import { billingConfiguration, getEdition } from "@/lib/edition";

/**
 * Owner details for the Campfire Online Terms of Service (/terms) and Privacy
 * Policy (/privacy). This is the one place to edit them: each {{NAME}} in
 * app/terms/terms.ts and app/privacy/privacy.ts is filled from the constant
 * of the same name below.
 *
 * A value still in [square brackets] is a placeholder the owner has not
 * supplied yet. The pages show a draft notice and the server logs a warning
 * while any remain. Replace each one with the real value; never guess.
 */

/** Legal name of whoever runs Campfire Online: a company, or the owner's own name. */
export const OPERATOR_NAME = "[Operator legal name]";
/** Campfire Online's address. Should match NEXT_PUBLIC_APP_URL and OFFICIAL_CLOUD_URL (lib/telemetry.ts). */
export const SERVICE_URL = "[Campfire Online web address]";
/** General, legal, privacy-request, and appeals inbox. */
export const CONTACT_EMAIL = "[Contact email]";
/** Abuse, safety, and child-safety inbox that a named person checks (docs/LAUNCH.md step 5). May equal CONTACT_EMAIL. */
export const ABUSE_EMAIL = "[Abuse email]";
/** DMCA designated agent (a person or a role). Must match the US Copyright Office agent registration. */
export const DMCA_AGENT = "[DMCA designated agent]";
/** Email for copyright notices. Must match the US Copyright Office agent registration. */
export const DMCA_EMAIL = "[DMCA email]";
/** Postal address for legal notices and DMCA mail. A PO box or registered-agent address is common. */
export const MAILING_ADDRESS = "[Mailing address]";
/**
 * US state whose law governs the Terms.
 * Suggested default: "Tennessee" (the owner appears to be based there). Confirm with counsel.
 */
export const GOVERNING_LAW = "[Governing-law state]";
/** Where disputes are heard, e.g. "<County> County, <State>". */
export const VENUE = "[County and state for disputes]";
/**
 * Representatives for people in the EU (GDPR Article 27) and the UK (UK GDPR
 * Article 27), shown in Privacy Policy section 13. A free service that EU or UK
 * residents sign up for may need them. Ask counsel (and, while at it, about the
 * EU Digital Services Act points of contact and the UK Online Safety Act), then
 * put each representative's name and address here, or "None appointed" once
 * counsel confirms none is required. Never leave this to guesswork.
 */
export const EU_REPRESENTATIVE = "[EU representative (GDPR Art. 27), or None appointed]";
export const UK_REPRESENTATIVE = "[UK representative (UK GDPR Art. 27), or None appointed]";
/** Date each document takes effect; also its "last updated" date. */
export const TERMS_EFFECTIVE_DATE = "[Terms effective date]";
export const PRIVACY_EFFECTIVE_DATE = "[Privacy Policy effective date]";

/**
 * Service providers that handle Campfire Online data (Privacy Policy section 6).
 * These are planned, not proven by the code: confirm each before launch.
 * Resend (password-reset email) is named in the policy directly, since
 * lib/email.ts proves it.
 */
export const SUBPROCESSORS = {
  /** App servers and the /app/media upload volume. Planned: Fly.io. */
  HOSTING_PROVIDER: "[Hosting provider, planned: Fly.io]",
  /** Managed PostgreSQL. Planned: Neon. */
  DATABASE_PROVIDER: "[Database provider, planned: Neon]",
  /** The TURN voice relay. Planned: a small VPS running coturn (Fly can't host TURN); name the VPS company. */
  TURN_PROVIDER: "[Voice relay host, planned: a VPS company running coturn]",
};

/** Country or region where the servers and database run (check the Fly and Neon regions). */
export const HOSTING_REGION = "[Hosting region]";
/** How long hosting and app logs are kept (the hosting provider's log retention, plus any log drain). */
export const LOG_RETENTION = "[Log retention period]";
/** Longest a backup holding deleted data survives (Neon point-in-time-recovery window, Fly volume snapshots). */
export const BACKUP_RETENTION = "[Backup retention period]";

const VALUES: Record<string, string> = {
  OPERATOR_NAME,
  SERVICE_URL,
  CONTACT_EMAIL,
  ABUSE_EMAIL,
  DMCA_AGENT,
  DMCA_EMAIL,
  MAILING_ADDRESS,
  GOVERNING_LAW,
  VENUE,
  EU_REPRESENTATIVE,
  UK_REPRESENTATIVE,
  TERMS_EFFECTIVE_DATE,
  PRIVACY_EFFECTIVE_DATE,
  ...SUBPROCESSORS,
  HOSTING_REGION,
  LOG_RETENTION,
  BACKUP_RETENTION,
};

/**
 * Our Terms and Privacy Policy cover Campfire Online only. Self-hosted servers
 * and the desktop app's "Host on this PC" are run by their own operators and
 * must never show them.
 */
export function legalPagesEnabled(): boolean {
  return getEdition() === "cloud";
}

/** Names of the constants above that are still [placeholders]. */
export function legalPlaceholdersRemaining(): string[] {
  return Object.keys(VALUES).filter((name) => /^\[.*\]$/.test(VALUES[name]));
}

/** What server.ts warns about at startup on Campfire Online. */
export function legalConfigurationWarnings(): string[] {
  if (!legalPagesEnabled()) return [];
  const warnings: string[] = [];
  const unfilled = legalPlaceholdersRemaining();
  if (unfilled.length > 0) {
    warnings.push(`/terms and /privacy still have placeholders in lib/legal.ts: ${unfilled.join(", ")}`);
  }
  if (billingConfiguration().enabled) {
    warnings.push(
      "Stripe billing is on, but Terms section 13 says nothing on Campfire Online can be bought. "
      + "Rewrite it in app/terms/terms.ts (price, renewal, cancellation, refunds) before charging anyone.",
    );
  }
  return warnings;
}

/**
 * Drop the owner-note comments and replace every {{NAME}} with its constant.
 * An unknown name is a bug in the document.
 */
export function fillLegalPlaceholders(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, "").replace(/\{\{([A-Z_]+)\}\}/g, (_, name: string) => {
    const value = VALUES[name];
    if (value === undefined) throw new Error(`Unknown legal placeholder {{${name}}}`);
    return value;
  });
}
