export type CampfireEdition = "community" | "cloud";

type Environment = Record<string, string | undefined>;

export interface BillingConfiguration {
  edition: CampfireEdition;
  enabled: boolean;
  missing: string[];
}

export interface EditionValidation {
  edition: CampfireEdition;
  errors: string[];
  warnings: string[];
}

/**
 * The edition is explicit. The safe default is the free AGPL Community
 * edition; adding a Stripe key never silently changes product policy.
 */
export function getEdition(env: Environment = process.env): CampfireEdition {
  if (env.SELF_HOSTED === "true") return "community";
  const raw = env.CAMPFIRE_EDITION?.trim().toLowerCase();
  if (!raw) return "community";
  if (raw === "community" || raw === "cloud") return raw;
  throw new Error('CAMPFIRE_EDITION must be either "community" or "cloud"');
}

export function isCommunityEdition(env: Environment = process.env): boolean {
  return getEdition(env) === "community";
}

export function billingConfiguration(env: Environment = process.env): BillingConfiguration {
  const edition = getEdition(env);
  const required = [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_MONTHLY",
    "STRIPE_PRICE_YEARLY",
  ];
  const missing = required.filter((name) => !env[name]?.trim());
  return {
    edition,
    enabled: edition === "cloud" && missing.length === 0,
    missing,
  };
}

export function validateEditionConfig(env: Environment = process.env): EditionValidation {
  const edition = getEdition(env);
  const errors: string[] = [];
  const warnings: string[] = [];
  const production = env.NODE_ENV === "production";

  if (edition === "community") {
    if (env.STRIPE_SECRET_KEY || env.STRIPE_WEBHOOK_SECRET) {
      warnings.push("Stripe settings are ignored in the Community edition");
    }
    return { edition, errors, warnings };
  }

  const billing = billingConfiguration(env);
  if (!billing.enabled) {
    warnings.push(`Cloud billing is disabled; missing: ${billing.missing.join(", ")}`);
  }

  if (production) {
    if (!env.DATABASE_URL?.startsWith("postgresql://") && !env.DATABASE_URL?.startsWith("postgres://")) {
      errors.push("Cloud production requires a PostgreSQL DATABASE_URL");
    }
    const secret = env.JWT_SECRET ?? "";
    if (secret.length < 32 || secret.includes("change-me") || secret === "campfire-secret") {
      errors.push("Cloud production requires a unique JWT_SECRET of at least 32 characters");
    }
    if (!env.NEXT_PUBLIC_APP_URL?.startsWith("https://")) {
      errors.push("Cloud production requires an HTTPS NEXT_PUBLIC_APP_URL");
    }
    if (!env.RESEND_API_KEY?.trim()) {
      errors.push("Cloud production requires RESEND_API_KEY for account recovery email");
    }
    if (!env.CAMPFIRE_EMAIL_FROM?.trim()) {
      errors.push("Cloud production requires CAMPFIRE_EMAIL_FROM for account recovery email");
    }
    if (env.STRICT_CORS !== "true" || !env.CORS_ORIGINS?.trim()) {
      errors.push("Cloud production requires STRICT_CORS=true and CORS_ORIGINS");
    }
  }

  return { edition, errors, warnings };
}

export function assertEditionConfig(env: Environment = process.env): EditionValidation {
  const result = validateEditionConfig(env);
  if (result.errors.length) {
    throw new Error(`Invalid Campfire ${result.edition} configuration:\n- ${result.errors.join("\n- ")}`);
  }
  return result;
}

export const EDITION_INFO = {
  community: {
    name: "Campfire Community",
    license: "AGPL-3.0-only",
    audience: "Free self-hosting, portable use, and local communities",
  },
  cloud: {
    name: "Campfire Cloud",
    license: "AGPL-3.0-only",
    audience: "Managed multi-tenant hosting with optional paid subscriptions",
  },
} as const;
