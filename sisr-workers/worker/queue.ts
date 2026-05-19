import { DurableObject } from 'cloudflare:workers';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { allocateMatch, stopMatch } from './allocator';
import type { MatchPlayer, QueueEntry, RirEnv } from './env';
import { pendingKey, PENDING_TTL_SECONDS, QUEUE_WIDEN_AFTER_MS, routeKey } from './env';
import { internalHeaders, isWebSocketUpgrade, requireInternal } from './http';
import { chooseTargetItem } from './items';
import { normalizeUuid } from './uuid';

const restoreSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  elo: z.number(),
  joinedAt: z.number(),
  queueName: z.string(),
});

const notifySchema = z.object({
  uuid: z.string(),
  message: z.unknown(),
});

interface QueueSocketAttachment {
  uuid: string;
}

export class Queue extends DurableObject {
  private readonly state: DurableObjectState;
  private readonly bindings: RirEnv;

  constructor(state: DurableObjectState, env: Env & RirEnv) {
    super(state, env);
    this.state = state;
    this.bindings = env;
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/join' && request.method === 'GET') return this.handleJoin(request);
      if (url.pathname === '/borrow' && request.method === 'POST') return this.handleBorrow(request);
      if (url.pathname === '/restore' && request.method === 'POST') return this.handleRestore(request);
      if (url.pathname === '/notify-match' && request.method === 'POST') return this.handleNotifyMatch(request);
      return errorResponse(404, 'Not found');
    } catch (error) {
      if (error instanceof HTTPException) return errorResponse(error.status, error.message);
      return errorResponse(500, error instanceof Error ? error.message : 'Queue error');
    }
  }

  async alarm(): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      await this.tryFormLocalMatches();
      await this.tryWidenOldestWaiter();
      await this.scheduleNextAlarm();
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'ping') ws.send('pong');
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as QueueSocketAttachment | undefined;
    if (attachment?.uuid) await this.state.storage.delete(queueKey(attachment.uuid));
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  private async handleJoin(request: Request): Promise<Response> {
    if (!isWebSocketUpgrade(request)) return errorResponse(426, 'Expected WebSocket upgrade');

    const rawUser = request.headers.get('x-rir-user');
    const bracketName = request.headers.get('x-rir-bracket');
    if (!rawUser || !bracketName) return errorResponse(400, 'Missing queue context');
    const rawUserInput = z
      .object({ uuid: z.string(), name: z.string(), elo: z.number() })
      .parse(JSON.parse(rawUser)) as { uuid: string; name: string; elo: number };
    const user = { ...rawUserInput, uuid: normalizeUuid(rawUserInput.uuid) };

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ uuid: user.uuid } satisfies QueueSocketAttachment);

    await this.state.blockConcurrencyWhile(async () => {
      await this.state.storage.put('bracketName', bracketName);
      for (const socket of this.state.getWebSockets(userTag(user.uuid))) socket.close(1000, 'Replaced by a newer queue socket');

      this.state.acceptWebSocket(server, [userTag(user.uuid)]);
      const entry: QueueEntry = {
        uuid: user.uuid,
        name: user.name,
        elo: user.elo,
        joinedAt: Date.now(),
        queueName: bracketName,
      };
      await this.state.storage.put(queueKey(user.uuid), entry);
      await this.sendQueuePosition(user.uuid);
      await this.tryFormLocalMatches();
      await this.scheduleNextAlarm();
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleBorrow(request: Request): Promise<Response> {
    requireInternal(request);
    const bracketName = await this.currentBracketName();

    return this.state.blockConcurrencyWhile(async () => {
      await this.tryFormLocalMatches();
      const waiters = await this.listWaiters();
      if (waiters.length !== 1) return new Response(null, { status: 204 });

      const [waiter] = waiters;
      await this.state.storage.delete(queueKey(waiter.uuid));
      await this.state.storage.put('bracketName', bracketName);
      return Response.json({ waiter });
    });
  }

  private async handleRestore(request: Request): Promise<Response> {
    requireInternal(request);
    const rawWaiter = restoreSchema.parse(await parseJson(request));
    const waiter = { ...rawWaiter, uuid: normalizeUuid(rawWaiter.uuid) };
    await this.state.blockConcurrencyWhile(async () => {
      await this.state.storage.put(queueKey(waiter.uuid), waiter);
      await this.sendQueuePosition(waiter.uuid);
      await this.scheduleNextAlarm();
    });
    return Response.json({ ok: true });
  }

  private async handleNotifyMatch(request: Request): Promise<Response> {
    requireInternal(request);
    const { uuid, message } = notifySchema.parse(await parseJson(request));
    await this.notifyLocalWaiter(normalizeUuid(uuid), message);
    return Response.json({ ok: true });
  }

  private async tryFormLocalMatches(): Promise<void> {
    while (true) {
      const waiters = await this.listWaiters();
      if (waiters.length < 2) return;

      const selected = waiters.slice(0, 2);
      await this.deleteWaiters(selected);
      try {
        await this.formMatch(selected);
      } catch (error) {
        await this.restoreWaiters(selected);
        throw error;
      }
    }
  }

  private async tryWidenOldestWaiter(): Promise<void> {
    const waiters = await this.listWaiters();
    if (waiters.length !== 1) return;

    const [oldest] = waiters;
    if (Date.now() - oldest.joinedAt < QUEUE_WIDEN_AFTER_MS) return;

    for (const neighbor of neighborBrackets(await this.currentBracketName())) {
      const borrowed = await this.borrowFromNeighbor(neighbor);
      if (!borrowed) continue;

      const selected = [oldest, borrowed];
      await this.state.storage.delete(queueKey(oldest.uuid));
      try {
        await this.formMatch(selected);
      } catch (error) {
        await this.restoreWaiters(selected);
        throw error;
      }
      return;
    }
  }

  private async borrowFromNeighbor(queueName: string): Promise<QueueEntry | null> {
    const stub = this.bindings.QUEUE.getByName(queueName);
    const response = await stub.fetch('https://queue.internal/borrow', {
      method: 'POST',
      headers: internalHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ requester: await this.currentBracketName() }),
    });
    if (response.status === 204) return null;
    if (!response.ok) throw new Error(`Neighbor borrow failed: ${response.status}`);
    const payload = (await response.json()) as { waiter: QueueEntry };
    return payload.waiter;
  }

  private async formMatch(waiters: QueueEntry[]): Promise<void> {
    const matchId = crypto.randomUUID();
    const targetItem = chooseTargetItem();
    const worldSeed = createWorldSeed();
    const players = waiters.map((waiter) => waiter.uuid);
    let allocated = false;

    try {
      const allocation = await allocateMatch(this.bindings, { matchId, players, targetItem, worldSeed });
      allocated = true;
      const startedAt = Math.floor(Date.now() / 1000);
      const matchPlayers: MatchPlayer[] = waiters.map((waiter) => ({
        uuid: waiter.uuid,
        name: waiter.name,
        eloBefore: waiter.elo,
      }));

      const seedResponse = await this.bindings.MATCH.getByName(matchId).fetch('https://match.internal/internal/seed', {
        method: 'POST',
        headers: internalHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          matchId,
          players: matchPlayers,
          targetItem,
          worldSeed,
          serverName: allocation.serverName,
          serverAddress: allocation.address,
          startedAt,
        }),
      });
      if (!seedResponse.ok) throw new Error(`Match seed failed: ${seedResponse.status} ${await seedResponse.text()}`);

      const message = {
        type: 'match_found',
        matchId,
        players: matchPlayers,
        targetItem,
        serverAddress: allocation.address,
        wsUrl: `/api/match/${matchId}/ws`,
      };

      await Promise.all(
        waiters.map((waiter) =>
          this.bindings.ROUTING.put(
            pendingKey(waiter.uuid),
            JSON.stringify({ matchId, targetItem, serverAddress: allocation.address }),
            { expirationTtl: PENDING_TTL_SECONDS },
          ),
        ),
      );

      await Promise.allSettled(waiters.map((waiter) => this.notifyWaiter(waiter, message)));
    } catch (error) {
      if (allocated) await stopMatch(this.bindings, matchId).catch(() => undefined);
      await Promise.all(players.map((uuid) => this.bindings.ROUTING.delete(routeKey(uuid))));
      throw error;
    }
  }

  private async notifyWaiter(waiter: QueueEntry, message: unknown): Promise<void> {
    if (waiter.queueName === (await this.currentBracketName())) {
      await this.notifyLocalWaiter(waiter.uuid, message);
      return;
    }

    const response = await this.bindings.QUEUE.getByName(waiter.queueName).fetch('https://queue.internal/notify-match', {
      method: 'POST',
      headers: internalHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ uuid: waiter.uuid, message }),
    });
    if (!response.ok) throw new Error(`Remote queue notify failed: ${response.status}`);
  }

  private async notifyLocalWaiter(uuid: string, message: unknown): Promise<void> {
    for (const socket of this.state.getWebSockets(userTag(uuid))) {
      socket.send(JSON.stringify(message));
      socket.close(1000, 'Match found');
    }
    await this.state.storage.delete(queueKey(uuid));
  }

  private async sendQueuePosition(uuid: string): Promise<void> {
    const waiters = await this.listWaiters();
    const position = waiters.findIndex((waiter) => waiter.uuid === uuid) + 1;
    for (const socket of this.state.getWebSockets(userTag(uuid))) {
      socket.send(JSON.stringify({ type: 'queued', position }));
    }
  }

  private async listWaiters(): Promise<QueueEntry[]> {
    const records = await this.state.storage.list<QueueEntry>({ prefix: 'q:' });
    return [...records.values()].sort((left, right) => left.joinedAt - right.joinedAt);
  }

  private async deleteWaiters(waiters: QueueEntry[]): Promise<void> {
    await this.state.storage.delete(waiters.map((waiter) => queueKey(waiter.uuid)));
  }

  private async restoreWaiters(waiters: QueueEntry[]): Promise<void> {
    const currentBracket = await this.currentBracketName();
    await Promise.all(
      waiters.map((waiter) => {
        if (waiter.queueName === currentBracket) return this.state.storage.put(queueKey(waiter.uuid), waiter);
        return this.bindings.QUEUE.getByName(waiter.queueName).fetch('https://queue.internal/restore', {
          method: 'POST',
          headers: internalHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify(waiter),
        });
      }),
    );
  }

  private async scheduleNextAlarm(): Promise<void> {
    const waiters = await this.listWaiters();
    if (waiters.length === 0) {
      await this.state.storage.deleteAlarm();
      return;
    }

    const nextAt = waiters[0].joinedAt + QUEUE_WIDEN_AFTER_MS;
    await this.state.storage.setAlarm(Math.max(Date.now() + 1_000, nextAt));
  }

  private async currentBracketName(): Promise<string> {
    const name = await this.state.storage.get<string>('bracketName');
    if (!name) throw new Error('Queue bracket has not been initialized');
    return name;
  }
}

export function bracketForElo(elo: number): string {
  if (elo < 1100) return 'bracket:0-1100';
  const lower = Math.floor(elo / 100) * 100;
  return `bracket:${lower}-${lower + 100}`;
}

function neighborBrackets(name: string): string[] {
  const match = /^bracket:(\d+)-(\d+)$/.exec(name);
  if (!match) return [];
  const lower = Number(match[1]);
  const upper = Number(match[2]);
  const neighbors: string[] = [];
  if (lower === 0 && upper === 1100) neighbors.push('bracket:1100-1200');
  else {
    neighbors.push(lower === 1100 ? 'bracket:0-1100' : `bracket:${lower - 100}-${lower}`);
    neighbors.push(`bracket:${upper}-${upper + 100}`);
  }
  return neighbors;
}

function queueKey(uuid: string): string {
  return `q:${normalizeUuid(uuid)}`;
}

function userTag(uuid: string): string {
  return `user:${normalizeUuid(uuid)}`;
}

function createWorldSeed(): string {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  return `${bytes[0]}${bytes[1]}`;
}

function errorResponse(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

async function parseJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON body' });
  }
}
