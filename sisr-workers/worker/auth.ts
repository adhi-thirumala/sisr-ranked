import { generateCodeVerifier, generateState, MicrosoftEntraId } from 'arctic';
import { z } from 'zod';
import type { RirEnv } from './env';
import { clearOAuthStateCookie, readOAuthStateCookie, setOAuthStateCookie, setSessionCookie, type RirContext } from './session';
import { upsertUser } from './db';
import { errorFields, logError, logInfo, shortId } from './logging';
import { normalizeUuid } from './uuid';

const xblTokenSchema = z.object({
  Token: z.string(),
  DisplayClaims: z.object({ xui: z.array(z.object({ uhs: z.string() })).min(1) }),
});
const microsoftTokenSchema = z.object({ access_token: z.string() });
const minecraftLoginSchema = z.object({ access_token: z.string() });
const minecraftProfileSchema = z.object({ id: z.string(), name: z.string() });
const MICROSOFT_TENANT = 'consumers';

export async function startMicrosoftAuth(c: RirContext): Promise<Response> {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const redirectTo = await authRedirectPath(c);
  const url = microsoftEntraId(c.req.raw, c.env).createAuthorizationURL(state, codeVerifier, ['XboxLive.signin']);
  url.searchParams.set('response_mode', 'query');

  await setOAuthStateCookie(c, state, codeVerifier, redirectTo);
  logAuthStep('start', { requestId: c.get('requestId'), redirectTo: redirectTo ?? '/queue', redirectUri: oauthRedirectUri(c.req.raw, c.env) });
  return c.json({ url: url.toString() });
}

export async function finishMicrosoftAuth(c: RirContext): Promise<Response> {
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  if (error) return redirectWithError(c, error);
  if (!code || !state) return redirectWithError(c, 'Missing OAuth callback parameters');
  logAuthStep('callback_received', { requestId: c.get('requestId') });

  const storedState = await readOAuthStateCookie(c);
  if (!storedState || storedState.state !== state || Date.now() - storedState.issuedAt > 10 * 60 * 1000) {
    return redirectWithError(c, 'OAuth state expired or did not match');
  }
  logAuthStep('state_validated', { requestId: c.get('requestId'), ageMs: Date.now() - storedState.issuedAt });

  try {
    const msAccessToken = await exchangeMicrosoftCode(c.req.raw, c.env, code, storedState.codeVerifier);
    logAuthStep('microsoft_token_exchanged', { requestId: c.get('requestId') });
    const xbl = await authenticateXboxLive(msAccessToken);
    logAuthStep('xbox_live_authenticated', { requestId: c.get('requestId') });
    const xsts = await authorizeXsts(xbl.Token);
    logAuthStep('xsts_authorized', { requestId: c.get('requestId') });
    const userHash = xsts.DisplayClaims.xui[0].uhs;
    const minecraftAccessToken = await loginWithMinecraft(userHash, xsts.Token);
    logAuthStep('minecraft_token_acquired', { requestId: c.get('requestId') });
    const profile = await fetchMinecraftProfile(minecraftAccessToken);
    logAuthStep('minecraft_profile_fetched', { requestId: c.get('requestId'), user: shortId(profile.id), name: profile.name });
    const uuid = parseMinecraftUuid(profile.id);

    await upsertUser(c.env.DB, uuid, profile.name);
    logAuthStep('user_upserted', { requestId: c.get('requestId'), user: shortId(uuid), name: profile.name });

    await setSessionCookie(c, uuid);
    clearOAuthStateCookie(c);
    logAuthStep('session_created', { requestId: c.get('requestId'), user: shortId(uuid), redirectTo: storedState.redirectTo ?? '/queue' });
    return c.redirect(`${new URL(c.req.url).origin}${storedState.redirectTo ?? '/queue'}`, 302);
  } catch (error) {
    logError('auth.microsoft.callback_failed', { requestId: c.get('requestId'), ...errorFields(error) });
    return redirectWithError(c, 'Authentication failed. Please try again.');
  }
}

async function authRedirectPath(c: RirContext): Promise<string | undefined> {
  const body = await c.req.json<{ redirectTo?: unknown }>().catch(() => null);
  if (!body || typeof body.redirectTo !== 'string') return undefined;
  if (!body.redirectTo.startsWith('/') || body.redirectTo.startsWith('//')) return undefined;
  return body.redirectTo;
}

function oauthRedirectUri(request: Request, env: RirEnv): string {
  return env.OAUTH_REDIRECT_URI || `${new URL(request.url).origin}/api/auth/microsoft/callback`;
}

function microsoftEntraId(request: Request, env: RirEnv): MicrosoftEntraId {
  return new MicrosoftEntraId(MICROSOFT_TENANT, env.MS_CLIENT_ID, null, oauthRedirectUri(request, env));
}

async function exchangeMicrosoftCode(request: Request, env: RirEnv, code: string, codeVerifier: string): Promise<string> {
  const redirectUri = oauthRedirectUri(request, env);
  const response = await fetch(`https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.MS_CLIENT_ID,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      scope: 'XboxLive.signin',
    }),
  });

  const json = await parseOAuthResponse(response, 'Microsoft token exchange failed');
  return microsoftTokenSchema.parse(json).access_token;
}

async function authenticateXboxLive(msAccessToken: string): Promise<z.infer<typeof xblTokenSchema>> {
  const response = await fetch('https://user.auth.xboxlive.com/user/authenticate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${msAccessToken}`,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    }),
  });

  const json = await parseOAuthResponse(response, 'Xbox Live authentication failed');
  return xblTokenSchema.parse(json);
}

async function authorizeXsts(xblToken: string): Promise<z.infer<typeof xblTokenSchema>> {
  const response = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      Properties: {
        SandboxId: 'RETAIL',
        UserTokens: [xblToken],
      },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    }),
  });

  const json = await parseOAuthResponse(response, 'XSTS authorization failed');
  return xblTokenSchema.parse(json);
}

async function loginWithMinecraft(userHash: string, xstsToken: string): Promise<string> {
  const response = await fetch('https://api.minecraftservices.com/authentication/login_with_xbox', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${userHash};${xstsToken}` }),
  });

  const json = await parseOAuthResponse(response, 'Minecraft login failed');
  return minecraftLoginSchema.parse(json).access_token;
}

async function fetchMinecraftProfile(accessToken: string): Promise<z.infer<typeof minecraftProfileSchema>> {
  const response = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  const json = await parseOAuthResponse(response, 'Minecraft profile lookup failed');
  return minecraftProfileSchema.parse(json);
}

async function parseOAuthResponse(response: Response, fallback: string): Promise<unknown> {
  const json = await response.json().catch(() => null);
  if (response.ok) return json;

  if (json && typeof json === 'object' && 'XErr' in json) {
    const xerr = Number((json as { XErr: unknown }).XErr);
    if (xerr === 2148916233) throw new Error('This Microsoft account does not have an Xbox profile.');
    if (xerr === 2148916238) throw new Error('This child account must be added to a Microsoft Family first.');
  }

  throw new Error(`${fallback}: ${JSON.stringify(json)}`);
}

function parseMinecraftUuid(value: string): string {
  try {
    return normalizeUuid(value);
  } catch {
    throw new Error('Minecraft returned an invalid UUID');
  }
}

function redirectWithError(c: RirContext, message: string): Response {
  const url = new URL('/login', new URL(c.req.url).origin);
  url.searchParams.set('error', message);
  clearOAuthStateCookie(c);
  return c.redirect(url.toString(), 302);
}

function logAuthStep(step: string, details?: Record<string, unknown>): void {
  logInfo('auth.microsoft.step', { step, ...details });
}
