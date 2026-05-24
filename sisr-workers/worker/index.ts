import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { finishMicrosoftAuth, startMicrosoftAuth } from './auth';
import { getLeaderboard, getProfile, getUser } from './db';
import type { AuthenticatedUser, RirEnv, RouteEntry } from './env';
import { routeKey, VELOCITY_HUB_NAME } from './env';
import { isServiceAuthorized } from './http';
import { errorFields, logError, logInfo, logWarn, requestIdFrom, routePath, shortId } from './logging';
import { bracketForElo, Queue } from './queue';
import { Match } from './match';
import { clearSessionCookie, readSession, type RirContext } from './session';
import { normalizeUuid } from './uuid';

export { Match, Queue };

const app = new Hono<{ Bindings: RirEnv; Variables: { requestId: string } }>();

app.use('*', async (c, next) => {
  const requestId = requestIdFrom(c.req.raw);
  const startedAt = Date.now();
  const path = routePath(c.req.raw);
  const upgrade = c.req.header('upgrade')?.toLowerCase();

  c.set('requestId', requestId);
  c.header('x-request-id', requestId);
  logInfo('http.request.start', {
    requestId,
    method: c.req.method,
    path,
    upgrade: upgrade === 'websocket' ? 'websocket' : undefined,
    serviceAuthorized: path.startsWith('/api/') ? isServiceAuthorized(c.req.raw, c.env) : undefined,
  });

  try {
    await next();
  } finally {
    logInfo('http.request.end', {
      requestId,
      method: c.req.method,
      path,
      status: c.res.status,
      durationMs: Date.now() - startedAt,
    });
  }
});

app.onError((error, c) => {
  const requestId = c.get('requestId') ?? requestIdFrom(c.req.raw);
  const path = routePath(c.req.raw);
  if (error instanceof HTTPException) {
    logWarn('http.request.exception', {
      requestId,
      method: c.req.method,
      path,
      status: error.status,
      errorMessage: error.message,
    });
    return c.json({ error: error.message }, error.status);
  }

  logError('http.request.error', {
    requestId,
    method: c.req.method,
    path,
    ...errorFields(error),
  });
  return c.json({ error: 'Internal error' }, 500);
});

app.post('/api/auth/microsoft/start', (c) => startMicrosoftAuth(c));

app.get('/api/auth/microsoft/callback', (c) => finishMicrosoftAuth(c));

app.post('/api/auth/logout', (c) => {
  logInfo('auth.logout', { requestId: c.get('requestId') });
  clearSessionCookie(c);
  return c.json({ ok: true });
});

app.get('/api/me', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  return c.json({ user });
});

app.get('/api/auth/test', async (c) => {
  const user = await requireUser(c);
  return c.json({ message: `Signed in as ${user.name}`, user });
});

app.get('/api/queue/join', async (c) => {
  const user = await requireUser(c);
  const bracket = bracketForElo(user.elo);
  const headers = forwardedHeaders(c.req.raw);
  headers.set('x-rir-request-id', c.get('requestId'));
  headers.set('x-rir-user', JSON.stringify({ uuid: user.uuid, name: user.name, elo: user.elo }));
  headers.set('x-rir-bracket', bracket);
  logInfo('queue.join.forward', { requestId: c.get('requestId'), user: shortId(user.uuid), bracket, elo: user.elo });
  return c.env.QUEUE.getByName(bracket).fetch('https://queue.internal/join', { method: 'GET', headers });
});

app.get('/api/match/:matchId/ws', async (c) => {
  const user = await requireUser(c);
  const headers = forwardedHeaders(c.req.raw);
  headers.set('x-rir-request-id', c.get('requestId'));
  headers.set('x-rir-user', JSON.stringify({ uuid: user.uuid }));
  logInfo('match.ws.forward', { requestId: c.get('requestId'), matchId: shortId(c.req.param('matchId')), user: shortId(user.uuid) });
  return c.env.MATCH.getByName(c.req.param('matchId')).fetch('https://match.internal/ws', { method: 'GET', headers });
});

app.post('/api/match/:matchId/forfeit', async (c) => {
  const user = await requireUser(c);
  const headers = forwardedHeaders(c.req.raw);
  headers.set('x-rir-request-id', c.get('requestId'));
  headers.set('x-rir-user', JSON.stringify({ uuid: user.uuid }));
  logInfo('match.forfeit.forward', { requestId: c.get('requestId'), matchId: shortId(c.req.param('matchId')), user: shortId(user.uuid) });
  return c.env.MATCH.getByName(c.req.param('matchId')).fetch('https://match.internal/forfeit', { method: 'POST', headers });
});

app.get('/api/velocity/events', (c) => {
  if (!isServiceAuthorized(c.req.raw, c.env)) return c.json({ error: 'Unauthorized' }, 401);
  const headers = forwardedHeaders(c.req.raw);
  headers.set('x-rir-request-id', c.get('requestId'));
  headers.set('x-rir-service', '1');
  logInfo('velocity.events.forward', { requestId: c.get('requestId') });
  return c.env.MATCH.getByName(VELOCITY_HUB_NAME).fetch('https://match.internal/velocity/events', {
    method: 'GET',
    headers,
  });
});

app.post('/api/match/:matchId/ready', async (c) => {
  if (!isServiceAuthorized(c.req.raw, c.env)) return c.json({ error: 'Unauthorized' }, 401);
  logInfo('match.ready.forward', { requestId: c.get('requestId'), matchId: shortId(c.req.param('matchId')) });
  return forwardMatchPost(c.env, c.get('requestId'), c.req.param('matchId'), '/ready', await c.req.text());
});

app.post('/api/match/:matchId/claim', async (c) => {
  if (!isServiceAuthorized(c.req.raw, c.env)) return c.json({ error: 'Unauthorized' }, 401);
  logInfo('match.claim.forward', { requestId: c.get('requestId'), matchId: shortId(c.req.param('matchId')) });
  return forwardMatchPost(c.env, c.get('requestId'), c.req.param('matchId'), '/claim', await c.req.text());
});

app.post('/api/match/:matchId/exit', async (c) => {
  if (!isServiceAuthorized(c.req.raw, c.env)) return c.json({ error: 'Unauthorized' }, 401);
  logInfo('match.exit.forward', { requestId: c.get('requestId'), matchId: shortId(c.req.param('matchId')) });
  return forwardMatchPost(c.env, c.get('requestId'), c.req.param('matchId'), '/exit', await c.req.text());
});

app.get('/api/route/:uuid', async (c) => {
  if (!isServiceAuthorized(c.req.raw, c.env)) return c.json({ error: 'Unauthorized' }, 401);
  const route = await c.env.ROUTING.get(routeKey(c.req.param('uuid')));
  if (!route) return c.json({ error: 'No route' }, 404);
  return c.json(JSON.parse(route) as RouteEntry);
});

app.get('/api/match/state/:uuid', async (c) => {
  if (!isServiceAuthorized(c.req.raw, c.env)) return c.json({ error: 'Unauthorized' }, 401);
  const route = await c.env.ROUTING.get(routeKey(c.req.param('uuid')));
  if (!route) return c.json({ error: 'No active match' }, 404);
  const { matchId } = JSON.parse(route) as RouteEntry;
  return c.env.MATCH.getByName(matchId).fetch('https://match.internal/state');
});

app.get('/api/match/:matchId/state', async (c) => {
  if (!isServiceAuthorized(c.req.raw, c.env)) await requireUser(c);
  return c.env.MATCH.getByName(c.req.param('matchId')).fetch('https://match.internal/state');
});

app.get('/api/leaderboard', async (c) => c.json({ leaderboard: await getLeaderboard(c.env) }));

app.get('/api/skin/:uuid', async (c) => {
  let uuid: string;
  try {
    uuid = normalizeUuid(c.req.param('uuid'));
  } catch {
    return c.json({ error: 'Invalid UUID' }, 400);
  }

  c.header('cache-control', 'public, max-age=3600');
  logInfo('skin.lookup', { requestId: c.get('requestId'), user: shortId(uuid) });
  return c.json(await getSkin(c.env, uuid));
});

app.get('/api/profile/:uuid', async (c) => {
  const profile = await getProfile(c.env.DB, c.req.param('uuid'));
  if (!profile) return c.json({ error: 'Profile not found' }, 404);
  logInfo('profile.lookup', { requestId: c.get('requestId'), user: shortId(profile.uuid) });
  return c.json({ profile });
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<RirEnv>;

async function currentUser(c: RirContext): Promise<AuthenticatedUser | null> {
  const session = await readSession(c);
  if (!session) return null;
  return getUser(c.env.DB, session.uuid);
}

async function requireUser(c: RirContext): Promise<AuthenticatedUser> {
  const user = await currentUser(c);
  if (!user) throw new HTTPException(401, { message: 'Unauthorized' });
  return user;
}

function forwardedHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  headers.delete('cookie');
  headers.delete('authorization');
  return headers;
}

function forwardMatchPost(env: RirEnv, requestId: string, matchId: string, path: '/ready' | '/claim' | '/exit', body: string): Promise<Response> {
  return env.MATCH.getByName(matchId).fetch(`https://match.internal${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-rir-request-id': requestId },
    body,
  });
}

interface SkinResponse {
  skinUrl: string | null;
  model: 'classic' | 'slim';
}

interface MojangProfileResponse {
  properties?: { name: string; value: string }[];
}

interface TexturePayload {
  textures?: {
    SKIN?: {
      url?: string;
      metadata?: { model?: string };
    };
  };
}

const SKIN_CACHE_TTL_SECONDS = 6 * 60 * 60;
const SKIN_NOT_FOUND_TTL_SECONDS = 5 * 60;

async function getSkin(env: RirEnv, uuid: string): Promise<SkinResponse> {
  const cacheKey = `skin:${uuid}`;
  const cached = await env.CACHE.get(cacheKey);
  if (cached) {
    logInfo('skin.cache.hit', { user: shortId(uuid) });
    return JSON.parse(cached) as SkinResponse;
  }

  logInfo('skin.cache.miss', { user: shortId(uuid) });
  const skin = await fetchMinecraftSkin(uuid);
  await env.CACHE.put(cacheKey, JSON.stringify(skin), {
    expirationTtl: skin.skinUrl ? SKIN_CACHE_TTL_SECONDS : SKIN_NOT_FOUND_TTL_SECONDS,
  });
  return skin;
}

async function fetchMinecraftSkin(uuid: string): Promise<SkinResponse> {
  const response = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid.replaceAll('-', '')}`);
  if (response.status === 204 || response.status === 404) return { skinUrl: null, model: 'classic' };
  if (!response.ok) throw new HTTPException(502, { message: 'Minecraft skin lookup failed' });

  const profile = (await response.json()) as MojangProfileResponse;
  const textures = profile.properties?.find((property) => property.name === 'textures');
  if (!textures) return { skinUrl: null, model: 'classic' };

  const payload = JSON.parse(atob(textures.value)) as TexturePayload;
  const skin = payload.textures?.SKIN;
  const skinUrl = skin?.url ? skin.url.replace(/^http:/, 'https:') : null;
  const model = skin?.metadata?.model === 'slim' ? 'slim' : 'classic';
  return { skinUrl, model };
}
