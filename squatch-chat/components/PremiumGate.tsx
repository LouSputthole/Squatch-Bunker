"use client";

import { useHasFeature } from "@/lib/features-client";

interface PremiumGateProps {
  feature: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export default function PremiumGate({ feature, children, fallback }: PremiumGateProps) {
  const hasAccess = useHasFeature(feature);

  if (hasAccess) return <>{children}</>;

  if (fallback) return <>{fallback}</>;

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-amber-600/10 border border-amber-600/20 rounded-lg">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400 shrink-0">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      <span className="text-xs text-amber-300">
        Premium feature — <a href="/billing" className="underline hover:text-amber-200">upgrade to unlock</a>
      </span>
    </div>
  );
}
