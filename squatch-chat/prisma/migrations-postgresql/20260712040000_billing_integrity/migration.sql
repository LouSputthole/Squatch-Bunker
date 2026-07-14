ALTER TABLE "User"
  ADD COLUMN "billingCheckoutPendingAt" TIMESTAMP(3),
  ADD COLUMN "billingEventAt" TIMESTAMP(3);

-- Stripe objects identify one Campfire account. PostgreSQL and SQLite both
-- permit multiple NULL values in unique indexes.
CREATE UNIQUE INDEX "User_stripeCustomerId_key"
  ON "User"("stripeCustomerId");
CREATE UNIQUE INDEX "User_stripeSubscriptionId_key"
  ON "User"("stripeSubscriptionId");

CREATE INDEX "User_billingCheckoutPendingAt_idx"
  ON "User"("billingCheckoutPendingAt");
