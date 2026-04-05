# SquatchChat — Production Dockerfile
# Builds both the Next.js app and the Socket.IO realtime server

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

# Copy everything needed at runtime
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/realtime ./realtime
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/next.config.ts ./

# Start script: migrations + realtime server + Next.js
COPY <<'EOF' /app/start.sh
#!/bin/sh
set -e

# Run migrations if DATABASE_URL is set
if [ -n "$DATABASE_URL" ]; then
  echo "[SquatchChat] Running database migrations..."
  npx prisma migrate deploy 2>/dev/null || echo "[SquatchChat] Migrations skipped"
fi

echo "[SquatchChat] Starting realtime server on port ${SOCKET_PORT:-3001}..."
npx tsx realtime/server.ts &

echo "[SquatchChat] Starting Next.js on port ${PORT:-3000}..."
exec npx next start -p ${PORT:-3000}
EOF
RUN chmod +x /app/start.sh

EXPOSE 3000 3001

CMD ["/app/start.sh"]
