import { createContext, useContext } from 'react';
import type { MatchFoundMessage, MatchState } from './api';
import type { RevealConfig } from './items';
import type { MatchSocketStatus, QueueSocketStatus } from './ws';

export interface QueueContextValue {
  queueStatus: QueueSocketStatus;
  queuedSince: number | null;
  match: MatchFoundMessage | null;
  matchState: MatchState | null;
  reveal: RevealConfig | null;
  revealComplete: boolean;
  matchSocketStatus: MatchSocketStatus;
  isForfeitingMatch: boolean;
  joinQueue: () => void;
  leaveQueue: () => void;
  queueAgain: () => void;
  forfeitMatch: () => Promise<void>;
  markRevealComplete: () => void;
}

export const QueueContext = createContext<QueueContextValue | null>(null);

export function useQueue(): QueueContextValue {
  const value = useContext(QueueContext);
  if (!value) throw new Error('useQueue must be used inside QueueProvider');
  return value;
}
