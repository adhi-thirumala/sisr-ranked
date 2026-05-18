import type { RirEnv } from './env';

const encoder = new TextEncoder();

export const SESSION_COOKIE = 'rir_session';
export const OAUTH_STATE_COOKIE = 'rir_oauth_state';

export interface SessionPayload {
  uuid: string;
  issuedAt: number;
}

export interface OAuthStatePayload {
  state: string;
  codeVerifier: string;
  issuedAt: number;
}

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  path?: string;
  maxAge?: number;
}

export function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  for (const part of header.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) return rawValue.join('=');
  }

  return null;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${value}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  return parts.join('; ');
}

export function clearCookie(name: string): string {
  return serializeCookie(name, '', { maxAge: 0, httpOnly: true, sameSite: 'Lax' });
}

export async function createSignedCookieValue(secret: string, payload: unknown): Promise<string> {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await sign(secret, body);
  return `${body}.${signature}`;
}

export async function readSignedCookieValue<T>(secret: string, value: string | null): Promise<T | null> {
  if (!value) return null;
  const [body, signature, ...extra] = value.split('.');
  if (!body || !signature || extra.length > 0) return null;

  const expected = await sign(secret, body);
  if (!safeEqual(signature, expected)) return null;

  try {
    const bytes = base64UrlDecode(body);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

export async function readSession(request: Request, env: RirEnv): Promise<SessionPayload | null> {
  return readSignedCookieValue<SessionPayload>(env.SESSION_SECRET, getCookie(request, SESSION_COOKIE));
}

export async function sessionCookie(request: Request, env: RirEnv, uuid: string): Promise<string> {
  const secure = new URL(request.url).protocol === 'https:';
  const value = await createSignedCookieValue(env.SESSION_SECRET, {
    uuid,
    issuedAt: Date.now(),
  } satisfies SessionPayload);

  return serializeCookie(SESSION_COOKIE, value, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function oauthStateCookie(
  request: Request,
  env: RirEnv,
  state: string,
  codeVerifier: string,
): Promise<string> {
  const secure = new URL(request.url).protocol === 'https:';
  const value = await createSignedCookieValue(env.SESSION_SECRET, {
    state,
    codeVerifier,
    issuedAt: Date.now(),
  } satisfies OAuthStatePayload);

  return serializeCookie(OAUTH_STATE_COOKIE, value, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    maxAge: 10 * 60,
  });
}

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return base64UrlEncode(new Uint8Array(signature));
}

export function randomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
