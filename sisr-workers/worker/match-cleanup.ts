import { stopMatch } from './allocator';
import type { RirEnv } from './env';
import { pendingKey, routeKey } from './env';
import { errorFields, logError, logInfo, shortId } from './logging';

export interface MatchCleanupResourcesInput {
  matchId: string;
  players: readonly string[];
  reason: string;
  deleteD1?: boolean;
  stopContainer?: boolean;
}

export async function cleanupMatchResources(env: RirEnv, input: MatchCleanupResourcesInput): Promise<void> {
  const stopContainer = input.stopContainer ?? true;
  const operations: Promise<void>[] = [];

  if (stopContainer) {
    operations.push(stopMatch(env, input.matchId));
  }

  operations.push(deleteRoutingKeys(env, input.players));

  if (input.deleteD1) {
    operations.push(deleteMatchRows(env, input.matchId));
  }

  const results = await Promise.allSettled(operations);
  const failures = results.filter((result) => result.status === 'rejected');
  for (const failure of failures) {
    logError('match.cleanup.resource_failed', {
      matchId: shortId(input.matchId),
      reason: input.reason,
      ...errorFields(failure.reason),
    });
  }

  logInfo('match.cleanup.resources_done', {
    matchId: shortId(input.matchId),
    reason: input.reason,
    playerCount: input.players.length,
    deleteD1: Boolean(input.deleteD1),
    stopContainer,
    failureCount: failures.length,
  });
}

async function deleteRoutingKeys(env: RirEnv, players: readonly string[]): Promise<void> {
  await Promise.all(players.flatMap((uuid) => [env.ROUTING.delete(routeKey(uuid)), env.ROUTING.delete(pendingKey(uuid))]));
}

async function deleteMatchRows(env: RirEnv, matchId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM match_players WHERE match_id = ?').bind(matchId),
    env.DB.prepare('DELETE FROM matches WHERE match_id = ?').bind(matchId),
  ]);
}
