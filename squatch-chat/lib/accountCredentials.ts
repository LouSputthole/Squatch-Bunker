export const MIN_USERNAME_LENGTH = 2;
export const MAX_USERNAME_LENGTH = 32;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
export const MAX_EMAIL_LENGTH = 254;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export interface AccountCredentials {
  email: string;
  username: string;
  password: string;
}

export type AccountCredentialsResult =
  | { ok: true; value: AccountCredentials }
  | { ok: false; error: string };

export function passwordValidationError(password: unknown): string | null {
  if (typeof password !== "string") return "Password is required";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  }
  return null;
}

export function parseAccountCredentials(body: unknown): AccountCredentialsResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Email, username, and password are required" };
  }

  const input = body as Record<string, unknown>;
  if (
    typeof input.email !== "string"
    || typeof input.username !== "string"
    || typeof input.password !== "string"
  ) {
    return { ok: false, error: "Email, username, and password are required" };
  }

  const email = input.email.trim().toLowerCase();
  const username = input.username.trim();
  const password = input.password;

  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "Enter a valid email address" };
  }
  if (
    username.length < MIN_USERNAME_LENGTH
    || username.length > MAX_USERNAME_LENGTH
  ) {
    return {
      ok: false,
      error: `Username must be ${MIN_USERNAME_LENGTH}-${MAX_USERNAME_LENGTH} characters`,
    };
  }

  const passwordError = passwordValidationError(password);
  if (passwordError) return { ok: false, error: passwordError };

  return {
    ok: true,
    value: { email, username, password },
  };
}
