# Fix Plan Round 2: Deployment Readiness

**Created:** 9 Nov 2026
**Branch to use:** `fix/deployment-readiness`
**Source:** `qa/phase-4-retest-report.md`, sections 3 and 7
**App status:** local only. This round closes the remaining items that matter before the deployment next month.

This plan is meant to be executed in **one session**. It has 4 code commits, 1 operational cleanup, and 1 manual production smoke. Do not mix it with unrelated work.

---

## 1. Status checklist

Tick these as you go. Update this section before you finish so the next session knows exactly where things stopped.

- [x] Step 0: branch and baseline
- [x] Step 1: SMTP fail-closed in production (P1-M26)
- [x] Step 2: Redis service and deadline check in CI (P4-F1)
- [x] Step 3: Redis outage logs are one line (P4-F4)
- [x] Step 4: orphan cleanup dry run and apply (P4-F2)
- [x] Step 5: production smoke (P4-F5)
- [x] Step 6: deployment checklist doc, including the readiness note (P4-F3)
- [x] Step 7: final verification and commit

---

## 2. Why these six, and not the rest

Everything else from Batches 1 to 8 was verified in the re-test. These are the only remaining items with real value:

| Item | Why it matters |
|---|---|
| P1-M26 | Production can boot with no usable SMTP. Email verification is required to sign in, so signup and invites would fail silently. |
| P4-F1 | CI never exercises Redis. A future Redis regression could merge green. |
| P4-F4 | Outage logs include full stack traces, which buries the useful line. Small cleanup. |
| P4-F2 | 39 old objects still in storage. Not a code bug, but stale client data and disk cost. |
| P4-F5 | The production CSP and boot were not independently re-run in the re-test. One smoke closes it. |
| P4-F3 | The readiness recovery window needs to be documented, not coded. |

Do **not** reopen already verified items. If you find something new, add it to `qa/FIX-PLAN.md` section 14 and keep going.

---

## 3. Preconditions

- The dev stack is running: `docker ps` shows web, api, postgres, redis, mailpit, seaweedfs.
- `fix-allll` is merged or at least contains the Batch 1 to 8 fixes.
- `app_test` exists, or `bun run test:db` can create it.
- You can write to `qa/` and `docs/`.

Start:

```bash
git checkout fix-allll
git pull
git checkout -b fix/deployment-readiness
```

Baseline, so you know a failure is yours and not inherited:

```bash
bun run check
bunx nx run-many -t typecheck
cd apps/api && bun test
cd apps/web && bun test
cd ../.. && bun run test:db
```

Expect: Biome 0, typecheck 3/3, API 406 pass / 49 skip, web 81 pass, database suite 453 pass.

---

## 4. Step 1: SMTP fail-closed in production (P1-M26)

**Commit:** `fix(deploy): require smtp settings in production`

### The problem

`compose.yaml` currently passes:

```yaml
SMTP_HOST: ${SMTP_HOST:-}
SMTP_FROM: ${SMTP_FROM:-Handoff <[email protected]>}
```

`validate-env.ts` does not check SMTP, so production boots with an empty host and a placeholder sender. The API looks healthy, but verification, reset, magic-link and invitation mail fails. Because sign-in requires a verified email, every new user and every invite is blocked.

### Changes

1. `compose.yaml`, API service:
   - `SMTP_HOST: ${SMTP_HOST:?set the SMTP host}`
   - `SMTP_FROM: ${SMTP_FROM:?set the sender address, for example Handoff <no-reply@yourdomain.com>}`
   - Leave `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` as they are. Port 587 and TLS off are safe defaults; user and pass are optional for an internal relay.

2. `.env.example` (the production template):
   - Fill the SMTP block with clear placeholders:
     ```
     SMTP_HOST=smtp.example.com
     SMTP_PORT=587
     SMTP_SECURE=true
     SMTP_USER=
     SMTP_PASS=
     SMTP_FROM=Handoff <no-reply@example.com>
     ```
   - Add a comment that a real deployment must use the provider's host and a sender on a domain with SPF and DKIM.
   - Do not touch `.env.example.dev`; it keeps Mailpit (`SMTP_HOST=mailpit`, port 1025).

3. `apps/api/src/lib/validate-env.ts`:
   - Add `SMTP_HOST` and `SMTP_FROM` to `REQUIRED_IN_PRODUCTION`.
   - Add a shape check for `SMTP_FROM`: it must contain `@`. Keep it simple; do not try to fully parse RFC 5322.
   - Do **not** require `SMTP_USER` or `SMTP_PASS`, because an internal relay may not need auth.
   - Do **not** call `transporter.verify()` at boot. An SMTP outage should not stop the API; the email worker already retries with backoff.

4. `apps/api/src/lib/validate-env.test.ts`:
   - Add `SMTP_HOST: "smtp.example.com"` and `SMTP_FROM: "Handoff <no-reply@example.com>"` to `completeEnv`, otherwise the "accepts a complete environment" test fails.
   - Add one test: missing `SMTP_FROM` is reported.
   - Add one test: `SMTP_FROM` without `@` is rejected, for example `"Handoff"`.

### Acceptance

Create the two fixture files from `.env.example`, filling every required value except SMTP for the first one and adding `SMTP_HOST` and `SMTP_FROM` for the second.

```bash
# A complete env without SMTP must fail on SMTP.
docker compose --env-file /tmp/opencode/env-no-smtp config
# Expect exit 1 and messages naming SMTP_HOST and SMTP_FROM.

# Add the two SMTP values and it must pass.
docker compose --env-file /tmp/opencode/env-with-smtp config
# Expect exit 0.

# The production boot must fail before listening when SMTP is missing.
cd apps/api
NODE_ENV=production PORT=3101 ... bun run src/index.ts
# Expect "Refusing to start in production... missing: SMTP_HOST, SMTP_FROM"
```

A production boot **with** SMTP must start and `/health` must return 200. Do not send mail in this check.

---

## 5. Step 2: CI Redis service and deadline check (P4-F1)

**Commit:** `ci: add redis service and the deadline check`

### The problem

`.github/workflows/ci.yml` sets `REDIS_URL: redis://localhost:6379` but starts only Postgres. The suites pass because Redis failures fail open, so CI never proves the Redis path and never runs `check:redis`.

### Changes

1. Add a service under `jobs.quality.services`, next to Postgres:

   ```yaml
   redis:
     image: redis:8.8.3-alpine
     ports:
       - 6379:6379
     options: >-
       --health-cmd "redis-cli ping"
       --health-interval 5s
       --health-timeout 3s
       --health-retries 12
   ```

2. Add a step after "Unit tests (Web)" and before "Integration suite":

   ```yaml
   - name: Redis deadline check
     run: cd apps/api && bun run check:redis
   ```

   The script defaults to `REDIS_UPSTREAM_URL=redis://127.0.0.1:6379`, which matches the service. It starts its own proxy on 6399, so it does not conflict with the service.

3. Do not add `SMTP_HOST` or `SMTP_FROM` to the CI env. `NODE_ENV=test`, so `validate-env` does not require them.

### Acceptance

- The YAML parses.
- On a pull request, the Redis service is healthy and `check:redis` passes.
- `bun run test:db` no longer prints a Redis rate-limit stack trace in CI.
- The job stays under the 20 minute timeout.

Local sanity check:

```bash
docker run --rm -d --name ci-redis-check -p 6379:6379 redis:8.8.3-alpine
cd apps/api && bun run check:redis
docker stop ci-redis-check
```

---

## 6. Step 3: Redis outage logs are one line (P4-F4)

**Commit:** `fix(logging): keep redis outage logs to one line`

### The problem

`logRedisIssue` in `apps/api/src/lib/redis.ts` does:

```ts
console.error(`[redis] ${key} failed`, error);
```

The throttle works, but each line includes the full ioredis stack. It also shows up in the integration suite output.

### Changes

1. Add a pure formatter next to `logRedisIssue`:

   ```ts
   export function formatRedisIssue(key: string, error: unknown): string {
     const message = error instanceof Error ? error.message : String(error);
     const code =
       error && typeof error === "object" && "code" in error
         ? String((error as { code?: unknown }).code)
         : "";

     return code
       ? `[redis] ${key} failed (${code}): ${message}`
       : `[redis] ${key} failed: ${message}`;
   }
   ```

2. Change the log call to `console.error(formatRedisIssue(key, error));`.

3. Add tests to `apps/api/src/lib/redis.test.ts`:
   - The message contains the key and the error message.
   - The message contains no `\n` and no `"    at "` (no stack).
   - A non-Error value still produces a readable line.

4. Do not change the throttle window or the fail-open behaviour.

### Acceptance

```bash
cd apps/api && bun test src/lib/redis.test.ts
```

Then, with Redis stopped, one log line should read like:

```
[redis] ping failed (ECONNREFUSED): connect ECONNREFUSED 127.0.0.1:6379
```

No stack, no multi-line error object.

---

## 7. Step 4: Orphan cleanup (P4-F2)

**No commit. This is an operational step in the dev stack.**

### The problem

Before Batch 2, deleting a comment or milestone removed the rows but left the files. The new delete path removes them, verified in the re-test. 39 old objects remain.

### Safety

- The script is dry-run by default. `--apply` is required to delete.
- It only touches keys under `/projects/`, `/milestones/` and `/comments/`.
- It skips objects younger than 24 hours, so a fresh upload that is not attached yet is safe.
- It skips avatars and organization logos.
- Review the list before applying. These are dev objects, but confirm.

### Commands

```bash
cd apps/api

export DATABASE_URL=postgres://app:app@localhost:5432/app
export DATABASE_APP_URL=postgres://app_tenant:tenant@localhost:5432/app
export REDIS_URL=redis://localhost:6379
export S3_ENDPOINT=http://localhost:8333
export S3_ACCESS_KEY=admin
export S3_SECRET_KEY=admin
export S3_BUCKET=handoff
export S3_REGION=us-east-1

# 1. Capture the list.
bun run db:reconcile-objects -- --dry-run | tee /tmp/opencode/orphans-before.txt

# Expect: "Scanned 72 objects. 2 keys are referenced. 39 look orphaned."

# 2. Read the list. Confirm they are old test objects and nothing current.
#    If anything looks like a real client file, stop and ask before deleting.

# 3. Apply.
bun run db:reconcile-objects -- --apply

# 4. Prove it is clean.
bun run db:reconcile-objects -- --dry-run
# Expect "... 0 look orphaned."
```

If you do not want to delete the 39, leave the step unticked and note it. Do not run `--apply` on production without a backup and the same review.

### Acceptance

- The second dry run reports 0 orphaned.
- A current comment or milestone attachment still loads for an organization member.
- The storage count dropped by 39.

---

## 8. Step 5: Production smoke (P4-F5)

**No commit. This is a manual verification.** Use spare ports so the dev stack keeps running.

### 5a. API in production mode

Use a separate Redis database for the queues so the smoke does not consume the dev queues. The dev stack uses DB 0; use DB 1.

```bash
cd apps/api

NODE_ENV=production \
PORT=3101 \
HOST=127.0.0.1 \
DATABASE_URL=postgres://app:app@localhost:5432/app \
DATABASE_APP_URL=postgres://app_tenant:tenant@localhost:5432/app \
BETTER_AUTH_SECRET=smoke-secret-at-least-32-characters-long \
BETTER_AUTH_URL=http://localhost:3101 \
WEB_URL=http://localhost:3102 \
REDIS_URL=redis://localhost:6379/1 \
S3_ENDPOINT=http://localhost:8333 \
S3_PUBLIC_ENDPOINT=http://localhost:8333 \
S3_ACCESS_KEY=admin \
S3_SECRET_KEY=admin \
S3_BUCKET=handoff \
S3_REGION=us-east-1 \
SMTP_HOST=localhost \
SMTP_PORT=1025 \
SMTP_SECURE=false \
SMTP_FROM="Handoff <qa@example.com>" \
bun run src/index.ts
```

In another terminal:

```bash
curl -s -o /dev/null -w "health:%{http_code}\n" http://localhost:3101/health
# 200

curl -s http://localhost:3101/ready
# {"status":"ok","checks":{"database":"ok","redis":"ok"}}

curl -s http://localhost:3101/
# {"name":"Handoff API"}

curl -s -o /dev/null -w "bull:%{http_code} " http://localhost:3101/bull-board/
curl -s -o /dev/null -w "openapi:%{http_code}\n" http://localhost:3101/openapi/json
# 404 404

curl -s -D - -o /dev/null http://localhost:3101/ | grep -iE "content-security-policy|referrer-policy|x-frame-options|x-content-type-options"
# default-src 'none', no-referrer, DENY, nosniff
```

Then stop the API with Ctrl+C.

### 5b. Web production build

```bash
cd apps/web

VITE_API_URL=http://localhost:3101 \
S3_PUBLIC_ENDPOINT=http://localhost:8333 \
bun run build

NODE_ENV=production \
PORT=3102 \
VITE_API_URL=http://localhost:3101 \
S3_PUBLIC_ENDPOINT=http://localhost:8333 \
bun run .output/server/index.mjs
```

In another terminal:

```bash
curl -s -D - -o /dev/null http://localhost:3102/ | grep -iE "content-security-policy|referrer-policy|x-frame-options|x-content-type-options"
# CSP must include connect-src http://localhost:3101 ws://localhost:3101 and the storage origin.

curl -s -o /dev/null -w "favicon:%{http_code} " http://localhost:3102/favicon.ico
curl -s -o /dev/null -w "robots:%{http_code}\n" http://localhost:3102/robots.txt
# 200 200

grep -rl "Open TanStack Devtools" .output | wc -l
# 0
```

Then stop the web server.

### Acceptance

- `/bull-board` and `/openapi` are 404 in production mode.
- `/ready` is ok and includes both checks.
- The web CSP names the API and the storage origin.
- No devtools control in the build.
- Favicon and robots are 200.

---

## 9. Step 6: Deployment checklist doc (P4-F3, P4-F5)

**Commit:** `docs(deploy): add the pre-deployment checklist`

Create `docs/DEPLOYMENT.md` with:

1. **Required environment**
   - Database: `DATABASE_URL`, `DATABASE_APP_URL` (must differ).
   - Auth: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `WEB_URL`.
   - Storage: `S3_*`, `S3_PUBLIC_ENDPOINT`, `S3_ALLOWED_ORIGINS`.
   - Mail: `SMTP_HOST`, `SMTP_FROM`, optional `SMTP_USER`, `SMTP_PASS`.
   - Web build: `VITE_API_URL`.
   - Redis: `REDIS_URL`.

2. **Pre-flight**
   - `docker compose --env-file .env config` exits 0.
   - `bun run check`, typecheck, API and web tests, `test:db`, `db:verify-rls`.
   - Build the web bundle with the production `VITE_API_URL`.

3. **Mail check**
   - Trigger a real verification or invitation to a real inbox.
   - Confirm the sender domain matches `SMTP_FROM` and passes SPF and DKIM.
   - Confirm the link lands on the web origin, not the API.

4. **Production smoke**
   - Paste the two commands from Step 5.
   - Check `/health`, `/ready`, `/`, `/bull-board` 404, `/openapi` 404.
   - Check the CSP and the favicon.

5. **Readiness window**
   - `/ready` can stay `degraded` for about 10 to 12 seconds after Redis restarts while the client reconnects. Deploy scripts should allow it. This is P4-F3; no code change.

6. **Recurring maintenance**
   - Run `db:reconcile-objects` dry-run monthly, review, then `--apply`.
   - Back up the database and the volume before any migration.

7. **Rollback**
   - Keep the previous image tags, the database backup and the `.env` values. Migrations are forward only; restore the backup to roll back.

Keep the doc short. It is a checklist, not an essay.

---

## 10. Step 7: Final verification and commit

Run the full gate:

```bash
bun run check
bunx nx run-many -t typecheck
cd apps/api && bun test
cd apps/web && bun test
cd ../.. && bun run test:db
cd apps/api && bun run db:verify-rls
```

Expected:

- Biome: 0 errors, 0 warnings.
- Typecheck: 3/3.
- API: 406 pass or more, 0 fail.
- Web: 81 pass or more, 0 fail.
- Database suite: 453 pass or more, 0 fail.
- RLS: 23/23.

Then commit in this order:

1. `fix(deploy): require smtp settings in production`
2. `ci: add redis service and the deadline check`
3. `fix(logging): keep redis outage logs to one line`
4. `docs(deploy): add the pre-deployment checklist`

Update `qa/FIX-PLAN.md`:

- Mark P1-M26, P4-F1, P4-F4 as Done.
- Mark P4-F2 as Done if the cleanup ran, otherwise leave Open with the count.
- Mark P4-F5 as Done after the smoke.
- Add a session log row with the commit hashes and the smoke result.

Do not mark P4-F3 as a code fix; it is documented.

---

## 11. What not to do

- Do not commit `.env`, `.env.dev`, or any real secret.
- Do not run the orphan `--apply` before reviewing the list, and never on production without a backup.
- Do not add `transporter.verify()` at boot. SMTP outages must not stop the API.
- Do not require `SMTP_USER` or `SMTP_PASS`; an internal relay may not need them.
- Do not start the smoke API on the dev Redis DB 0. Use DB 1 so the queues do not interfere.
- Do not weaken the SMTP check to a warning. A production boot with no mail is worse than a failed boot.
- Do not touch the already verified file access, Redis deadline, authorization or RLS code.

---

## 12. Definition of done

- [ ] `docker compose --env-file` fails on missing SMTP, passes with a complete env.
- [ ] A production boot without SMTP fails before listening.
- [ ] CI has a healthy Redis service and runs `check:redis`.
- [ ] Redis outage logs are one line, no stack.
- [ ] Orphan dry run reports 0, or the step is documented as deferred.
- [ ] Production smoke passes all checks in Step 5.
- [ ] `docs/DEPLOYMENT.md` exists and is short.
- [ ] Full test and typecheck gate is green.
- [ ] `qa/FIX-PLAN.md` is updated.
