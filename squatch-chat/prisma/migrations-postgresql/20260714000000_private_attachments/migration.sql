CREATE TABLE "PrivateUpload" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "claimKind" TEXT,
    "claimId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    CONSTRAINT "PrivateUpload_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Message" ADD COLUMN "privateUploadId" TEXT;
ALTER TABLE "DirectMessage" ADD COLUMN "privateUploadId" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN "privateUploadId" TEXT;

CREATE UNIQUE INDEX "PrivateUpload_storageKey_key"
  ON "PrivateUpload"("storageKey");
CREATE UNIQUE INDEX "PrivateUpload_claimKind_claimId_key"
  ON "PrivateUpload"("claimKind", "claimId");
CREATE INDEX "PrivateUpload_ownerId_state_createdAt_idx"
  ON "PrivateUpload"("ownerId", "state", "createdAt");
CREATE UNIQUE INDEX "Message_privateUploadId_key"
  ON "Message"("privateUploadId");
CREATE UNIQUE INDEX "DirectMessage_privateUploadId_key"
  ON "DirectMessage"("privateUploadId");
CREATE INDEX "JournalEntry_privateUploadId_idx"
  ON "JournalEntry"("privateUploadId");

ALTER TABLE "PrivateUpload" ADD CONSTRAINT "PrivateUpload_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_privateUploadId_fkey"
  FOREIGN KEY ("privateUploadId") REFERENCES "PrivateUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_privateUploadId_fkey"
  FOREIGN KEY ("privateUploadId") REFERENCES "PrivateUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_privateUploadId_fkey"
  FOREIGN KEY ("privateUploadId") REFERENCES "PrivateUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;
