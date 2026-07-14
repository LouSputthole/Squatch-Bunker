# Campfire — Production Dockerfile
# Single port: Next.js + Socket.IO on one server

FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS base

# --- Dependencies ---
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts prisma.postgresql.config.ts ./
COPY scripts/postinstall.mjs scripts/generate-prisma.mjs ./scripts/
ENV CAMPFIRE_POSTINSTALL_GENERATE_ONLY=1
RUN npm ci

# --- Build ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG CAMPFIRE_BUILD_JWT_SECRET=campfire-build-only-jwt-never-use-at-runtime-0000000000000000
RUN JWT_SECRET="${CAMPFIRE_BUILD_JWT_SECRET}" npm run build

# --- Production ---
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --chown=node:node --from=builder /app/package.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/.next ./.next
COPY --chown=node:node --from=builder /app/public ./public
COPY --chown=node:node --from=builder /app/generated ./generated
COPY --chown=node:node --from=builder /app/lib ./lib
COPY --chown=node:node --from=builder /app/realtime ./realtime
COPY --chown=node:node --from=builder /app/server.ts ./
COPY --chown=node:node --from=builder /app/prisma ./prisma
COPY --chown=node:node --from=builder /app/prisma.config.ts ./
COPY --chown=node:node --from=builder /app/prisma.postgresql.config.ts ./
COPY --chown=node:node --from=builder /app/next.config.ts ./
COPY --chown=node:node --from=builder /app/tsconfig.json ./
COPY --chown=node:node --from=builder /app/scripts/preflight-postgresql.ts ./scripts/
COPY --chown=node:node --from=builder /app/scripts/verify-realtime.ts ./scripts/

COPY <<'EOF' /app/start.sh
#!/bin/sh
set -e
case "${DATABASE_URL:-}" in
  postgresql://*|postgres://*)
    ;;
  "")
    echo "[Campfire] DATABASE_URL must be set to a PostgreSQL connection URL." >&2
    exit 1
    ;;
  *)
    echo "[Campfire] The hosted container supports PostgreSQL DATABASE_URL values only." >&2
    exit 1
    ;;
esac
echo "[Campfire] Running PostgreSQL migrations..."
npm run db:migrate
echo "[Campfire] Starting on port ${PORT:-3000}..."
exec npx tsx server.ts
EOF
RUN chmod +x /app/start.sh

RUN mkdir -p /app/.next/cache /app/media/uploads /app/media/avatars /app/media/private-uploads \
    && chown -R node:node /app/.next/cache /app/media /home/node

USER node

EXPOSE ${PORT:-3000}

CMD ["/app/start.sh"]
