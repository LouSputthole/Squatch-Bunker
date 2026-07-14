// Campfire Feature Flag System
// Self-hosted: all features unlocked
// Managed service: free vs premium tiers

import { prisma } from "@/lib/db";
import { isCommunityEdition } from "@/lib/edition";
import { FEATURES, type Tier } from "@/lib/featureCatalog";
export { FEATURES, TIER_INFO, type Tier } from "@/lib/featureCatalog";

/** Check if a tier has access to a feature */
export function hasFeature(tier: Tier, feature: string): boolean {
  const def = FEATURES[feature];
  if (!def || def.status === "planned") return false;

  if (tier === "self-hosted" || isCommunityEdition()) return true;

  if (def.tier === "free") return true;
  if (def.tier === "premium" && tier === "premium") return true;

  return false;
}

/** Get all features available for a tier */
export function getFeatures(tier: Tier): string[] {
  return Object.keys(FEATURES).filter((key) => hasFeature(tier, key));
}

/** Determine the effective tier for a user */
export function getTier(user?: { tier?: string; tierExpiresAt?: Date | string | null } | null): Tier {
  if (isCommunityEdition()) return "self-hosted";
  if (!user) return "free";

  if (user.tier === "premium") {
    // Check expiry
    if (user.tierExpiresAt) {
      const expires = new Date(user.tierExpiresAt);
      if (expires < new Date()) return "free"; // expired
    }
    return "premium";
  }

  return "free";
}

/**
 * Server-side feature gate: load the user, compute their effective tier, and
 * return true iff that tier has the given feature. Use in premium API routes:
 *   if (!(await assertFeature(session.userId, 'custom_emoji')))
 *     return NextResponse.json({ error: 'Upgrade required' }, { status: 403 });
 */
export async function assertFeature(userId: string, feature: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tier: true, tierExpiresAt: true },
  });
  return hasFeature(getTier(user), feature);
}
