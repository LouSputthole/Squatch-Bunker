-- AlterTable
ALTER TABLE "ServerMember" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'member';

-- Set server owners to 'owner' role
UPDATE "ServerMember" sm SET "role" = 'owner'
FROM "Server" s WHERE sm."serverId" = s."id" AND sm."userId" = s."ownerId";
