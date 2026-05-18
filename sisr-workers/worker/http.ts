import type { RirEnv } from './env';

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(status: number, message: string): Response {
  return jsonResponse({ error: message }, { status });
}

export async function parseJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

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
    throw new HttpError(401, 'Unauthorized service request');
  }
}

export function internalHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set('x-rir-internal', '1');
  return headers;
}

export function requireInternal(request: Request): void {
  if (request.headers.get('x-rir-internal') !== '1') {
    throw new HttpError(403, 'Forbidden');
  }
}
