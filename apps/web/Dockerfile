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
# Vite inlines `import.meta.env.VITE_API_URL` into the client bundle, so the
# value has to exist at build time. A runtime environment variable alone would
# leave production pointing at the localhost fallback.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN bun run build

# ---------------------------------------------------------------------------
# runner — Nitro bundle only. No node_modules, no source, no server.mjs:
# Nitro's .output/server/index.mjs is a self-contained listening server that
# already serves .output/public as static assets.
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY --from=builder --chown=bun:bun /workspace/apps/web/.output ./apps/web/.output

WORKDIR /workspace/apps/web
USER bun
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["bun", "--eval", "fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/`).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["bun", "run", ".output/server/index.mjs"]
