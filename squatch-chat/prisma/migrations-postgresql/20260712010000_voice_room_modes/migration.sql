ALTER TABLE "Channel"
ADD COLUMN "roomMode" TEXT NOT NULL DEFAULT 'hangout',
ADD COLUMN "roomScene" TEXT NOT NULL DEFAULT 'campfire';
