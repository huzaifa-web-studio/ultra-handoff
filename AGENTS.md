<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

---

# Working Instructions (OpenCode Agent)

You are working on the **Handoff** monorepo. Follow these routing rules for every task. These rules are enforced by `RULES.md` (21 rules) — read it first.

## Skill / Tool Routing

| Concern | Skill / Tool to Use |
|---|---|
| New frontend UI, components, pages, layouts | `@frontend-design` skill + `shadcn` MCP (browse/install components) |
| Creating or styling designs | `@frontend-design` skill |
| Backend logic, services, routes, middleware | `@sqa-engineer` skill + Elysia patterns (see ARCHITECTURE.md) |
| API endpoints / request handling | Elysia.js (`@elysia/eden` for type safety) |
| Authentication / sessions / OAuth | `better-auth` MCP + `better-auth-best-practices` skill |
| Database schema, queries, migrations | `drizzle-orm` skill + `drizzle` MCP + `postgres` MCP |
| Web app routing, data fetching, hooks | TanStack Start + Eden Treaty client |
| Styling / Tailwind classes | Tailwind CSS v4 token classes only (see Design System below) |
| UI components | `shadcn-ui` skill, reuse from `packages/ui` first |
| Monorepo tasks (build, test, lint, generate) | `nx-workspace`, `nx-generate`, `nx-run-tasks` skills |
| Runtime / package management | Bun only (no npm/yarn/pnpm) |
| Containers / deployment | Docker compose files (`compose.yaml`, `compose.dev.yaml`) |
| Performance auditing | `web-perf` skill |
| Security hardening | `better-auth-security-best-practices` skill |
| Documentation | `docs` skill |
| Version control | git — conventional commits, never on `main` |
| Code quality / formatting | Biome (`bun run check`, `bun run format`) |
| Type safety | TypeScript strict, Eden Treaty (no `any` type ever) |
| Testing / QA | `sqa-engineer` skill |

## Do

- Use `bun` / `bunx` for all commands, never npm/yarn/pnpm
- Use design token classes (`bg-app-canvas`, `text-app-text`, etc.) — never direct colors
- Put all DB schema in `apps/api/src/db/schema.ts`
- Put business logic in `apps/api/src/services/`, routes in `apps/api/src/routes/`
- Route all API calls through `apps/web/src/lib/api.ts` (Eden Treaty)
- Comment every file and logic block
- Use conventional commit messages (`feat:`, `fix:`, `chore:`, etc.)
- Create feature branches, never commit to `main`
- Run `bun run check` and `bun run format` before finishing

## Do Not

- Do not use em dashes in any text
- Do not create standalone CSS files — Tailwind only
- Do not use direct colors or values in Tailwind classes
- Do not put backend logic in the web app (frontend only)
- Do not put frontend logic in the API (backend only)
- Do not edit the `drizzle/` folder — use `db:generate`
- Do not use `any` type
- Do not use `console.log` in production code
- Do not hardcode URLs, ports, or secrets
- Do not create a shared types package — use Eden Treaty
- Do not skip accessibility (WCAG 2.2 AA)
- Do not auto-trace images or use AI-generated assets without approval

---

# Project: Handoff

## Product Overview

Handoff is a client-facing project delivery and approval platform for agencies, freelancers, and service-based teams. It provides a shared workspace where service providers and clients can agree on project scope, communicate expectations, review completed work, and formally approve deliveries.

Handoff is not a project management tool. It focuses on the relationship between the team delivering the work and the client receiving it.

**Core flow:** Scope Approval (define what will be delivered → client reviews and approves) → Delivery Approval (submit deliverables → client reviews and accepts or requests corrections).

**Who it's for:** Web dev agencies, design studios, freelancers, digital service providers, small teams managing multiple client engagements.

**Product principles:** Clarity, Accountability, Transparency, Simplicity, Trust.

**Vision:** Make every client engagement clear, accountable, and confidently delivered.

See `PRODUCT.md` for the full product document. See `ARCHITECTURE.md` for the full architecture document.

---

## Architecture

```
ultra-handoff/
├── apps/
│   ├── api/          — Elysia (Bun) backend: REST API, Drizzle ORM, Postgres
│   └── web/          — TanStack Start (React 19, Vite 8, Nitro 3) SPA frontend
├── packages/
│   ├── ui/           — shadcn/ui component library (Tailwind v4, aria-sera style)
│   ├── biome-config/ — shared Biome config
│   └── tsconfig/     — shared TypeScript configs
├── compose.yaml      — production Docker stack (project: ultra)
├── compose.dev.yaml  — development Docker stack with watch (project: ultra-dev)
├── opencode.json     — MCP server config + permissions
├── RULES.md          — all coding rules (21 rules)
└── PRODUCT.md        — product overview and vision
```

### Apps

- **`apps/api`** — Elysia REST API on Bun. Routes, Drizzle ORM schema, migrations. Compiles to a standalone binary for production. Runs on port 3001.
- **`apps/web`** — TanStack Start SPA (React 19, Vite 8, Nitro 3 beta). Client-side rendered. Runs on port 3000.

### Packages

- **`packages/ui`** — shadcn/ui component library. Tailwind v4, `aria-sera` style, lucide icons. Oxanium (display) + Outfit (sans) fonts. All design tokens live in `packages/ui/src/styles/global.css`.
- **`packages/biome-config`** — shared Biome configuration.
- **`packages/tsconfig`** — shared TypeScript configs (base, node, web).

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
| Production server | Nitro | 3.0.260903-beta |
| Styling | Tailwind CSS | 4.3.3 |
| UI library | shadcn/ui | aria-sera style |
| Linter/Formatter | Biome | 2.4.5 (→ 2.5.15) |
| TypeScript | TypeScript | 6.0.3 (→ 7.0.2 available) |
| Container base | oven/bun | 1.4.3-slim (Debian 13 trixie) |

---

## Design System

All design tokens are defined in `packages/ui/src/styles/global.css`. This is the single source of truth for colors, typography, spacing, and radius.

- **Zero radius** — all `--radius-*` values are `0px`.
- **Tailwind v4** with `@theme inline` — tokens map to CSS custom properties.
- **Dark mode** via `.dark` class with overridden CSS variables.
- **Brand colors:** forest (`#19382d`), gold (`#d8b65c`), ivory (`#f5f2e9`), graphite (`#29332f`), sage (`#a4b4a7`).
- **App colors:** canvas, panel, text, border, focus, action, attention, etc.
- **Status colors:** success, warning, danger, info, neutral (each with bg variant).

**Rule:** Never use direct colors or values in Tailwind classes. Always use token classes (e.g., `bg-app-canvas`, `text-app-text`, `border-app-border`).

See `RULES.md` Rule 3 for full details.

---

## Rules

All coding rules are defined in `RULES.md` (21 rules). Key rules:

- No em dashes in text
- No standalone CSS files — Tailwind only
- Design tokens only (no direct colors/values)
- Web = frontend only, API = backend
- Never touch `drizzle/` folder — migrations via drizzle-kit
- DRY — no duplicated logic
- No `any` type
- No `console.log` in production
- No hardcoded URLs/ports/secrets
- Component reuse first
- Accessibility (WCAG 2.2 AA)
- Comment every file and logic block
- Conventional commits
- Never make changes on `main` branch

---

## Docker Setup

| File | Purpose |
|---|---|
| `compose.yaml` | Production stack (project: `ultra`) |
| `compose.dev.yaml` | Development stack with watch (project: `ultra-dev`) |
| `apps/api/Dockerfile` | API — compiles to standalone binary |
| `apps/web/Dockerfile` | Web — Nitro bundle, no node_modules at runtime |

**Commands:**
- `bun run docker:prod` — production
- `bun run docker:dev` — development with hot reload
- `bun run docker:prod:down` / `bun run docker:dev:down` — stop

**Note:** Docker commands require user approval (gated in `opencode.json`).

---

## AI / MCP Setup

`opencode.json` configures 6 MCP servers:

| Server | Type | Purpose |
|---|---|---|
| `nx-mcp` | local | Nx workspace queries, generators, tasks |
| `drizzle` | local | Drizzle Kit migration tools (drizzle-kit is a devDep) |
| `better-auth` | remote | Better Auth docs search |
| `chrome-devtools` | local | Browser debugging (requires approval) |
| `shadcn` | local | Component browsing/installation |
| `postgres` | local | Direct SQL access to dev DB |

**Skills** are in `.agents/skills/` — includes drizzle-orm, shadcn-ui, better-auth-*, ux-*, frontend-design, motion-design, web-perf, lint-check, etc.

**Permissions:** Docker commands and Chrome DevTools require explicit approval.

---

## Key Conventions

- **SPA mode** — no SSR. All rendering on client. Server functions are thin proxies to API.
- **Conventional commits** — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `style:`
- **Import order** — external → internal (`@org/*`) → relative
- **No em dashes** in any text
- **Comment everything** — file headers + logic blocks
- **Never commit to `main`** — always use a feature branch
- **Biome** handles formatting, linting, import sorting. Run `bun run format` and `bun run check`.
- **Nx** for task running: `bunx nx run-many -t build`, `bunx nx run api:build`, etc.
