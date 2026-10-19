# Web (TanStack Start)

TanStack Start SPA frontend. Client-side rendered (SPA mode), React 19, Tailwind CSS 4, shadcn/ui components, Nitro production server.

## Tech Stack

- **Framework:** TanStack Start 1.169.3 (SPA mode, no SSR)
- **React:** 19.3.1
- **Build tool:** Vite 8.3.4
- **Production server:** Nitro 3.0.260903-beta
- **Styling:** Tailwind CSS 4.3.3
- **UI:** shadcn/ui (aria-sera style, lucide icons)
- **Fonts:** Oxanium (display), Outfit (sans)

## Project Structure

```
apps/web/
├── src/
│   ├── routes/       — file-based routes (TanStack Router)
│   ├── router.tsx    — router configuration
│   └── routeTree.gen.ts — auto-generated route tree
├── public/           — static assets
├── vite.config.ts    — Vite + TanStack Start + Nitro config
├── Dockerfile        — multi-stage build (Nitro bundle)
└── package.json
```

## Running

```bash
# Development (Vite dev server with HMR)
bun run dev

# Production (Nitro server)
bun run start

# Build (generates routes + Vite build + Nitro bundle)
bun run build
```

The web app runs on port 3000 by default. Override with `PORT` env var.

## Linting & Formatting

```bash
bun run lint     # Biome lint
bun run format   # Biome format --write
bun run check    # Biome check (lint + format)
```

## Routing

File-based routing via TanStack Router. Add new routes as files in `src/routes/`. The route tree is auto-generated.

## Styling

- Tailwind CSS 4 with design tokens from `packages/ui/src/styles/global.css`
- shadcn/ui components from `packages/ui/src/components/ui/`
- Zero radius design (all `--radius-*` set to `0px`)
- Dark mode via `.dark` class

## Docker

The web app is containerized via `apps/web/Dockerfile`. It builds a Nitro bundle (`.output/`) with no `node_modules` at runtime.

See the root `README.md` for Docker commands.

## Rules

See `RULES.md` at the project root. Key rules for this app:
- SPA mode only — no SSR logic
- No backend logic — frontend only
- No standalone CSS files — Tailwind only
- Design tokens only (no direct colors/values)
- Comment every file and logic block
- No em dashes in text
- Component reuse from `packages/ui` first
