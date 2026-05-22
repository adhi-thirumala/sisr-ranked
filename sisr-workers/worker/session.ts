import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import type { RirEnv } from './env';

export const SESSION_COOKIE = 'rir_session';
export const OAUTH_STATE_COOKIE = 'rir_oauth_state';

export type RirContext = Context<{ Bindings: RirEnv; Variables: { requestId: string } }>;

export interface SessionPayload {
  uuid: string;
  issuedAt: number;
}

export interface OAuthStatePayload {
  state: string;
  codeVerifier: string;
  issuedAt: number;
  redirectTo?: string;
}

export async function readSession(c: RirContext): Promise<SessionPayload | null> {
  return readSignedPayload<SessionPayload>(c, SESSION_COOKIE);
}

export async function setSessionCookie(c: RirContext, uuid: string): Promise<void> {
  await setSignedPayload(c, SESSION_COOKIE, {
    uuid,
    issuedAt: Date.now(),
  } satisfies SessionPayload, 60 * 60 * 24 * 30);
}

export async function readOAuthStateCookie(c: RirContext): Promise<OAuthStatePayload | null> {
  return readSignedPayload<OAuthStatePayload>(c, OAUTH_STATE_COOKIE);
}

export async function setOAuthStateCookie(c: RirContext, state: string, codeVerifier: string, redirectTo?: string): Promise<void> {
  await setSignedPayload(c, OAUTH_STATE_COOKIE, {
    state,
    codeVerifier,
    issuedAt: Date.now(),
    redirectTo,
  } satisfies OAuthStatePayload, 10 * 60);
}

export function clearSessionCookie(c: RirContext): void {
  clearCookie(c, SESSION_COOKIE);
}

export function clearOAuthStateCookie(c: RirContext): void {
  clearCookie(c, OAUTH_STATE_COOKIE);
}

function clearCookie(c: RirContext, name: string): void {
  deleteCookie(c, name, { path: '/', secure: isSecureRequest(c) });
}

async function setSignedPayload(c: RirContext, name: string, payload: unknown, maxAge: number): Promise<void> {
  await setSignedCookie(c, name, encodeURIComponent(JSON.stringify(payload)), c.env.SESSION_SECRET, {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: 'Lax',
    path: '/',
    maxAge,
  });
}

async function readSignedPayload<T>(c: RirContext, name: string): Promise<T | null> {
  const value = await getSignedCookie(c, c.env.SESSION_SECRET, name);
  if (typeof value !== 'string') return null;

  try {
    return JSON.parse(decodeURIComponent(value)) as T;
  } catch {
    return null;
  }
}

function isSecureRequest(c: RirContext): boolean {
  return new URL(c.req.url).protocol === 'https:';
}
