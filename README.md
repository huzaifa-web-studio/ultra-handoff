# Handoff

A client-facing project delivery and approval platform for agencies, freelancers, and service-based teams. Handoff provides a shared workspace where service providers and clients can agree on project scope, communicate expectations, review completed work, and formally approve deliveries.

Handoff is not a project management tool. It focuses on the relationship between the team delivering the work and the client receiving it.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Bun 1.4.3 |
| Orchestration | Nx 23.2 |
| Backend | Elysia, Drizzle ORM, PostgreSQL 18 |
| Frontend | TanStack Start (React 19, Vite 8, Nitro 3) |
| UI | shadcn/ui (Tailwind CSS 4, aria-sera style) |
| Linting | Biome 2.4 |
| Containers | Docker + Docker Compose |

## Project Structure

```
ultra-handoff/
├── apps/
│   ├── api/          — Elysia REST API (Bun, port 3001)
│   └── web/          — TanStack Start SPA (React 19, port 3000)
├── packages/
│   ├── ui/           — shadcn/ui component library
│   ├── biome-config/ — shared Biome config
│   └── tsconfig/     — shared TypeScript configs
├── compose.yaml      — production Docker stack
├── compose.dev.yaml  — development Docker stack with hot reload
├── opencode.json     — MCP server config + permissions
├── RULES.md          — all coding rules (21 rules)
├── PRODUCT.md        — product overview and vision
└── AGENTS.md         — architecture, tech stack, conventions
```

## Running the Project

### With Docker (recommended)

```bash
# Development (hot reload, watch mode)
bun run docker:dev

# Production
bun run docker:prod
```

Development runs on `http://localhost:3000` (web) and `http://localhost:3001` (api). Postgres is available on port 5432.

To stop:

```bash
bun run docker:dev:down   # development
bun run docker:prod:down  # production
```

### Without Docker

```bash
# Install dependencies
bun install

# Run API (port 3001)
cd apps/api && bun run dev

# Run Web (port 3000) — in a separate terminal
cd apps/web && bun run dev
```

### Environment Setup

Copy `.env.example` to `.env` and adjust values:

```bash
cp .env.example .env
```

Key variables: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `WEB_PORT`, `API_PORT`, `VITE_API_URL`.

### Database

```bash
# Generate migration from schema changes
bun run db:generate

# Apply migrations
bun run db:migrate

# Push schema directly (dev only)
cd apps/api && bun run db:push

# Open Drizzle Studio
bun run db:studio
```

## Services

### Development stack (`compose.dev.yaml`)

| Service | Purpose | Access |
|---|---|---|
| `web` | TanStack Start SPA | http://localhost:3000 |
| `api` | Elysia REST API | http://localhost:3001 |
| `postgres` | PostgreSQL 18 database | `localhost:5432` |
| `redis` | Better Auth sessions and BullMQ job queues | `localhost:6379` |
| `seaweedfs` | S3-compatible object storage (all-in-one) | S3 API http://localhost:8333, master http://localhost:9333 |
| `mailpit` | Captures outgoing email for testing | UI http://localhost:8025, SMTP `localhost:1025` |
| `redis-insight` | Web GUI for browsing Redis | http://localhost:5540 |
| `db-studio` | Drizzle Studio database browser | https://local.drizzle.studio?host=localhost |
| `migrate` | One-shot schema migration job | n/a |

Dev-only API dashboards (mounted only when `NODE_ENV=development`):

| Dashboard | URL | Purpose |
|---|---|---|
| OpenAPI | http://localhost:3001/openapi | Interactive docs for the Elysia routes |
| Better Auth reference | http://localhost:3001/api/auth/reference | Docs for auth endpoints and plugins |
| Bull Board | http://localhost:3001/bull-board | BullMQ queue monitoring |

These dashboards are not mounted in production and return 404 there.

**Drizzle Studio:** the browser may ask for permission to access apps or devices on your local network. Allow it, otherwise the page stays on "Connecting to the Drizzle Kit on localhost:4983". Port 4983 is the local bridge; the UI itself is served from `local.drizzle.studio`.

**Mailpit:** in development the API sends email to Mailpit by default (`SMTP_HOST=mailpit`, `SMTP_PORT=1025`). Open http://localhost:8025 to read captured messages. Override `SMTP_HOST` in `.env` to test a real SMTP server.

### Production stack (`compose.yaml`)

| Service | Purpose | Exposure |
|---|---|---|
| `web` | TanStack Start SPA (Nitro) | `WEB_PORT` (3000) |
| `api` | Compiled Elysia binary | `API_PORT` (3001) |
| `postgres` | PostgreSQL 18 database | Internal only |
| `redis` | Sessions and queues | Internal only |
| `seaweedfs` | S3-compatible object storage | Internal only |
| `migrate` | Runs migrations before API starts | n/a |

Production uses two Docker networks:

- `ultra-backend`: `postgres`, `redis`, `seaweedfs`, `migrate`, `api`
- `ultra-frontend`: `api`, `web`

The `web` container can only reach `api`. It cannot resolve or connect to the database, Redis, or object storage. SeaweedFS ports are not published in production.

## Building

```bash
# Build all projects (Nx graph-aware)
bunx nx run-many -t build

# Build API only (compiles to standalone binary)
bunx nx run api:build

# Build Web only (Nitro bundle)
bunx nx run web:build
```

## Linting & Formatting

```bash
bun run check    # Biome check (lint + format)
bun run format   # Biome format --write
bun run lint     # Biome lint only
```

## Documentation

- `PRODUCT.md` — product overview, problem, solution, vision
- `AGENTS.md` — architecture, tech stack, design system, conventions
- `RULES.md` — all coding rules (21 rules)

## License

MIT
