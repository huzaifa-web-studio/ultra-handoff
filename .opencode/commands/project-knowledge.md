---
description: Load full project context (AGENTS, PRODUCT, ARCHITECTURE, RULES, design tokens) before any work
---

## Current Git Branch
!`git branch --show-current`

If the branch above is `main`, STOP and tell the user: "You are on the `main` branch. Please switch to a feature branch before working (e.g. `git checkout -b feature/...`). Never commit directly to `main`." Do not proceed with any other work until the user confirms they have switched branches.

## AGENTS.md
!`cat AGENTS.md`

## PRODUCT.md
!`cat PRODUCT.md`

## ARCHITECTURE.md
!`cat ARCHITECTURE.md`

## RULES.md
!`cat RULES.md`

## Design Tokens (packages/ui/src/styles/global.css)
!`cat packages/ui/src/styles/global.css`

## Working Instructions

You are working on the Handoff monorepo. Follow these routing rules for every task:

### Skill / Tool Routing

| Concern | Skill / Tool to Use |
|---|---|
| New frontend UI, components, pages, layouts | `@frontend-design` skill + `shadcn` MCP (browse/install components) |
| Creating or styling designs | `@frontend-design` skill |
| Backend logic, services, routes, middleware | `@sqa-engineer` skill + Elysia patterns (see ARCHITECTURE.md) |
| API endpoints / request handling | Elysia.js (`@elysia/eden` for type safety) |
| Authentication / sessions / OAuth | `better-auth` MCP + `better-auth-best-practices` skill |
| Database schema, queries, migrations | `drizzle-orm` skill + `drizzle` MCP + `postgres` MCP |
| Web app routing, data fetching, hooks | TanStack Start + Eden Treaty client |
| Styling / Tailwind classes | Tailwind CSS v4 token classes only (see design tokens above) |
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

### Do

- Use `bun` / `bunx` for all commands, never npm/yarn/pnpm
- Use design token classes (`bg-app-canvas`, `text-app-text`, etc.) — never direct colors
- Put all DB schema in `apps/api/src/db/schema.ts`
- Put business logic in `apps/api/src/services/`, routes in `apps/api/src/routes/`
- Route all API calls through `apps/web/src/lib/api.ts` (Eden Treaty)
- Comment every file and logic block
- Use conventional commit messages (`feat:`, `fix:`, `chore:`, etc.)
- Create feature branches, never commit to `main`
- Run `bun run check` and `bun run format` before finishing

### Do Not

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

Now proceed with the user's request: $ARGUMENTS
