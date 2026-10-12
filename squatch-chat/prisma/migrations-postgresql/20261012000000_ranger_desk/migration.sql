-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assigneeId" TEXT,
ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "escalatedById" TEXT,
ADD COLUMN     "escalationNote" TEXT,
ADD COLUMN     "evidenceAttachmentName" TEXT,
ADD COLUMN     "evidenceAttachmentUrl" TEXT,
ADD COLUMN     "evidenceChannelId" TEXT,
ADD COLUMN     "evidenceChannelName" TEXT,
ADD COLUMN     "evidenceContent" TEXT,
ADD COLUMN     "evidenceMessageAt" TIMESTAMP(3),
ADD COLUMN     "resolution" TEXT,
ADD COLUMN     "resolutionNote" TEXT,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedById" TEXT,
ADD COLUMN     "serverId" TEXT;

-- CreateTable
CREATE TABLE "ReportEvent" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportAppeal" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "appellantId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ReportAppeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportEvent_reportId_createdAt_idx" ON "ReportEvent"("reportId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReportAppeal_reportId_key" ON "ReportAppeal"("reportId");

-- CreateIndex
CREATE INDEX "ReportAppeal_appellantId_status_idx" ON "ReportAppeal"("appellantId", "status");

-- CreateIndex
CREATE INDEX "Report_serverId_status_createdAt_idx" ON "Report"("serverId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_assigneeId_idx" ON "Report"("assigneeId");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportEvent" ADD CONSTRAINT "ReportEvent_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportAppeal" ADD CONSTRAINT "ReportAppeal_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportAppeal" ADD CONSTRAINT "ReportAppeal_appellantId_fkey" FOREIGN KEY ("appellantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: message reports filed before Ranger Desk learn their community and
-- evidence from the reported message, where it still exists. Reports whose
-- message is already gone stay unscoped (instance operator) as before.
UPDATE "Report" SET
    "serverId" = (SELECT "Channel"."serverId" FROM "Message" JOIN "Channel" ON "Channel"."id" = "Message"."channelId" WHERE "Message"."id" = "Report"."messageId"),
    "evidenceContent" = (SELECT "Message"."content" FROM "Message" WHERE "Message"."id" = "Report"."messageId"),
    "evidenceAttachmentName" = (SELECT "Message"."attachmentName" FROM "Message" WHERE "Message"."id" = "Report"."messageId"),
    "evidenceAttachmentUrl" = (SELECT "Message"."attachmentUrl" FROM "Message" WHERE "Message"."id" = "Report"."messageId"),
    "evidenceChannelId" = (SELECT "Message"."channelId" FROM "Message" WHERE "Message"."id" = "Report"."messageId"),
    "evidenceChannelName" = (SELECT "Channel"."name" FROM "Message" JOIN "Channel" ON "Channel"."id" = "Message"."channelId" WHERE "Message"."id" = "Report"."messageId"),
    "evidenceMessageAt" = (SELECT "Message"."createdAt" FROM "Message" WHERE "Message"."id" = "Report"."messageId")
WHERE "serverId" IS NULL
    AND "messageId" IS NOT NULL
    AND EXISTS (SELECT 1 FROM "Message" WHERE "Message"."id" = "Report"."messageId");

-- Every existing report gets its "filed" case event so histories start at the top.
INSERT INTO "ReportEvent" ("id", "reportId", "actorId", "type", "createdAt")
SELECT 'legacy-filed-' || "Report"."id", "Report"."id", "Report"."reporterId", 'filed', "Report"."createdAt"
FROM "Report"
WHERE NOT EXISTS (SELECT 1 FROM "ReportEvent" WHERE "ReportEvent"."reportId" = "Report"."id");
