# Handoff — Cloudflare Workers + Durable Objects Backend

This is a mid-stream handoff for the `sisr-ranked` web/Worker tier. The Worker
backbone (routes, Queue DO, Match DO, allocator, D1 schema, OAuth chain) is
implemented and builds; what remains is to swap the hand-rolled helper modules
for vetted libraries, finish typecheck, and wire real Cloudflare resource IDs.

Source of truth: `ARCHITECTURE.MD` at the repo root.
Working branch: `workers-backend`.

## Project layout

```
sisr-ranked/
  ARCHITECTURE.MD                # canonical design doc — defer to this
  HANDOFF.md                     # this file
  sisr-workers/
    AGENTS.md                    # always pull fresh CF docs via the docs subagent
    wrangler.jsonc               # bindings configured, IDs are placeholders
    worker-configuration.d.ts    # regenerated via `bunx wrangler types`
    migrations/0001_initial.sql  # D1 schema (users, matches, match_players)
    worker/
      index.ts                   # Hono app; exports `Queue` and `Match` DO classes
      env.ts                     # shared types + constants
      http.ts                    # request helpers (HttpError, jsonResponse, …)
      session.ts                 # hand-rolled signed cookies + PKCE helpers
      auth.ts                    # MS → XBL → XSTS → MC OAuth chain
      db.ts                      # D1 helpers (users, leaderboard, profile)
      elo.ts                     # 1v1 Elo (K=24)
      items.ts                   # target-item pool
      allocator.ts               # Agent /match/start + /match/stop + KV routes
      queue.ts                   # Queue DO (WS hibernation, bracket widening)
      match.ts                   # Match DO (seed/ready/claim + velocity hub)
    src/                         # existing Vite + React SPA (untouched by backend work)
```

## What is done

- `wrangler.jsonc` bindings: `ASSETS`, `QUEUE`, `MATCH`, `DB`, `ROUTING`,
  `CACHE`, `AGENT_BASE_URL`, `OAUTH_REDIRECT_URI`, migrations
  (`new_sqlite_classes: ["Queue", "Match"]`). All resource IDs are intentional
  placeholders (`00000000…`).
- D1 schema migration matches `ARCHITECTURE.MD` (`users`, `matches`,
  `match_players`, three indexes).
- API routes (Hono, `worker/index.ts`):
  - `POST /api/auth/microsoft/start`
  - `GET  /api/auth/microsoft/callback`
  - `POST /api/auth/logout`
  - `GET  /api/me`
  - `GET  /api/queue/join` (WS upgrade → `QUEUE` DO by bracket)
  - `GET  /api/match/:matchId/ws` (WS upgrade → `MATCH` DO)
  - `GET  /api/velocity/events` (service auth, WS upgrade → `velocity:events` hub)
  - `POST /api/match/:matchId/ready` (service auth)
  - `POST /api/match/:matchId/claim` (service auth)
  - `GET  /api/route/:uuid` (service auth)
  - `GET  /api/match/state/:uuid` and `/api/match/:matchId/state` (service auth)
  - `GET  /api/leaderboard`
  - `GET  /api/profile/:uuid`
- Queue DO: WebSocket hibernation, `setWebSocketAutoResponse` ping/pong,
  inline matchmaker, alarm-driven bracket widening via `tryBorrow` to neighbor
  bracket DOs.
- Match DO: `/internal/seed`, `/ready` (writes KV routes + broadcasts to
  Velocity hub + player sockets), `/claim` arbitration inside
  `blockConcurrencyWhile`, batched D1 update via `DB.batch()`, leaderboard
  cache bust, fire-and-forget Agent `/match/stop` via `state.waitUntil`.
- Allocator: POSTs to Agent over Tunnel, writes `route:<uuid>` KV with 30 min
  TTL, JVM/VD defaults from `ARCHITECTURE.MD` resource budget.
- Microsoft OAuth chain (MS → XBL → XSTS → `login_with_xbox` →
  `/minecraft/profile`) with friendly `XErr` mapping.
- `bun run build` (Vite + Worker) succeeds.
- `bunx wrangler types` succeeds; `worker-configuration.d.ts` reflects bindings.

## What is NOT done

1. **Replace hand-rolled helpers with libraries** (user explicitly asked).
   Already installed (verify in `sisr-workers/package.json`):
   - `arctic@3.7.0` — has `providers/microsoft-entra-id` for MS code exchange
     + PKCE. Use this in `worker/auth.ts` to drop the manual
     `login.microsoftonline.com/.../token` POST and the PKCE/`base64url`
     plumbing in `worker/session.ts`.
   - `elo-rating@1.0.1` — replace `worker/elo.ts` math with
     `EloRating.calculate(playerRating, opponentRating, playerWon, 24)`.
     Note: the package has no types and rounds to int via `parseInt` — accept
     integer Elo deltas and adjust `elo` column reads/writes accordingly (or
     keep our own rounding wrapper around it).
   - Replace `worker/session.ts` cookie + HMAC + base64url with Hono cookie
     helpers from `hono/cookie`: `setSignedCookie`, `getSignedCookie`,
     `deleteCookie`. Keep `SESSION_COOKIE`/`OAUTH_STATE_COOKIE` constants.
   - Replace `HttpError` in `worker/http.ts` with `HTTPException` from
     `hono/http-exception`. Update `app.onError` to detect it.
   - `worker/http.ts` `jsonResponse` is redundant with `c.json(...)` — keep
     only the helpers we still need (`isWebSocketUpgrade`, `nowSeconds`,
     `serviceTokenFromRequest`, `requireService`, `internalHeaders`,
     `requireInternal`).
   - Validation: `zod` is already a dependency; keep using it. `worker/db.ts`
     can stay as-is — it’s thin D1 prepared statements.

2. **Finish TypeScript verification.** Last remaining error after the cleanup
   was unrelated to the backend:
   ```
   src/main.tsx(3,8): error TS2882: Cannot find module or type declarations
   for side-effect import of './index.css'.
   ```
   Resolve by either creating `src/vite-env.d.ts` with
   `/// <reference types="vite/client" />` or adding a `*.css` module
   declaration. (Pure SPA-side fix; backend code already typechecks.)

3. **Subagent for Microsoft OAuth in `arctic`.** Pseudocode for the swap:
   ```ts
   import { MicrosoftEntraId } from 'arctic';

   const ms = new MicrosoftEntraId(
     'consumers',                    // tenant
     env.MS_CLIENT_ID,
     env.MS_CLIENT_SECRET,
     oauthRedirectUri(request, env),
   );

   // start
   const state = generateState();
   const codeVerifier = generateCodeVerifier();
   const url = ms.createAuthorizationURL(state, codeVerifier, ['XboxLive.signin']);

   // callback
   const tokens = await ms.validateAuthorizationCode(code, codeVerifier);
   const msAccessToken = tokens.accessToken();
   ```
   The XBL → XSTS → `login_with_xbox` → `/minecraft/profile` chain stays
   as-is — `arctic` does not cover Mojang.

4. **Real Cloudflare resource IDs.** In `sisr-workers/wrangler.jsonc`:
   ```bash
   bunx wrangler d1 create sisr-ranked
   bunx wrangler kv namespace create ROUTING
   bunx wrangler kv namespace create CACHE
   ```
   Replace the three `00000000…` placeholders with the IDs returned.

5. **Secrets.** Set via Wrangler before any deploy:
   ```bash
   bunx wrangler secret put MS_CLIENT_ID
   bunx wrangler secret put MS_CLIENT_SECRET
   bunx wrangler secret put SESSION_SECRET
   bunx wrangler secret put AGENT_SERVICE_TOKEN
   bunx wrangler secret put SERVICE_API_TOKEN   # optional, callbacks from Fabric mod / Velocity
   ```

6. **D1 migration apply.** Local:
   `bunx wrangler d1 migrations apply sisr-ranked --local`.
   Remote (after real IDs): `… --remote`.

7. **Optional, not done:** the Velocity event-hub Match DO instance is named
   `velocity:events` (`VELOCITY_HUB_NAME` in `worker/env.ts`). The hub
   currently broadcasts only the messages individual Match DOs push to it.
   No background fan-in — fine for v1.

## Verification commands

From `sisr-workers/`:

```bash
bun install
bunx wrangler types         # after any wrangler.jsonc change
bunx tsc --noEmit           # backend typechecks; fix the lone src/main.tsx CSS import
bun run build               # Vite + Worker build
bunx wrangler dev           # local dev
```

API smoke once dev is running:

```bash
curl http://localhost:8787/api/leaderboard
curl http://localhost:8787/api/me                  # 401 expected without session
```

## Architectural rules to preserve (from ARCHITECTURE.MD §Invariants)

- The Match DO is the only writer for a given match (D1 + KV routes).
- `blockConcurrencyWhile` is the only correctness mechanism for the winner.
- The Worker is stateless. No module-level mutable state.
- Velocity moves players only on a `match_ready` event or a route lookup that
  says `ready: true`. The current `Match` DO sets `ready` in KV inside
  `/ready` — preserve that.
- One container per match. The Agent owns lifecycle.
- D1 is the system of record; KV and DO storage are caches/derived state.
- 1v1 has exactly two players; FFA is out of scope for v1 but the
  `players: MatchPlayer[]` shape is deliberately variadic.

## Suggested next session opening prompt

> Continue the workers-backend branch handoff in `HANDOFF.md`. Start by
> replacing `worker/session.ts` and `worker/http.ts` with `hono/cookie` +
> `hono/http-exception`, then rewrite `worker/auth.ts` to use
> `arctic`'s `MicrosoftEntraId` provider for the MS code exchange (keep the
> XBL/XSTS/Mojang chain), then swap `worker/elo.ts` to `elo-rating`. Finish
> by getting `bunx tsc --noEmit` clean (resolve the `src/main.tsx` CSS
> declaration) and `bun run build` green. Do not invent CF resource IDs;
> leave the placeholders.
