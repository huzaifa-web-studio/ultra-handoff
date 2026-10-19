# syntax=docker/dockerfile:1.7

# Keep in lockstep with apps/api/Dockerfile — same Bun as the host toolchain,
# same -slim (Debian/glibc) base so Vite/Rolldown native binaries resolve.
ARG BUN_VERSION=1.4.3

FROM oven/bun:${BUN_VERSION}-slim AS base
WORKDIR /workspace
ENV CI=1

# ---------------------------------------------------------------------------
# deps — manifest-only install, cached independently of source changes.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/biome-config/package.json ./packages/biome-config/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/ui/package.json ./packages/ui/
RUN bun install --frozen-lockfile

# ---------------------------------------------------------------------------
# dev — full install + source. Stays root on purpose: Vite writes its
# dependency-optimisation cache into node_modules/.vite.
# ---------------------------------------------------------------------------
FROM deps AS dev
COPY . .
WORKDIR /workspace/apps/web
CMD ["bun", "run", "dev"]

# ---------------------------------------------------------------------------
# builder — route tree + production bundle. Needs devDependencies (vite,
# @tanstack/router-cli), so it builds on top of the full install.
# ---------------------------------------------------------------------------
FROM deps AS builder
COPY . .
WORKDIR /workspace/apps/web
RUN bun run build

# ---------------------------------------------------------------------------
# prod-deps — runtime dependency tree for the SSR bundle.
# TanStack Start externalises react/@tanstack/* from the server build
# (only `@tanstack/start**` is noExternal), so these must ship.
# ---------------------------------------------------------------------------
FROM base AS prod-deps
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/biome-config/package.json ./packages/biome-config/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/ui/package.json ./packages/ui/
RUN bun install --frozen-lockfile --omit=dev

# ---------------------------------------------------------------------------
# runner — non-root, dist + server wrapper only.
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Both node_modules trees, for the same relative-symlink reason as the API.
COPY --from=prod-deps --chown=bun:bun /workspace/node_modules ./node_modules
COPY --from=prod-deps --chown=bun:bun /workspace/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder --chown=bun:bun /workspace/apps/web/dist ./apps/web/dist
COPY --chown=bun:bun package.json ./package.json
COPY --chown=bun:bun apps/web/package.json ./apps/web/package.json
COPY --chown=bun:bun apps/web/server.mjs ./apps/web/server.mjs
# @org/ui is a workspace dependency, symlinked into apps/web/node_modules as
# ../../../packages/ui. Vite resolves the realpath and inlines it, but copying
# the source costs three files and removes the case where it is externalised.
COPY --chown=bun:bun packages/ui ./packages/ui

WORKDIR /workspace/apps/web
USER bun
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["bun", "--eval", "fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/`).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["bun", "run", "server.mjs"]
