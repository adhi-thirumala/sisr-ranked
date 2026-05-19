import { generateCodeVerifier, generateState, MicrosoftEntraId } from 'arctic';
import { z } from 'zod';
import type { RirEnv } from './env';
import {
  clearOAuthStateCookie,
  readOAuthStateCookie,
  setOAuthStateCookie,
  setSessionCookie,
  type RirContext,
} from './session';
import { upsertUser } from './db';
import { normalizeUuid } from './uuid';

const xblTokenSchema = z.object({
  Token: z.string(),
  DisplayClaims: z.object({ xui: z.array(z.object({ uhs: z.string() })).min(1) }),
});
const minecraftLoginSchema = z.object({ access_token: z.string() });
const minecraftProfileSchema = z.object({ id: z.string(), name: z.string() });

export async function startMicrosoftAuth(c: RirContext): Promise<Response> {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = microsoftEntraId(c.req.raw, c.env).createAuthorizationURL(state, codeVerifier, ['XboxLive.signin']);
  url.searchParams.set('response_mode', 'query');

  await setOAuthStateCookie(c, state, codeVerifier);
  return c.json({ url: url.toString() });
}

export async function finishMicrosoftAuth(c: RirContext): Promise<Response> {
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  if (error) return redirectWithError(c, error);
  if (!code || !state) return redirectWithError(c, 'Missing OAuth callback parameters');

  const storedState = await readOAuthStateCookie(c);
  if (!storedState || storedState.state !== state || Date.now() - storedState.issuedAt > 10 * 60 * 1000) {
    return redirectWithError(c, 'OAuth state expired or did not match');
  }

  const msAccessToken = await exchangeMicrosoftCode(c.req.raw, c.env, code, storedState.codeVerifier);
  const xbl = await authenticateXboxLive(msAccessToken);
  const xsts = await authorizeXsts(xbl.Token);
  const userHash = xsts.DisplayClaims.xui[0].uhs;
  const minecraftAccessToken = await loginWithMinecraft(userHash, xsts.Token);
  const profile = await fetchMinecraftProfile(minecraftAccessToken);
  const uuid = parseMinecraftUuid(profile.id);

  await upsertUser(c.env.DB, uuid, profile.name);

  await setSessionCookie(c, uuid);
  clearOAuthStateCookie(c);
  return c.redirect(`${new URL(c.req.url).origin}/queue`, 302);
}

function oauthRedirectUri(request: Request, env: RirEnv): string {
  return env.OAUTH_REDIRECT_URI || `${new URL(request.url).origin}/api/auth/microsoft/callback`;
}

function microsoftEntraId(request: Request, env: RirEnv): MicrosoftEntraId {
  return new MicrosoftEntraId('consumers', env.MS_CLIENT_ID, env.MS_CLIENT_SECRET, oauthRedirectUri(request, env));
}

async function exchangeMicrosoftCode(
  request: Request,
  env: RirEnv,
  code: string,
  codeVerifier: string,
): Promise<string> {
  const tokens = await microsoftEntraId(request, env).validateAuthorizationCode(code, codeVerifier);
  return tokens.accessToken();
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
