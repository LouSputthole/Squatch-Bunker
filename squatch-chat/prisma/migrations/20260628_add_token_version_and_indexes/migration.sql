-- Additive, non-destructive migration.
-- Adds User.tokenVersion (session revocation on password reset) and hot-lookup indexes.
-- Written for the PostgreSQL deploy path; the SQLite dev DB is kept in sync via `prisma db push`.

-- Session revocation counter (bumped on password reset to invalidate old JWTs)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- Hot-lookup indexes
CREATE INDEX IF NOT EXISTS "Message_channelId_idx" ON "Message"("channelId");
CREATE INDEX IF NOT EXISTS "DirectMessage_conversationId_idx" ON "DirectMessage"("conversationId");
CREATE INDEX IF NOT EXISTS "ScheduledMessage_channelId_sendAt_idx" ON "ScheduledMessage"("channelId", "sendAt");
