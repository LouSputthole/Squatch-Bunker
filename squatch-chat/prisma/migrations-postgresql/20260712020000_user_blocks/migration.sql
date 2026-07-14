CREATE TABLE "UserBlock" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserBlock_no_self_check" CHECK ("blockerId" <> "blockedId")
);

CREATE UNIQUE INDEX "UserBlock_blockerId_blockedId_key"
ON "UserBlock"("blockerId", "blockedId");

CREATE INDEX "UserBlock_blockedId_idx" ON "UserBlock"("blockedId");

ALTER TABLE "UserBlock"
ADD CONSTRAINT "UserBlock_blockerId_fkey"
FOREIGN KEY ("blockerId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserBlock"
ADD CONSTRAINT "UserBlock_blockedId_fkey"
FOREIGN KEY ("blockedId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve blocks created by the legacy Friendship action. The addressee was
-- the user who chose "block" and the requester was the blocked account.
INSERT INTO "UserBlock" ("id", "blockerId", "blockedId", "createdAt")
SELECT
    'legacy-block-' || "id",
    "addresseeId",
    "requesterId",
    "updatedAt"
FROM "Friendship"
WHERE "status" = 'blocked' AND "addresseeId" <> "requesterId"
ON CONFLICT DO NOTHING;

-- A personal block and a friendship are mutually exclusive in the new model.
DELETE FROM "Friendship" WHERE "status" = 'blocked';
