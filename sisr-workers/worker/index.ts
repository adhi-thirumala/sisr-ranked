import { Hono } from 'hono';
import { finishMicrosoftAuth, startMicrosoftAuth } from './auth';
import { getLeaderboard, getProfile, getUser } from './db';
import type { AuthenticatedUser, RirEnv, RouteEntry } from './env';
import { routeKey, VELOCITY_HUB_NAME } from './env';
import { errorResponse, HttpError, isServiceAuthorized, jsonResponse } from './http';
import { bracketForElo, Queue } from './queue';
import { Match } from './match';
import { clearCookie, readSession, SESSION_COOKIE } from './session';

export { Match, Queue };

const app = new Hono<{ Bindings: RirEnv }>();

app.onError((error, c) => {
  if (error instanceof HttpError) return errorResponse(error.status, error.message);
  return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
});

app.post('/api/auth/microsoft/start', (c) => startMicrosoftAuth(c.req.raw, c.env));

app.get('/api/auth/microsoft/callback', (c) => finishMicrosoftAuth(c.req.raw, c.env));

app.post('/api/auth/logout', (c) => {
  const response = jsonResponse({ ok: true });
  response.headers.append('set-cookie', clearCookie(SESSION_COOKIE));
  return response;
});

app.get('/api/me', async (c) => {
  const user = await currentUser(c.req.raw, c.env);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  return c.json({ user });
});

app.get('/api/queue/join', async (c) => {
  const user = await requireUser(c.req.raw, c.env);
  const bracket = bracketForElo(user.elo);
  const headers = forwardedHeaders(c.req.raw);
  headers.set('x-rir-user', JSON.stringify({ uuid: user.uuid, name: user.name, elo: user.elo }));
  headers.set('x-rir-bracket', bracket);
  return c.env.QUEUE.getByName(bracket).fetch('https://queue.internal/join', { method: 'GET', headers });
});

app.get('/api/match/:matchId/ws', async (c) => {
  const user = await requireUser(c.req.raw, c.env);
  const headers = forwardedHeaders(c.req.raw);
  headers.set('x-rir-user', JSON.stringify({ uuid: user.uuid }));
  return c.env.MATCH.getByName(c.req.param('matchId')).fetch('https://match.internal/ws', { method: 'GET', headers });
});

app.get('/api/velocity/events', (c) => {
  if (!isServiceAuthorized(c.req.raw, c.env)) return c.json({ error: 'Unauthorized' }, 401);
  const headers = forwardedHeaders(c.req.raw);
  headers.set('x-rir-service', '1');
  return c.env.MATCH.getByName(VELOCITY_HUB_NAME).fetch('https://match.internal/velocity/events', {
    method: 'GET',
    headers,
  });
});

app.post('/api/match/:matchId/ready', async (c) => {
  if (!isServiceAuthorized(c.req.raw, c.env)) return c.json({ error: 'Unauthorized' }, 401);
  return forwardMatchPost(c.env, c.req.param('matchId'), '/ready', await c.req.text());
});

app.post('/api/match/:matchId/claim', async (c) => {
  if (!isServiceAuthorized(c.req.raw, c.env)) return c.json({ error: 'Unauthorized' }, 401);
  return forwardMatchPost(c.env, c.req.param('matchId'), '/claim', await c.req.text());
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

app.get('/api/match/:matchId/state', (c) => {
  if (!isServiceAuthorized(c.req.raw, c.env)) return c.json({ error: 'Unauthorized' }, 401);
  return c.env.MATCH.getByName(c.req.param('matchId')).fetch('https://match.internal/state');
});

app.get('/api/leaderboard', async (c) => c.json({ leaderboard: await getLeaderboard(c.env) }));

app.get('/api/profile/:uuid', async (c) => {
  const profile = await getProfile(c.env.DB, c.req.param('uuid').toLowerCase());
  if (!profile) return c.json({ error: 'Profile not found' }, 404);
  return c.json({ profile });
});

app.notFound(() => errorResponse(404, 'Not found'));

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<RirEnv>;

async function currentUser(request: Request, env: RirEnv): Promise<AuthenticatedUser | null> {
  const session = await readSession(request, env);
  if (!session) return null;
  return getUser(env.DB, session.uuid);
}

async function requireUser(request: Request, env: RirEnv): Promise<AuthenticatedUser> {
  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, 'Unauthorized');
  return user;
}

function forwardedHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  headers.delete('cookie');
  headers.delete('authorization');
  return headers;
}

function forwardMatchPost(env: RirEnv, matchId: string, path: '/ready' | '/claim', body: string): Promise<Response> {
  return env.MATCH.getByName(matchId).fetch(`https://match.internal${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}
