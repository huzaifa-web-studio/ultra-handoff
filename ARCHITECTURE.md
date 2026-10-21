# Architecture

This document describes the architecture of the Handoff monorepo. For coding rules, see `RULES.md`. For product context, see `PRODUCT.md`.

---

## Overview

Handoff is a full-stack TypeScript monorepo using Bun as the runtime and Nx as the orchestrator. The backend is an Elysia REST API that compiles to a standalone binary. The frontend is a TanStack Start SPA (client-side rendered, no SSR) that runs on Nitro.

**End-to-end type safety** is provided by Elysia's Eden Treaty — no code generation, no shared types package. The API exports `type App = typeof app`, and the frontend imports it as a type-only dependency.

---

## Directory Structure

```
ultra-handoff/
├── apps/
│   ├── api/                    # Backend (Elysia, Bun)
│   │   └── src/
│   │       ├── index.ts        # App entry, route registration, type export
│   │       ├── db/
│   │       │   ├── index.ts    # Drizzle client
│   │       │   └── schema.ts   # Database schema (single source of truth)
│   │       ├── routes/         # Route handlers (one file per resource)
│   │       ├── services/       # Business logic (no HTTP concerns)
│   │       ├── middleware/     # Auth, logging, error handling
│   │       └── lib/            # Shared utilities (validation, helpers)
│   └── web/                    # Frontend (TanStack Start, React 19)
│       └── src/
│           ├── routes/         # File-based routes (TanStack Router)
│           ├── components/     # Shared app-specific components (used by 2+ features)
│           ├── features/       # Feature modules: each owns its components, hooks, store, api calls
│           │   └── <feature>/
│           │       ├── api.ts       # Feature API calls (endpoints, fetch wrappers)
│           │       ├── store.ts     # Feature state (TanStack Store)
│           │       ├── hooks.ts     # Feature hooks
│           │       └── *.tsx        # Feature components
│           ├── hooks/          # Shared custom React hooks
│           ├── lib/
│           │   ├── api.ts      # Eden Treaty client (all API calls go here)
│           │   └── utils.ts    # Helpers
│           └── types/          # Web-specific types (extends API types)
├── packages/
│   ├── ui/                     # shadcn/ui component library
│   ├── biome-config/           # Shared Biome config
│   └── tsconfig/               # Shared TypeScript configs
├── compose.yaml                # Production Docker stack (project: ultra)
├── compose.dev.yaml            # Development Docker stack with watch (project: ultra-dev)
├── opencode.json               # MCP server config + permissions
├── RULES.md                    # All coding rules (21 rules)
├── PRODUCT.md                  # Product overview and vision
├── AGENTS.md                   # Architecture, tech stack, conventions
└── README.md                   # Project overview and quick start
```

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Bun | 1.4.3 (isolated linker) |
| Orchestration | Nx | 23.2 |
| Backend framework | Elysia | 1.4.30 |
| ORM | Drizzle ORM | 0.45.4 |
| Database | PostgreSQL | 18.6 |
| DB driver | postgres (postgres-js) | 3.4.9 |
| Frontend framework | TanStack Start | 1.169.3 |
| React | React | 19.3.1 |
| Build tool | Vite | 8.3.4 |
| Production server (web) | Nitro | 3.0.260903-beta |
| Styling | Tailwind CSS | 4.3.3 |
| UI library | shadcn/ui | aria-sera style |
| Linter/Formatter | Biome | 2.4.5 |
| TypeScript | TypeScript | 6.0.3 |
| Container base | oven/bun | 1.4.3-slim (Debian 13 trixie) |

---

## Type Safety — Eden Treaty

End-to-end type safety is provided by Elysia's Eden Treaty (`@elysia/eden`). No code generation, no shared types package.

### Backend (apps/api/src/index.ts)

```typescript
const app = new Elysia()
  .get("/", () => "Hello Elysia")
  .get("/health", () => ({ status: "ok" }))
  .get("/users", async () => db.select().from(users))
  .listen({ port, hostname });

export type App = typeof app;  // export the type for frontend consumption
```

### Frontend (apps/web/src/lib/api.ts)

```typescript
import { treaty } from "@elysia/eden";
import type { App } from "@org/api";  // type-only import, erased at compile time

export const api = treaty<App>("http://localhost:3001");
```

### Usage in components

```typescript
const { data, error } = await api.users.get();
// data: { id: number; name: string; email: string; createdAt: Date }[]
// error: typed by status code (400, 401, 404, etc.)
```

### How the type import works

1. `@org/api` is added to `apps/web/package.json` as a devDependency (`workspace:*`).
2. The API's `package.json` has `"types": "src/index.ts"` so TypeScript resolves the `App` type.
3. Bun's isolated linker creates the workspace symlink.
4. The import is `import type` — completely erased at compile time. The web bundle has zero runtime dependency on the API.

---

## Data Flow

```
Browser (React component)
  │
  ▼
apps/web/src/lib/api.ts  (Eden Treaty client)
  │  HTTP fetch to localhost:3001
  ▼
apps/api/src/index.ts    (Elysia app)
  │  route handler
  ▼
apps/api/src/services/   (business logic)
  │
  ▼
apps/api/src/db/         (Drizzle ORM)
  │
  ▼
PostgreSQL 18
```

### Request/Response Cycle

1. Component calls `api.users.get()` (typed by Eden Treaty).
2. Treaty serializes the request and sends an HTTP fetch to the API.
3. Elysia route handler receives the request, validates input.
4. Service layer executes business logic.
5. Drizzle ORM queries PostgreSQL.
6. Response flows back through the same chain, fully typed.

---

## Module Boundaries

| Concern | Location | Rule |
|---|---|---|
| Database schema | `apps/api/src/db/schema.ts` | Only place for DB table definitions |
| Business logic | `apps/api/src/services/` | No HTTP concerns (no request/response objects) |
| HTTP routes | `apps/api/src/routes/` | Thin handlers, delegate to services |
| Validation | `apps/api/src/lib/validation.ts` | Zod schemas for request validation |
| Shared UI components | `packages/ui/src/components/ui/` | Reusable across apps |
| Shared app-specific components | `apps/web/src/components/` | Used by 2+ features, web only |
| Feature modules | `apps/web/src/features/<feature>/` | Each feature owns its components, hooks, store, and API calls |
| Custom hooks (shared) | `apps/web/src/hooks/` | React hooks shared across features |
| API client | `apps/web/src/lib/api.ts` | All API calls go through here |
| Web-specific types | `apps/web/src/types/` | Extends API types if needed |

### Rules

- **No shared runtime code between apps.** Only types are shared via Eden Treaty. Apps never import from each other's source code.
- **Database is single source of truth.** Drizzle schema is the canonical data model. Types are derived via `$inferSelect` and `$inferInsert`.
- **No direct DB access from web.** All data flows through the API.

---

## Authentication Flow (Planned)

When authentication is added:

1. Better Auth will be integrated into the Elysia API (`apps/api`).
2. The web app will use Better Auth's client SDK for session management.
3. Protected routes in TanStack Start will check auth state before rendering.
4. API routes will use middleware to verify auth tokens.

---

## Organization Switch Safety

> **IMPORTANT:** Every change of the active organization must go through `useSwitchOrganization` in `apps/web/src/features/organization/switch.ts`. Never call `authClient.organization.setActive` directly. Long running organization work must be wrapped with `beginOrganizationOperation`.

Better Auth stores `activeOrganizationId` on the shared session, not per tab. Two tabs therefore share one active organization, and a long operation in one tab can be interrupted when the user switches organization in another tab.

### Operation registry

`apps/web/src/features/organization/switch-guard.ts` records long running operations in localStorage:

- One key per operation, never one shared registry key, so two tabs starting at the same time cannot overwrite each other.
- Every entry carries `organizationId`, a user facing `reason`, `startedAt` and `expiresAt`.
- A heartbeat refreshes `expiresAt` while the operation runs.
- Expired entries are pruned on read, so a crashed or closed tab stops blocking after the TTL.
- The block is scoped to the organization that owns the operation. An operation in one workspace never blocks a switch between two other workspaces.
- Only leaving the busy workspace is blocked. Entering it from another workspace is not dangerous for the operation.

### Guarded flows

- The organization switcher.
- Creating an organization, specifically the switch that follows it.
- Leaving an organization.
- Deleting an organization.
- Logo upload and removal.

The guard is evaluated when the user acts. The switcher and create flow call `useSwitchOrganization`; leaving and deleting call `getBlockingOperation` first. A blocked action opens `SwitchBlockedDialog` with the operation's reason instead of proceeding.

### Rules for new features

Wrap any long running organization operation:

```ts
const operation = beginOrganizationOperation({
  organizationId,
  organizationSlug,
  reason: "Sending invitations to 12 people",
});

try {
  await doWork();
} finally {
  operation.end();
}
```

- Use `useSwitchOrganization` for every active organization change, including accepting an invitation.
- Always pass an explicit `organizationId` to organization scoped mutations. The guard is a UX safety net, not the data correctness mechanism.
- Move bulk work to a server job when it must survive a tab reload, a crash, or another device. localStorage is local to one browser profile.
- Keep the `reason` user facing. It is shown in the blocked dialog.

### Limits

- The registry is browser local, not cross device.
- It does not replace server side authorization.
- A switch that bypasses the helper bypasses the guard.

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────┐
│  Docker Compose (project: ultra)                │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ postgres │  │ migrate  │  │    api        │  │
│  │ (18.6)   │  │ (one-shot│  │ (compiled    │  │
│  │          │  │  job)     │  │  binary)     │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       │             │               │          │
│       └─────────────┴───────────────┘          │
│                     │                          │
│              ┌──────┴──────┐                   │
│              │     web     │                   │
│              │  (Nitro)    │                   │
│              └─────────────┘                   │
└─────────────────────────────────────────────────┘
```

- **API:** Single compiled binary (~96 MB), no node_modules, runs as non-root `bun` user.
- **Web:** Nitro bundle (`.output/`), no node_modules, serves SPA shell + static assets.
- **Postgres:** Official `postgres:18.6-alpine3.24` image with named volume.
- **Migrate:** One-shot job using the `dev` stage (needs drizzle-kit), runs before API starts.

---

## Development Workflow

1. `bun run docker:dev` — starts all services with hot reload.
2. Edit source files → Compose `develop.watch` syncs changes into containers.
3. Edit `package.json` or `bun.lock` → triggers image rebuild (deps layer cached).
4. `bun run db:generate` — generate migration from schema changes.
5. `bun run db:migrate` — apply migrations (runs automatically in dev compose).
6. `bun run db:studio` — open Drizzle Studio for visual DB browsing.

### Local development (without Docker)

```bash
bun install
cd apps/api && bun run dev    # port 3001
cd apps/web && bun run dev    # port 3000
```

---

## Conventions

- **SPA mode** — no SSR. All rendering on client. Server functions are thin proxies.
- **Conventional commits** — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `style:`
- **Import order** — external → internal (`@org/*`) → relative
- **No em dashes** in any text
- **Comment everything** — file headers + logic blocks
- **Never commit to `main`** — always use a feature branch
- **Biome** handles formatting, linting, import sorting
- **Nx** for task running: `bunx nx run-many -t build`, `bunx nx run api:build`
- **Eden Treaty** for type safety — no shared types package, no code generation
