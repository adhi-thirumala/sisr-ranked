import type { MatchPlayer } from './env';

const K_FACTOR = 24;

export interface EloOutcome {
  before: number;
  after: number;
  delta: number;
  placement: number;
}

export function calculateOneVOneElo(players: MatchPlayer[], winnerUuid: string): Record<string, EloOutcome> {
  if (players.length !== 2) {
    throw new Error('1v1 Elo requires exactly two players');
  }

  const [a, b] = players;
  const expectedA = 1 / (1 + 10 ** ((b.eloBefore - a.eloBefore) / 400));
  const expectedB = 1 - expectedA;
  const scoreA = a.uuid === winnerUuid ? 1 : 0;
  const scoreB = b.uuid === winnerUuid ? 1 : 0;
  const afterA = roundRating(a.eloBefore + K_FACTOR * (scoreA - expectedA));
  const afterB = roundRating(b.eloBefore + K_FACTOR * (scoreB - expectedB));

  return {
    [a.uuid]: {
      before: a.eloBefore,
      after: afterA,
      delta: roundRating(afterA - a.eloBefore),
      placement: scoreA === 1 ? 1 : 2,
    },
    [b.uuid]: {
      before: b.eloBefore,
      after: afterB,
      delta: roundRating(afterB - b.eloBefore),
      placement: scoreB === 1 ? 1 : 2,
    },
  };
}

function roundRating(value: number): number {
  return Math.round(value * 100) / 100;
}
