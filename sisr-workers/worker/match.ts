import { DurableObject } from 'cloudflare:workers';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { stopMatch } from './allocator';
import { calculateOneVOneElo } from './elo';
import type { MatchMeta, RirEnv, RouteEntry } from './env';
import { LEADERBOARD_CACHE_KEY, routeKey, ROUTE_TTL_SECONDS, VELOCITY_HUB_NAME } from './env';
import { internalHeaders, isWebSocketUpgrade, nowSeconds, requireInternal } from './http';

const playerSchema = z.object({
  uuid: z.string(),
  name: z.string().optional(),
  eloBefore: z.number(),
});

const seedSchema = z.object({
  matchId: z.string(),
  players: z.array(playerSchema).min(2),
  targetItem: z.string(),
  worldSeed: z.string(),
  serverName: z.string(),
  serverAddress: z.string(),
  startedAt: z.number(),
});

const readySchema = z.object({
  serverAddress: z.string().optional(),
});

const claimSchema = z.object({ uuid: z.string() });

interface MatchSocketAttachment {
  kind: 'player' | 'spectator' | 'velocity';
  uuid?: string;
}

export class Match extends DurableObject {
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
      if (url.pathname === '/ws' && request.method === 'GET') return this.handlePlayerSocket(request);
      if (url.pathname === '/velocity/events' && request.method === 'GET') return this.handleVelocitySocket(request);
      if (url.pathname === '/internal/broadcast' && request.method === 'POST') return this.handleHubBroadcast(request);
      if (url.pathname === '/internal/seed' && request.method === 'POST') return this.handleSeed(request);
      if (url.pathname === '/ready' && request.method === 'POST') return this.handleReady(request);
      if (url.pathname === '/claim' && request.method === 'POST') return this.handleClaim(request);
      if (url.pathname === '/state' && request.method === 'GET') return this.handleState();
      return errorResponse(404, 'Not found');
    } catch (error) {
      if (error instanceof HTTPException) return errorResponse(error.status, error.message);
      return errorResponse(500, error instanceof Error ? error.message : 'Match error');
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'ping') ws.send('pong');
  }

  async webSocketClose(): Promise<void> {}

  async webSocketError(): Promise<void> {}

  private async handlePlayerSocket(request: Request): Promise<Response> {
    if (!isWebSocketUpgrade(request)) return errorResponse(426, 'Expected WebSocket upgrade');
    const rawUser = request.headers.get('x-rir-user');
    if (!rawUser) return errorResponse(401, 'Unauthorized');
    const user = z.object({ uuid: z.string() }).parse(JSON.parse(rawUser));
    const meta = await this.getMeta();
    const isPlayer = Boolean(meta?.players.some((player) => player.uuid === user.uuid));

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ kind: isPlayer ? 'player' : 'spectator', uuid: user.uuid } satisfies MatchSocketAttachment);
    this.state.acceptWebSocket(server, [isPlayer ? playerTag(user.uuid) : 'spectator']);
    if (meta) server.send(JSON.stringify({ type: 'match_state', ...publicMatchState(meta) }));
    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleVelocitySocket(request: Request): Promise<Response> {
    if (!isWebSocketUpgrade(request)) return errorResponse(426, 'Expected WebSocket upgrade');
    if (request.headers.get('x-rir-service') !== '1') return errorResponse(401, 'Unauthorized');

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ kind: 'velocity' } satisfies MatchSocketAttachment);
    this.state.acceptWebSocket(server, ['velocity']);
    server.send(JSON.stringify({ type: 'velocity_connected' }));
    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleHubBroadcast(request: Request): Promise<Response> {
    requireInternal(request);
    const message = await parseJson(request);
    this.broadcastToTag('velocity', message);
    return Response.json({ ok: true });
  }

  private async handleSeed(request: Request): Promise<Response> {
    requireInternal(request);
    const input = seedSchema.parse(await parseJson(request));
    const existing = await this.getMeta();
    if (existing) return Response.json(existing);

    const meta: MatchMeta = {
      matchId: input.matchId,
      players: input.players,
      targetItem: input.targetItem,
      worldSeed: input.worldSeed,
      serverName: input.serverName,
      serverAddress: input.serverAddress,
      startedAt: input.startedAt,
      readyAt: null,
      winnerUuid: null,
      endedAt: null,
    };

    await this.bindings.DB.batch([
      this.bindings.DB
        .prepare('INSERT OR IGNORE INTO matches (match_id, target_item, started_at) VALUES (?, ?, ?)')
        .bind(meta.matchId, meta.targetItem, meta.startedAt),
      ...meta.players.map((player) =>
        this.bindings.DB
          .prepare('INSERT OR IGNORE INTO match_players (match_id, mc_uuid, elo_before) VALUES (?, ?, ?)')
          .bind(meta.matchId, player.uuid, player.eloBefore),
      ),
    ]);

    await this.state.storage.put('meta', meta);
    return Response.json(meta);
  }

  private async handleReady(request: Request): Promise<Response> {
    const input = readySchema.parse(await parseJson(request));
    const meta = await this.requireMeta();
    if (meta.readyAt === null) {
      meta.readyAt = nowSeconds();
      if (input.serverAddress) meta.serverAddress = input.serverAddress;
      await this.state.storage.put('meta', meta);
      await Promise.all(
        meta.players.map((player) => {
          const route: RouteEntry = {
            matchId: meta.matchId,
            serverAddress: meta.serverAddress,
            serverName: meta.serverName,
            ready: true,
            targetItem: meta.targetItem,
          };
          return this.bindings.ROUTING.put(routeKey(player.uuid), JSON.stringify(route), { expirationTtl: ROUTE_TTL_SECONDS });
        }),
      );
      const message = {
        type: 'match_ready',
        matchId: meta.matchId,
        players: meta.players.map((player) => player.uuid),
        serverAddress: meta.serverAddress,
      };
      this.broadcastToPlayers(meta, message);
      await this.broadcastToVelocity(message);
    }

    return Response.json({ ok: true, ...publicMatchState(meta) });
  }

  private async handleClaim(request: Request): Promise<Response> {
    const { uuid } = claimSchema.parse(await parseJson(request));
    let result: unknown;

    await this.state.blockConcurrencyWhile(async () => {
      result = await this.claim(uuid.toLowerCase());
    });

    return Response.json(result);
  }

  private async handleState(): Promise<Response> {
    const meta = await this.requireMeta();
    return Response.json(publicMatchState(meta));
  }

  private async claim(uuid: string): Promise<unknown> {
    const meta = await this.requireMeta();
    const canonicalWinner = await this.findPersistedWinner(meta.matchId);
    if (canonicalWinner) {
      meta.winnerUuid = canonicalWinner;
      await this.state.storage.put('meta', meta);
      return { winner: canonicalWinner, youWon: canonicalWinner === uuid, alreadyDecided: true };
    }

    if (meta.winnerUuid) return { winner: meta.winnerUuid, youWon: meta.winnerUuid === uuid, alreadyDecided: true };
    if (!meta.players.some((player) => player.uuid === uuid)) {
      throw new HTTPException(403, { message: 'Claimant is not in this match' });
    }

    const endedAt = nowSeconds();
    const outcomes = calculateOneVOneElo(meta.players, uuid);
    const statements: D1PreparedStatement[] = [
      this.bindings.DB
        .prepare('UPDATE matches SET winner_uuid = ?, ended_at = ? WHERE match_id = ? AND winner_uuid IS NULL')
        .bind(uuid, endedAt, meta.matchId),
    ];

    for (const player of meta.players) {
      const outcome = outcomes[player.uuid];
      const won = player.uuid === uuid ? 1 : 0;
      statements.push(
        this.bindings.DB
          .prepare(
            `UPDATE users
             SET elo = ?, matches = matches + 1, wins = wins + ?
             WHERE mc_uuid = ?
               AND EXISTS (
                 SELECT 1 FROM match_players
                 WHERE match_id = ? AND mc_uuid = ? AND elo_after IS NULL
               )`,
          )
          .bind(outcome.after, won, player.uuid, meta.matchId, player.uuid),
      );
      statements.push(
        this.bindings.DB
          .prepare(
            `UPDATE match_players
             SET elo_after = ?, placement = ?
             WHERE match_id = ? AND mc_uuid = ? AND elo_after IS NULL`,
          )
          .bind(outcome.after, outcome.placement, meta.matchId, player.uuid),
      );
    }

    await this.bindings.DB.batch(statements);
    meta.winnerUuid = uuid;
    meta.endedAt = endedAt;
    meta.eloChanges = Object.fromEntries(
      Object.entries(outcomes).map(([playerUuid, outcome]) => [
        playerUuid,
        { before: outcome.before, after: outcome.after, delta: outcome.delta },
      ]),
    );
    await this.state.storage.put('meta', meta);
    await this.bindings.CACHE.delete(LEADERBOARD_CACHE_KEY);
    await Promise.all(meta.players.map((player) => this.bindings.ROUTING.delete(routeKey(player.uuid))));

    const message = {
      type: 'match_result',
      matchId: meta.matchId,
      winner: uuid,
      eloChanges: meta.eloChanges,
    };
    this.broadcastToPlayers(meta, message);
    await this.broadcastToVelocity(message);
    this.state.waitUntil(stopMatch(this.bindings, meta.matchId).catch(() => undefined));

    return { winner: uuid, youWon: true, eloChanges: meta.eloChanges };
  }

  private async getMeta(): Promise<MatchMeta | null> {
    return (await this.state.storage.get<MatchMeta>('meta')) ?? null;
  }

  private async requireMeta(): Promise<MatchMeta> {
    const meta = await this.getMeta();
    if (!meta) throw new HTTPException(404, { message: 'Match not found' });
    return meta;
  }

  private async findPersistedWinner(matchId: string): Promise<string | null> {
    const row = await this.bindings.DB
      .prepare('SELECT winner_uuid FROM matches WHERE match_id = ? AND winner_uuid IS NOT NULL')
      .bind(matchId)
      .first<{ winner_uuid: string }>();
    return row?.winner_uuid ?? null;
  }

  private broadcastToPlayers(meta: MatchMeta, message: unknown): void {
    for (const player of meta.players) this.broadcastToTag(playerTag(player.uuid), message);
    this.broadcastToTag('spectator', message);
  }

  private broadcastToTag(tag: string, message: unknown): void {
    const payload = JSON.stringify(message);
    for (const socket of this.state.getWebSockets(tag)) socket.send(payload);
  }

  private async broadcastToVelocity(message: unknown): Promise<void> {
    await this.bindings.MATCH.getByName(VELOCITY_HUB_NAME).fetch('https://match.internal/internal/broadcast', {
      method: 'POST',
      headers: internalHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(message),
    });
  }
}

function publicMatchState(meta: MatchMeta): Record<string, unknown> {
  return {
    matchId: meta.matchId,
    players: meta.players,
    targetItem: meta.targetItem,
    serverAddress: meta.serverAddress,
    ready: meta.readyAt !== null,
    readyAt: meta.readyAt,
    startedAt: meta.startedAt,
    winner: meta.winnerUuid,
    endedAt: meta.endedAt,
    eloChanges: meta.eloChanges,
  };
}

function playerTag(uuid: string): string {
  return `player:${uuid.toLowerCase()}`;
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
