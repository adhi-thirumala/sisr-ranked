import type { AuthenticatedUser, RirEnv } from './env';
import { LEADERBOARD_CACHE_KEY } from './env';
import { nowSeconds } from './http';

interface UserRecord {
  mc_uuid: string;
  mc_name: string;
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

export function mapUser(row: UserRecord): AuthenticatedUser {
  return {
    uuid: row.mc_uuid,
    name: row.mc_name,
    elo: row.elo,
    matches: row.matches,
    wins: row.wins,
  };
}

export async function getUser(db: D1Database, uuid: string): Promise<AuthenticatedUser | null> {
  const row = await db
    .prepare('SELECT mc_uuid, mc_name, elo, matches, wins FROM users WHERE mc_uuid = ?')
    .bind(uuid)
    .first<UserRecord>();
  return row ? mapUser(row) : null;
}

export async function upsertUser(db: D1Database, uuid: string, name: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (mc_uuid, mc_name, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(mc_uuid) DO UPDATE SET mc_name = excluded.mc_name`,
    )
    .bind(uuid, name, nowSeconds())
    .run();
}

export async function getLeaderboard(env: RirEnv): Promise<LeaderboardEntry[]> {
  const cached = await env.CACHE.get(LEADERBOARD_CACHE_KEY);
  if (cached) return JSON.parse(cached) as LeaderboardEntry[];

  const result = await env.DB
    .prepare(
      `SELECT mc_uuid AS uuid, mc_name AS name, elo, matches, wins
       FROM users
       ORDER BY elo DESC, wins DESC, matches ASC
       LIMIT 100`,
    )
    .all<LeaderboardEntry>();

  const entries = result.results ?? [];
  await env.CACHE.put(LEADERBOARD_CACHE_KEY, JSON.stringify(entries), { expirationTtl: 30 });
  return entries;
}

export async function getProfile(db: D1Database, uuid: string): Promise<LeaderboardEntry | null> {
  const row = await db
    .prepare('SELECT mc_uuid AS uuid, mc_name AS name, elo, matches, wins FROM users WHERE mc_uuid = ?')
    .bind(uuid)
    .first<LeaderboardEntry>();
  return row ?? null;
}
