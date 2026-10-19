# Rules

This file defines the rules that all code in this repository must follow. Every AI agent, contributor, and developer working on this project is expected to read and adhere to these rules.

---

## 1. No Em Dashes

**Never use em dashes (`—`) in any text.** This includes code comments, documentation, commit messages, and user-facing strings.

Use commas, periods, or parentheses instead.

- ✅ "The server starts on port 3001."
- ❌ "The server starts on port 3001 — it runs in the background."

---

## 2. No Standalone CSS Files

**Never create `.css` files** beyond `packages/ui/src/styles/global.css`. All styling must use Tailwind CSS utility classes.

If you think a new style is needed, add it as a token in `global.css` and use the corresponding Tailwind class.

---

## 3. Design Tokens Only

**Never use direct colors (`#hex`, `rgb()`, `hsl()`) or direct values in Tailwind classes.** Always use tokens defined in `packages/ui/src/styles/global.css`.

- ✅ `bg-app-canvas`, `text-app-text`, `border-app-border`
- ❌ `bg-[#f5f2e9]`, `text-[#19382d]`, `border-[#dde2d9]`

If a new token is absolutely needed, add it to `global.css` first (in both `:root` and `@theme inline`), then use the Tailwind class.

---

## 4. Web Is Frontend Only

**No backend logic in `apps/web`.** The web app is strictly a frontend. All database queries, authentication, business logic, and server-side data processing live in `apps/api`.

- `apps/web` may use TanStack Start server functions (`createServerFn`) only as thin proxies to API endpoints.
- Never import `drizzle-orm`, `postgres`, or any database driver in `apps/web`.

---

## 5. Never Touch the `drizzle/` Folder

**Never create, edit, or delete files in `apps/api/drizzle/`.** Migrations are created exclusively via:

```bash
bun run db:generate   # generates migration from schema changes
bun run db:migrate    # applies migrations to the database
bun run db:push       # pushes schema directly (dev only)
```

The `drizzle/` folder is auto-generated. Hand-editing it will cause migration drift.

---

## 6. DRY — Do Not Repeat Yourself

**No duplicated logic.** If the same code appears in two or more places, extract it into a shared utility, hook, or package.

- Shared UI components go in `packages/ui/src/components/ui/`.
- Shared types go in a shared package or are co-located with the consuming code.
- Shared helpers go in a `lib/` or `utils/` directory.

---

## 7. Best Design Principles

**Follow the existing design system.** Use the tokens, spacing, typography, and component patterns defined in `packages/ui/src/styles/global.css` and the shadcn/ui components in `packages/ui/src/components/ui/`.

- Use semantic color tokens (`app-canvas`, `app-text`, `app-border`) not raw values.
- Follow the established component patterns — do not invent new UI patterns when an existing one works.
- Maintain consistent spacing and typography across all pages.

---

## 8. No Em Dashes in Text (Repeated for Emphasis)

This is restated because it is the most commonly violated rule. **No em dashes (`—`) anywhere.** Not in code, not in comments, not in documentation, not in commit messages, not in UI text.

---

## 9. Comment Everything

**Every file gets a header comment** explaining:
- What it is
- Why it exists
- Where it is used

**Every function, block, or section with non-obvious logic gets an inline comment** explaining the "why", not just the "what".

This is especially important in `apps/api` where business logic lives. The goal is that any developer (or AI agent) can read the code and understand the intent without guessing.

Example:
```typescript
/**
 * Health check endpoint for container orchestration.
 * Used by: Docker HEALTHCHECK, compose depends_on condition.
 * Returns: { status: "ok" } with 200 status code.
 */
.get("/health", () => ({ status: "ok" }))
```

---

## 10. No `any` Type

**Never use `any` in TypeScript.** Use proper types. If the type is truly unknown, use `unknown` and narrow it with type guards.

- ✅ `function process(data: unknown) { if (typeof data === "string") { ... } }`
- ❌ `function process(data: any) { ... }`

---

## 11. No `console.log` in Production

**No `console.log`, `console.warn`, or `console.error` in production code.** Remove all debug logging before committing. Use structured logging if needed.

---

## 12. No Hardcoded Values

**Never hardcode URLs, ports, secrets, or environment-specific values.** Always use environment variables.

- ✅ `process.env.PORT ?? 3001`
- ❌ `3001` hardcoded in source

---

## 13. Component Reuse

**Before creating a new component, check `packages/ui/src/components/ui/` for an existing one.** Reuse first. Only create new components when no existing one fits.

If a component is specific to one app, put it in `apps/<app>/src/components/`. If it's shared, put it in `packages/ui/src/components/ui/`.

---

## 14. Accessibility (a11y)

**All interactive elements must be keyboard-accessible and have proper ARIA labels.** Follow WCAG 2.2 AA standards.

- All buttons, links, and form controls must be reachable via keyboard (Tab, Enter, Space).
- All images must have `alt` text.
- All form inputs must have associated labels.
- Color contrast must meet WCAG 2.2 AA (the design tokens in `global.css` already satisfy this).
- Use semantic HTML (`<nav>`, `<main>`, `<section>`, `<article>`) instead of generic `<div>` where appropriate.

---

## 15. Error Handling

**Every async operation must handle errors explicitly.** No unhandled promise rejections.

- Use `try/catch` for all async operations.
- Return meaningful error messages to the user.
- Never swallow errors silently.

---

## 16. No Direct DOM Manipulation

**Use React state and refs.** Never use `document.querySelector`, `document.getElementById`, or direct DOM manipulation in components.

---

## 17. Import Order

**Imports must be ordered as follows:**

1. External packages (React, Elysia, etc.)
2. Internal packages (`@org/*`)
3. Relative imports (`./`, `../`)

Biome handles formatting. Run `bun run format` to auto-sort.

---

## 18. Conventional Commits

**Use conventional commit messages:**

- `feat:` — new feature
- `fix:` — bug fix
- `chore:` — maintenance, dependencies, config
- `docs:` — documentation
- `refactor:` — code restructuring without behavior change
- `test:` — adding or updating tests
- `style:` — formatting, no logic change

---

## 19. Permission Required for Docker and Chrome DevTools

**Never run Docker or Chrome DevTools commands without explicit user permission.** These are gated in `opencode.json` with `ask` permission level.

Docker commands include: `docker`, `docker compose`, `docker build`, `docker run`, etc.
Chrome DevTools MCP tools include: screenshots, DOM inspection, network requests, etc.

---

## 20. SPA Mode Awareness

**This app runs in SPA mode** (no SSR). All rendering happens on the client. Server functions (`createServerFn`) are thin proxies to API endpoints. Do not add SSR-specific logic.

---

## 21. Never Make Changes on `main`

**Before making any code changes, check the current branch** (`git branch --show-current`). If it returns `main` or `master`, **stop immediately** and tell the user:

> "You are on the `main` branch. Please create or switch to a feature branch before making changes."

Do not write, edit, or delete any files until the user confirms they are on a non-main branch. This prevents accidental direct commits to production.

---

## Enforcement

These rules are enforced by:
- **Biome** — formatting, linting, import sorting
- **TypeScript** — strict type checking
- **OpenCode permissions** — Docker and Chrome DevTools require approval
- **Code review** — manual review of PRs against these rules
