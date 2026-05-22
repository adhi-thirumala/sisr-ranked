import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { applyMatchRealtimeMessage, type MatchFoundMessage, type MatchState } from './api';
import { useAuth } from './auth';
import { createRevealConfig, type RevealConfig } from './items';
import { QueueContext } from './queue-context';
import { type MatchSocketStatus, type QueueSocketStatus, useMatchSocket, useQueueSocket } from './ws';

export function QueueProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [isQueueing, setIsQueueing] = useState(false);
  const [queuedSince, setQueuedSince] = useState<number | null>(null);
  const [match, setMatch] = useState<MatchFoundMessage | null>(null);
  const [matchState, setMatchState] = useState<MatchState | null>(null);
  const [reveal, setReveal] = useState<RevealConfig | null>(null);
  const [revealComplete, setRevealComplete] = useState(false);

  const socketStatus = useQueueSocket(status === 'authenticated' && isQueueing && !match, (message) => {
    setIsQueueing(false);
    setQueuedSince(null);
    setMatch(message);
    setMatchState(initialMatchState(message));
    setReveal(createRevealConfig(message.targetItem));
    setRevealComplete(false);
  });

  const matchSocketStatus = useMatchSocket(match?.matchId ?? null, (message) => {
    setMatchState((current) => applyMatchRealtimeMessage(current, message));
  });

  const reset = useCallback(() => {
    setIsQueueing(false);
    setQueuedSince(null);
    setMatch(null);
    setMatchState(null);
    setReveal(null);
    setRevealComplete(false);
  }, []);

  const joinQueue = useCallback(() => {
    if (status !== 'authenticated' || match || isQueueing) return;
    setQueuedSince(Date.now());
    setIsQueueing(true);
  }, [isQueueing, match, status]);

  const leaveQueue = useCallback(() => {
    if (match) return;
    reset();
  }, [match, reset]);

  const queueAgain = useCallback(() => {
    setMatch(null);
    setMatchState(null);
    setReveal(null);
    setRevealComplete(false);
    setQueuedSince(Date.now());
    setIsQueueing(status === 'authenticated');
  }, [status]);

  const markRevealComplete = useCallback(() => {
    setRevealComplete(true);
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') reset();
  }, [reset, status]);

  const queueStatus: QueueSocketStatus = match ? { phase: 'matched' } : socketStatus;

  return (
    <QueueContext.Provider
      value={{
        queueStatus,
        queuedSince,
        match,
        matchState,
        reveal,
        revealComplete,
        matchSocketStatus,
        joinQueue,
        leaveQueue,
        queueAgain,
        markRevealComplete,
      }}
    >
      {children}
    </QueueContext.Provider>
  );
}

function initialMatchState(message: MatchFoundMessage): MatchState {
  return {
    matchId: message.matchId,
    players: message.players,
    targetItem: message.targetItem,
    serverAddress: message.serverAddress,
    ready: false,
    readyAt: null,
    startedAt: Math.floor(Date.now() / 1000),
    winner: null,
    endedAt: null,
  };
}
