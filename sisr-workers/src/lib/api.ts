export interface AuthenticatedUser {
  uuid: string;
  name: string;
  elo: number;
  matches: number;
  wins: number;
}

export interface LeaderboardEntry extends AuthenticatedUser {}

export interface MatchPlayer {
  uuid: string;
  name?: string;
  eloBefore: number;
}

export interface EloChange {
  before: number;
  after: number;
  delta: number;
}

export interface MatchState {
  matchId: string;
  players: MatchPlayer[];
  targetItem: string;
  serverAddress: string;
  ready: boolean;
  readyAt: number | null;
  startedAt: number;
  winner: string | null;
  endedAt: number | null;
  eloChanges?: Record<string, EloChange>;
}

export interface MatchFoundMessage {
  type: 'match_found';
  matchId: string;
  players: MatchPlayer[];
  targetItem: string;
  serverAddress: string;
  wsUrl: string;
}

export interface MatchStateMessage extends MatchState {
  type: 'match_state';
}

export interface MatchReadyMessage {
  type: 'match_ready';
  matchId: string;
  players: string[];
  serverAddress: string;
}

export interface MatchResultMessage {
  type: 'match_result';
  matchId: string;
  winner: string;
  eloChanges?: Record<string, EloChange>;
}

export type MatchRealtimeMessage = MatchStateMessage | MatchReadyMessage | MatchResultMessage;

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  if (!response.ok) throw new Error(await responseErrorMessage(response));
  return (await response.json()) as T;
}

export async function startMicrosoftSignIn(redirectTo = '/queue'): Promise<void> {
  const data = await apiJson<{ url: string }>('/api/auth/microsoft/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirectTo }),
  });
  window.location.assign(data.url);
}

export function applyMatchRealtimeMessage(state: MatchState | null, message: MatchRealtimeMessage): MatchState | null {
  if (message.type === 'match_state') {
    const { type: _type, ...nextState } = message;
    return nextState;
  }

  if (!state || state.matchId !== message.matchId) return state;

  if (message.type === 'match_ready') {
    return {
      ...state,
      ready: true,
      readyAt: state.readyAt ?? nowSeconds(),
      serverAddress: message.serverAddress || state.serverAddress,
    };
  }

  return {
    ...state,
    winner: message.winner,
    endedAt: state.endedAt ?? nowSeconds(),
    eloChanges: message.eloChanges ?? state.eloChanges,
  };
}

export function webSocketUrl(path: string): string {
  if (path.startsWith('ws://') || path.startsWith('wss://')) return path;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${protocol}//${window.location.host}${normalizedPath}`;
}

export function formatItemName(item: string): string {
  const rawName = item.includes(':') ? item.split(':')[1] : item;
  return rawName
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatRating(value: number): string {
  return Math.round(value).toString();
}

export function winRate(user: Pick<AuthenticatedUser, 'matches' | 'wins'>): string {
  if (user.matches === 0) return '0%';
  return `${Math.round((user.wins / user.matches) * 100)}%`;
}

export function playerAvatarUrl(uuid: string): string {
  return `https://crafatar.com/avatars/${uuid}?overlay&size=96`;
}

export async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function responseErrorMessage(response: Response): Promise<string> {
  const json = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (json && typeof json.error === 'string') return json.error;
  return `${response.status} ${response.statusText}`;
}
