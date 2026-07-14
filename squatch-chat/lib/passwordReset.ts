import { createHash, randomBytes } from "node:crypto";

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1_000;

export interface PasswordResetToken {
  token: string;
  digest: string;
  expiresAt: Date;
}

export function hashPasswordResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createPasswordResetToken(now = new Date()): PasswordResetToken {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    digest: hashPasswordResetToken(token),
    expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
  };
}
