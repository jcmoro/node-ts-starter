# syntax=docker/dockerfile:1.7
#
# Backend image — Node 22 alpine, multi-stage, non-root user, tini as PID 1.
#
# Stages:
#   deps    → installs only production dependencies (npm ci --omit=dev)
#   runtime → final image, copies node_modules + source, runs with strip-types
#
# Build context: repository root. We replicate the monorepo layout inside the
# image so that relative paths (e.g. ../../../../migrations/ from migrate.ts)
# resolve correctly inside the container.

ARG NODE_VERSION=22-alpine

# ---------- deps ----------
FROM node:${NODE_VERSION} AS deps

WORKDIR /app/services/node-api
COPY services/node-api/package.json services/node-api/package-lock.json ./

# BuildKit cache mount: persists npm cache across builds for fast rebuilds.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# ---------- runtime ----------
FROM node:${NODE_VERSION} AS runtime

# tini gives us a real PID 1 (handles signals, reaps zombies). curl for healthchecks.
RUN apk add --no-cache tini curl

# Create an unprivileged user to run the app.
RUN addgroup -g 1001 -S nodejs && \
    adduser  -S app -u 1001 -G nodejs && \
    mkdir -p /data && \
    chown -R app:nodejs /data

WORKDIR /app/services/node-api
COPY --chown=app:nodejs --from=deps /app/services/node-api/node_modules ./node_modules
COPY --chown=app:nodejs services/node-api/package.json ./
COPY --chown=app:nodejs services/node-api/src ./src
# Migrations live at the repo root and are shared between APIs.
COPY --chown=app:nodejs migrations /app/migrations

USER app

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/users.db \
    LOG_LEVEL=info

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:3000/ready || exit 1

LABEL org.opencontainers.image.title="node-ts-starter-api" \
      org.opencontainers.image.description="Hono backend (TypeScript, SQLite/Postgres)" \
      org.opencontainers.image.source="https://github.com/your/node-ts-starter" \
      org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--experimental-strip-types", "--experimental-sqlite", "--import", "./src/tracing.ts", "src/index.ts"]
