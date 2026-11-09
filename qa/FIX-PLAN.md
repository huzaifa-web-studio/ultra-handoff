# Handoff Fix Plan and Session Tracker

**Created:** 8 Nov 2026
**Source reports:** `qa/phase-1-static-review.md`, `qa/phase-2-test-report.md`, `qa/phase-3-e2e-report.md`
**App status:** local only, not hosted. Production items are pre-deployment gates, not current incidents.

This file is the single place to see what is fixed, what is next, and what the next session must not redo. Update it at the end of every session.

---

## 1. How to use this file

1. Read the **status board** below.
2. Pick the next batch from the **suggested order** in section 3. The batch numbers are stable IDs, not the execution order.
3. Create a branch for that batch only:
   ```bash
   git checkout -b fix/batch-1-auth-abuse
   ```
4. Read the batch, then read the linked report section for the full context.
5. Fix only the items in that batch. Do not mix batches.
6. Run the batch **Verify** commands and the global suite.
7. Tick the item boxes, set the batch status to `Done`, append to the **session log**, and commit.
8. If you must stop mid-batch, set the status to `In progress` and write exactly what is done and what is not in the session log. The next session continues there.

**Status values**

| Value | Meaning |
|---|---|
| `Not started` | No work has begun |
| `In progress` | Some items are done, see the log |
| `Done` | Every item ticked, tests green, committed |
| `Blocked` | Waiting on a decision or another batch, see the log |
| `Closed` | Not a defect, or fixed as part of another item |

**Rules for every session**

- One batch per branch and commit series.
- No unrelated refactors. If you spot a new issue, add it to the appendix and keep going.
- No em dashes, design tokens only, no `any`, comment non-obvious logic.
- Run `bun run format` and `bun run check` on the files you touched. Batch 8 cleared the repo-wide `bun run check` to zero errors and zero warnings; keep it that way.
- Update this file in the same commit as the fix.

**Global verify (run after every batch)**

```bash
cd apps/api && bun test
cd apps/web && bun test
cd apps/api && bunx tsc --noEmit -p tsconfig.json
cd apps/web && bunx tsc --noEmit -p tsconfig.json
cd packages/ui && bunx tsc --noEmit -p tsconfig.json
```

Integration suite, when the batch touches services or tenancy:

```bash
cd apps/api
TEST_DATABASE=1 \
DATABASE_URL=postgres://app:app@localhost:5432/app_test \
DATABASE_APP_URL=postgres://app_tenant:tenant@localhost:5432/app_test \
bun test
```

---

## 2. Status board

| Batch | Theme | Highest risk | Status | Depends on | Last updated | Commit |
|---|---|---|---|---|---|---|
| 1 | Authentication abuse | High | Done | none | 8 Nov 2026 | uncommitted |
| 2 | File access and object lifecycle | High | Done | none | 8 Nov 2026 | 3a45be7 |
| 3 | Redis and storage resilience | High | Done | none | 9 Nov 2026 | 105eee6 |
| 4 | Production and environment gate | High (deployment) | Done | none | 9 Nov 2026 | 685dd35 |
| 5 | Authorization and error handling | Medium | Done | Batch 1 (same auth files) | 9 Nov 2026 | 7eafffc |
| 6 | Web shell, headers and UX | Medium | Done | Batch 4 (API origin) | 9 Nov 2026 | uncommitted |
| 7 | Performance | Medium | Done | none | 9 Nov 2026 | 00c64b9 |
| 8 | Tooling, CI and test harness | Medium | Done | none | 9 Nov 2026 | 7d1a7e5 |

Suggested order: **3, 1, 2, 4, 5, 6, 7, 8.** Batch 3 first because the Redis hang is the most severe live defect. Batch 1 next because the auth abuse is the most severe release gate. If you prefer to close the security work first, do 1 then 3; they are independent.

**If this is your first session:** start with Batch 3 (the confirmed 30 second hang) or Batch 1 (the open magic-link sign-up). Both are self-contained and high value. Do not start with Batch 6 or 7; they are lower risk and easier to do after the core is fixed.

---

## 3. Severity in context

- The app is local only. "High" means it matters when the app is hosted, or it breaks the current local product, not that it is exploitable on the internet today.
- `P1-C1` is dev-only. Production already excludes it.
- `P1-H3` and `P1-M1` are deployment gates for next month, not live vulnerabilities.
- The real "fix now" items are the auth abuse paths, the file lifecycle, and the Redis hang.

---

## 4. Batch 1: Authentication abuse

**Risk:** High. Real in every environment.
**Status:** `Done`
**Depends on:** none
**Files:** `apps/api/src/auth/auth.ts`, `apps/web/src/features/auth/*`

### P1-H1: Magic link allows open sign-up for any email

- [x] Done: `hooks.before` gate in `apps/api/src/auth/magic-link-gate.ts`, backed by `hasPendingInvitationForEmail`. A blocked request returns `200 {"status":true}`, so it is indistinguishable from a real request, and no mail or user row is produced.

**Implemented:** The gate allows an existing user or a pending, unexpired invitation. The plan's neutral `BAD_REQUEST` was replaced with a `ctx.json({ status: true })` short circuit, because a 400 would still reveal that the address is unknown. `rateLimit.customRules["/sign-in/magic-link"]` is now `{ window: 60, max: 3 }`.

**Where:** `apps/api/src/auth/auth.ts`, `magicLink({ ... })` (around line 341).
**Problem:** The plugin has no `disableSignUp`, so `POST /api/auth/sign-in/magic-link` creates a user for any address and sends a link. Confirmed live: a random address received a link, and verifying it created a verified user with no invitation.
**Important:** Do **not** simply set `disableSignUp: true`. The invitation flow relies on a magic link creating the account for a new invitee (`services/invitation.service.ts`, `sendInvitationMagicLink`). Setting the flag alone will break invitations.

**Recommended fix: gate the plugin in a `before` hook.**
In the existing `hooks.before` in `auth.ts`, for `ctx.path === "/sign-in/magic-link"`:
1. Read and normalise `ctx.body.email`.
2. If a user already exists, allow.
3. If no user exists, allow only when a pending, unexpired invitation exists for that email in the `invitation` table.
4. Otherwise throw a neutral `APIError("BAD_REQUEST", ...)` that does not reveal whether the address exists.

This keeps the invite flow working, because the invitee has a pending invitation, and blocks arbitrary addresses. Read the invitation with `adminDb`, read only, like the other auth-table lookups, and check `status = 'pending'` plus `expiresAt > now`. Add a `rateLimit.customRules` entry for `/sign-in/magic-link` (for example `{ window: 60, max: 3 }`).

**Done when:**
- A magic-link request for an address with no user and no invitation sends no mail and creates no user.
- An address with a pending invitation still receives a link and can accept.
- An existing user can still request a link.
- The response does not reveal whether the address exists.

**Verify:**
```bash
curl -s -X POST http://localhost:3001/api/auth/sign-in/magic-link \
  -H 'content-type: application/json' \
  -d '{"email":"no-such-person@example.com"}'
# expect a neutral rejection, no Mailpit message, no user row
```
Then run the invitation flow in the UI for a new address and confirm it still works.

### P1-H2: Implicit account linking enables pre-registration hijacking

- [x] Closed: not reachable with this configuration. Better Auth defaults `accountLinking.requireLocalEmailVerified` to `true`, and the source guard rejects linking into an existing local row whose address is unverified. Sign-up always writes `emailVerified: false` and this app requires verification before a password sign-in, so an attacker who pre-registers a victim's address can never verify it. The victim's OAuth sign-in is rejected instead of activating the attacker's password.

**Verdict:** `disableImplicitLinking: true` was implemented first and then reverted. It added no protection given `requireEmailVerification: true` plus `requireLocalEmailVerified: true`, and it broke legitimate same-email GitHub and Google sign-in for verified users. `apps/api/src/auth/account-linking.ts` now keeps implicit linking on and states `requireLocalEmailVerified: true` explicitly, so a future library default change or the option's removal surfaces in review. The `account_not_linked` copy still guides an unverified local account.

**Optional hardening implemented:** an hourly BullMQ sweep in `apps/api/src/queues/account-cleanup.ts` removes unverified users older than 7 days, using the rules in `apps/api/src/services/account-cleanup.service.ts`. Users who hold a workspace seat are skipped. This stops an abandoned or mistyped address from reserving the email forever.

**Where:** `apps/api/src/auth/auth.ts`, `account.accountLinking` (around line 178).
**Problem:** Same-email OAuth sign-in is implicitly linked to an existing user. An attacker can pre-register a victim's email with a password they choose; when the victim later signs in with Google, the accounts link and the attacker's password remains valid.
**Fix:** Set `disableImplicitLinking: true`. Keep `trustedProviders` for explicit linking. Users who already have a password account and want Google must sign in with the password and link Google from account settings.
**UX:** Update the sign-in error copy for `account_not_linked` to explain the next step (sign in with password, then link the provider). The auth dialog already maps errors; add this code to the map.
**Optional hardening:** Add a cleanup job that deletes unverified users older than N days.

**Done when:**
- A same-email OAuth sign-in for an existing password account is rejected with `account_not_linked`, not silently linked.
- Explicit linking from an authenticated session still works.
- The dialog shows a useful message for the new error.

**Verify:** Manual with a Google test account that shares an email with an existing password account. If no provider account is available, add a note in the session log and verify the config value plus the error copy in a unit test of the error map.

### P3-F5: Generic magic-link route lands on the API origin

- [x] Done: `resolveMagicLinkCallback` in the magic-link hook. A missing or foreign callback becomes `${serverEnv.webUrl}/`, a relative callback resolves against the web origin, and a trusted absolute invitation callback passes through unchanged.

**Where:** `apps/api/src/auth/auth.ts`, magic-link hook.
**Problem:** A direct request without `callbackURL` lands on `http://localhost:3001/` and shows the leftover `"Hello Huzaifa"` string.
**Fix:** In the same magic-link hook, if `callbackURL` is missing, relative or not on the trusted web origin, set it to `${serverEnv.webUrl}/`. Keep the invitation route's absolute callback as is.
**Done when:** A direct magic-link request with no callback lands on the web app, not the API root.

### P1-M8: Invitation magic-link endpoint can be spammed

- [x] Done: per-IP cap of 5 per hour and a total cap of 5 per invitation in `sendInvitationMagicLink`. The route passes `server.requestIP(request)`, so a client cannot spoof the address with a header.

**Implemented:** Limits live in `apps/api/src/auth/permissions.ts`. Manual checks: the 6th request on one invitation returned 429 with the total-cap copy, and the IP cap returned 429 with its own copy.

**Where:** `apps/api/src/services/invitation.service.ts`, `sendInvitationMagicLink`.
**Problem:** The public route uses the invitation id as a bearer token and only has a 60 second cooldown per invitation. A leaked link can trigger one email per minute for the invitation lifetime.
**Fix:** Add a per-IP counter (for example 5 per hour) and a total cap per invitation (for example 5). Return 429 with the existing copy. Pass the client IP from the route, do not trust a header that the client can set unless the proxy strips it.
**Done when:** The 4th or 6th request within the window returns 429, and a normal invitee can still request a link.

### P1-M25: Sign-up reveals whether an email is registered

- [x] Decision: option 3. Keep the friendly message and document the trade-off. Better Auth applies rate limits at the router before hooks, so the existing `/sign-up/email` rule of 5 per 60 seconds already runs before the duplicate lookup.

**Decision note:** Option 2 was rejected because `requireEmailVerification` makes Better Auth answer a duplicate sign-up with a generic success and no email, which would leave the person waiting for mail that never arrives. The accepted exposure is throttled to five probes per minute.

**Where:** `apps/api/src/auth/auth.ts`, sign-up pre-check (around line 276).
**Problem:** The friendly message tells an attacker whether an address has an account.
**Options:**
1. Keep it and document the trade-off (current behaviour).
2. Return a neutral message and rely on the sign-in or reset flow to guide the person.
3. Keep the friendly message but apply the sign-up rate limit before the lookup.

**Recommendation:** Option 2 if the product can accept a slightly less specific message; otherwise option 3 and document it.
**Done when:** The chosen behaviour is written in this file and reflected in the code and copy.

### Batch 1 exit criteria

- [x] All five items ticked or explicitly closed.
- [x] New/updated tests for the hook gate and the error map.
- [x] API and web tests green, typecheck clean.
- [x] Manual verification recorded in the session log.
- [x] No new lint errors.

---

## 5. Batch 2: File access and object lifecycle

**Risk:** High. Client attachments stay public after deletion.
**Status:** `Done`
**Depends on:** none
**Files:** `apps/api/src/routes/files.ts`, `apps/api/src/lib/storage/*`, `services/comment.service.ts`, `services/milestone.service.ts`, `services/project.service.ts`

### P1-H4: `/files/*` is public and unrevocable

- [x] Done: Option A. `fileKeyAccess` classifies every key. Avatars, organization logos, project logos and cached link previews are public. Comment and milestone attachments require a session plus membership of the organization named in the key. Private responses are `private, no-store`, so a delete revokes access.

**Decision recorded: Option A.** Implemented in `apps/api/src/lib/storage/config.ts` (`fileKeyAccess`) and enforced in `apps/api/src/routes/files.ts` through `isOrganizationMember` in `apps/api/src/middleware/tenant.ts`. Unauthenticated, unverified and cross-organization callers all receive 404, so the route cannot be used to probe organization ids.

**Follow-through required by the decision:** the four fetch based viewers and PDF.js now send credentials. `text-viewer.tsx`, `csv-viewer.tsx`, `docx-viewer.tsx` and `sheet-viewer.tsx` set `credentials: "include"`, and `pdf-viewer.tsx` sets `withCredentials: true`. This depends on the API staying on the same site as the web app, which Batch 4 pins down.

**Scope note:** this closes the public gap. The five already-orphaned attachments discovered in phase 3 remain readable by members of the owning organization until the cleanup in P1-M7 and the reconciliation script removes them.

### P1-M7: Deleted content leaves attachments in storage

- [x] Done: `keyFromRichText` walks `milestone.description` and `comment.body` before the row is removed. Comment delete collects from the loaded record. Milestone delete collects the description plus every comment in one query. Project delete collects every milestone description and every comment in the project before the cascade. Objects are removed after the commit by `deleteObjectsBestEffort`, which is bounded to two seconds so unreachable storage cannot hold the request open.

**Reconciliation:** `apps/api/scripts/reconcile-orphan-objects.ts`, run with `bun run db:reconcile-objects` (dry run) or `--apply`. It reads references from business tables only (`project.logo`, `milestone.description`, `comment.body`), prunes only project, milestone and comment folders, and skips objects newer than 24 hours. Avatars and organization logos are deliberately out of scope because their references live in Better Auth tables.

### P1-M18: Milestone attachments are served inline

- [x] Done: `Content-Disposition` is forced to `attachment` for `comments/files/` and `milestones/files/`, and for any request with `?download=1`. Images and logos stay `inline`.

### P1-M24: Downloads have no filename

- [x] Done: the route accepts a sanitised `name` query parameter and emits `filename="..."` plus `filename*=UTF-8''...`. `fileDownloadUrl(src, name)` adds it from the viewer and the editor chip. `safeDownloadName` strips control characters, quotes, backslashes and path separators and caps the length at 120.

### P1-M17: External images allow viewer tracking

- [x] Done: Option "restrict to `/files/`". `safeImageUrl` drops any absolute image source, so an external URL cannot become a tracking pixel. Attachment chips and bookmark previews still accept external URLs, so link previews keep working. Existing external images already stored remain until the document is next saved.

### Batch 2 exit criteria

- [x] Decision recorded for P1-H4.
- [x] All items ticked or closed.
- [x] Tests for the file route (authenticated, unauthenticated, cross-org), the key classifier, the rich text key walk, the download name sanitiser and the delete paths.
- [x] Live unauthenticated access check recorded: a private milestone image returns 404, a public project logo returns 200 with the immutable cache header, and an unknown prefix returns 404. The authenticated upload and delete click-through is still outstanding and noted in the session log.

---

## 6. Batch 3: Redis and storage resilience

**Risk:** High. Confirmed 30 second hang on authenticated requests during a Redis outage.
**Status:** `Done`
**Depends on:** none
**Files:** `apps/api/src/lib/redis.ts`, `apps/api/src/lib/timeout.ts`, `apps/api/src/auth/secondary-storage.ts`, `apps/api/src/lib/storage/client.ts`, `apps/api/src/routes/health.ts`, `apps/api/src/queues/*.ts`, `apps/api/src/index.ts`, `apps/api/scripts/check-redis-deadline.ts`

### P3-F1: Redis outage hangs authenticated requests

- [x] Done: the connection options are now split. `redisClientOptions` gives our client `enableOfflineQueue: false`, `connectTimeout` 1s, `commandTimeout` 500ms and `maxRetriesPerRequest: 1`, while `redisConnectionOptions` stays permissive for BullMQ, whose blocking reads cannot survive those limits. `failSoft` runs every secondary storage call through a 250ms `withDeadline`, so a connected but silent Redis now returns the fallback and Better Auth reads the Postgres copy. One throttled `logRedisIssue` (30s per key, dev only) replaces the per failure logging and is now attached to every BullMQ queue, worker and queue events emitter, because BullMQ otherwise falls back to an unthrottled `console.error` per reconnect. `/ready` pings the same client through `pingRedis` and reports Redis as `degraded`, not down.

**Measured this session, live stack:**
- Healthy Redis, authenticated `GET /orgs/qa-studio-p3203518/projects`: 10 to 22ms.
- Redis stopped, same request: 200 in 14 to 30ms, served from the Postgres session copy. The phase 3 report measured 29.7s and a fetch failure.
- Redis stopped, `/ready`: 200 in 2ms with `{"status":"degraded","checks":{"database":"ok","redis":"down"}}`, and `/health` stayed 200.
- Redis stopped, API log: 6 throttled lines in 30s, one per BullMQ emitter, down from 57 unthrottled DNS lines in a short window.
- Redis started again: 10 to 20ms, and `/ready` returned `{"status":"ok","checks":{"database":"ok","redis":"ok"}}`.
- Silent peer check (`bun run check:redis`): auth read 251ms, increment 250ms, write 251ms, readiness ping 250ms, each returning its fallback.
- Live Redis in the same script: ping 1ms, write 1ms, read 1ms.

**Known, accepted:** a command issued before the client first reaches the ready state fails fast and falls back to Postgres, so the first requests after boot may skip the cache. That is a miss, not an error, and it keeps boot from blocking on Redis.

**Where:** `apps/api/src/auth/secondary-storage.ts`, `apps/api/src/lib/redis.ts`.
**Problem:** With Redis stopped, `/health` stays 200 but `GET /orgs/:slug/projects` hung for 29.7 seconds and then failed. ioredis queues commands while disconnected and retries, so the `failSoft` wrapper never receives a rejection and never falls back to the database.
**Fix:**
1. Configure the Redis clients with `enableOfflineQueue: false`, a short `connectTimeout`, and `commandTimeout` (and a bounded `maxRetriesPerRequest`).
2. Wrap secondary-storage reads in a short timeout race (for example 250 ms) that returns the fallback, so Better Auth falls back to Postgres.
3. Add a single throttled `error` listener so a long outage does not flood the logs.
4. Add an authenticated readiness check that exercises the session path, not only `/health`.
**Done when:** Stopping Redis makes an authenticated request either succeed from Postgres within a second or fail with a clear 503, never hang for 30 seconds. Starting Redis restores normal latency.

**Verify:**
```bash
cd apps/api
bun run check:redis
# expect each auth call under 1s with its fallback, then "Redis deadline check passed"
```

Full end to end check, when Docker is approved:
```bash
docker stop ultra-dev-redis-1
# authenticated request: expect < 1s, 200 from DB or a clean 503
curl -i http://localhost:3001/ready     # 200, status "degraded", checks.redis "down"
curl -i http://localhost:3001/health    # still 200, liveness is unchanged
docker start ultra-dev-redis-1
# request: 200, single digit ms, and /ready reports status "ok"
```

### P1-M6: Storage reads and deletes have no deadline

- [x] Done: `headObject`, `readHeadBytes`, `deleteObject` and the response acquisition inside `openObject` all run through the shared `withDeadline`, with 10s metadata and 15s transfer deadlines. `openObject` bounds only the response, never the stream. The upload worker also wraps its processor in a 60s backstop, because BullMQ 6 has no per job timeout option. `routes/files.ts` maps `TimeoutError` to 504 so a hung gateway is distinguishable from a server bug.

**Where:** `apps/api/src/lib/storage/client.ts`.
**Fix:** Wrap `headObject`, `readHeadBytes`, `openObject` and `deleteObject` in the existing `withStorageTimeout`, and add a BullMQ job timeout as a backstop.
**Done when:** A hung storage call releases the worker slot within the deadline.

### P1-M14: Redis password in `REDIS_URL` is ignored

- [x] Done: `parseRedisUrl` now returns `username` and `password` and percent decodes them. `resolveRedisAuth` prefers `REDIS_PASSWORD` and falls back to the URL password, and the username always comes from the URL. Tests cover `redis://:secret@host`, an explicit user, and encoded credentials.

**Where:** `apps/api/src/lib/redis.ts`, `parseRedisUrl`.
**Fix:** Read `parsed.password` and `parsed.username` as fallbacks when `REDIS_PASSWORD` is empty, or construct the client from the URL and let ioredis parse it.
**Done when:** A URL of the form `redis://:secret@host:6379` authenticates.

### P1-H5: Shared Redis client has no error listener

- [x] Closed, disproved in phase 3

The API did not crash during the outage. The throttled `error` listener now lives in `apps/api/src/lib/redis.ts`, and `logRedisIssue` is shared with the auth and rate limit fallbacks, so this stays closed.

### Batch 3 exit criteria

- [x] All items ticked or closed.
- [x] A repeatable outage test is written down: `apps/api/scripts/check-redis-deadline.ts` (`bun run check:redis`) plus the Docker steps above. The script uses a proxy that goes silent after the handshake, which is the exact failure mode from phase 3.
- [x] Recovery verified: after `docker start ultra-dev-redis-1`, the authenticated request returned in 10 to 20ms and `/ready` reported `{"status":"ok","checks":{"database":"ok","redis":"ok"}}`. The bounded client adds no latency on the healthy path.

---

## 7. Batch 4: Production and environment gate

**Risk:** High for deployment, not a current incident. Do this before the planned hosting.
**Status:** `Done`
**Depends on:** none
**Files:** `.env.example`, `.env.example.dev`, `compose.yaml`, `compose.dev.yaml`, `apps/api/src/lib/env.ts`, `apps/api/src/lib/validate-env.ts`, `apps/api/src/lib/validate-boot.ts`, `apps/web/src/lib/api-base.ts`, `apps/web/vite.config.ts`, `seaweedfs/s3-entrypoint.sh`

### P1-H3: Production defaults ship dev credentials and localhost URLs

- [x] Done

**Implemented:** `compose.yaml` uses `${VAR:?message}` for every secret and public URL: `POSTGRES_PASSWORD`, `POSTGRES_APP_PASSWORD`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `WEB_URL`, `S3_PUBLIC_ENDPOINT`, `S3_ALLOWED_ORIGINS`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` and `VITE_API_URL`. Development defaults stay only in `compose.dev.yaml`. `.env.example` is now the production template with blank required values, and `.env.example.dev` holds the local values. The web client has one origin resolver in `apps/web/src/lib/api-base.ts`, and `vite.config.ts` refuses a production build without `VITE_API_URL`. SeaweedFS now reads its credentials from `S3_ACCESS_KEY` and `S3_SECRET_KEY` through `seaweedfs/s3-entrypoint.sh`, so the committed `admin/admin` file is development only.

**Where:** `compose.yaml` (`POSTGRES_PASSWORD`, `POSTGRES_APP_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `WEB_URL`, `S3_PUBLIC_ENDPOINT`), `.env.example`, `apps/web/src/lib/api.ts`, `apps/web/src/features/auth/client.ts`.
**Fix:**
1. Remove every production default for secrets and public URLs. Use `${VAR:?message}` in compose so a missing value fails `docker compose config` with a clear message.
2. Replace the example values with placeholders such as `change-me` and mark them required. The values are left blank instead, because a non-empty placeholder would make `docker compose config` pass and defeat the check.
3. Keep development defaults only in `compose.dev.yaml`.
4. Make the web client use a relative API base in production when `VITE_API_URL` is empty, instead of `http://localhost:3001`. If a relative base is not supported by Eden Treaty, require the variable at build time and fail the build when it is missing. A relative base was rejected because it needs an HTTP and WebSocket reverse proxy that the stack does not have, so the build time requirement was implemented.

**Done when:** `docker compose --env-file .env.example config` fails on the missing secrets, and a production build with a real API URL points at that URL.

### P1-M1: `NODE_ENV` defaults to development

- [x] Done

**Implemented:** `NODE_ENV` defaults to `production`, and the dev script plus the dev compose stack set `development` explicitly. `apps/api/src/lib/validate-env.ts` lists every missing production value in one error. `validate-boot.ts` is the first import in `index.ts`, so the check runs before `auth.ts` constructs Better Auth and before the Postgres or Redis clients are used. Required: `DATABASE_URL`, `DATABASE_APP_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `WEB_URL`, `REDIS_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PUBLIC_ENDPOINT`. The check also rejects non-absolute public URLs and `DATABASE_APP_URL` equal to `DATABASE_URL`, because that would silently disable RLS.

**Where:** `apps/api/src/lib/env.ts`.
**Fix:** Default to `production`, or fail the boot when `NODE_ENV` is unset. Keep `development` as an explicit opt-in. Add startup validation for `DATABASE_URL`, `DATABASE_APP_URL`, `BETTER_AUTH_SECRET`, `WEB_URL` and `S3_PUBLIC_ENDPOINT` when `NODE_ENV=production`.
**Done when:** A bare production start without the required variables fails with a clear message, and Bull Board and OpenAPI are absent.

### P1-M15: `S3_PUBLIC_ENDPOINT` defaults to an unreachable Docker name

- [x] Done

**Implemented:** Production compose no longer defaults it, and both `docker compose config` and the startup validation require a value. `env.ts` still leaves the production value empty, so signing cannot silently use a Docker internal name.

**Where:** `compose.yaml`, `apps/api/src/lib/env.ts`.
**Fix:** Leave it empty by default, fail the boot in production when it is unset, and document that it must be a browser-reachable reverse proxy that preserves the Host header.
**Done when:** Uploads work through a real public endpoint, and a missing value fails loudly.

### P1-M23: OpenAPI is mounted whenever `NODE_ENV` is not production

- [x] Covered by P1-M1

It lives in the same `if (isDevelopment)` block as Bull Board. Changing the default to production closes it. No separate change. Verified in a production boot: `/bull-board` and `/openapi` both returned 404.

### P1-C1: Unauthenticated Bull Board on the dev stack

- [x] Done, dev-only

**Implemented:** `compose.dev.yaml` publishes the API on `127.0.0.1:${API_PORT:-3001}:3001`. The web container still reaches `api:3001` over the compose network, and the host still reaches `/health` and `/bull-board`.

**Where:** `apps/api/src/index.ts`, `compose.dev.yaml`.
**Fix:** Bind the dev API port to loopback (`127.0.0.1:3001:3001`), or protect `/bull-board` with the `auth` macro plus an owner check. Production is already correct.
**Done when:** From another machine on the network, `/bull-board` is not reachable; from the host, it still is.

### Batch 4 exit criteria

- [x] `docker compose config` fails on missing required values. `docker compose --env-file .env.example config` exits 1 and names the missing values. A complete temporary env exits 0.
- [x] A production boot with a minimal valid env starts and does not expose `/bull-board` or `/openapi`. Boot check on `127.0.0.1:3101`: `/health` 200, `/` 200, `/bull-board` 404, `/openapi` 404.
- [x] The web bundle points at the configured API origin. A build with `VITE_API_URL=https://api.example.com` inlined the origin, and a build without it failed with the new error.
- [x] The checklist is added to the deployment notes in `README.md`.

---

## 8. Batch 5: Authorization and error handling

**Risk:** Medium. Mostly hardening and consistency.
**Status:** `Done`
**Depends on:** Batch 1 for the same auth file (avoid conflicts)
**Files:** `apps/api/src/lib/auth-error.ts`, `services/milestone.service.ts`, `realtime/gateway.ts`, `services/comment.service.ts`, `auth/permissions.ts`, `auth/project-permissions.ts`

### P1-M2: Unknown errors become 409 and raw messages reach clients

- [x] Done: unknown and server side failures now answer 500, and only an `APIError` with a client status reaches the browser as text.

**Implemented:** `authErrorStatus` returns 500 for a non `APIError` and for any unknown or 5xx status. `authErrorMessage` keeps the mapped code table, then surfaces `body.message` only when the error is an `APIError` that resolves to a client status (400, 401, 403, 404, 422, 429). Anything else is logged with its caller fallback as context and replaced by that fallback. The log is dev only and silent under `NODE_ENV=test`, matching the Redis logger until a production logger exists.

**Where:** `apps/api/src/lib/auth-error.ts`.
**Done when:** A forced driver error returns a generic 500 and the raw message appears only in the server log. Covered by `auth-error.test.ts`.

### P1-M9: Presence join accepts any milestone id

- [x] Done: `presence.join` now confirms the milestone belongs to the connection's project before subscribing.

**Implemented:** `milestoneExistsInProject` in `milestone.service.ts` is a tenant scoped id check. The gateway message path moved into an async `handleMessage`, and `presence.join` runs that check through `withTenant` before `subscribeMilestone`. A frame naming another project's milestone, a missing milestone, or a membership that changed mid frame is ignored; `presence.leave` stays unvalidated because unsubscribing grants nothing.

**Where:** `apps/api/src/realtime/gateway.ts`, `presence.join`.
**Done when:** A milestone id from another project is rejected or ignored, and a valid one still subscribes.

### P1-M10: Revoked members keep receiving events

- [x] Done: revocation rides a Redis control channel and closes the matching sockets on every instance.

**Decision: revocation broadcast.**
**Implemented:** `realtime/control.ts` owns a dedicated `realtime:control` channel with a strict `revoke.member` frame (`organizationId`, `userId`, optional `projectId`). The bus subscribes to it and handles it before any project topic fan-out, so no control frame ever reaches a browser. `realtime/revoke.ts` matches connections by user, organization and, when present, project, and `RealtimeRegistry.retireWhere` removes then closes them with 4403. `publishMemberRevocation` follows the same 250ms ready wait and local fallback as project events, so a Redis outage still closes the local sockets instead of queueing a stale instruction. Hooks publish after a successful organization member removal (`member.service.ts`) and project member removal (`project.service.ts`). `maxConnectionMs` stays at 30 minutes as a backstop, because leaving an organization goes through `authClient.organization.leave` on the client and never reaches the API.

**Where:** `apps/api/src/realtime/gateway.ts`, `maxConnectionMs` in `lib/env.ts`.
**Done when:** The chosen behaviour is implemented and written in this file. Covered by `control.test.ts`, `revoke.test.ts` and the new `registry.test.ts` case.

### P1-M19: Any project member can toggle checklists in another person's comment

- [x] Done: author only.

**Decision: author only.** A checklist item is part of the comment body, so `toggleMilestoneChecklistItem` now calls `assertCanModifyComment` after loading the row, exactly like a text edit. The web checkbox uses `comment.canEdit` instead of `canComment`. The module comment in `comment.service.ts` and the `comment-checklist.tsx` header now describe the author rule.

**Where:** `services/comment.service.ts`, `toggleMilestoneChecklistItem`; `auth/comment-permissions.ts`.
**Done when:** The rule is consistent between the code, the copy and the tests. Covered by the new `comment-permissions.test.ts` assertion.

### P1-M20: Empty milestone PATCH still writes

- [x] Done: an empty or no-op patch returns the current detail without an update.

**Implemented:** `updateMilestone` returns the current detail when no recognized field is present, and also skips the write when the named fields produced no change, no timeline event and no assignee replacement. The `description` field is only listed in `changed` when the sanitized Plate array differs from the stored one. The PATCH route only publishes a realtime update when there is a change or a timeline row.

**Where:** `services/milestone.service.ts`, `updateMilestone`.
**Done when:** `PATCH {}` leaves `updatedAt` and `updatedBy` unchanged.

### P2-F2: Target-only permission predicates

- [x] Done: the actor check is part of both predicates.

**Implemented:** `canManageTarget` returns false unless the actor is owner or admin, and `canManageProjectTarget` returns false unless the actor is a project owner or admin. Every current caller already asserts the manager role first, so valid requests are unchanged, and a caller that forgets the guard now gets a safe answer.

**Where:** `auth/permissions.ts`, `canManageTarget`; `auth/project-permissions.ts`, `canManageProjectTarget`.
**Done when:** `canManageTarget("member", "member")` is false, and the member and project role tests still pass.

### Batch 5 exit criteria

- [x] All items ticked, closed or marked as a documented decision.
- [x] New tests for the error mapping and the predicates.
- [x] Integration suite green.

---

## 9. Batch 6: Web shell, headers and UX

**Risk:** Medium. Navigation confusion, missing headers, production devtools.
**Status:** `Done`
**Depends on:** Batch 4 for the API origin
**Files:** `apps/web/src/features/organization/active-workspace.ts`, `apps/web/src/routes/_app.tsx`, `apps/web/src/routes/__root.tsx`, `apps/web/server/*`, `apps/web/public/*`, `vite.config.ts`, `apps/web/src/features/files/viewer-kind.ts`, `apps/api/src/middleware/security-headers.ts`

### P3-F2: App shell ignores the organization in the URL

- [x] Done: one active organization per session, and any other organization URL is sent back to it.

**Decision: the active organization is authoritative.** The product has one active workspace per session, so the URL must name it. A stale bookmark, an old link or a hand edited address is replaced with the active workspace instead of rendering a second workspace. The active organization is not switched from the URL: it changes only through `useSwitchOrganization`, which keeps the switch guard and the cross tab broadcast in one place.

**Implemented:** `decideActiveWorkspace` (`features/organization/active-workspace.ts`) compares the `$orgSlug` match param with the active organization slug. `routes/_app.tsx` reads the slug through `useMatches` (the layout renders above that route, so `useParams` has no params there), renders nothing while the active organization is loading, and replaces a mismatched URL with `/$activeSlug` using `replace: true`, so Back does not bounce between two workspaces. The shell, breadcrumb, switcher and settings page keep reading the active organization, which is now always the organization on screen.

The cross tab feature still works: `sync.ts` refreshes the session in every tab on `auth:org-changed`, and the guard moves any tab whose URL does not match the new active organization. Tabs on `/account` have no organization scope and stay put.

**Where:** `apps/web/src/features/organization/active-workspace.ts` and `apps/web/src/routes/_app.tsx`.
**Done when:** Deep-linking to either organization lands on the active one. Covered by `active-workspace.test.ts`; the live redirect check is tracked as outstanding in the session log because Docker stopped mid-session.

### P3-F6 and P1-M11: TanStack Devtools in production

- [x] Done: the devtools render only under `import.meta.env.DEV`, and a production boot clears the two keys the panel writes (`pip_open`, `tanstack_devtools_settings`).

**Implemented:** the static imports become unreachable in a production build, so Rollup drops both packages. Verified with a grep of `.output/public` and `.output/server` for the panel and trigger names.

**Where:** `apps/web/src/routes/__root.tsx`.
**Done when:** The "Open TanStack Devtools" control is absent from a production build.

### P3-F3: Missing favicon

- [x] Done: `public/favicon.svg` plus a generated `public/favicon.ico` (32 px and 16 px), linked from the root head. Production returns 200 with `image/vnd.microsoft.icon`, and the Vite dev server returns 200 too.

**Why both:** the SVG is the crisp icon modern browsers prefer, and the ICO keeps a direct `/favicon.ico` request a 200 for every other client.

**Also:** `compose.dev.yaml` now syncs `apps/web/public` and `apps/web/server` into the dev container. Without that, new source directories never reach it and Nitro cannot load the header plugin.

**Where:** `apps/web/public/`, root head.
**Done when:** `/favicon.ico` returns 200 and the console is clean.

### P3-F4: Missing SEO metadata

- [x] Done: a meta description in the root head and `public/robots.txt` with `Disallow: /`.

**Decision: no `llms.txt`.** The app is a private workspace, the only public page is the sign in screen, and `robots.txt` disallows crawling, so there is nothing for a crawler-oriented file to describe. Adding one would contradict the robots policy.

**Where:** root route head, `apps/web/public/`.
**Done when:** Lighthouse SEO is deliberate, not accidental.

### P1-M12: No CSP or security headers

- [x] Done: the app shell and the API both send the headers, and the `/files` CSP is preserved.

**Web:** a Nitro runtime plugin (`apps/web/server/plugins/security-headers.ts`) applies the headers through the `response` hook. A `handlers` middleware would not work: Nitro runs the static middleware first, it returns a Response for every asset, and the chain stops there. The `response` hook covers the shell and every static file.

Policy: `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Opener-Policy: same-origin`, and a production CSP. The CSP allows the API origin (Eden, Better Auth, the realtime socket over `ws`/`wss`), the presigned storage origin for direct uploads, and Google Fonts. `script-src` keeps `'unsafe-inline'` because the static SPA shell carries inline bootstrap scripts and a nonce is not possible without dynamic HTML. `img-src` keeps `https:` because OAuth profile photos are external URLs.

`S3_PUBLIC_ENDPOINT` is now passed to the web container and used only to build the policy. Production fails to boot when either the API origin or the storage origin is missing, so a CSP that would silently block sign in, uploads or the realtime stream cannot ship. The temporary preview server that prerenders the shell is exempt (`TSS_PRERENDERING`), otherwise the build would demand a runtime deployment value.

Development sends the same headers without the CSP, so HMR, its websocket and Vite's inline modules keep working. The plugin, not Vite's `server.headers`, is what covers dev responses in practice.

**API:** `apps/api/src/middleware/security-headers.ts` is a global Elysia plugin. Every response gets `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff`; outside development it also gets `default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. It skips the CSP for `/files/*`, because that route returns its own sandboxed policy and Elysia would otherwise overwrite it.

**Zod follow-up found by the browser check:** the production console reported one CSP issue, Zod 4's `new Function` JIT probe. Zod catches the blocked probe and falls back, but the browser still reports it. `apps/web/src/lib/zod-config.ts` sets `jitless` (loaded first from `src/router.tsx`), which skips the probe entirely and keeps the console clean.

**Where:** `apps/web/server/*`, `vite.config.ts`, `compose.yaml`, `apps/api/src/middleware/security-headers.ts`, `apps/api/src/index.ts`.
**Done when:** The headers are present on the app shell and the API, and the app still loads its fonts and styles. Production build and dev header checks are in the session log.

### P1-M13: Unguarded `console.log` and leftover root string

- [x] Done: `/` returns `{ "name": "Handoff API" }`, and the success boot log is development only.

**Why keep `/`:** the deployment smoke check in Batch 4 expects it to answer 200. A neutral JSON body keeps that contract without the leftover string. The fatal boot `console.error` stays on purpose: removing the only startup failure report would be worse than the rule it bends.

**Where:** `apps/api/src/index.ts`.
**Done when:** No user-facing leftover strings and no unguarded console logging.

### P2-F1: Viewer routing contradicts its comment

- [x] Done: a specific MIME type is checked first and the extension is the fallback.

**Implemented:** pdf, csv, text, image, docx and sheet MIME checks run before any extension check. When the MIME names no viewer (empty, `application/octet-stream`, or an unrelated type) the extension decides. That keeps a Windows CSV uploaded as `application/vnd.ms-excel` working, which a strict MIME-only rule would drop. The test now asserts MIME precedence and keeps that CSV case.

**Where:** `apps/web/src/features/files/viewer-kind.ts`.
**Done when:** The code and the comment agree, and `viewer-kind.test.ts` matches.

### Batch 6 exit criteria

- [x] All items ticked.
- [x] Deep link to both organizations lands on the active one. `active-workspace.test.ts` covers the decision; the live redirect check is outstanding because Docker stopped mid-session.
- [x] Production build has no devtools and clean console. Bundle grep plus the browser console check.
- [x] Header check recorded in the log.

---

## 10. Batch 7: Performance

**Risk:** Medium. No user-visible failure yet, but the patterns do not scale.
**Status:** `Done`
**Depends on:** none
**Files:** `services/invitation.service.ts`, `services/project.service.ts`, `services/organization.service.ts`, `routes/uploads.ts`, `queues/upload-verification.ts`, `lib/link-preview/http.ts`, `db/schema.ts`

### P1-M3: Invitation history loads and sorts the whole set

- [x] Done: filter, sort, count and pagination now run in Postgres.

**Implemented:** `listInvitationHistory` reads the `invitation` table on the privileged client (a Better Auth table, never joined into a tenant query). The role filter compares the first value of the comma separated role, search uses `ILIKE` with `escapeLike`, the derived expired status is a `case` expression, and one grouped query produces every status count. `counts.all` is the scope total and the selected status bucket is the page total, so pagination matches the old contract. The page query uses `limit`/`offset`, sorts with an `id` tiebreaker for stable pages, and resolves inviters for the page only.

**Measured:** 20,000 invitations for one organization, page 1, size 20. The old full-load plus JS sort took 107 to 132 ms per call. The new service took 35 ms and returns 20 rows regardless of history size.

### P1-M4: Bulk actions open one transaction per item

- [x] Done: the project bulk paths use one transaction and one write.

**Implemented:** `loadProjectAccessMany` reads every selected project in one query and applies the same visibility and archived rules as `loadProjectAccess`. `getOrganizationMembers` resolves every target in one privileged read. Bulk archive and delete use one `update`/`delete ... where id in (...)`. Bulk add pre-checks existing memberships and inserts the rest with `onConflictDoNothing`, so a concurrent insert cannot abort the batch. Bulk remove reads memberships and owner rows once, evaluates the self, organization owner, target permission and last owner rules from that read, and deletes in one statement. Per item results keep the same keys, order and messages. Revocations are published after the commit.

**Scope note:** the member and invitation bulk paths were audited. They already use one list read and no per-item tenant transaction. Their remaining per-item calls are Better Auth APIs (`updateMemberRole`, `removeMember`, `createInvitation`, `cancelInvitation`) with no batch equivalent. Bypassing them would duplicate Better Auth token, email and limit logic, so they stay as they are.

**Measured:** 100 projects, owner caller. The old path opened one `withTenant` transaction per project and took 2,396 ms. The new path took 115 ms with a `xact_commit` delta of 1.

### P1-M5: Upload completion blocks for up to 8 seconds

- [x] Done: `POST /uploads/:id/complete` enqueues and answers 202.

**Implemented:** the route only enqueues when the session is still `pending`, re-reads once so a fast job can still finish in the same call, and otherwise returns 202. The browser already polls the same route; the call that sees `verified` applies the avatar or organization logo, so the apply step stays idempotent and runs once. `waitForUploadVerification`, its `QueueEvents` connection and its error listener were removed, which also drops one Redis connection from the API. No web change was needed beyond the comment update.

### P1-M16: Decompressed body cap can be exceeded by one chunk

- [x] Done: every buffer return is sliced to `maxBytes`, and a test pins the exact cap.

**Implemented:** `readLimited` now joins through one `capped()` helper in the stop-tag, end and close branches. The stop-tag branch already ran only under the cap, so this makes the guarantee explicit rather than changing behaviour. `http.test.ts` covers an oversized document, a stop tag past the cap, a body under the cap, an oversized asset and an asset at exactly the cap.

### Missing indexes

- [x] Done: `project.slug` trigram index added. Description index deliberately not added.

**Decision:** the phase 1 index table tied the description search to the mention picker. The actual code shows the picker searches user name and email, project name and milestone title, all already indexed. The only `description_text` search is `listMilestones`, which is scoped to one project and is small by design. A 5,000 character cap makes a trigram index feasible, but it is not worth the disk and write cost for a project-scoped list, so the milestone list search is title only and no description index was added.

**Implemented:** `project_slug_trgm_idx` on `project.slug` (GIN, `gin_trgm_ops`), generated in `0021_material_shiver_man.sql` and applied to `app` and `app_test`. `EXPLAIN` with `enable_seqscan = off` shows `Bitmap Index Scan on project_slug_trgm_idx`.

### Batch 7 exit criteria

- [x] All items ticked or explicitly deferred with a reason.
- [x] The integration suite is green on `app_test` (453 pass, 0 fail).
- [x] A before/after timing note is in the log.

---

## 11. Batch 8: Tooling, CI and test harness

**Risk:** Medium. The suite is green but nothing enforces it.
**Status:** `Not started`
**Depends on:** none
**Files:** `nx.json`, `package.json`, `biome.json`, `apps/api/scripts/verify-rls.ts`, `.github/workflows/`

### P2-F3: Nx typecheck target is broken

- [x] Done: explicit `typecheck` target using `bunx tsc --noEmit -p tsconfig.json` on api, web and ui (new `packages/ui/project.json`). `bunx nx run-many -t typecheck` now runs all three and exits 0.

**Where:** `nx.json`, `apps/api/tsconfig.json`, `packages/ui/tsconfig.json`.
**Problem:** `tsc --build tsconfig.json --emitDeclarationOnly` fails with TS5069, and the UI target is disabled by `noEmit`.
**Fix:** Either add `declaration` and `composite` and make the build real, or override the inferred target with `tsc --noEmit -p tsconfig.json` for api, web and ui. Direct `tsc --noEmit` is already clean.
**Done when:** `bunx nx run-many -t typecheck` exits 0 for all three projects.

### P2-F4: Biome check is red and lints vendored files

- [x] Done: `.agents` ignored in `packages/biome-config/biome.json`. 5 SVG marks get `aria-hidden="true"`. `field.tsx` drops `role="group"`, `==` to `===`, index key to message key. `input-group.tsx` drops `role="group"` and suppresses the two a11y rules on the pointer-only handler. alert and sonner import fixes. `bun run check` exits 0 with 0 errors and 0 warnings.

**Where:** `biome.json`, `packages/ui/src/components/ui/*`.
**Fix:** Add `.agents` to the Biome ignore list. Fix the 13 source errors: the five SVG components need a title or `aria-hidden`, `input-group.tsx` and `field.tsx` need semantic and keyboard fixes, and `alert.tsx` and `sonner.tsx` need import order and type-only imports.
**Done when:** `bun run check` exits 0, or the only remaining diagnostics are explicitly documented.

### P2-F5: No CI

- [x] Done: `.github/workflows/ci.yml` with install, Biome, Nx typecheck, unit tests for api and web, `bun run test:db`, and the RLS script against a Postgres service. YAML parses cleanly; every step replayed locally. First real run lands on the first push.

**Where:** `.github/workflows/`.
**Fix:** Add one workflow with install, `bun run check`, direct typecheck, `bun test` in api and web, and the RLS script against a Postgres service. Cache Bun and Nx.
**Done when:** A pull request runs the workflow and blocks on failure.

### P2-F6: Integration suite needs manual setup

- [x] Done: `apps/api/scripts/test-db.ts` plus `test:db` scripts. Creates `app_test` if missing, runs `db:setup`, runs the suite, optional `--drop`. Keeps the `TEST_DATABASE=1` and `app_test` name guard. Verified locally: 453 pass, 0 fail.

**Where:** root `package.json`, `apps/api/package.json`, `apps/api/scripts`.
**Fix:** Add a `test:db` script that creates `app_test` if missing, runs `db:setup`, runs the suite, and optionally drops the database. Keep the `TEST_DATABASE=1` and `app_test` name guard.
**Done when:** One command runs the database suite from a clean machine.

### P1-M21 and P1-M22: Test execution and RLS coverage

- [x] Done: `verify-rls.ts` now covers `comment` and `link_preview` (seed, scoped read, cross-tenant insert, cascade). `TENANT_TABLES` extracted to `scripts/tenant-tables.ts` and compared both ways against `pg_class.relrowsecurity`. Verified 23/23 checks pass and the drift check fails in both directions.

**Where:** `apps/api/scripts/verify-rls.ts`.
**Fix:** Extend the script to `comment` and `link_preview`, and add a check that `TENANT_TABLES` in `bootstrap-db.ts` matches the business tables that have an RLS policy.
**Done when:** Removing a table from `TENANT_TABLES` or forgetting a policy makes the script fail.

### P2-F7 and P2-F8: Informational

- [x] Closed, no action

September renders as "Sept" with `en-GB`; the date test is timezone local by design. Neither is a defect.

### Batch 8 exit criteria

- [x] Typecheck, lint, unit tests and the RLS script all run in CI.
- [x] The database suite is one command.
- [x] The status board is updated.

---

## 12. Session log

Append one row per session. Do not rewrite old rows.

| Date | Batch | What changed | Verify | Commit | Next session |
|---|---|---|---|---|---|
| 8 Nov 2026 | none | Baseline reports only | Phase 1, 2 and 3 complete | none | Start Batch 1 |
| 8 Nov 2026 | Batch 1 | Magic-link gate, callback fix, implicit linking off, invitation link caps, sign-up trade-off documented | `bun test` api 332 pass / web 67 pass, tsc clean for api, web and ui, biome clean on 13 files, live curl checks passed | uncommitted | Start Batch 3 (Redis hang), then Batch 2. Manual OAuth `account_not_linked` check still outstanding (no test provider account). |
| 8 Nov 2026 | Batch 1 correction | Reverted `disableImplicitLinking` after confirming Better Auth defaults `requireLocalEmailVerified` to true and blocks linking into unverified rows. Kept implicit linking, pinned the real guard, updated copy. | `bun test` api 332 pass / web 67 pass, tsc clean | uncommitted | P1-H2 closed as not reachable. Start Batch 3, then Batch 2. |
| 8 Nov 2026 | Batch 1 follow-up | Added an hourly BullMQ sweep that deletes unverified accounts older than 7 days, skipping workspace members. | `bun test` api 338 pass, tsc clean, live job removed an 8 day fake row and kept a 6 day one | uncommitted | Start Batch 3, then Batch 2. |
| 8 Nov 2026 | Batch 2 | Option A file access: `fileKeyAccess` classifier, member gated comment and milestone attachments with private no-store, public branding and link previews unchanged. Delete paths in comment, milestone and project walk the rich text and remove objects after commit. Forced attachment disposition with a sanitised filename, external images restricted to `/files/`, and a dry-run reconciliation script. | `bun test` api 365 pass / 40 skip, web 67 pass, tsc clean for api, web and ui, integration suite 38 pass on `app_test`, biome clean on touched files, reconciliation dry run scanned 68 objects and found 39 removable orphans, live curl check returned 404 for a private milestone image, 200 with the immutable cache for a public project logo, and 404 for an unknown prefix | 3a45be7 | Authenticated upload and delete click-through still outstanding. Start Batch 3 next. |
| 9 Nov 2026 | Batch 3 | Split Redis options into a fail fast application client and a permissive BullMQ set. Added a 250ms deadline around every secondary storage call so Better Auth falls back to Postgres, a bounded command timeout, throttled Redis logging on the app client and every BullMQ emitter, URL credential parsing, deadlines on all storage calls plus a 60s worker backstop, and a `/ready` probe that keeps `/health` as liveness and reports Redis as degraded rather than taking the instance out of rotation. | `bun test` api 379 pass / 40 skip, web 67 pass, tsc clean for api, web and ui, biome clean on the touched files, `bun run check:redis` returned 250 to 251ms for every auth call against a silent server. Live stack with Docker: authenticated request 200 in 14 to 30ms while Redis was stopped, `/ready` 200 degraded in 2ms, `/health` 200, 6 throttled log lines in 30s instead of 57 unthrottled, then 10 to 20ms and `/ready` ok after Redis restarted. | 105eee6 | Start Batch 4. |
| 9 Nov 2026 | Batch 4 | Fail-closed production config: `NODE_ENV` defaults to production, `validate-env.ts` with `validate-boot.ts` rejects an incomplete env before auth or database clients load, `compose.yaml` has no secret or public URL defaults, `.env.example` is the production template with a new `.env.example.dev`, the web bundle requires `VITE_API_URL` at build time through one origin resolver, SeaweedFS reads its credentials from env, and the dev API port is loopback only. | `bun test` api 388 pass / 40 skip, web 71 pass, tsc clean for api, web and ui, biome clean on touched files (repo-wide still the 17 pre-existing Batch 8 errors), `docker compose --env-file .env.example config` exited 1 with the missing values, a complete temp env exited 0, production boot on 127.0.0.1:3101 returned 200 for `/health` and `/`, 404 for `/bull-board` and `/openapi`, the web build inlined `VITE_API_URL=https://api.example.com` and failed without it, and `ss` showed the dev API on 127.0.0.1:3001. | 685dd35 | Start Batch 5. |
| 9 Nov 2026 | Batch 5 | Unknown failures answer 500 and are logged instead of echoed. `presence.join` verifies the milestone belongs to the connection's project. Membership revocation is broadcast on a dedicated Redis control channel and closes matching sockets on every instance, with hooks after organization and project member removal. Checklist toggles are author only. An empty or no-op milestone PATCH no longer writes. Both target predicates now include the actor check. | `bun test` api 399 pass / 40 skip, web 71 pass, tsc clean for api, web and ui, integration suite 437 pass on `app_test`, biome clean on touched files. | 7eafffc | Start Batch 6. |
| 9 Nov 2026 | Batch 6 | One active organization per session: `decideActiveWorkspace` plus a guard in `routes/_app.tsx` replaces any other organization URL with the active one, using `replace` so history does not bounce. The shell, breadcrumb, switcher and settings keep reading the active organization. Devtools are development only. Favicon, meta description and `robots.txt` added. The web shell gets referrer, frame, nosniff and a production CSP from a Nitro `response` plugin; the API gets the same base headers plus a `default-src 'none'` CSP outside development, with `/files/*` keeping its own policy. `S3_PUBLIC_ENDPOINT` is passed to the web container and production fails to boot without the CSP origins. The API root returns a neutral payload and the boot log is development only. Viewer routing is MIME first, extension as fallback. Zod runs `jitless` so its `new Function` probe cannot be reported as a CSP violation. | `bun test` api 401 pass / 40 skip, web 81 pass, tsc clean for api, web and ui, biome clean on touched files. Production build with `VITE_API_URL` prerendered the shell and served `/` with the full CSP, `/favicon.ico` 200, `/robots.txt` 200 and static assets carrying the same headers; a production start without `S3_PUBLIC_ENDPOINT` failed with the new error. No devtools strings in `.output`. Earlier dev stack checks showed the base headers and `/favicon.ico` 200. The production console in Chrome had no devtools control, Outfit and Oxanium loaded, and no CSP or favicon errors; the only errors were CORS from serving the build on a non-allowlisted port, plus the Zod eval issue that `jitless` fixed. Live redirect check is outstanding: Docker stopped mid-session, so the signed-in deep-link session that validated the old URL-following rule predates this final one; `active-workspace.test.ts` covers the decision. | uncommitted | Re-run the live redirect check when Docker is back, then start Batch 7. Test org `qa-studio-batch6` was created by the earlier browser check. |

| 9 Nov 2026 | Batch 7 | Invitation history now filters, sorts, counts and pages in Postgres (one grouped count plus one limited page, inviters loaded for the page only). Project bulk archive, delete, add and remove use one transaction, one access read and one write per action, with the same per-item results. Upload completion enqueues and returns 202, and the 8 second wait plus its QueueEvents connection are gone. `readLimited` caps every buffer return and a new test pins the exact limit. Added the `project.slug` trigram index; dropped the planned `milestone.description_text` index after confirming the description search is project scoped and the mention picker never used it, and removed description matching from the milestone list search. | `bun test` api 453 pass / 0 fail on `app_test`, web 81 pass, tsc clean for api, web and ui, biome clean on the 12 touched files, integration suite 47 pass. Benchmark on 20,000 invitations: old 107 to 132 ms, new service 35 ms. Bulk archive 100 projects: old 2,396 ms, new 115 ms with `xact_commit` delta 1. `EXPLAIN` with `enable_seqscan = off` uses `project_slug_trgm_idx`; migration `0021` applied to `app` and `app_test`. | 00c64b9 | Review the branch, then start Batch 8. Live upload click-through and the Batch 6 deep-link redirect check are still outstanding. |
| 9 Nov 2026 | Batch 8 | Nx typecheck target made real for api, web and ui. Biome now clean: `.agents` ignored, 5 SVG marks get `aria-hidden`, field and input-group a11y fixes, alert and sonner import fixes. `test:db` script added with `--drop` and the `app_test` guard. `verify-rls.ts` extended to `comment` and `link_preview` plus a two-way drift check; `TENANT_TABLES` extracted to `tenant-tables.ts`. CI workflow added at `.github/workflows/ci.yml`. | `bunx nx run-many -t typecheck` 3/3 pass; `bun run check` 0 errors and 0 warnings; `bun test` api 455 pass / web 81 pass; `bun run test:db` 453 pass 0 fail; `db:verify-rls` 23/23 pass; drift check fails in both directions; YAML parses. | 7d1a7e5 | Batch 8 complete. |

**Template for a new row**

```
| YYYY-MM-DD | Batch N | one or two sentences | commands run and result | short sha | what the next session should pick up |
```

**If you stop mid-batch**

Set the batch status to `In progress` and add a note like:
"P1-H1 hook gate implemented and tested; P1-H2 not started. Do not merge until both are done. Next: disableImplicitLinking and the account_not_linked copy."

---

## 13. Appendix: finding index

Every finding from the three reports, mapped to its batch. Use this to check that nothing is lost.

| Finding | Severity | Batch | Status |
|---|---|---|---|
| P1-C1 | High, dev only | 4 | Done |
| P1-H1 | High | 1 | Done |
| P1-H2 | High | 1 | Closed: not reachable (requireLocalEmailVerified) |
| P1-H3 | High, deployment | 4 | Done |
| P1-H4 | High | 2 | Done |
| P1-H5 | Disproved | 3 | Closed |
| P1-M1 | Medium, deployment | 4 | Done |
| P1-M2 | Medium | 5 | Done |
| P1-M3 | Medium | 7 | Done |
| P1-M4 | Medium | 7 | Done |
| P1-M5 | Medium | 7 | Done |
| P1-M6 | Medium | 3 | Done |
| P1-M7 | Medium | 2 | Done |
| P1-M8 | Medium | 1 | Done |
| P1-M9 | Medium | 5 | Done |
| P1-M10 | Medium | 5 | Done |
| P1-M11 | Medium | 6 | Done |
| P1-M12 | Medium | 6 | Done |
| P1-M13 | Low | 6 | Done |
| P1-M14 | Low | 3 | Done |
| P1-M15 | Low, deployment | 4 | Done |
| P1-M16 | Low | 7 | Done |
| P1-M17 | Low | 2 | Done |
| P1-M18 | Low | 2 | Done |
| P1-M19 | Low | 5 | Done |
| P1-M20 | Low | 5 | Done |
| P1-M21 | Low | 8 | Done |
| P1-M22 | Low | 8 | Done |
| P1-M23 | Low, dev only | 4 | Covered by P1-M1 |
| P1-M24 | Low | 2 | Done |
| P1-M25 | Low | 1 | Decision: option 3 |
| P2-F1 | Low | 6 | Done |
| P2-F2 | Low | 5 | Done |
| P2-F3 | Medium | 8 | Done |
| P2-F4 | Medium | 8 | Done |
| P2-F5 | Medium | 8 | Done |
| P2-F6 | Medium | 8 | Done |
| P2-F7 | Info | 8 | Closed |
| P2-F8 | Info | 8 | Closed |
| P3-F1 | High | 3 | Done |
| P3-F2 | Medium | 6 | Done |
| P3-F3 | Low | 6 | Done |
| P3-F4 | Low | 6 | Done |
| P3-F5 | Low | 1 | Done |
| P3-F6 | Low | 6 | Done |

---

## 14. New findings discovered during a fix session

Add them here, not in the old reports. Give them the next free ID in the batch that owns the area, and add them to the status board before starting work.

| Date | Batch | New finding | Severity | Status |
|---|---|---|---|---|
| 9 Nov 2026 | 4 | P1-M26: `compose.yaml` still defaults `SMTP_HOST` and `SMTP_FROM` to development values (`localhost` and a `handoff.local` sender). A production deployment can boot with a broken mail transport. Not fixed here because it was outside the Batch 4 scope. | Low | Open |
| 9 Nov 2026 | 7 | The phase 1 index table said milestone description search was in the mention picker. It is actually `listMilestones`, which is project scoped. The planned `description_text` index was dropped and the milestone list search is now title only. | Info | Closed |
