import { createHash, timingSafeEqual } from "node:crypto";

type Environment = Record<string, string | undefined>;

export const BETA_ACCESS_CODE_ENV = "CAMPFIRE_BETA_ACCESS_CODE";
export const MIN_BETA_ACCESS_CODE_LENGTH = 16;

function configuredCode(env: Environment): string | null {
  const code = env[BETA_ACCESS_CODE_ENV];
  return code && code.length > 0 ? code : null;
}

export function betaAccessRequired(env: Environment = process.env): boolean {
  return configuredCode(env) !== null;
}

export function betaAccessAllowed(
  candidate: unknown,
  env: Environment = process.env,
): boolean {
  const expected = configuredCode(env);
  if (!expected) return true;
  if (typeof candidate !== "string") return false;

  const expectedDigest = createHash("sha256").update(expected).digest();
  const candidateDigest = createHash("sha256").update(candidate).digest();
  return timingSafeEqual(expectedDigest, candidateDigest);
}

export function assertBetaAccessConfig(
  env: Environment = process.env,
): void {
  const code = configuredCode(env);
  if (code && code.length < MIN_BETA_ACCESS_CODE_LENGTH) {
    throw new Error(
      `${BETA_ACCESS_CODE_ENV} must contain at least ${MIN_BETA_ACCESS_CODE_LENGTH} characters when configured.`,
    );
  }

  if (
    code &&
    (env.GITHUB_CLIENT_ID ||
      env.GITHUB_CLIENT_SECRET ||
      env.GOOGLE_CLIENT_ID ||
      env.GOOGLE_CLIENT_SECRET)
  ) {
    throw new Error(
      BETA_ACCESS_CODE_ENV + " cannot be combined with OAuth providers because OAuth sign-up would bypass the invited-beta gate.",
    );
  }
}
