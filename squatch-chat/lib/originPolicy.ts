import { isIP } from "node:net";

export interface OriginPolicyEnvironment {
  corsOrigins?: string;
  appUrl?: string;
  strictCors?: string;
}

export interface OriginPolicy {
  selfHosted: boolean;
  allowedOrigins: ReadonlySet<string>;
  isOriginAllowed: (origin: string | undefined) => boolean;
}

export function isStrictCorsEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function isPrivateLanOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    if (hostname === "localhost") return true;

    const ipVersion = isIP(hostname);
    if (ipVersion === 4) {
      const [first, second] = hostname.split(".").map(Number);
      return (
        first === 10 ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) ||
        (first === 169 && second === 254) ||
        first === 127
      );
    }
    if (ipVersion === 6) {
      const normalized = hostname.toLowerCase();
      return (
        normalized === "::1" ||
        /^(?:fc|fd)[0-9a-f]{2}:/.test(normalized) ||
        /^fe[89ab][0-9a-f]:/.test(normalized)
      );
    }
    return false;
  } catch {
    return false;
  }
}

function normalizeHttpOrigin(origin: string): string {
  const parsed = new URL(origin);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported origin protocol: ${parsed.protocol}`);
  }
  return parsed.origin;
}

export function createOriginPolicy(
  environment: OriginPolicyEnvironment,
): OriginPolicy {
  const configuredOrigins = environment.corsOrigins?.trim() ?? "";
  const selfHosted =
    configuredOrigins.length === 0 &&
    !isStrictCorsEnabled(environment.strictCors);
  const allowedOrigins = new Set<string>();
  const rawOrigins =
    configuredOrigins || environment.appUrl?.trim() || "http://localhost:3000";

  for (const origin of rawOrigins
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean)) {
    try {
      allowedOrigins.add(normalizeHttpOrigin(origin));
    } catch {
      throw new Error(`[Campfire] Invalid CORS origin: ${origin}`);
    }
  }

  return {
    selfHosted,
    allowedOrigins,
    isOriginAllowed(origin) {
      // Native clients and server-to-server callers have no ambient browser
      // cookie attached through an Origin header, so they carry no CSWSH risk.
      if (!origin) return true;
      let normalizedOrigin: string;
      try {
        normalizedOrigin = normalizeHttpOrigin(origin);
      } catch {
        return false;
      }
      if (allowedOrigins.has(normalizedOrigin)) return true;
      return selfHosted && isPrivateLanOrigin(normalizedOrigin);
    },
  };
}
