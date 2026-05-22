import { z } from 'zod';
import type { AllocationResult, RirEnv, RouteEntry } from './env';
import { routeKey, ROUTE_TTL_SECONDS } from './env';
import { errorFields, logError, logInfo, shortId } from './logging';

const allocationSchema = z.object({
  serverName: z.string().min(1),
  address: z.string().min(1),
});

export interface AllocateMatchInput {
  matchId: string;
  players: string[];
  targetItem: string;
  worldSeed: string;
}

export async function allocateMatch(env: RirEnv, input: AllocateMatchInput): Promise<AllocationResult> {
  const startedAt = Date.now();
  logInfo('allocator.match.start.request', { matchId: shortId(input.matchId), playerCount: input.players.length, targetItem: input.targetItem });
  const response = await fetch(`${trimTrailingSlash(env.AGENT_BASE_URL)}/match/start`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.AGENT_SERVICE_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      matchId: input.matchId,
      players: input.players,
      targetItem: input.targetItem,
      worldSeed: input.worldSeed,
      viewDistance: 6,
      simulationDistance: 4,
      jvmFlags: ['-Xms200m', '-Xmx480m', '-XX:+UseG1GC', '-XX:MaxGCPauseMillis=50'],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    logError('allocator.match.start.failed', { matchId: shortId(input.matchId), status: response.status, body: truncate(body), durationMs: Date.now() - startedAt });
    throw new Error(`Agent /match/start failed with ${response.status}: ${body}`);
  }

  let allocation: AllocationResult;
  try {
    allocation = allocationSchema.parse(await response.json());
  } catch (error) {
    logError('allocator.match.start.invalid_response', { matchId: shortId(input.matchId), ...errorFields(error) });
    throw error;
  }

  await Promise.all(
    input.players.map((uuid) => {
      const route: RouteEntry = {
        matchId: input.matchId,
        serverAddress: allocation.address,
        serverName: allocation.serverName,
        ready: false,
        targetItem: input.targetItem,
      };
      return env.ROUTING.put(routeKey(uuid), JSON.stringify(route), { expirationTtl: ROUTE_TTL_SECONDS });
    }),
  );

  logInfo('allocator.match.start.ok', {
    matchId: shortId(input.matchId),
    serverName: allocation.serverName,
    address: allocation.address,
    playerCount: input.players.length,
    durationMs: Date.now() - startedAt,
  });

  return allocation;
}

export async function stopMatch(env: RirEnv, matchId: string): Promise<void> {
  const startedAt = Date.now();
  logInfo('allocator.match.stop.request', { matchId: shortId(matchId) });
  const response = await fetch(`${trimTrailingSlash(env.AGENT_BASE_URL)}/match/stop`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.AGENT_SERVICE_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ matchId }),
  });

  if (!response.ok) {
    const body = await response.text();
    logError('allocator.match.stop.failed', { matchId: shortId(matchId), status: response.status, body: truncate(body), durationMs: Date.now() - startedAt });
    throw new Error(`Agent /match/stop failed with ${response.status}: ${body}`);
  }

  logInfo('allocator.match.stop.ok', { matchId: shortId(matchId), durationMs: Date.now() - startedAt });
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function truncate(value: string, maxLength = 500): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
