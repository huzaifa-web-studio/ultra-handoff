# Phase 4: Re-test Report

**Project:** Handoff (ultra-handoff monorepo)
**Branch:** `fix-allll`
**Date:** 9 Nov 2026
**Mode:** Independent re-test after Batches 1 to 8. No application code was changed.
**Stack:** web 3000, api 127.0.0.1:3001, postgres, redis, mailpit 8025, seaweedfs 8333.
**Fix tracking:** `qa/FIX-PLAN.md` (batch status, session log).

This report checks the fixes, not the original findings. Each item is marked as fixed and verified, accepted as intended, still open, or not re-tested.

---

## 1. Automated baseline

| Check | Command | Result |
|---|---|---|
| API unit tests | `cd apps/api && bun test` | 406 pass, 49 skip, 0 fail, 455 tests, 33 files |
| Web unit tests | `cd apps/web && bun test` | 81 pass, 0 fail, 11 files |
| Database suite | `bun run test:db` | 453 pass, 0 fail |
| Typecheck | `bunx nx run-many -t typecheck` | 3 of 3 pass |
| Lint | `bun run check` | 0 errors, 0 warnings, 420 files |
| RLS | `bun run db:verify-rls` | 23 of 23 pass |
| Production compose | `docker compose --env-file .env.example config` | exit 1 with the required-variable messages |
| API bind | `ss -ltnp` | `127.0.0.1:3001` only |

The one log line worth noting: during `test:db`, the comment rate limiter logged a Redis failure because the fail-fast client rejected a command before the socket was ready. The comment still posted because the limiter fails open. It does not fail the suite.

---

## 2. Result by batch

### Batch 1: Authentication abuse

| Finding | Status | Evidence |
|---|---|---|
| P1-H1 open magic-link sign-up | Fixed, verified live | A random address got HTTP 200 but no Mailpit message (`messages_count: 0`) and no user row. An existing user and an invited address still received a link. |
| P1-H2 implicit linking | Accepted as intended, guard verified | The code pins `requireLocalEmailVerified: true`. The installed Better Auth 1.7.11 source reads `accountLinking?.requireLocalEmailVerified ?? true` and rejects linking into a local user whose email is unverified. No live provider test, see section 6. |
| P3-F5 magic-link callback | Fixed, verified live | The owner link now carries `callbackURL=http://localhost:3000/`, not the API root. |
| P1-M8 invitation magic-link caps | Code verified | `MAGIC_LINK_IP_LIMIT`, `MAGIC_LINK_TOTAL_LIMIT` and a socket-address IP are in `invitation.service.ts`. Not hammered live to avoid sending repeated mail. |
| P1-M25 sign-up enumeration | Accepted, documented | The friendly "already exists" message is still there by choice, behind the tighter sign-up rate limit. The trade-off is in the code comment. |

### Batch 2: File access and object lifecycle

| Finding | Status | Evidence |
|---|---|---|
| P1-H4 public `/files` | Fixed, verified live | Unauthenticated attachment: 404. Owner (org A): 200 with `private, no-store`. Outsider (org B member): 404. Unknown folder: 404. |
| P1-M7 orphaned objects | Fixed, verified live | New PDF upload, comment, delete. Before delete owner 200; after delete owner 404. A direct `headObject` to SeaweedFS returned "gone". |
| P1-M18 inline attachments | Fixed, verified live | Response header: `content-disposition: attachment; filename="retest-brief.pdf"; filename*=UTF-8''retest-brief.pdf`. |
| P1-M24 download filename | Fixed, verified live | Same header. The name is sanitised and the ASCII fallback is present. |
| P1-M17 external images | Fixed, code and tests | `safeAssetUrl` now only allows `/files/` for inline images, and the viewer tests cover it. |
| Old orphan backlog | Follow-up, see P4-F2 | The dry run still finds 39 orphaned objects from before the new delete path. |

### Batch 3: Redis and storage resilience

| Finding | Status | Evidence |
|---|---|---|
| P3-F1 Redis hang | Fixed, verified live | With Redis stopped, an authenticated request returned 200 in **16 ms** and the project list loaded from Postgres. `/ready` returned 200 with `{"database":"ok","redis":"down"}`. `/health` stayed 200. After restart, `/ready` returned ok and requests were 17 ms. |
| P1-M6 storage deadlines | Code verified | `headObject`, `readHeadBytes`, `openObject` and `deleteObject` use the deadline wrapper; the worker has a backstop. |
| P1-M14 Redis URL password | Code verified | `parseRedisUrl` decodes the userinfo; `resolveRedisAuth` gives `REDIS_PASSWORD` precedence. |
| P1-H5 Redis crash | Closed, disproved | The process never crashed in either outage. |

### Batch 4: Production and environment gate

| Finding | Status | Evidence |
|---|---|---|
| P1-H3 dev defaults | Fixed, verified | The example env fails `docker compose config` with clear required-variable errors for database, storage, web URL and API URL. |
| P1-M1 NODE_ENV default | Fixed, code and tests | `NODE_ENV` defaults to production, and `validate-boot` rejects an incomplete production env. |
| P1-M15 S3 public endpoint | Fixed, verified | It is a required compose value; the example fails without it. |
| P1-C1 Bull Board | Fixed for the dev exposure | The dev API now listens on `127.0.0.1:3001` only. Bull Board still answers on localhost, which is correct for development. |
| P1-M23 OpenAPI | Closed by the same change | Dev-only and loopback-only. |
| Web API origin | Fixed | The production build requires `VITE_API_URL`; `api-base.ts` and its tests cover the resolver. |

### Batch 5: Authorization and error handling

| Finding | Status | Evidence |
|---|---|---|
| P1-M19 checklist toggles | Fixed, verified live | Member reading the milestone: 200. Member toggling the owner's checklist item: 403 "Only the person who wrote a comment can change it." Owner toggle: 200, checked true. |
| P1-M20 empty milestone PATCH | Fixed, verified live | `PATCH {}` returned 200 and `updatedAt` was byte-identical before and after. |
| P1-M2 error mapping | Fixed, unit tested | Unknown failures map to 500; known API errors keep their message. Covered by `auth-error.test.ts`. |
| P2-F2 target predicates | Fixed, unit tested | The actor check is folded into both predicates. |
| P1-M9 presence validation | Fixed, unit tested | `realtime/registry` and `control` tests cover the project scope check. Not re-tested through a live WebSocket. |
| P1-M10 revoked members | Fixed, unit tested | A control-channel revocation closes matching sockets; `realtime/revoke.test.ts` covers it. Not re-tested live. |

### Batch 6: Web shell, headers and UX

| Finding | Status | Evidence |
|---|---|---|
| P3-F2 URL organization | Accepted as intended | Opening org B's URL while org A is active redirects to org A (`replace`), with no B content rendered. This is the "one active workspace per session" decision. |
| P3-F6 / P1-M11 devtools | Fixed for production | `.output` contains zero occurrences of the devtools control or its storage key. The control still appears in dev, which is intended. |
| P3-F3 favicon | Fixed | `/favicon.ico` 200, `/favicon.svg` 200. |
| P3-F4 SEO metadata | Fixed | Meta description present, `/robots.txt` 200. |
| P1-M12 headers | Fixed | Web: `referrer-policy: same-origin`, `x-content-type-options: nosniff`, `x-frame-options: DENY`. API: `referrer-policy: no-referrer`, `nosniff`, `DENY`. The production build contains the CSP. Dev has no CSP by design. |
| P1-M13 root and logs | Fixed | `GET /` returns `{"name":"Handoff API"}`. |
| P2-F1 viewer precedence | Fixed, unit tested | MIME is checked first, extension second. |

### Batch 7: Performance

| Finding | Status | Evidence |
|---|---|---|
| P1-M5 upload wait | Fixed, verified live | `POST /uploads/:id/complete` returned **202**, the client polled, and the worker verified the file. |
| P1-M3 invitation history | Fixed, code | One grouped count plus one limited page query with `orderBy`, `limit` and `offset`. |
| P1-M4 bulk actions | Fixed, code | One transaction, one access read and one write per bulk action. Benchmark not re-run. |
| Missing indexes | Fixed, verified | `project_slug_trgm_idx` exists and `EXPLAIN` uses a bitmap index scan on it. |
| P1-M16 body cap | Fixed, unit tested | `http.test.ts` and the `readLimited` cap test cover it. |

### Batch 8: Tooling, CI and test harness

| Finding | Status | Evidence |
|---|---|---|
| P2-F3 Nx typecheck | Fixed | 3 of 3 projects pass. |
| P2-F4 Biome | Fixed | 0 errors, 0 warnings, `.agents` ignored. |
| P2-F6 one-command database suite | Fixed | `bun run test:db` ran 453 tests, 0 fail. |
| P1-M22 RLS coverage | Fixed | 23 of 23 checks, including comments, link previews and the table/policy drift check. |
| P2-F5 CI | Partial, see P4-F1 | The workflow exists and runs lint, typecheck, both unit suites, the database suite and RLS, but no Redis service. |

---

## 3. Findings from the re-test

### P4-F1: CI does not start Redis

**Severity:** Medium, tooling and coverage
**Where:** `.github/workflows/ci.yml`

The workflow declares `REDIS_URL: redis://localhost:6379` but starts only a Postgres service. Nothing listens on 6379 in the job. The unit and integration suites still pass because the rate limiter and secondary storage fail open, but the Redis-specific paths are not exercised, and `bun run check:redis` is not in the pipeline.

**Recommendation:** Add a `redis:8.8.3-alpine` service with a health check, and add `bun run check:redis` (or an equivalent deadline test) as a step. Keep the fail-open behaviour, but prove it in CI.

**Done when:** The CI job shows a healthy Redis service and the Redis deadline check passes there.

### P4-F2: The old orphan backlog is still in object storage

**Severity:** Operational, not a code defect
**Where:** SeaweedFS, `scripts/reconcile-orphan-objects.ts`

The new delete path is correct, but the dry run reports:

```
Scanned 72 objects. 2 keys are referenced. 39 look orphaned.
```

The 39 are from before the new delete path, including the phase 3 attachments. They are no longer public (the classifier gates `comments` and `milestones` by organization membership), but they still occupy storage and are still readable by members who know the URL.

**Recommendation:** Review the dry-run list, then run `bun run db:reconcile-objects --apply` in a quiet window. It has a 24 hour grace window, so it will not touch a fresh upload that has not been attached yet.

**Done when:** The follow-up dry run reports zero removable orphans.

### P4-F3: `/ready` takes about 10 to 12 seconds to return to ok after Redis restarts

**Severity:** Low, operational note
**Where:** `lib/redis.ts`, `routes/health.ts`

While Redis is down, `/ready` correctly reports `degraded` and the app keeps serving from Postgres. After Redis came back, `/ready` stayed `degraded` for roughly 10 to 12 seconds while ioredis reconnected with backoff, then returned `ok`. This is acceptable for a readiness probe, but a deploy script that waits on `/ready` should allow that window.

**Recommendation:** Either document the reconnect window or set a shorter `retryStrategy` cap for the application client. Do not make `/ready` report ok before Redis is actually usable.

### P4-F4: Redis outage logs include full stack traces

**Severity:** Low, observability
**Where:** `lib/redis.ts`, `logRedisIssue`, `routes/health.ts`

The log is throttled, which fixed the flood (9 Redis lines in 40 instead of dozens), but each line includes the whole `Stream isn't writeable` stack. During an outage the first line is useful; the stack on every throttled line is noise.

**Recommendation:** Log the key, the error message and the code, and drop the stack for known connection errors.

### P4-F5: Production CSP and boot were verified by build, not by a live production run in this session

**Severity:** Info, coverage
**Where:** `apps/web/.output`, `server/security-headers.ts`

The built server contains the CSP string, and the production build contains zero devtools strings. The earlier session booted the production build and checked the headers. This re-test did not repeat the production boot, to avoid starting a second API against the shared dev database and queues.

**Recommendation:** The pre-deployment checklist should include one production boot with a complete env and a header check. Do it before the deployment, not in the dev loop.

---

## 4. Accepted as intended

These were reported in the earlier phases but are not defects given the product decisions:

| Item | Decision |
|---|---|
| P1-H2 implicit linking | Allowed on purpose. `requireLocalEmailVerified: true` blocks linking into an unverified local account, which is the pre-registration attack path. Verified in the installed Better Auth source. |
| P3-F2 one active workspace | The app redirects any other organization URL to the active one. The URL is replaced, not switched, so the guard and cross-tab broadcast stay authoritative. |
| P1-M25 sign-up enumeration | The explicit "account already exists" message is a product choice, behind the tighter sign-up rate limit. |
| P1-C1 dev Bull Board | Dev-only, now loopback-only. Production does not mount it. |

If you also closed other items as intended, add them here so the next session does not reopen them.

---

## 5. Not re-tested, and why

- **Live Google or GitHub linking.** No provider test account. The guard is verified in the library source and pinned in config.
- **Live WebSocket membership revocation.** Covered by `realtime/revoke.test.ts` and the control-channel tests; a live two-user socket test would need another full browser pass.
- **Live production boot and CSP.** Verified by build strings and the earlier session; see P4-F5.
- **The 20,000 invitation benchmark and the 100 project bulk benchmark.** The code paths and the one-transaction shape are verified; the timings are from the fix session and were not reproduced here.
- **The invitation magic-link IP cap under load.** The code is present; hammering it would send repeated mail.
- **A forced unknown 500.** Covered by `auth-error.test.ts`; forcing a driver failure would mean breaking the dev database.
- **Downloading through the browser UI.** The header was verified from the raw network response, which is stronger than the JS `headers.get` (CORS does not expose `Content-Disposition`).

---

## 6. Test data left behind

The re-test created and then deleted a milestone, a comment, an uploaded PDF and a checklist comment. It also canceled the temporary invitation. Remaining test data:

- The five QA users and three QA organizations from phase 3 and the Batch 6 check (`qa-studio-p3203518`, `qa-studio-b-p3203518`, `qa-studio-batch6`).
- One canceled invitation for `retest.invite.20261109@example.com`.
- The 39 old orphaned objects listed in P4-F2.

No new project, milestone or comment was left behind.

---

## 7. Verdict

The high-severity findings are addressed and independently verified:

- Open magic-link sign-up: blocked; invite and existing-user paths still work.
- Public attachments: gated by organization membership; new deletes remove the object.
- Redis outage: 30 second hang reduced to 16 ms with a database fallback and a degraded readiness signal.
- Production config: fails closed; dev API is loopback-only.
- Checklist ownership, empty PATCH, realtime revocation, headers, favicon, viewer precedence, upload 202 and RLS coverage: fixed or covered by tests.

Two follow-ups remain: the CI Redis service (P4-F1) and the old orphan backlog (P4-F2). Neither is a regression in the application code. One pre-deployment item is also still open from the fix sessions: **P1-M26**, `SMTP_HOST` and `SMTP_FROM` still default to development values in `compose.yaml`. Add it to the release checklist before the deployment.

The branch is ready for review. No code was changed during this re-test.
