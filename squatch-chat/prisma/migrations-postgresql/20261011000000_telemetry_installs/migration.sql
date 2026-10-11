-- CreateTable
CREATE TABLE "TelemetryInstall" (
    "installId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT,
    "version" TEXT NOT NULL,
    "edition" TEXT,
    "platform" TEXT,
    "users" INTEGER,
    "activeUsers" INTEGER,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetryInstall_pkey" PRIMARY KEY ("installId")
);

-- CreateIndex
CREATE INDEX "TelemetryInstall_lastSeenAt_idx" ON "TelemetryInstall"("lastSeenAt");

-- CreateIndex
CREATE INDEX "TelemetryInstall_firstSeenAt_idx" ON "TelemetryInstall"("firstSeenAt");
