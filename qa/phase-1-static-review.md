# Phase 1: Static Review

**Project:** Handoff (ultra-handoff monorepo)
**Branch:** `the-fixess`
**Date:** 8 Nov 2026
**Mode:** Read only. No application code was changed. This document is the only file created.
**Scope:** `apps/api` (19,459 LOC), `apps/web` (38,914 LOC), `packages/ui`, Docker and environment configuration, migrations, dependency tree.
**Deployment context:** the app is not hosted yet. Production findings are pre-deployment risks, not current incidents.
**Fix tracking:** `qa/FIX-PLAN.md` (batch status, session log).

---

## 1. Method

Static analysis only, in this order:

1. Tenant and RLS layer (`db/tenant.ts`, `db/rls.ts`, `middleware/tenant.ts`, `scripts/bootstrap-db.ts`).
2. Authorization matrix across all 54 HTTP handlers and the WebSocket gateway.
3. Auth surface (`auth/auth.ts`, `auth/plugin.ts`, `auth/verified.ts`, secondary storage).
4. Uploads and storage (`routes/uploads.ts`, `routes/files.ts`, `lib/storage/*`).
5. Link preview SSRF (`lib/link-preview/*`).
6. Rich text and file viewers (`lib/rich-text.ts`, `apps/web/src/features/files`).
7. Realtime (`realtime/*`).
8. Query and index review (`project.service.ts`, `milestone.service.ts`, `comment.service.ts`, `invitation.service.ts`).
9. Rules and configuration sweep, plus `bun audit`.
10. A few harmless live probes to confirm dev-only surfaces are actually mounted (Bull Board, OpenAPI, magic-link route validation).

Baseline measured during the review:

| Item | Value |
|---|---|
| Running stack | 8 dev containers healthy (web 3000, api 3001, postgres 5432, redis 6379, mailpit 8025, seaweedfs 8333) |
| HTTP handlers | 54 across 46 documented paths, plus 1 WebSocket route |
| Automated tests | 16 test files, all unit level |
| Integration or E2E tests | 0 |
| CI | none (`.github/workflows` is empty) |
| Dependency advisories | 29 (13 high, 13 moderate, 3 low), all in dev or build tooling except one low in the email stack |

Severity rubric: **Critical** means remote compromise of a reachable surface with no other precondition (no account, no user interaction). **High** means compromise or data exposure with a realistic precondition, or a production default that breaks security. **Medium** means a real defect with limited impact or a meaningful hardening gap. **Low** means hygiene, UX, or defence in depth.

---

## 2. Summary

| ID | Severity | Area | Title |
|---|---|---|---|
| P1-C1 | High (dev only) | Dev surfaces | Unauthenticated Bull Board exposes queued sign-in and reset emails on the dev stack |
| P1-H1 | High | Auth | Magic link plugin allows unauthenticated sign-up for any email |
| P1-H2 | High | Auth | Implicit account linking enables pre-registration account hijacking |
| P1-H3 | High | Config | Production defaults ship dev credentials and a client that calls localhost |
| P1-H4 | High | Files | `/files/*` is public, unrevocable, and deletion does not delete objects |
| P1-H5 | High | Reliability | Shared Redis client has no `error` listener and can crash the API |
| P1-M1 | Medium | Config | `NODE_ENV` defaults to development, so a misconfigured deploy is fail-open |
| P1-M2 | Medium | Errors | Unknown errors become 409 and raw driver messages reach clients |
| P1-M3 | Medium | Performance | Invitation history loads and sorts the whole set in memory per request |
| P1-M4 | Medium | Performance | Bulk actions open one transaction per item, up to 100 per request |
| P1-M5 | Medium | Performance | Upload completion blocks the HTTP request for up to 8 seconds |
| P1-M6 | Medium | Reliability | Storage reads and deletes have no deadline |
| P1-M7 | Medium | Privacy | Deleted comments and milestones leave attachments in storage forever |
| P1-M8 | Medium | Auth | Public invitation link can trigger repeated email to the invitee |
| P1-M9 | Medium | Realtime | Presence join accepts a milestone id without validating project scope |
| P1-M10 | Medium | Realtime | Revoked members keep receiving events for up to 30 minutes |
| P1-M11 | Medium | Web | TanStack Devtools ships and mounts in production |
| P1-M12 | Medium | Web | No CSP or security headers on the app shell |
| P1-M13 | Low | Rules | Unguarded `console.log`, leftover root string |
| P1-M14 | Low | Config | Redis password in `REDIS_URL` is silently ignored |
| P1-M15 | Low | Config | `S3_PUBLIC_ENDPOINT` compose default is browser unreachable |
| P1-M16 | Low | Link preview | Decompressed body cap can be exceeded by one chunk |
| P1-M17 | Low | Privacy | External images in rich text allow viewer tracking |
| P1-M18 | Low | Files | Milestone attachments are served inline by default |
| P1-M19 | Low | Consistency | Any project member can toggle checklists inside another person's comment |
| P1-M20 | Low | Data | Empty milestone PATCH still bumps `updatedBy` and `updatedAt` |
| P1-M21 | Low | Quality | No CI and no web test script |
| P1-M22 | Low | Tests | RLS verification misses `comment` and `link_preview` |
| P1-M23 | Low | Dev surfaces | OpenAPI is mounted whenever `NODE_ENV` is not production |
| P1-M24 | Low | UX | Downloads have no filename |
| P1-M25 | Low | Auth | Sign-up reveals whether an email is registered |

No cross-tenant read or write was found in the code paths reviewed. Every service scopes by `organizationId`, and project-scoped services additionally resolve project access before touching a row. The issues below are the real gaps around that otherwise strong boundary.

---

## 3. Dev-only exposure

### P1-C1 (High, dev only): Unauthenticated Bull Board exposes queued sign-in and reset emails

> Correction: this was first rated Critical. The production mount condition was then confirmed: the route is inside `if (isDevelopment)` and is absent when `NODE_ENV=production`. It is kept as P1-C1 for traceability, but the correct severity is High on the dev stack and informational for production.

**Where:** `apps/api/src/index.ts:71-90`, `apps/api/src/lib/env.ts:32-35`

**What:** In development the API mounts Bull Board at `/bull-board` with no authentication and no role check. It lists every queue and the full payload of every job, including `email` jobs. Email job payloads contain the verification URL, reset URL, magic-link URL and invitation URL, because `EmailJobData` stores the link itself (`apps/api/src/lib/mailer.tsx:40-70`).

**Evidence:** Live probe against the running stack returned HTTP 200 with no session:

```
GET http://localhost:3001/bull-board   -> 200
GET http://localhost:3001/bull-board/  -> 200
```

**Production status (confirmed):** This route is not mounted in production. The registration sits inside `if (isDevelopment)` (`index.ts:71`), and running `apps/api/src/lib/env.ts` with `NODE_ENV=production` reports `isDevelopment: false`. The production compose file sets `NODE_ENV: production` for the API (`compose.yaml:113`) and the API Dockerfile sets `ENV NODE_ENV=production` (`apps/api/Dockerfile:66`), so the production image never registers the route. The exposure is limited to the dev stack.

The dev compose file publishes the API on `0.0.0.0:3001` (`compose.dev.yaml`, api ports), so this is reachable from the local network, not only from the host.

**Impact (dev only):** Anyone on the local network who can reach the dev port can read completed email jobs for up to 1 hour (`removeOnComplete.age`, `queues/email.ts:33`) and failed jobs for 7 days. A reset link is valid for 1 hour, a magic link for 10 minutes, an invitation for 7 days. That is enough to take over an account whose reset or magic link is still in the queue, and to accept invitations as the invitee. This is a development-machine exposure, not a production one.

**Residual risk:** A bare deployment started without `NODE_ENV` defaults to development (P1-M1) and would mount the same dashboard. The production compose and Dockerfile already set `NODE_ENV=production`, so this only becomes real if the app is started another way.

**Severity:** High on the dev stack whenever the port is reachable by someone other than the developer (it is published on `0.0.0.0` today). Informational for the current production path, which does not mount it.

**Recommendation:** Bind the dev API port to loopback, or protect Bull Board with the `auth` macro plus an owner check. Keep the production exclusion, and change the `NODE_ENV` default to production so a bare start cannot mount it.

**Confidence:** Confirmed live.

---

## 4. High

### P1-H1: Magic link plugin allows unauthenticated sign-up for any email

**Where:** `apps/api/src/auth/auth.ts:341-349`

**What:** The `magicLink` plugin is configured without `disableSignUp`. Better Auth documents that a magic-link request signs the user up unless `disableSignUp` is `true`. The plugin therefore exposes `POST /api/auth/sign-in/magic-link` as a public endpoint that:

1. Creates a `user` row for any address supplied by the caller.
2. Sends a sign-in link to that address.
3. Is limited only by Better Auth's default rate limiter, which is enabled in production only.

**Evidence:** Live probe confirms the route is mounted and validating:

```
POST /api/auth/sign-in/magic-link  {}  -> 400
```

The app already has a controlled path for invited users: `sendInvitationMagicLink` takes the address from the invitation row, not from the request, and enforces a 60 second cooldown per invitation (`services/invitation.service.ts:741-793`). The generic plugin route bypasses all of that.

**Impact:** Anyone can create account rows for arbitrary addresses and send unsolicited mail from the product's domain. It also feeds P1-H2, because a pre-created account is exactly what the implicit-link hijack needs.

**Recommendation:** Set `disableSignUp: true` on the magic link plugin and keep using the invitation-scoped route. If self-serve magic link is wanted later, add an explicit per-IP and per-email throttle and an allowlist of existing accounts.

**Confidence:** High, based on documented Better Auth behaviour and the live route probe.

### P1-H2: Implicit account linking enables pre-registration account hijacking

**Where:** `apps/api/src/auth/auth.ts:178-183`

**What:** `accountLinking.enabled` is true and `github` and `google` are trusted providers. `disableImplicitLinking` is not set, so a same-email OAuth sign-in is silently attached to an existing local user.

**Attack:** An attacker signs up with `victim@example.com` and a password they choose. The account is unverified, so it cannot be used yet, but the credential is stored. The victim later signs in with Google. Better Auth links Google to the pre-existing user. Better Auth's own docs state that linking never changes the local `emailVerified`, so the victim still verifies the address (which they own) and gains access. The attacker's password row is still valid, and the attacker can now sign in as the victim.

**Why this is realistic here:** sign-up with email and password is enabled, verification does not delete the unverified row, and linking is implicit. The sign-up route even deliberately confirms that an address is taken (`auth/auth.ts:276-291`), which does not prevent the attack.

**Impact:** Persistent account takeover after a low-effort, unauthenticated first step.

**Recommendation:** Either set `disableImplicitLinking: true` and require an explicit link from an authenticated session, or add `deleteUnverifiedUserAfter` cleanup and refuse to link a credential account that was never verified. Verify the exact behaviour with a Google account in phase 3 before choosing.

**Confidence:** High on the configuration gap. The end-to-end result should be proven in phase 3.

### P1-H3: Production defaults ship dev credentials and a client that calls localhost

**Where:** `compose.yaml:23,116,123,139,140-141,169,175`, `.env.example:10,17,38,42,82,86,87`, `apps/web/src/lib/api.ts:10-12`, `apps/web/src/features/auth/client.ts:15-16`

**What:** The production compose file and the example environment file default to development values:

| Setting | Default | Consequence |
|---|---|---|
| `POSTGRES_PASSWORD` | `app` | Database reachable with a known password |
| `POSTGRES_APP_PASSWORD` | `tenant` | RLS role reachable with a known password |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | `admin` / `admin` | Object storage admin with known credentials |
| `WEB_URL` | `http://localhost:3000` | CORS, trusted origins, email links and `S3_ALLOWED_ORIGINS` all point at localhost |
| `VITE_API_URL` | empty | Client falls back to `http://localhost:3001`, not a relative URL |
| `S3_PUBLIC_ENDPOINT` | `http://seaweedfs:8333` | Browser cannot resolve the Docker service name, so presigned uploads fail |

The `.env.example` comment says an empty `VITE_API_URL` means same-origin relative requests, but the code does not do that. It substitutes `http://localhost:3001` (`api.ts:11`, `client.ts:16`). A production deploy that follows the example will ship a bundle that calls the end user's own machine.

**Current status:** the app is not hosted yet, so this is a pre-deployment checklist rather than a live vulnerability. The production compose file and both Dockerfiles set `NODE_ENV=production`, so the dev-only surfaces are correctly excluded. The default credentials and localhost URLs are still one missing `.env` away from shipping, so treat this as a release gate, not a current incident.

**Impact:** A deployment that follows the documentation is either insecure (default passwords) or unusable (localhost URLs, broken uploads, CORS failures). This is the kind of thing that gets "fixed" under pressure with a quick manual change and never documented.

**Recommendation:** Remove every production default for secrets and public URLs. Make the API refuse to boot in production when `WEB_URL`, `VITE_API_URL`, `S3_PUBLIC_ENDPOINT` or the database passwords are missing. Generate the production values in `.env.example` as placeholders such as `change-me` and mark them required.

**Confidence:** Confirmed from configuration and code.

### P1-H4: `/files/*` is public, unrevocable, and deletion does not delete objects

**Where:** `apps/api/src/routes/files.ts:20-86`, `apps/api/src/lib/storage/config.ts:227-232`, `apps/api/src/services/comment.service.ts:900-920`, `apps/api/src/services/milestone.service.ts:1239-1265`, `apps/api/src/services/upload.service.ts:198-264`

**What:** `/files/*` has no session check. Any key under `avatars/` or `organizations/` is served to anyone who requests it, with `Cache-Control: public, max-age=31536000, immutable`. There is no revocation, no per-project check and no signed expiry. Keys contain a UUID, so they are unguessable, but they are capability URLs.

Attachments are also never deleted:

- `deleteMilestoneComment` blanks `body` and sets `deletedAt`, but leaves the image and file nodes (and their objects) in place.
- `deleteMilestone` deletes the row and cascades comments, but does not delete milestone images or attachments.
- `deleteProject` deletes the project and cascades rows, but does not delete milestone or comment objects.
- `deleteObject` is only called for rejected uploads and replaced avatars, organization logos and project logos.

**Impact:** "Deleted" attachments remain readable at their old URL forever. Because the response is immutable, a leaked URL also stays cached in browsers and proxies. This is a privacy and erasure problem, and it grows storage indefinitely. It matters for client-facing work where a deleted comment may have carried a confidential brief.

**Recommendation:** Decide explicitly whether `/files` should be public. If it stays public, treat attachment URLs as secrets and delete objects when the owning row is deleted. Add a cleanup job that reconciles storage keys against referenced URLs. If attachments must be private, replace the public route with an authenticated, tenant-scoped read.

**Confidence:** Confirmed from code.

### P1-H5: Shared Redis client has no `error` listener and can crash the API

**Where:** `apps/api/src/lib/redis.ts:35-43` (contrast `apps/api/src/realtime/bus.ts:111-113`)

**What:** `getRedis()` creates an `ioredis` client and never attaches an `error` listener. ioredis emits `error` on connection failures. In Node and Bun, an EventEmitter that emits `error` with no listener throws, which becomes an uncaught exception and terminates the process. The realtime bus module explicitly attaches a listener for exactly this reason and documents it.

**Impact:** A Redis restart, failover, or momentary network blip can crash the API process. Sessions, rate limits and upload sessions all use this client, so the crash is likely under the conditions where you least want one. Docker `restart: unless-stopped` would restart the container, but every restart drops in-flight requests and WebSockets.

**Recommendation:** Attach `client.on("error", ...)` in `getRedis()`, log at most at a throttled rate, and keep the process alive. Add a Redis outage test in phase 2 (stop the container, hit `/health` and a tenant route, confirm no crash).

**Confidence:** High from code and known ioredis behaviour. Confirm in phase 2 by stopping Redis.

---

## 5. Medium

### P1-M1: `NODE_ENV` defaults to development, so a misconfigured deploy is fail-open

**Where:** `apps/api/src/lib/env.ts:32-35`

`nodeEnv` falls back to `"development"`. Consequences of starting without `NODE_ENV`:

- Bull Board and OpenAPI mount (P1-C1, P1-M23), both public.
- `isProduction` is false, so all "dev only" log guards turn on.
- Better Auth rate limiting is documented as production only, so authentication throttles are off.
- Localhost origins are added to `trustedOrigins`.

**Current status:** this only matters once the app is deployed outside compose. The production compose file and the Dockerfiles set `NODE_ENV=production`, so the current deployment path is correct. The fallback matters for a bare binary, a different orchestrator, or someone starting the compiled binary by hand.

**Recommendation:** Default to production, or fail the boot when `NODE_ENV` is unset. Development surfaces should require an explicit opt-in.

### P1-M2: Unknown errors become 409 and raw driver messages reach clients

**Where:** `apps/api/src/lib/auth-error.ts:68-92`

`authErrorMessage` returns `error.message` for any `Error`, not only `APIError`. `authErrorStatus` returns `409` for anything it does not recognise. A Postgres constraint violation or a driver failure therefore becomes a 409 with the raw message, which can include table and column names, constraint names and values. Genuine server faults are also hidden from monitoring because they look like client conflicts.

**Recommendation:** Log unknown errors server side with a correlation id, return a generic 500 to the client, and keep 409 only for actual conflicts.

### P1-M3: Invitation history loads and sorts the whole set in memory per request

**Where:** `apps/api/src/services/invitation.service.ts:215-318`

Every request calls `listInvitations` for the organization, maps the full set, filters, sorts and paginates in JavaScript. There is no `limit` or `offset` passed to Better Auth. If the library caps the result, counts and pagination silently truncate. At scale this is O(n log n) per keystroke in the search box.

**Recommendation:** Push filter, sort and pagination into the query (or a dedicated projection table), and pass explicit `limit` and `offset`. Confirm the library's default cap in phase 2.

### P1-M4: Bulk actions open one transaction per item

**Where:** `services/project.service.ts:1456-1537, 1574-1627, 1876-1911`; `services/member.service.ts:310-372, 382-471`; `services/invitation.service.ts:334-500, 508-592`

Each bulk action loops the single-item service, and each single-item service opens its own `withTenant` transaction and repeats the access query. The route caps selection at 100, so one request can produce 100 sequential transactions and several hundred queries. Some paths also make a Better Auth call per item.

**Recommendation:** Keep the per-item outcome contract, but batch the work: one access check per request, one transaction around the batch, and a single `update ... where id in (...)` where the rule allows it. At minimum, measure p95 with 100 items in phase 3.

### P1-M5: Upload completion blocks the HTTP request for up to 8 seconds

**Where:** `apps/api/src/routes/uploads.ts:122-136`, `apps/api/src/queues/upload-verification.ts:174-186`

`POST /uploads/:id/complete` enqueues the verification job and then waits on `QueueEvents` for up to 8 seconds. Under concurrent uploads this ties up HTTP connections and the API event loop (the wait itself is async, but each request stays open).

**Recommendation:** Return 202 immediately and let the client poll, or keep a much shorter wait (1 to 2 seconds). The polling endpoint already exists.

### P1-M6: Storage reads and deletes have no deadline

**Where:** `apps/api/src/lib/storage/client.ts:167-259`

`withStorageTimeout` wraps bucket setup and `putObject`, but not `headObject`, `readHeadBytes`, `openObject` or `deleteObject`. A hung S3 connection in the upload verification worker occupies one of five worker slots indefinitely.

**Recommendation:** Wrap every storage call in the same deadline, and add a job timeout in BullMQ as a backstop.

### P1-M7: Deleted comments and milestones leave attachments in storage forever

This is the lifecycle half of P1-H4. It is listed separately because the fix is different: P1-H4 is about access, this is about erasure and cost.

**Where:** `services/comment.service.ts:900-920`, `services/milestone.service.ts:1239-1265`, `services/upload.service.ts:198-264`

**Recommendation:** Collect storage keys from the rich text document before the delete, then delete the objects after the transaction commits. Add a periodic reconciliation job for orphans.

### P1-M8: Public invitation link can trigger repeated email to the invitee

**Where:** `services/invitation.service.ts:741-793`

`POST /invitations/:id/magic-link` is public and the invitation id is the bearer token. It always targets the invitation's own address, which is good, and it enforces a 60 second cooldown per invitation. Anyone who obtains the id (forwarded email, screenshot, shared link) can still cause one email per minute to the invitee until the invitation expires or is canceled, and the cooldown key never resets on failure.

**Recommendation:** Add a per-IP throttle in addition to the per-invitation cooldown, and cap total sends per invitation (for example 3).

### P1-M9: Presence join accepts a milestone id without validating project scope

**Where:** `apps/api/src/realtime/gateway.ts:375-385`, `apps/api/src/realtime/registry.ts:127-140`

A `presence.join` frame accepts any `milestoneId` up to 64 characters and adds the connection to that milestone group. No database check confirms the milestone belongs to the authorized project. Today nothing is broadcast from that group, so there is no leak, but the moment presence is emitted this becomes an authorization gap and a way to appear present on a milestone in another project.

**Recommendation:** Validate the milestone against the project at join time, or index presence only by ids the server has already resolved.

### P1-M10: Revoked members keep receiving events for up to 30 minutes

**Where:** `lib/env.ts:73-78`, `realtime/gateway.ts:224-229`

Authorization happens once, at upgrade. `maxConnectionMs` forces a reconnect after 30 minutes, which re-checks access. A member removed from a project or organization keeps receiving that project's comment and milestone events until the socket is recycled or closed by the client.

**Recommendation:** Accept this only if documented as a product decision. Otherwise close connections on membership change (a Redis broadcast on removal is enough), or shorten `maxConnectionMs` for sensitive projects.

### P1-M11: TanStack Devtools ships and mounts in production

**Where:** `apps/web/src/routes/__root.tsx:106-116`

`TanStackDevtools` and `TanStackRouterDevtoolsPanel` are rendered unconditionally, with no `import.meta.env.DEV` guard. The packages ship in the production bundle, mount on every page, and expose router state and navigation history in a floating panel.

**Recommendation:** Wrap the devtools block in a development-only branch, or use the library's supported production toggle. This also removes a meaningful chunk from the bundle.

### P1-M12: No CSP or security headers on the app shell

**Where:** `apps/web/src/routes/__root.tsx` (head), `apps/api/src/index.ts` (no header middleware)

`/files/*` sets a good CSP, but the SPA shell and API responses do not set `Content-Security-Policy`, `X-Frame-Options` or `Referrer-Policy`. The app is same-origin for its own assets, so a CSP is practical. Missing `Referrer-Policy` also means capability URLs such as `/files/...` can leak through the `Referer` header to external sites linked from rich text.

**Recommendation:** Add a strict-ish CSP and `Referrer-Policy: no-referrer` or `same-origin` at the Nitro layer and the API. Add `X-Frame-Options: DENY` or `frame-ancestors 'none'`.

### P1-M13: Unguarded `console.log`, leftover root string

**Where:** `apps/api/src/index.ts:68, 160`

`/` returns `"Hello Huzaifa"`, and the boot line uses `console.log`. The mailer and rate-limit logs are guarded by `!isProduction`, so they are acceptable for now, but Rule 11 asks for no console logging in production code. The root string is a leftover marker.

**Recommendation:** Return a neutral payload or remove the route, and replace the boot log with the structured logger when one exists.

### P1-M14: Redis password in `REDIS_URL` is silently ignored

**Where:** `apps/api/src/lib/redis.ts:10-24`

`parseRedisUrl` extracts host and port only. The password comes from `REDIS_PASSWORD`. A URL such as `redis://:secret@redis:6379` connects without auth, and the failure appears later as `NOAUTH`. This is a deployment trap for managed Redis providers that hand out a single URL.

**Recommendation:** Read `parsed.password` and `parsed.username` as fallbacks, or parse the URL with ioredis directly.

### P1-M15: `S3_PUBLIC_ENDPOINT` compose default is browser unreachable

**Where:** `compose.yaml:139`, `apps/api/src/lib/env.ts:120-132`

The production compose default is `http://seaweedfs:8333`, which resolves only inside the Docker network. The browser cannot reach it, so every presigned upload fails with a network or CORS error. `env.ts` correctly refuses to sign when the value is empty, but compose fills it with a value that looks valid and is not.

**Recommendation:** Leave it empty by default and fail the boot in production when it is unset, so the operator must provide a real public proxy URL.

### P1-M16: Decompressed body cap can be exceeded by one chunk

**Where:** `apps/api/src/lib/link-preview/http.ts:147-177`

When `stopAt` is found, `finish(Buffer.concat(chunks))` returns every chunk read so far, including the chunk that pushed the total past `maxBytes`. The cap is therefore approximate by up to one stream chunk. The practical overshoot is tens of kilobytes against a 512 KB budget, so the risk is small, but the comment claims an exact cap.

**Recommendation:** Slice to `maxBytes` before returning, in both the `stopAt` and truncation branches.

### P1-M17: External images in rich text allow viewer tracking

**Where:** `apps/api/src/lib/rich-text.ts:255-280`

`safeAssetUrl` allows any absolute `http` or `https` URL. A comment or milestone description can therefore embed a third-party image that records the IP and user agent of every project member who opens it. The link preview pipeline deliberately avoids this by storing images locally, but inline images do not.

**Recommendation:** Either proxy and cache inline images through the existing object store, or restrict image sources to `/files/` uploads. At minimum, document the privacy trade-off.

### P1-M18: Milestone attachments are served inline by default

**Where:** `apps/api/src/routes/files.ts:53-55`

`Content-Disposition` is `attachment` only for `comments/files/` or when `?download=1`. Milestone files are served `inline`. The `nosniff` and sandbox CSP reduce the risk, and HTML and SVG are not uploadable, but a PDF or Office file with active content is more exposed in the milestone path than in the comment path.

**Recommendation:** Force `attachment` for every `milestones/files/` and `comments/files/` key, and keep `inline` for images and logos only.

### P1-M19: Any project member can toggle checklists inside another person's comment

**Where:** `apps/api/src/services/comment.service.ts:756-763`, `apps/api/src/auth/comment-permissions.ts:57-75`

`toggleMilestoneChecklistItem` calls `assertCanComment`, not `assertCanModifyComment`. Any project member, including a client, can change checklist state inside someone else's comment. The comment is not marked as edited, which hides who changed it. The module comment says this is intentional, but it contradicts the stated rule that only the author can change a comment.

**Recommendation:** Either treat the checklist as a shared task list and record who toggled it, or require authorship. Pick one and make the copy match.

### P1-M20: Empty milestone PATCH still bumps `updatedBy` and `updatedAt`

**Where:** `apps/api/src/services/milestone.service.ts:994-1096`

The route accepts `{}` because every field is optional. The service still sets `updatedBy` and performs an update, so `updatedAt` moves and the "last edited by" label changes with no content change. This pollutes the timeline and any future sync logic.

**Recommendation:** If no recognized field is present, return the current detail without writing.

### P1-M21: No CI and no web test script

**Where:** `.github/workflows` (empty), `apps/web/package.json` (no `test`), `nx.json` (no `test` target)

The 16 unit tests only run if a developer remembers `bun test`. There is no pipeline that runs `bun run check`, `tsc`, or the tests on push. Biome and TypeScript are therefore advisory only.

**Recommendation:** Add a minimal workflow: install, `bun run check`, `bunx nx run-many -t typecheck`, `bun test`. Add a `test` script to `apps/web` and `apps/api` and a `test` target to Nx.

### P1-M22: RLS verification misses `comment` and `link_preview`

**Where:** `apps/api/scripts/verify-rls.ts`

The script proves isolation for `project`, `project_member`, `project_pin`, `milestone` and `milestone_assignee`, plus the cascade. It does not exercise `comment` or `link_preview`, the two newest business tables. It also does not assert that `TENANT_TABLES` in `bootstrap-db.ts` matches the set of tables that have an RLS policy.

**Recommendation:** Extend the script to every business table, and add a check that compares `TENANT_TABLES` with `pg_tables` plus `pg_policies`. That turns a silent omission into a red check.

### P1-M23: OpenAPI is mounted whenever `NODE_ENV` is not production

**Where:** `apps/api/src/index.ts:71-74`

Same root cause as P1-M1. The schema advertises every internal route, parameter shape and error code. It is useful in dev; it should not be reachable in a deployment that forgot `NODE_ENV`.

**Production status:** it lives in the same `if (isDevelopment)` block as Bull Board, so it is absent from the production image. The `NODE_ENV=production` check confirms `isDevelopment` is false there.

### P1-M24: Downloads have no filename

**Where:** `apps/api/src/routes/files.ts:73`

`Content-Disposition: attachment` has no `filename`, so the browser saves `3f2a...9c.pdf` instead of the name the author chose. The name is available in the rich text node. This is a UX defect, not a security one.

### P1-M25: Sign-up reveals whether an email is registered

**Where:** `apps/api/src/auth/auth.ts:276-291`

The hook returns `"An account with this email already exists"` for an existing address. The code documents the trade-off. It is a user-friendly choice, but it is still account enumeration, and combined with P1-H2 it gives an attacker a cheap way to confirm which addresses already have rows.

**Recommendation:** Keep the friendly message only after a rate-limit check, or move the check behind the same neutral response used elsewhere.

---

## 6. Verified strengths

These are the parts that held up under review. They matter because phase 3 should test them, not re-litigate them.

### Tenant and RLS boundary

- `withTenant` runs business queries as `app_tenant`, which is neither superuser nor table owner, so RLS applies (`db/tenant.ts:107-136`).
- The org and user scope are written with `set_config(..., true)`, so they are transaction local and cannot leak across pooled connections.
- The scope is applied and read back before any query, so a failed setting is a hard error.
- `resolveTenantScope` checks both session and verified email, and resolves the slug through a membership join on the privileged client (`middleware/tenant.ts:54-92`).
- Every business table carries `organization_id`, an index, the `tenantIsolation` policy and `.enableRLS()` (`db/schema.ts`).
- `adminDb` usage is confined to auth tables, slug resolution and small read-only lookups. No business service uses it for tenant data.
- `verify-rls.ts` is a real, runnable proof of the boundary, and it cleans up after itself.

### Authorization

- Project visibility is expressed once (`projectVisibility`, `project.service.ts:342-364`) and reused by the list, sidebar, by-slug lookup, mention search and realtime.
- `loadProjectAccess` returns null for both "missing" and "not yours", so the API does not confirm existence.
- Milestone and comment lookups always filter by `organizationId`, `projectId` and the row id. A forged milestone id cannot reach another project (`milestone.service.ts:383-433`, `comment.service.ts:218-272`).
- Role rules are centralized (`auth/permissions.ts`, `project-permissions.ts`, `milestone-permissions.ts`, `comment-permissions.ts`) and enforced in the service, not only in the UI.
- Last-owner protection exists at both organization and project level.
- Organization owners are overlaid as project owners even if a materialized row is missing.
- Bulk actions reuse the single-item rule, so a batch cannot bypass a guard.

### Auth

- Email verification is required, and the same `isEmailVerified` check is used by HTTP and realtime (`auth/verified.ts`).
- Sign-up does not mint a session; verification does.
- Password policy is centralized and applied to sign-up, reset, change and set (`lib/password.ts`).
- Reset revokes sessions.
- Invitations require a verified email to accept.
- Invitation preview masks the address and uses the id as a bearer token.
- Magic link tokens are stored hashed in Redis.
- Better Auth rate limits sign-up, sign-in and verification resend.
- Trusted origins are explicit and localhost is development only.

### SSRF

The link preview pipeline is unusually well defended:

- http and https only, port 80 and 443 only, no credentials in the URL, no single-label host.
- Every resolved address is checked, not only the first.
- `net.BlockList` covers private, loopback, link-local, CGNAT, multicast, reserved, documentation, ULA and NAT64 ranges, plus IPv4-mapped IPv6.
- DNS has a deadline.
- The socket is pinned to the validated IP, so DNS rebinding does not work.
- Every redirect hop is re-validated.
- The total time budget covers all hops.
- The response body is capped after decompression.
- HTML only, first part only, no cookies or authorization headers.
- Error text is never surfaced, so it cannot be used as a blind port scanner.
- Provider adapters only call fixed public hosts.
- Images are byte sniffed and SVG is rejected.

### Rich text and uploads

- Rich text uses an allowlist for blocks, marks and protocols, and rejects `javascript:`, `data:` and `blob:`.
- Node count, depth, leaf length and payload size are capped.
- Mentions are validated against project membership and project visibility inside the write transaction.
- Stored text is rendered as text; no `dangerouslySetInnerHTML` anywhere in `apps/web` or `packages/ui`.
- Upload keys are fully server generated from a UUID and the policy prefix; the client filename is never used.
- Declared MIME must be in the policy allowlist, and images are sniffed for PNG or JPEG.
- Rejected uploads are deleted.
- The bucket is private in production; reads are proxied.
- `/files` sets `nosniff`, a sandbox CSP and `Cross-Origin-Resource-Policy`.
- DOCX rendering is sanitized after render, and PDF, CSV, text and sheet viewers all have row, column or byte caps.

### Realtime

- Authorization happens before upgrade, with an Origin check, tenant resolution and project access.
- One socket, one project. The project comes from the URL, never from a frame.
- Frames are size limited at the protocol edge and rate limited per connection.
- Malformed frames are ignored rather than echoed.
- Heartbeat detects dead sockets; a hard connection lifetime forces re-authorization.
- The client uses terminal close codes to stop reconnecting on auth failures, and exponential backoff with jitter otherwise.

### Web

- Organization switches go through one helper; direct `setActive` calls are not scattered.
- The switch guard records operations per key with a heartbeat and TTL, prunes expired entries, and blocks only leaving the busy workspace.
- All visible dates use `en-GB` day month year helpers; no `toLocaleDateString` or ad hoc `Intl` usage was found.
- No `any` outside the generated route tree, no direct hex colour classes, no em dashes in source.
- Cross-tab auth sync handles sign-in, sign-out, organization change and account deletion.

---

## 7. Performance hotspots

Ranked by expected cost at realistic scale.

| Rank | Hotspot | Where | Why it matters |
|---|---|---|---|
| 1 | Bulk actions, one transaction per item | `project.service.ts`, `member.service.ts`, `invitation.service.ts` | Up to 100 sequential transactions and several hundred queries per request |
| 2 | Invitation history, full set in memory | `invitation.service.ts:215-318` | O(n log n) per request; possible truncation |
| 3 | Upload completion waits up to 8 s | `routes/uploads.ts:130`, `queues/upload-verification.ts:182` | Holds HTTP connections under load |
| 4 | Milestone search on `descriptionText` | `milestone.service.ts:766-772` | `ILIKE '%term%'` has no trigram index, unlike `title` |
| 5 | Project search on `slug` | `project.service.ts:559-563` | `slug` has no trigram index, only `name` does |
| 6 | Correlated subqueries per project row | `project.service.ts:324-329, 410-416, 454-455` | Three subqueries per row on the list and detail |
| 7 | Storage calls without deadlines | `lib/storage/client.ts` | A hung call occupies a worker slot |
| 8 | Mention search, four queries per keystroke | `mention.service.ts` | Fine with debounce, expensive without |
| 9 | Realtime fan-out to every replica | `realtime/bus.ts:140-163` | Every event is parsed and delivered on every instance |
| 10 | `getSession` on every tenant request | `middleware/tenant.ts:58` | Expected, but it is the hottest auth path |

The schema itself is well indexed for the primary read paths: project by org and archived, milestone by project, status and due date, comment by milestone and created, assignee by member, link preview by org and hash, plus trigram indexes on project name, milestone title, user name and user email. The missing indexes above are the exceptions.

---

## 8. Dependency audit

`bun audit` reports 29 advisories: 13 high, 13 moderate, 3 low.

All of the high and moderate advisories are in development or build tooling:

- `axios` and `follow-redirects` through Nx.
- `brace-expansion`, `minimatch`, `glob`, `smol-toml` and `nx` itself through Nx and react-email.
- `esbuild` through Vite, drizzle-kit and react-email, which is a dev server issue.
- `fast-uri` through the react-email CLI.

The only runtime-adjacent advisory is `deepmerge` (low, prototype poisoning), reached through `@react-email/components` in the email rendering path. No high or moderate advisory was found in Elysia, Drizzle, postgres-js, Better Auth, ioredis or BullMQ.

**Recommendation:** Run `bun audit fix` and add `bun audit` to CI so the tree does not drift. Keep react-email and Nx out of the runtime image, which the production Dockerfile already does.

---

## 9. Configuration and operations findings, consolidated

| Item | Current | Risk | Recommendation |
|---|---|---|---|
| `NODE_ENV` default | development | Dev dashboards and no rate limits in a misconfigured prod | Default to production or fail the boot |
| Database passwords | `app` / `tenant` | Known credentials | Required, no defaults |
| S3 credentials | `admin` / `admin` | Known credentials | Required, no defaults |
| `WEB_URL` | localhost | CORS, email links, S3 origin all wrong | Required, no default |
| `VITE_API_URL` | empty falls back to localhost | Client calls the user's machine | Use a relative URL or require the value |
| `S3_PUBLIC_ENDPOINT` | `seaweedfs:8333` | Browser cannot reach it | Empty by default, fail fast |
| `REDIS_URL` password | ignored | Auth failure with managed Redis | Parse credentials from the URL |
| `BETTER_AUTH_SECRET` | empty default | Better Auth throws in production, but late | Fail at boot with a clear message |
| Health checks | present for all services | Good | Keep |
| Docker networks | backend and frontend split | Good | Keep |
| Runtime images | no node_modules, non-root `bun` user | Good | Keep |
| `.env.dev` contents | real-looking GitHub and Google secrets, shared auth secret | Dev credentials on disk | Confirm they are dev-only apps, rotate if ever shared |
| `.gitignore` | `.env` and `.env.dev` ignored, never committed | Good | Keep, and avoid attaching the files to bug reports |

---

## 10. What phase 1 could not cover

- Runtime behaviour, race conditions and actual authorization outcomes. Phase 2 and 3 cover these.
- Browser-only code paths: rendering, accessibility, file viewers with real malicious files, mobile layout.
- Provider behaviour: Google and GitHub linking, magic link delivery, invitation acceptance.
- Load and concurrency. The performance items above are code reading, not measurements.
- UI copy, empty states and error presentation beyond the API layer.
- A full `tsc` and Biome run. Phase 2 should run both and report the existing baseline.
- Dependency licences and supply chain beyond `bun audit`.

---

## 11. Recommended order of remediation (after the testing phases)

1. **P1-H1 / P1-H2**: close magic-link sign-up and implicit linking. These survive in every environment, hosted or local.
2. **P1-H3 / P1-M1 / P1-M15**: make production configuration fail closed. This is the release gate before deployment.
3. **P1-H4 / P1-M7**: decide the `/files` access model and delete objects on delete.
4. **P1-C1 (dev only)**: bind the dev API port to loopback, or protect Bull Board. Production is already excluded by `NODE_ENV`.
5. **P3-F1**: make Redis failures fail fast. This replaces the phase 1 crash hypothesis; the live test showed a 30 second hang, not a crash.
6. **P1-M2 / P1-M6**: error mapping and storage deadlines.
7. Everything else by severity.

---

## Appendix A: Reproduction notes for the top findings

**P1-C1, Bull Board**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/bull-board/
# 200, no session required
```

**P1-H1, magic link route is live**

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:3001/api/auth/sign-in/magic-link \
  -H 'content-type: application/json' -d '{}'
# 400, meaning the route is mounted and validates its body.
# A real address would create a user and send mail.
```

**P1-H5, Redis crash (phase 2)**

```bash
docker stop ultra-dev-redis-1
# then hit /health and a tenant route, and watch the API container logs
docker start ultra-dev-redis-1
```

**P1-H4, public file read (phase 3)**

1. Upload an attachment through a comment.
2. Copy the `/files/...` URL.
3. Open it in a private window with no session. It renders or downloads.
4. Delete the comment. Open the same URL again. It still works.

---

## Appendix B: Files reviewed

`apps/api/src/index.ts`, `auth/*`, `db/*`, `middleware/tenant.ts`, `routes/*`, `services/*`, `lib/*`, `queues/*`, `realtime/*`, `workers/index.ts`, `scripts/bootstrap-db.ts`, `scripts/verify-rls.ts`, `apps/api/drizzle/*.sql`, `apps/api/Dockerfile`, `apps/web/src/lib/*`, `apps/web/src/features/{auth,organization,files,invitations,projects,milestones}/*`, `apps/web/src/routes/*`, `apps/web/vite.config.ts`, `packages/ui/src/styles/global.css`, `compose.yaml`, `compose.dev.yaml`, `.env.example`, `nx.json`, `package.json` files.

---

## Appendix C: Commands used

```bash
bun audit
curl -s http://localhost:3001/openapi/json
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/bull-board/
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3001/api/auth/sign-in/magic-link -H 'content-type: application/json' -d '{}'
grep -rn "console.log|toLocaleDateString|dangerouslySetInnerHTML|: any" apps packages
```

No application files were edited during phase 1.
