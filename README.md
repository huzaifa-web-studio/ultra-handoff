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
