"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  AVAILABLE_FREE_FEATURES,
  FEATURES,
  type Tier,
  TIER_INFO,
} from "@/lib/featureCatalog";

interface FeatureContext {
  tier: Tier;
  features: string[];
}

let cachedContext: FeatureContext | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const FREE_FALLBACK: FeatureContext = {
  tier: "free",
  features: AVAILABLE_FREE_FEATURES,
};

export function setFeatureContext(tier: Tier, features: string[]) {
  cachedContext = { tier, features };
  for (const listener of listeners) listener();
}

export async function loadFeatureContext(): Promise<void> {
  if (cachedContext || inflight) return inflight ?? Promise.resolve();
  inflight = fetch("/api/features", { credentials: "same-origin" })
    .then(async (response) => {
      if (!response.ok) throw new Error("Feature policy unavailable");
      const data = await response.json() as { tier: Tier; features: string[] };
      setFeatureContext(data.tier, Array.isArray(data.features) ? data.features : []);
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot() {
  return cachedContext ?? FREE_FALLBACK;
}

export function useFeatures(): FeatureContext {
  const context = useSyncExternalStore(subscribe, snapshot, () => FREE_FALLBACK);
  useEffect(() => {
    void loadFeatureContext().catch(() => {
      // Fail closed at the free shipped-feature set.
    });
  }, []);
  return context;
}

export function useHasFeature(feature: string): boolean {
  const { features } = useFeatures();
  return features.includes(feature);
}

export { FEATURES, TIER_INFO };
export type { Tier };
