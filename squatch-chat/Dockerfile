# Campfire — Production Dockerfile
# Single port: Next.js + Socket.IO on one server

FROM node:22-alpine AS base

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
RUN npm run build

# --- Production ---
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/realtime ./realtime
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/prisma.postgresql.config.ts ./
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/tsconfig.json ./

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

EXPOSE ${PORT:-3000}

CMD ["/app/start.sh"]
