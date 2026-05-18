import { z } from 'zod';
import type { AllocationResult, RirEnv, RouteEntry } from './env';
import { routeKey, ROUTE_TTL_SECONDS } from './env';

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
    throw new Error(`Agent /match/start failed with ${response.status}: ${await response.text()}`);
  }

  const allocation = allocationSchema.parse(await response.json());
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

  return allocation;
}

export async function stopMatch(env: RirEnv, matchId: string): Promise<void> {
  const response = await fetch(`${trimTrailingSlash(env.AGENT_BASE_URL)}/match/stop`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.AGENT_SERVICE_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ matchId }),
  });

  if (!response.ok) {
    throw new Error(`Agent /match/stop failed with ${response.status}: ${await response.text()}`);
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
