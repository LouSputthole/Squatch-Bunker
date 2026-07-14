"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { FeatureDefinition, Tier } from "@/lib/featureCatalog";

interface FeaturePolicy {
  edition: "community" | "cloud";
  billingEnabled: boolean;
  tier: Tier;
  features: string[];
  allFeatures: Record<string, FeatureDefinition>;
}

export default function BillingPage() {
  const [policy, setPolicy] = useState<FeaturePolicy | null>(null);
  const [loadingAction, setLoadingAction] = useState<"monthly" | "yearly" | "portal" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/features")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load plan information");
        return response.json();
      })
      .then(setPolicy)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load plan information"));
  }, []);

  const premiumFeatures = useMemo(
    () => Object.entries(policy?.allFeatures ?? {}).filter(([, feature]) =>
      feature.tier === "premium" && feature.status !== "planned"),
    [policy],
  );
  const plannedFeatures = useMemo(
    () => Object.entries(policy?.allFeatures ?? {}).filter(([, feature]) => feature.status === "planned"),
    [policy],
  );

  async function checkout(plan: "monthly" | "yearly") {
    setLoadingAction(plan);
    setError("");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start checkout");
      window.location.assign(data.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start checkout");
      setLoadingAction(null);
    }
  }

  async function openPortal() {
    setLoadingAction("portal");
    setError("");
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not open billing");
      window.location.assign(data.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open billing");
      setLoadingAction(null);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)] px-5 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-[var(--accent-2)]">Campfire editions</p>
            <h1 className="mt-1 text-3xl font-bold">Keep the fire yours</h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
              Community is free AGPL software you run. Cloud charges for managed uptime, backups, networking, and higher service limits.
            </p>
          </div>
          <Link href="/chat" className="rounded-lg border border-[var(--accent-2)]/30 px-3 py-2 text-sm text-[var(--muted)] hover:text-[var(--text)]">
            Back to chat
          </Link>
        </div>

        {!policy && !error && <p className="mt-10 text-sm text-[var(--muted)]">Reading the trail map...</p>}

        {policy?.edition === "community" ? (
          <section className="mt-10 rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-6">
            <h2 className="text-xl font-semibold">Campfire Community</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              All shipped code features are unlocked on this self-hosted instance. Billing is intentionally disabled.
            </p>
            <p className="mt-3 text-xs text-[var(--muted)]">
              Licensed AGPL-3.0-only. You control the database, uploads, domain, backups, and updates.
            </p>
          </section>
        ) : policy ? (
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <section className="rounded-2xl border border-[var(--accent-2)]/25 bg-[var(--panel)] p-6">
              <h2 className="text-xl font-semibold">Cloud Free</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">Core chat, voice, DMs, events, polls, and Campfire&apos;s social features.</p>
              <p className="mt-6 text-3xl font-bold">$0</p>
              <p className="text-xs text-[var(--muted)]">Managed account, no card required</p>
            </section>
            <section className="rounded-2xl border border-amber-400/45 bg-amber-400/10 p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Cloud Plus</h2>
                {policy.tier === "premium" && <span className="rounded-full bg-emerald-500/20 px-2 py-1 text-xs text-emerald-300">Your plan</span>}
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">Higher limits and managed extras. Prices are set in the operator&apos;s Stripe catalog.</p>
              <ul className="mt-4 space-y-1.5 text-sm">
                {premiumFeatures.map(([key, feature]) => <li key={key}>? {feature.name}</li>)}
              </ul>
              {policy.tier === "premium" ? (
                <button disabled={loadingAction !== null} onClick={() => void openPortal()} className="mt-6 w-full rounded-lg bg-amber-500 px-4 py-2.5 font-semibold text-black disabled:opacity-50">
                  {loadingAction === "portal" ? "Opening..." : "Manage billing"}
                </button>
              ) : policy.billingEnabled ? (
                <div className="mt-6 grid grid-cols-2 gap-2">
                  <button disabled={loadingAction !== null} onClick={() => void checkout("monthly")} className="rounded-lg bg-amber-500 px-3 py-2.5 text-sm font-semibold text-black disabled:opacity-50">
                    {loadingAction === "monthly" ? "Opening..." : "Choose monthly"}
                  </button>
                  <button disabled={loadingAction !== null} onClick={() => void checkout("yearly")} className="rounded-lg border border-amber-400/60 px-3 py-2.5 text-sm font-semibold text-amber-200 disabled:opacity-50">
                    {loadingAction === "yearly" ? "Opening..." : "Choose yearly"}
                  </button>
                </div>
              ) : (
                <p className="mt-6 rounded-lg bg-red-500/10 p-3 text-xs text-red-300">The operator has not finished configuring billing, so checkout is disabled.</p>
              )}
            </section>
          </div>
        ) : null}

        {policy && plannedFeatures.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Roadmap ? not included yet</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {plannedFeatures.map(([key, feature]) => <span key={key} className="rounded-full border border-[var(--accent-2)]/20 px-3 py-1 text-xs text-[var(--muted)]">{feature.name}</span>)}
            </div>
          </section>
        )}
        {error && <p role="alert" className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      </div>
    </main>
  );
}
