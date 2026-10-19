# API (Elysia)

Elysia REST API running on Bun. Handles all backend logic: authentication, database queries, business rules, and data processing.

## Tech Stack

- **Runtime:** Bun 1.4.3
- **Framework:** Elysia 1.4.30
- **ORM:** Drizzle ORM 0.45.4
- **Database:** PostgreSQL 18
- **DB Driver:** postgres (postgres-js) 3.4.9

## Project Structure

```
apps/api/
├── src/
│   ├── index.ts      — app entry point, routes, health check
│   └── db/
│       ├── index.ts  — Drizzle client setup
│       └── schema.ts — database schema (users table)
├── drizzle/          — auto-generated migration files (do not edit)
├── drizzle.config.ts — Drizzle Kit configuration
├── Dockerfile        — multi-stage build (compiles to standalone binary)
└── package.json
```

## Running

```bash
# Development (hot reload on file changes)
bun run dev

# Production (runs TypeScript directly)
bun run start

# Build (compiles to standalone binary)
bun run build
```

The API runs on port 3001 by default. Override with `PORT` env var.

## Database Commands

```bash
# Generate migration from schema changes
bun run db:generate

# Apply migrations to database
bun run db:migrate

# Push schema directly (dev only, no migration file)
bun run db:push

# Open Drizzle Studio (visual DB browser)
bun run db:studio
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATABASE_URL` | — | Postgres connection string |

## Docker

The API is containerized via `apps/api/Dockerfile`. It compiles to a standalone binary (~96 MB) with no `node_modules` at runtime.

See the root `README.md` for Docker commands.

## Rules

See `RULES.md` at the project root. Key rules for this app:
- No direct SQL queries outside Drizzle ORM
- Never edit the `drizzle/` folder — use `db:generate`
- All routes must have error handling
- Comment every file and logic block
- No `console.log` in production
