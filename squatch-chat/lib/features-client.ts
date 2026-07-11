"use client";

import { useMemo } from "react";
import { FEATURES, type Tier, TIER_INFO } from "@/lib/features";

interface FeatureContext {
  tier: Tier;
  features: string[];
}

let cachedContext: FeatureContext | null = null;

export function setFeatureContext(tier: Tier, features: string[]) {
  cachedContext = { tier, features };
}

export function useFeatures(): FeatureContext {
  return useMemo(() => {
    if (cachedContext) return cachedContext;
    // Default: assume self-hosted (all features)
    return { tier: "self-hosted" as Tier, features: Object.keys(FEATURES) };
  }, []);
}

export function useHasFeature(feature: string): boolean {
  const { features } = useFeatures();
  return features.includes(feature);
}

export { FEATURES, TIER_INFO };
export type { Tier };
