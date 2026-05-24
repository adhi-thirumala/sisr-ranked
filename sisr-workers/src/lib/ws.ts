import { useEffect, useEffectEvent, useState } from 'react';
import { webSocketUrl, type MatchFoundMessage, type MatchRealtimeMessage } from './api';

export type QueueSocketStatus =
  | { phase: 'idle' }
  | { phase: 'connecting' }
  | { phase: 'queued'; position: number | null }
  | { phase: 'matched' }
  | { phase: 'error'; error: string };

export type MatchSocketStatus = 'idle' | 'connecting' | 'connected' | 'error';

export function useQueueSocket(enabled: boolean, onMatchFound: (message: MatchFoundMessage) => void): QueueSocketStatus {
  const [status, setStatus] = useState<QueueSocketStatus>({ phase: 'idle' });
  const onMatchFoundEvent = useEffectEvent(onMatchFound);

  useEffect(() => {
    if (!enabled) {
      setStatus({ phase: 'idle' });
      return;
    }

    let closedByClient = false;
    let matched = false;
    const socket = new WebSocket(webSocketUrl('/api/queue/join'));
    const heartbeat = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send('ping');
    }, 15_000);
    setStatus({ phase: 'connecting' });

    socket.onopen = () => setStatus({ phase: 'queued', position: null });
    socket.onmessage = (event) => {
      const message = parseSocketMessage(event.data);

      if (isQueuedMessage(message)) {
        setStatus({ phase: 'queued', position: typeof message.position === 'number' ? message.position : null });
        return;
      }

      if (isMatchFoundMessage(message)) {
        matched = true;
        setStatus({ phase: 'matched' });
        onMatchFoundEvent(message);
        socket.close(1000, 'Match found');
      }
    };
    socket.onerror = () => {
      if (!matched && !closedByClient) setStatus({ phase: 'error', error: 'Queue socket failed' });
    };
    socket.onclose = (event) => {
      if (matched || closedByClient) return;
      setStatus({ phase: 'error', error: event.reason || 'Queue socket closed before a match was found' });
    };

    return () => {
      closedByClient = true;
      window.clearInterval(heartbeat);
      socket.close(1000, 'Leaving queue');
    };
  }, [enabled]);

  return status;
}

export function useMatchSocket(matchId: string | null, onMessage: (message: MatchRealtimeMessage) => void): MatchSocketStatus {
  const [status, setStatus] = useState<MatchSocketStatus>('idle');
  const onMessageEvent = useEffectEvent(onMessage);

  useEffect(() => {
    if (!matchId) {
      setStatus('idle');
      return;
    }

    let closedByClient = false;
    const socket = new WebSocket(webSocketUrl(`/api/match/${matchId}/ws`));
    const heartbeat = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send('ping');
    }, 15_000);

    setStatus('connecting');
    socket.onopen = () => setStatus('connected');
    socket.onmessage = (event) => {
      const message = parseSocketMessage(event.data);
      if (isMatchRealtimeMessage(message)) onMessageEvent(message);
    };
    socket.onerror = () => {
      if (!closedByClient) setStatus('error');
    };
    socket.onclose = (event) => {
      if (closedByClient) return;
      setStatus(event.code === 1000 ? 'idle' : 'error');
    };

    return () => {
      closedByClient = true;
      window.clearInterval(heartbeat);
      socket.close(1000, 'Leaving match view');
    };
  }, [matchId]);

  return status;
}

function parseSocketMessage(value: unknown): unknown {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isQueuedMessage(message: unknown): message is { type: 'queued'; position?: number } {
  return isRecord(message) && message.type === 'queued';
}

function isMatchFoundMessage(message: unknown): message is MatchFoundMessage {
  return (
    isRecord(message) &&
    message.type === 'match_found' &&
    typeof message.matchId === 'string' &&
    typeof message.targetItem === 'string' &&
    typeof message.serverAddress === 'string' &&
    typeof message.wsUrl === 'string' &&
    Array.isArray(message.players)
  );
}

function isMatchRealtimeMessage(message: unknown): message is MatchRealtimeMessage {
  return isRecord(message) && (message.type === 'match_state' || message.type === 'match_ready' || message.type === 'match_result' || message.type === 'match_aborted');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}
