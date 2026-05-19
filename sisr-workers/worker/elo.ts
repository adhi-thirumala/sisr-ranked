import EloRating from 'elo-rating';
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
  const playerAWon = a.uuid === winnerUuid;
  const { playerRating: afterA, opponentRating: afterB } = EloRating.calculate(
    a.eloBefore,
    b.eloBefore,
    playerAWon,
    K_FACTOR,
  );

  return {
    [a.uuid]: {
      before: a.eloBefore,
      after: afterA,
      delta: afterA - a.eloBefore,
      placement: playerAWon ? 1 : 2,
    },
    [b.uuid]: {
      before: b.eloBefore,
      after: afterB,
      delta: afterB - b.eloBefore,
      placement: playerAWon ? 2 : 1,
    },
  };
}
