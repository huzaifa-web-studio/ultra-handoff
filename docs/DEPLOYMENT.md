# Deployment Checklist

Short pre-deployment gate for Handoff. Run the sections in order. Commands run
from the repository root unless a section says otherwise.

## 1. Required environment

Copy `.env.example` to `.env` and fill it. `compose.yaml` refuses to resolve
when a required value is missing, so `docker compose config` is the first check.

| Area | Variables |
|---|---|
| Database | `DATABASE_URL`, `DATABASE_APP_URL` (must differ) |
| Auth | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `WEB_URL` |
| Storage | `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_ALLOWED_ORIGINS`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION` |
| Mail | `SMTP_HOST`, `SMTP_FROM`, optional `SMTP_USER`, `SMTP_PASS` |
| Web build | `VITE_API_URL` |
| Redis | `REDIS_URL` |

Notes:

- `VITE_API_URL` is inlined at build time, so changing it requires a rebuild.
- `SMTP_FROM` must contain an `@`. The API refuses to boot without it, because
  sign-in needs a verified address and a broken relay blocks every signup and
  invitation.
- `DATABASE_APP_URL` must point at the unprivileged `app_tenant` role. Pointing
  both database URLs at the owner silently disables row level security.

## 2. Pre-flight

```bash
docker compose --env-file .env config
bun run check
bunx nx run-many -t typecheck
cd apps/api && bun test && cd ../..
cd apps/web && bun test && cd ../..
bun run test:db
cd apps/api && bun run db:verify-rls && cd ../..
```

Then build the web bundle with the production API URL:

```bash
cd apps/web
VITE_API_URL=https://api.example.com \
S3_PUBLIC_ENDPOINT=https://storage.example.com \
bun run build
```

## 3. Mail check

- Trigger a real verification email or invitation to a real inbox.
- Confirm the sender matches `SMTP_FROM` and that the domain publishes SPF and
  DKIM.
- Confirm the link points at the web origin, not the API.

## 4. Production smoke

Run the API in production mode on a spare port:

```bash
cd apps/api
NODE_ENV=production PORT=3101 HOST=127.0.0.1 \
  DATABASE_URL=... DATABASE_APP_URL=... \
  BETTER_AUTH_SECRET=... BETTER_AUTH_URL=http://localhost:3101 \
  WEB_URL=http://localhost:3102 REDIS_URL=redis://localhost:6379 \
  S3_ENDPOINT=... S3_PUBLIC_ENDPOINT=... S3_ACCESS_KEY=... S3_SECRET_KEY=... \
  S3_BUCKET=handoff S3_REGION=us-east-1 \
  SMTP_HOST=... SMTP_PORT=587 SMTP_SECURE=true \
  SMTP_FROM="Handoff <no-reply@example.com>" \
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
curl -s -o /dev/null -w "bull:%{http_code}\n" http://localhost:3101/bull-board/
# 404
curl -s -o /dev/null -w "openapi:%{http_code}\n" http://localhost:3101/openapi/json
# 404
curl -s -D - -o /dev/null http://localhost:3101/ \
  | grep -iE "content-security-policy|referrer-policy|x-frame-options|x-content-type-options"
```

Expected API headers: `default-src 'none'`, `no-referrer`, `DENY`, `nosniff`.

Then the web bundle:

```bash
cd apps/web
NODE_ENV=production PORT=3102 HOST=127.0.0.1 \
  VITE_API_URL=http://localhost:3101 \
  S3_PUBLIC_ENDPOINT=http://localhost:8333 \
  bun run .output/server/index.mjs
```

```bash
curl -s -D - -o /dev/null http://localhost:3102/ \
  | grep -iE "content-security-policy|referrer-policy|x-frame-options|x-content-type-options"
curl -s -o /dev/null -w "favicon:%{http_code} " http://localhost:3102/favicon.ico
curl -s -o /dev/null -w "robots:%{http_code}\n" http://localhost:3102/robots.txt
grep -rl "Open TanStack Devtools" .output | wc -l
# 0
```

The web CSP must list the API origin in `connect-src` as both `http` and `ws`,
plus the storage origin.

## 5. Readiness window

`/ready` can return `degraded` for about 10 to 12 seconds after a Redis restart
while the client reconnects. It reports `degraded` correctly in the meantime,
and `/health` stays 200. Deploy scripts must poll `/ready` and allow the window
instead of failing on the first response.

Note: the API client currently ignores the database path in `REDIS_URL` and
always uses the default database. Do not rely on `/1` or `/2` for queue
separation yet. Tracked as P4-F6.

## 6. Recurring maintenance

- Run `bun run db:reconcile-objects` monthly, review the list, then `--apply`.
- Back up the database and the object storage volume before any migration.
- Keep the previous image tags.

## 7. Rollback

- Keep the previous image tags, the database backup and the `.env` values.
- Restore the database backup and the storage volume, then redeploy the
  previous tags.
- Migrations are forward only. Do not run `db:migrate` against a database you
  cannot restore.
