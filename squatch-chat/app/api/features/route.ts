import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getTier, getFeatures, FEATURES, TIER_INFO } from "@/lib/features";

export async function GET() {
  const session = await getSession();

  let user = null;
  if (session) {
    try {
      const { prisma } = await import("@/lib/db");
      user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { tier: true, tierExpiresAt: true },
      });
    } catch { /* db unavailable, default to free */ }
  }

  const tier = getTier(user);
  const features = getFeatures(tier);

  return NextResponse.json({
    tier,
    tierInfo: TIER_INFO[tier],
    features,
    allFeatures: FEATURES,
  });
}
