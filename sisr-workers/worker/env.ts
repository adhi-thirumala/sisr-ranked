import { normalizeUuid } from './uuid';

export interface RirEnv {
  ASSETS: Fetcher;
  DB: D1Database;
  ROUTING: KVNamespace;
  CACHE: KVNamespace;
  QUEUE: DurableObjectNamespace;
  MATCH: DurableObjectNamespace;
  AGENT: Fetcher;
  OAUTH_REDIRECT_URI?: string;
  MS_CLIENT_ID: string;
  MS_CLIENT_SECRET?: string;
  SESSION_SECRET: string;
  AGENT_SERVICE_TOKEN: string;
  SERVICE_API_TOKEN?: string;
}

export interface AuthenticatedUser {
  uuid: string;
  name: string;
  elo: number;
  matches: number;
  wins: number;
}

export interface QueueEntry {
  uuid: string;
  name: string;
  elo: number;
  joinedAt: number;
  queueName: string;
}

export interface RouteEntry {
  matchId: string;
  serverAddress: string;
  serverName?: string;
  ready: boolean;
  targetItem?: string;
}

export interface MatchPlayer {
  uuid: string;
  name?: string;
  eloBefore: number;
}

export interface MatchMeta {
  matchId: string;
  players: MatchPlayer[];
  targetItem: string;
  worldSeed: string;
  serverName: string;
  serverAddress: string;
  startedAt: number;
  readyAt: number | null;
  winnerUuid: string | null;
  endedAt: number | null;
  eloChanges?: Record<string, { before: number; after: number; delta: number }>;
}

export interface AllocationResult {
  serverName: string;
  address: string;
}

export const LEADERBOARD_CACHE_KEY = 'leaderboard:top100';
export const ROUTE_TTL_SECONDS = 30 * 60;
export const PENDING_TTL_SECONDS = 60;
export const QUEUE_WIDEN_AFTER_MS = 30_000;
export const VELOCITY_HUB_NAME = 'velocity:events';

export function routeKey(uuid: string): string {
  return `route:${normalizeUuid(uuid)}`;
}

export function pendingKey(uuid: string): string {
  return `pending:${normalizeUuid(uuid)}`;
}
