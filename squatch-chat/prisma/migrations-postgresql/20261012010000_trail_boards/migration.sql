-- CreateTable
CREATE TABLE "BoardTopic" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "rootMessageId" TEXT NOT NULL,
    "ownerId" TEXT,
    "title" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'open',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardTopic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoardTopic_rootMessageId_key" ON "BoardTopic"("rootMessageId");

-- CreateIndex
CREATE INDEX "BoardTopic_channelId_status_lastActivityAt_idx" ON "BoardTopic"("channelId", "status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "BoardTopic_channelId_pinned_lastActivityAt_idx" ON "BoardTopic"("channelId", "pinned", "lastActivityAt");

-- AddForeignKey
ALTER TABLE "BoardTopic" ADD CONSTRAINT "BoardTopic_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardTopic" ADD CONSTRAINT "BoardTopic_rootMessageId_fkey" FOREIGN KEY ("rootMessageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardTopic" ADD CONSTRAINT "BoardTopic_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

