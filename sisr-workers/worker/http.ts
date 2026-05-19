import { HTTPException } from 'hono/http-exception';
import type { RirEnv } from './env';

export function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket';
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function serviceTokenFromRequest(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

export function isServiceAuthorized(request: Request, env: RirEnv): boolean {
  const token = serviceTokenFromRequest(request);
  if (!token) return false;

  const allowed = [env.SERVICE_API_TOKEN, env.AGENT_SERVICE_TOKEN].filter(
    (value): value is string => Boolean(value),
  );
  return allowed.includes(token);
}

export function requireService(request: Request, env: RirEnv): void {
  if (!isServiceAuthorized(request, env)) {
    throw new HTTPException(401, { message: 'Unauthorized service request' });
  }
}

export function internalHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set('x-rir-internal', '1');
  return headers;
}

export function requireInternal(request: Request): void {
  if (request.headers.get('x-rir-internal') !== '1') {
    throw new HTTPException(403, { message: 'Forbidden' });
  }
}
