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
- Run `bun run format` and `bun run check` on the files you touched. The repo-wide `bun run check` has 17 pre-existing errors tracked in Batch 8; do not add new ones.
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
| 2 | File access and object lifecycle | High | Not started | none | 8 Nov 2026 | none |
| 3 | Redis and storage resilience | High | Not started | none | 8 Nov 2026 | none |
| 4 | Production and environment gate | High (deployment) | Not started | none | 8 Nov 2026 | none |
| 5 | Authorization and error handling | Medium | Not started | Batch 1 (same auth files) | 8 Nov 2026 | none |
| 6 | Web shell, headers and UX | Medium | Not started | Batch 4 (API origin) | 8 Nov 2026 | none |
| 7 | Performance | Medium | Not started | none | 8 Nov 2026 | none |
| 8 | Tooling, CI and test harness | Medium | Not started | none | 8 Nov 2026 | none |

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
**Status:** `Not started`
**Depends on:** none
**Files:** `apps/api/src/routes/files.ts`, `apps/api/src/lib/storage/*`, `services/comment.service.ts`, `services/milestone.service.ts`, `services/project.service.ts`

### P1-H4: `/files/*` is public and unrevocable

- [ ] Not started, decision required

**Where:** `apps/api/src/routes/files.ts`, `apps/api/src/lib/storage/config.ts` (`isPublicFileKey`).
**Problem:** Every key under `avatars/` and `organizations/` is served to anyone with the URL, with `Cache-Control: public, max-age=31536000, immutable`. There is no expiry and no revocation. Confirmed live: five comment attachments still returned 200 after the project and comments were deleted.

**Decision needed.** Pick one and write it here before coding:

- **Option A, minimal:** keep avatars, organization logos and project logos public, but require a session and organization membership for `organizations/<org>/comments/*` and `organizations/<org>/milestones/*`. Parse the org id from the key and check membership. Change the cache header for attachments to `private, no-store` or a short max-age.
- **Option B, strongest:** serve all files through a short-lived signed URL generated when the comment or milestone is read. Add an expiry and a signature to `objectUrl()`, verify it in the route. This changes the wire shape and caching.
- **Option C, private everything:** require a session for all `/files` reads and map the key to its owner. More work because the key does not contain the project id.

**Recommendation:** Option A now, Option B before hosting if attachments are sensitive. Option A closes the "anyone with the link" gap without a schema change.

**Done when:** An unauthenticated request for a comment or milestone attachment returns 401 or 404, a member of the organization can still read it, and a member of another organization cannot. Logos and avatars keep working for the UI.

### P1-M7: Deleted content leaves attachments in storage

- [ ] Not started

**Where:** `services/comment.service.ts` (delete path around line 900), `services/milestone.service.ts` (delete around line 1239), `services/project.service.ts` (delete around line 1314), `services/upload.service.ts`.
**Problem:** Deleting a comment, milestone or project removes the row but not the objects. Combined with P1-H4, the files stay readable.
**Fix:**
1. Before the delete, walk the rich text (`comment.body` or `milestone.description`) and collect `/files/...` keys.
2. Delete the rows, then delete the objects after the transaction commits.
3. For a project delete, collect keys from every milestone and comment first (one query), then delete the objects in a batch.
4. Add a reconciliation script or job that lists objects and removes keys not referenced anywhere. This also handles older orphans.
**Done when:** Deleting a comment with an attachment and then requesting its URL returns 404 (or 401 under Option A), and the object is gone from SeaweedFS.

### P1-M18: Milestone attachments are served inline

- [ ] Not started

**Where:** `apps/api/src/routes/files.ts`, `Content-Disposition`.
**Fix:** Force `attachment` for every `milestones/files/` and `comments/files/` key, and keep `inline` for images and logos. Keep `nosniff` and the sandbox CSP.
**Done when:** A `.pdf` or Office attachment downloads instead of opening inline, and an image still renders inline.

### P1-M24: Downloads have no filename

- [ ] Not started

**Where:** `apps/api/src/routes/files.ts`.
**Fix:** Accept a sanitised `name` query parameter (or store the original name in object metadata) and emit `Content-Disposition: attachment; filename="..."`. Strip quotes, newlines and path separators; cap the length.
**Done when:** Downloading `qa-brief.pdf` saves a file with that name, not a UUID.

### P1-M17: External images allow viewer tracking

- [ ] Not started, decision required

**Where:** `apps/api/src/lib/rich-text.ts`, `safeAssetUrl`.
**Problem:** The sanitizer allows any absolute `http` or `https` image URL. A comment can embed a third-party pixel that records every viewer.
**Options:** proxy and cache inline images through the object store on save, or restrict images to `/files/` uploads. Restricting is simpler but breaks pasted images.
**Recommendation:** Restrict to `/files/` for now and keep the existing link previews for external pages. Document the change in the editor.
**Done when:** An external image URL is dropped or proxied, and existing internal images still render.

### Batch 2 exit criteria

- [ ] Decision recorded for P1-H4.
- [ ] All items ticked or closed.
- [ ] Tests for the file route (authenticated, unauthenticated, cross-org) and for object cleanup.
- [ ] Manual upload, delete, re-request recorded in the log.

---

## 6. Batch 3: Redis and storage resilience

**Risk:** High. Confirmed 30 second hang on authenticated requests during a Redis outage.
**Status:** `Not started`
**Depends on:** none
**Files:** `apps/api/src/lib/redis.ts`, `apps/api/src/auth/secondary-storage.ts`, `apps/api/src/lib/storage/client.ts`, `apps/api/src/index.ts`

### P3-F1: Redis outage hangs authenticated requests

- [ ] Not started

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
docker stop ultra-dev-redis-1
# authenticated request: expect < 1s, 200 from DB or a clean 503
docker start ultra-dev-redis-1
# request: 200, single digit ms
```

### P1-M6: Storage reads and deletes have no deadline

- [ ] Not started

**Where:** `apps/api/src/lib/storage/client.ts`.
**Fix:** Wrap `headObject`, `readHeadBytes`, `openObject` and `deleteObject` in the existing `withStorageTimeout`, and add a BullMQ job timeout as a backstop.
**Done when:** A hung storage call releases the worker slot within the deadline.

### P1-M14: Redis password in `REDIS_URL` is ignored

- [ ] Not started

**Where:** `apps/api/src/lib/redis.ts`, `parseRedisUrl`.
**Fix:** Read `parsed.password` and `parsed.username` as fallbacks when `REDIS_PASSWORD` is empty, or construct the client from the URL and let ioredis parse it.
**Done when:** A URL of the form `redis://:secret@host:6379` authenticates.

### P1-H5: Shared Redis client has no error listener

- [ ] Closed, disproved in phase 3

The API did not crash during the outage. The remaining action is the throttled error listener in P3-F1. Keep this line for traceability.

### Batch 3 exit criteria

- [ ] All items ticked or closed.
- [ ] A repeatable outage test is written down (script or manual steps).
- [ ] Recovery verified in the log.

---

## 7. Batch 4: Production and environment gate

**Risk:** High for deployment, not a current incident. Do this before the planned hosting.
**Status:** `Not started`
**Depends on:** none
**Files:** `.env.example`, `compose.yaml`, `compose.dev.yaml`, `apps/api/src/lib/env.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/features/auth/client.ts`

### P1-H3: Production defaults ship dev credentials and localhost URLs

- [ ] Not started

**Where:** `compose.yaml` (`POSTGRES_PASSWORD`, `POSTGRES_APP_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `WEB_URL`, `S3_PUBLIC_ENDPOINT`), `.env.example`, `apps/web/src/lib/api.ts`, `apps/web/src/features/auth/client.ts`.
**Fix:**
1. Remove every production default for secrets and public URLs. Use `${VAR:?message}` in compose so a missing value fails `docker compose config` with a clear message.
2. Replace the example values with placeholders such as `change-me` and mark them required.
3. Keep development defaults only in `compose.dev.yaml`.
4. Make the web client use a relative API base in production when `VITE_API_URL` is empty, instead of `http://localhost:3001`. If a relative base is not supported by Eden Treaty, require the variable at build time and fail the build when it is missing.

**Done when:** `docker compose --env-file .env.example config` fails on the missing secrets, and a production build with a real API URL points at that URL.

### P1-M1: `NODE_ENV` defaults to development

- [ ] Not started

**Where:** `apps/api/src/lib/env.ts`.
**Fix:** Default to `production`, or fail the boot when `NODE_ENV` is unset. Keep `development` as an explicit opt-in. Add startup validation for `DATABASE_URL`, `DATABASE_APP_URL`, `BETTER_AUTH_SECRET`, `WEB_URL` and `S3_PUBLIC_ENDPOINT` when `NODE_ENV=production`.
**Done when:** A bare production start without the required variables fails with a clear message, and Bull Board and OpenAPI are absent.

### P1-M15: `S3_PUBLIC_ENDPOINT` defaults to an unreachable Docker name

- [ ] Not started

**Where:** `compose.yaml`, `apps/api/src/lib/env.ts`.
**Fix:** Leave it empty by default, fail the boot in production when it is unset, and document that it must be a browser-reachable reverse proxy that preserves the Host header.
**Done when:** Uploads work through a real public endpoint, and a missing value fails loudly.

### P1-M23: OpenAPI is mounted whenever `NODE_ENV` is not production

- [ ] Covered by P1-M1

It lives in the same `if (isDevelopment)` block as Bull Board. Changing the default to production closes it. No separate change.

### P1-C1: Unauthenticated Bull Board on the dev stack

- [ ] Not started, dev-only

**Where:** `apps/api/src/index.ts`, `compose.dev.yaml`.
**Fix:** Bind the dev API port to loopback (`127.0.0.1:3001:3001`), or protect `/bull-board` with the `auth` macro plus an owner check. Production is already correct.
**Done when:** From another machine on the network, `/bull-board` is not reachable; from the host, it still is.

### Batch 4 exit criteria

- [ ] `docker compose config` fails on missing required values.
- [ ] A production boot with a minimal valid env starts and does not expose `/bull-board` or `/openapi`.
- [ ] The web bundle points at the configured API origin.
- [ ] The checklist is added to the deployment notes.

---

## 8. Batch 5: Authorization and error handling

**Risk:** Medium. Mostly hardening and consistency.
**Status:** `Not started`
**Depends on:** Batch 1 for the same auth file (avoid conflicts)
**Files:** `apps/api/src/lib/auth-error.ts`, `services/milestone.service.ts`, `realtime/gateway.ts`, `services/comment.service.ts`, `auth/permissions.ts`, `auth/project-permissions.ts`

### P1-M2: Unknown errors become 409 and raw messages reach clients

- [ ] Not started

**Where:** `apps/api/src/lib/auth-error.ts`.
**Fix:** Return 500 for unknown errors, not 409. Only return `APIError.body.message` for known API errors; for unknown errors, log with context and return the caller's generic fallback. Keep the known code map.
**Done when:** A forced driver error returns a generic 500 and the raw message appears only in the server log.

### P1-M9: Presence join accepts any milestone id

- [ ] Not started

**Where:** `apps/api/src/realtime/gateway.ts`, `presence.join`.
**Fix:** Validate the milestone against the connection's project before subscribing, or reject presence frames until the feature is implemented. Use the same access helper as the HTTP routes.
**Done when:** A milestone id from another project is rejected or ignored, and a valid one still subscribes.

### P1-M10: Revoked members keep receiving events

- [ ] Not started, decision required

**Where:** `apps/api/src/realtime/gateway.ts`, `maxConnectionMs` in `lib/env.ts`.
**Options:** Publish a revocation event on member removal and close matching sockets, or shorten the hard connection lifetime (for example 5 minutes) and document the trade-off.
**Recommendation:** Add the revocation event if realtime carries client data; otherwise shorten the TTL.
**Done when:** The chosen behaviour is implemented and written in this file.

### P1-M19: Any project member can toggle checklists in another person's comment

- [ ] Not started, decision required

**Where:** `services/comment.service.ts`, `toggleMilestoneChecklistItem`; `auth/comment-permissions.ts`.
**Options:**
1. Shared checklist: record who toggled and when, and update the comment copy.
2. Author-only: use `assertCanModifyComment` and update the UI copy.
**Recommendation:** Pick one. Shared is fine for a client collaboration product, but it must be explicit and attributable.
**Done when:** The rule is consistent between the code, the copy and the tests.

### P1-M20: Empty milestone PATCH still writes

- [ ] Not started

**Where:** `services/milestone.service.ts`, `updateMilestone`.
**Fix:** If no recognised field is present, return the current detail without an update. Also avoid pushing `"description"` to `changed` when the sanitized body did not change.
**Done when:** `PATCH {}` leaves `updatedAt` and `updatedBy` unchanged.

### P2-F2: Target-only permission predicates

- [ ] Not started

**Where:** `auth/permissions.ts`, `canManageTarget`; `auth/project-permissions.ts`, `canManageProjectTarget`.
**Fix:** Fold the actor check into the predicate, or rename to `isManageableTarget` and document the precondition. Folding is safer; every current caller is already a manager, so the result does not change.
**Done when:** `canManageTarget("member", "member")` is false, and the member and project role tests still pass.

### Batch 5 exit criteria

- [ ] All items ticked, closed or marked as a documented decision.
- [ ] New tests for the error mapping and the predicates.
- [ ] Integration suite green.

---

## 9. Batch 6: Web shell, headers and UX

**Risk:** Medium. Navigation confusion, missing headers, production devtools.
**Status:** `Not started`
**Depends on:** Batch 4 for the API origin
**Files:** `apps/web/src/routes/_app.tsx`, `apps/web/src/routes/__root.tsx`, `components/app-sidebar/*`, `app-sidebar`, `vite.config.ts`, `apps/web/src/features/files/viewer-kind.ts`

### P3-F2: App shell ignores the organization in the URL

- [ ] Not started

**Where:** `apps/web/src/routes/_app.tsx`, sidebar and breadcrumb components.
**Problem:** Opening org A's URL while org B is active renders org A data but the shell shows org B links. Confirmed live.
**Fix:** Derive the shell organization from the `$orgSlug` route param. If it differs from the active organization, either switch the active organization on route entry or render the URL organization and show a clear "active workspace" hint.
**Done when:** Deep-linking to either organization shows that organization's sidebar, breadcrumb and links.

### P3-F6 and P1-M11: TanStack Devtools in production

- [ ] Not started

**Where:** `apps/web/src/routes/__root.tsx`.
**Fix:** Render the devtools block only when `import.meta.env.DEV`, or use the library's production toggle. Remove the devtools state from localStorage on production.
**Done when:** The "Open TanStack Devtools" control is absent from a production build.

### P3-F3: Missing favicon

- [ ] Not started

**Where:** `apps/web`, root head.
**Fix:** Add a favicon and a `<link rel="icon">`. This removes the only console 404 and the Lighthouse best-practices deduction.
**Done when:** `/favicon.ico` returns 200 and the console is clean.

### P3-F4: Missing SEO metadata

- [ ] Not started, low priority

**Where:** root route head, `public/`.
**Fix:** Add a meta description to the marketing page, a deliberate `robots.txt`, and either a real `llms.txt` or an explicit decision not to have one.
**Done when:** Lighthouse SEO is deliberate, not accidental.

### P1-M12: No CSP or security headers

- [ ] Not started

**Where:** Nitro server config, Elysia middleware.
**Fix:** Add `Content-Security-Policy`, `Referrer-Policy: same-origin` (or `no-referrer`), and `X-Frame-Options: DENY` or `frame-ancestors 'none'`. Keep the existing `/files` CSP.
**Done when:** The headers are present on the app shell and the API, and the app still loads its fonts and styles.

### P1-M13: Unguarded `console.log` and leftover root string

- [ ] Not started

**Where:** `apps/api/src/index.ts`.
**Fix:** Remove `"Hello Huzaifa"` from `/` (return a neutral payload or a 404) and replace the boot `console.log` with the project logger when one exists.
**Done when:** No user-facing leftover strings and no unguarded console logging.

### P2-F1: Viewer routing contradicts its comment

- [ ] Not started

**Where:** `apps/web/src/features/files/viewer-kind.ts`.
**Fix:** Either check a specific MIME before the extension, or correct the comment and the test name to say the extension wins for pdf, text and csv. Pick one.
**Done when:** The code and the comment agree, and `viewer-kind.test.ts` matches.

### Batch 6 exit criteria

- [ ] All items ticked.
- [ ] Deep link to both organizations shows the correct shell.
- [ ] Production build has no devtools and clean console.
- [ ] Header check recorded in the log.

---

## 10. Batch 7: Performance

**Risk:** Medium. No user-visible failure yet, but the patterns do not scale.
**Status:** `Not started`
**Depends on:** none
**Files:** `services/invitation.service.ts`, `services/project.service.ts`, `services/member.service.ts`, `routes/uploads.ts`, `lib/link-preview/http.ts`, `db/schema.ts`

### P1-M3: Invitation history loads and sorts the whole set

- [ ] Not started

**Where:** `services/invitation.service.ts`, `listInvitationHistory`.
**Fix:** Move filter, sort, count and pagination into Postgres. The `invitation` table is a Better Auth table, so use a read-only `adminDb` query with `limit`/`offset` and a `case` for the derived expired status. Do not join it into a tenant query.
**Done when:** A workspace with 1,000 invitations returns page 1 in bounded time and the counts are correct.

### P1-M4: Bulk actions open one transaction per item

- [ ] Not started

**Where:** `services/project.service.ts` (bulk methods), `services/member.service.ts`, `services/invitation.service.ts`.
**Fix:** Load the access decisions in one query, run the loop inside one `withTenant` transaction, and batch the writes where the rule allows it. Keep the per-item result contract. If a single item must not abort the batch, use a savepoint per item.
**Done when:** A 100-item bulk action uses a small, constant number of transactions and still reports per-item outcomes.

### P1-M5: Upload completion blocks for up to 8 seconds

- [ ] Not started

**Where:** `routes/uploads.ts`, `queues/upload-verification.ts`.
**Fix:** Return 202 immediately after enqueueing, and let the client poll `/uploads/:id`. The polling endpoint already exists.
**Done when:** `POST /uploads/:id/complete` returns in well under a second and the UI still resolves the upload.

### P1-M16: Decompressed body cap can be exceeded by one chunk

- [ ] Not started

**Where:** `lib/link-preview/http.ts`, `readLimited`.
**Fix:** Slice the buffer to `maxBytes` before returning in both the `stopAt` and truncation branches.
**Done when:** A test with a body larger than the cap returns exactly the cap.

### Missing indexes

- [ ] Not started

**Where:** `db/schema.ts`, `apps/api/drizzle` via `db:generate`.
**Fix:** Add a trigram index on `milestone.descriptionText` (milestone search uses `ILIKE` on it) and consider one on `project.slug` (project search uses `ILIKE` on it). Do not edit `drizzle/` by hand; change the schema and run `bun run db:generate`.
**Done when:** The migration is generated, applied to `app_test`, and the query plan uses the index.

### Batch 7 exit criteria

- [ ] All items ticked or explicitly deferred with a reason.
- [ ] The integration suite is green on `app_test`.
- [ ] A before/after timing note is in the log.

---

## 11. Batch 8: Tooling, CI and test harness

**Risk:** Medium. The suite is green but nothing enforces it.
**Status:** `Not started`
**Depends on:** none
**Files:** `nx.json`, `package.json`, `biome.json`, `apps/api/scripts/verify-rls.ts`, `.github/workflows/`

### P2-F3: Nx typecheck target is broken

- [ ] Not started

**Where:** `nx.json`, `apps/api/tsconfig.json`, `packages/ui/tsconfig.json`.
**Problem:** `tsc --build tsconfig.json --emitDeclarationOnly` fails with TS5069, and the UI target is disabled by `noEmit`.
**Fix:** Either add `declaration` and `composite` and make the build real, or override the inferred target with `tsc --noEmit -p tsconfig.json` for api, web and ui. Direct `tsc --noEmit` is already clean.
**Done when:** `bunx nx run-many -t typecheck` exits 0 for all three projects.

### P2-F4: Biome check is red and lints vendored files

- [ ] Not started

**Where:** `biome.json`, `packages/ui/src/components/ui/*`.
**Fix:** Add `.agents` to the Biome ignore list. Fix the 13 source errors: the five SVG components need a title or `aria-hidden`, `input-group.tsx` and `field.tsx` need semantic and keyboard fixes, and `alert.tsx` and `sonner.tsx` need import order and type-only imports.
**Done when:** `bun run check` exits 0, or the only remaining diagnostics are explicitly documented.

### P2-F5: No CI

- [ ] Not started

**Where:** `.github/workflows/`.
**Fix:** Add one workflow with install, `bun run check`, direct typecheck, `bun test` in api and web, and the RLS script against a Postgres service. Cache Bun and Nx.
**Done when:** A pull request runs the workflow and blocks on failure.

### P2-F6: Integration suite needs manual setup

- [ ] Not started

**Where:** root `package.json`, `apps/api/package.json`, `apps/api/scripts`.
**Fix:** Add a `test:db` script that creates `app_test` if missing, runs `db:setup`, runs the suite, and optionally drops the database. Keep the `TEST_DATABASE=1` and `app_test` name guard.
**Done when:** One command runs the database suite from a clean machine.

### P1-M21 and P1-M22: Test execution and RLS coverage

- [ ] Not started

**Where:** `apps/api/scripts/verify-rls.ts`.
**Fix:** Extend the script to `comment` and `link_preview`, and add a check that `TENANT_TABLES` in `bootstrap-db.ts` matches the business tables that have an RLS policy.
**Done when:** Removing a table from `TENANT_TABLES` or forgetting a policy makes the script fail.

### P2-F7 and P2-F8: Informational

- [x] Closed, no action

September renders as "Sept" with `en-GB`; the date test is timezone local by design. Neither is a defect.

### Batch 8 exit criteria

- [ ] Typecheck, lint, unit tests and the RLS script all run in CI.
- [ ] The database suite is one command.
- [ ] The status board is updated.

---

## 12. Session log

Append one row per session. Do not rewrite old rows.

| Date | Batch | What changed | Verify | Commit | Next session |
|---|---|---|---|---|---|
| 8 Nov 2026 | none | Baseline reports only | Phase 1, 2 and 3 complete | none | Start Batch 1 |
| 8 Nov 2026 | Batch 1 | Magic-link gate, callback fix, implicit linking off, invitation link caps, sign-up trade-off documented | `bun test` api 332 pass / web 67 pass, tsc clean for api, web and ui, biome clean on 13 files, live curl checks passed | uncommitted | Start Batch 3 (Redis hang), then Batch 2. Manual OAuth `account_not_linked` check still outstanding (no test provider account). |
| 8 Nov 2026 | Batch 1 correction | Reverted `disableImplicitLinking` after confirming Better Auth defaults `requireLocalEmailVerified` to true and blocks linking into unverified rows. Kept implicit linking, pinned the real guard, updated copy. | `bun test` api 332 pass / web 67 pass, tsc clean | uncommitted | P1-H2 closed as not reachable. Start Batch 3, then Batch 2. |
| 8 Nov 2026 | Batch 1 follow-up | Added an hourly BullMQ sweep that deletes unverified accounts older than 7 days, skipping workspace members. | `bun test` api 338 pass, tsc clean, live job removed an 8 day fake row and kept a 6 day one | uncommitted | Start Batch 3, then Batch 2. |

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
| P1-C1 | High, dev only | 4 | Not started |
| P1-H1 | High | 1 | Done |
| P1-H2 | High | 1 | Closed: not reachable (requireLocalEmailVerified) |
| P1-H3 | High, deployment | 4 | Not started |
| P1-H4 | High | 2 | Not started |
| P1-H5 | Disproved | 3 | Closed |
| P1-M1 | Medium, deployment | 4 | Not started |
| P1-M2 | Medium | 5 | Not started |
| P1-M3 | Medium | 7 | Not started |
| P1-M4 | Medium | 7 | Not started |
| P1-M5 | Medium | 7 | Not started |
| P1-M6 | Medium | 3 | Not started |
| P1-M7 | Medium | 2 | Not started |
| P1-M8 | Medium | 1 | Done |
| P1-M9 | Medium | 5 | Not started |
| P1-M10 | Medium | 5 | Not started |
| P1-M11 | Medium | 6 | Not started |
| P1-M12 | Medium | 6 | Not started |
| P1-M13 | Low | 6 | Not started |
| P1-M14 | Low | 3 | Not started |
| P1-M15 | Low, deployment | 4 | Not started |
| P1-M16 | Low | 7 | Not started |
| P1-M17 | Low | 2 | Not started |
| P1-M18 | Low | 2 | Not started |
| P1-M19 | Low | 5 | Not started |
| P1-M20 | Low | 5 | Not started |
| P1-M21 | Low | 8 | Not started |
| P1-M22 | Low | 8 | Not started |
| P1-M23 | Low, dev only | 4 | Covered |
| P1-M24 | Low | 2 | Not started |
| P1-M25 | Low | 1 | Decision: option 3 |
| P2-F1 | Low | 6 | Not started |
| P2-F2 | Low | 5 | Not started |
| P2-F3 | Medium | 8 | Not started |
| P2-F4 | Medium | 8 | Not started |
| P2-F5 | Medium | 8 | Not started |
| P2-F6 | Medium | 8 | Not started |
| P2-F7 | Info | 8 | Closed |
| P2-F8 | Info | 8 | Closed |
| P3-F1 | High | 3 | Not started |
| P3-F2 | Medium | 6 | Not started |
| P3-F3 | Low | 6 | Not started |
| P3-F4 | Low | 6 | Not started |
| P3-F5 | Low | 1 | Done |
| P3-F6 | Low | 6 | Not started |

---

## 14. New findings discovered during a fix session

Add them here, not in the old reports. Give them the next free ID in the batch that owns the area, and add them to the status board before starting work.

| Date | Batch | New finding | Severity | Status |
|---|---|---|---|---|
| none yet | | | | |
