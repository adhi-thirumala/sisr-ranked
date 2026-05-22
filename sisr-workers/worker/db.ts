import type { AuthenticatedUser, RirEnv } from './env';
import { LEADERBOARD_CACHE_KEY } from './env';
import { nowSeconds } from './http';
import { logInfo, shortId } from './logging';
import { tryUuidToBlob, uuidFromBlob, uuidToBlob } from './uuid';

interface UserRecord {
  mc_uuid: ArrayBuffer;
  mc_name: string;
  elo: number;
  matches: number;
  wins: number;
}

interface LeaderboardRecord {
  uuid: ArrayBuffer;
  name: string;
  elo: number;
  matches: number;
  wins: number;
}

export interface LeaderboardEntry {
  uuid: string;
  name: string;
  elo: number;
  matches: number;
  wins: number;
}

const LEADERBOARD_CACHE_TTL_SECONDS = 60;

export function mapUser(row: UserRecord): AuthenticatedUser {
  return {
    uuid: uuidFromBlob(row.mc_uuid),
    name: row.mc_name,
    elo: row.elo,
    matches: row.matches,
    wins: row.wins,
  };
}

export async function getUser(db: D1Database, uuid: string): Promise<AuthenticatedUser | null> {
  const uuidBlob = tryUuidToBlob(uuid);
  if (!uuidBlob) return null;

  const row = await db
    .prepare('SELECT mc_uuid, mc_name, elo, matches, wins FROM users WHERE mc_uuid = ?')
    .bind(uuidBlob)
    .first<UserRecord>();
  const user = row ? mapUser(row) : null;
  logInfo('db.user.lookup', { user: shortId(uuid), found: Boolean(user) });
  return user;
}

export async function upsertUser(db: D1Database, uuid: string, name: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (mc_uuid, mc_name, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(mc_uuid) DO UPDATE SET mc_name = excluded.mc_name`,
    )
    .bind(uuidToBlob(uuid), name, nowSeconds())
    .run();
  logInfo('db.user.upserted', { user: shortId(uuid), name });
}

export async function getLeaderboard(env: RirEnv): Promise<LeaderboardEntry[]> {
  const cached = await env.CACHE.get(LEADERBOARD_CACHE_KEY);
  if (cached) {
    logInfo('db.leaderboard.cache_hit');
    return JSON.parse(cached) as LeaderboardEntry[];
  }

  logInfo('db.leaderboard.cache_miss');

  const result = await env.DB.prepare(
    `SELECT mc_uuid AS uuid, mc_name AS name, elo, matches, wins
       FROM users
       ORDER BY elo DESC, wins DESC, matches ASC
       LIMIT 100`,
  ).all<LeaderboardRecord>();

  const entries = (result.results ?? []).map(mapLeaderboardRecord);
  await env.CACHE.put(LEADERBOARD_CACHE_KEY, JSON.stringify(entries), { expirationTtl: LEADERBOARD_CACHE_TTL_SECONDS });
  logInfo('db.leaderboard.loaded', { count: entries.length });
  return entries;
}

export async function getProfile(db: D1Database, uuid: string): Promise<LeaderboardEntry | null> {
  const uuidBlob = tryUuidToBlob(uuid);
  if (!uuidBlob) return null;

  const row = await db
    .prepare('SELECT mc_uuid AS uuid, mc_name AS name, elo, matches, wins FROM users WHERE mc_uuid = ?')
    .bind(uuidBlob)
    .first<LeaderboardRecord>();
  const profile = row ? mapLeaderboardRecord(row) : null;
  logInfo('db.profile.lookup', { user: shortId(uuid), found: Boolean(profile) });
  return profile;
}

function mapLeaderboardRecord(row: LeaderboardRecord): LeaderboardEntry {
  return {
    uuid: uuidFromBlob(row.uuid),
    name: row.name,
    elo: row.elo,
    matches: row.matches,
    wins: row.wins,
  };
}
