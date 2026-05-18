import { z } from 'zod';
import type { RirEnv } from './env';
import { jsonResponse } from './http';
import {
  clearCookie,
  getCookie,
  oauthStateCookie,
  OAUTH_STATE_COOKIE,
  randomBase64Url,
  readSignedCookieValue,
  sessionCookie,
  sha256Base64Url,
  type OAuthStatePayload,
} from './session';
import { upsertUser } from './db';

const msTokenSchema = z.object({ access_token: z.string() });
const xblTokenSchema = z.object({
  Token: z.string(),
  DisplayClaims: z.object({ xui: z.array(z.object({ uhs: z.string() })).min(1) }),
});
const minecraftLoginSchema = z.object({ access_token: z.string() });
const minecraftProfileSchema = z.object({ id: z.string(), name: z.string() });

export async function startMicrosoftAuth(request: Request, env: RirEnv): Promise<Response> {
  const state = randomBase64Url(24);
  const codeVerifier = randomBase64Url(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const redirectUri = oauthRedirectUri(request, env);
  const url = new URL('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
  url.searchParams.set('client_id', env.MS_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'XboxLive.signin');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('response_mode', 'query');

  const response = jsonResponse({ url: url.toString() });
  response.headers.append('set-cookie', await oauthStateCookie(request, env, state, codeVerifier));
  return response;
}

export async function finishMicrosoftAuth(request: Request, env: RirEnv): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  if (error) return redirectWithError(request, error);
  if (!code || !state) return redirectWithError(request, 'Missing OAuth callback parameters');

  const storedState = await readSignedCookieValue<OAuthStatePayload>(
    env.SESSION_SECRET,
    getCookie(request, OAUTH_STATE_COOKIE),
  );
  if (!storedState || storedState.state !== state || Date.now() - storedState.issuedAt > 10 * 60 * 1000) {
    return redirectWithError(request, 'OAuth state expired or did not match');
  }

  const msAccessToken = await exchangeMicrosoftCode(request, env, code, storedState.codeVerifier);
  const xbl = await authenticateXboxLive(msAccessToken);
  const xsts = await authorizeXsts(xbl.Token);
  const userHash = xsts.DisplayClaims.xui[0].uhs;
  const minecraftAccessToken = await loginWithMinecraft(userHash, xsts.Token);
  const profile = await fetchMinecraftProfile(minecraftAccessToken);
  const uuid = hyphenateMinecraftUuid(profile.id);

  await upsertUser(env.DB, uuid, profile.name);

  const response = Response.redirect(`${new URL(request.url).origin}/queue`, 302);
  response.headers.append('set-cookie', await sessionCookie(request, env, uuid));
  response.headers.append('set-cookie', clearCookie(OAUTH_STATE_COOKIE));
  return response;
}

function oauthRedirectUri(request: Request, env: RirEnv): string {
  return env.OAUTH_REDIRECT_URI || `${new URL(request.url).origin}/api/auth/microsoft/callback`;
}

async function exchangeMicrosoftCode(
  request: Request,
  env: RirEnv,
  code: string,
  codeVerifier: string,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: env.MS_CLIENT_ID,
    scope: 'XboxLive.signin',
    code,
    redirect_uri: oauthRedirectUri(request, env),
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });
  if (env.MS_CLIENT_SECRET) body.set('client_secret', env.MS_CLIENT_SECRET);

  const response = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = await parseOAuthResponse(response, 'Microsoft token exchange failed');
  return msTokenSchema.parse(json).access_token;
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

function hyphenateMinecraftUuid(value: string): string {
  const normalized = value.replaceAll('-', '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(normalized)) throw new Error('Minecraft returned an invalid UUID');
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`;
}

function redirectWithError(request: Request, message: string): Response {
  const url = new URL('/login', new URL(request.url).origin);
  url.searchParams.set('error', message);
  const response = Response.redirect(url.toString(), 302);
  response.headers.append('set-cookie', clearCookie(OAUTH_STATE_COOKIE));
  return response;
}
