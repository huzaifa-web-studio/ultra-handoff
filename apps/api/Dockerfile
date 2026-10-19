# syntax=docker/dockerfile:1.7

# Pinned to the exact Bun release that produced bun.lock (1.4.3 is also
# oven/bun:1 today). Host and container run identical Bun, so there is no
# lockfile or feature skew between `bun run dev` and the containers.
# -slim is the Debian 13 (trixie) variant, i.e. glibc.
ARG BUN_VERSION=1.4.3

FROM oven/bun:${BUN_VERSION}-slim AS base
WORKDIR /workspace
ENV CI=1

# ---------------------------------------------------------------------------
# deps — manifest-only install. Cached until a package.json or bun.lock
# changes, so editing source never re-downloads the dependency tree.
# Every workspace manifest is required: bun.lock is a single root lockfile.
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
# dev — full install + source, running the TypeScript directly.
# Deliberately stays root: Bun and Vite write caches into node_modules, which
# a non-root user cannot create. Also used by the `migrate` job, which needs
# drizzle-kit (a devDependency, absent from the runtime image by design).
# ---------------------------------------------------------------------------
FROM deps AS dev
COPY . .
WORKDIR /workspace/apps/api
CMD ["bun", "run", "dev"]

# ---------------------------------------------------------------------------
# builder — standalone executable.
#
# --compile bundles the source, every imported package (elysia, drizzle-orm,
# postgres) and the Bun runtime into one file. Reading, resolving,
# transpiling and parsing move from startup to build time: faster boot, lower
# steady-state memory, and a runtime image with no node_modules at all.
#
# No --target: Bun compiles for the current platform, which inside a build is
# the image's own platform, so it is never cross-compiled by mistake.
#
# --minify  smaller binary
# --sourcemap  stack traces still point at the original TypeScript
#           (note: this embeds your source in the binary — do not compile
#           secrets or private code you would not ship)
# --bytecode  JavaScriptCore bytecode is compiled at build time too, so the
#           engine skips a parse pass on boot
# ---------------------------------------------------------------------------
FROM deps AS builder
COPY . .
WORKDIR /workspace/apps/api
RUN bun run build

# ---------------------------------------------------------------------------
# runner — the binary, and nothing else. No node_modules, no source, no
# package.json.
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

# Destination is resolved against the WORKDIR in effect *here* (/workspace),
# not the WORKDIR set on the next line — so the path is written out in full.
COPY --from=builder --chown=bun:bun /workspace/apps/api/dist/api ./apps/api/dist/api

WORKDIR /workspace/apps/api
USER bun
EXPOSE 3001

# The base image ships a healthcheck-capable Bun, so this costs nothing even
# though the binary itself has no probe mode.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "--eval", "fetch(`http://127.0.0.1:${process.env.PORT ?? 3001}/health`).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

# ENTRYPOINT, not CMD: oven/bun's entrypoint script prepends `bun` to any CMD
# that is not a bare command name, which would turn this into
# `bun /workspace/apps/api/dist/api`. As the entrypoint the binary is also
# PID 1 and receives SIGTERM directly for a clean shutdown.
ENTRYPOINT ["/workspace/apps/api/dist/api"]
