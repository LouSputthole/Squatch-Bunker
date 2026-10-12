"use client";

import Link from "next/link";
import { createContext, useContext } from "react";

const linkClass = "text-[var(--accent)] underline underline-offset-2 hover:no-underline";

const LegalPagesContext = createContext(false);

/**
 * Whether this server is Campfire Online, decided on the server for each
 * request (app/(auth)/layout.tsx), so the consent line is there on the first
 * render and never waits on, or is lost to, a client-side /api/config fetch.
 */
export function LegalPagesProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return <LegalPagesContext.Provider value={enabled}>{children}</LegalPagesContext.Provider>;
}

export function useLegalPagesEnabled(): boolean {
  return useContext(LegalPagesContext);
}

/**
 * Campfire Online's sign-up consent line, shown above the button that creates
 * the account, in body text. Render it only where useLegalPagesEnabled() is
 * true: self-hosted servers have their own operators' rules. It carries the
 * Terms section 2 age rule. The links open a new tab so a half-filled form
 * survives.
 */
export default function LegalConsent({ action }: { action: string }) {
  return (
    <p className="text-sm text-center text-[var(--text)]">
      By {action}, you confirm that you are at least 13 (and have a parent&apos;s or guardian&apos;s permission
      if you are under 18), agree to the{" "}
      <Link href="/terms" target="_blank" className={linkClass}>Terms of Service</Link>
      , and acknowledge the{" "}
      <Link href="/privacy" target="_blank" className={linkClass}>Privacy Policy</Link>.
    </p>
  );
}
