# Campfire — Production Dockerfile
# Single port: Next.js + Socket.IO on one server

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

# --- Dependencies ---
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# --- Build ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

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
COPY --from=builder /app/realtime ./realtime
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/next.config.ts ./

COPY <<'EOF' /app/start.sh
#!/bin/sh
set -e
if [ -n "$DATABASE_URL" ]; then
  echo "[Campfire] Running migrations..."
  npx prisma migrate deploy 2>/dev/null || echo "[Campfire] Migrations skipped"
fi
echo "[Campfire] Starting on port ${PORT:-3000}..."
exec npx tsx server.ts
EOF
RUN chmod +x /app/start.sh

EXPOSE ${PORT:-3000}

CMD ["/app/start.sh"]
