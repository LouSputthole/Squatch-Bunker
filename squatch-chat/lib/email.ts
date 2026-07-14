import { createHash } from "node:crypto";

type Environment = Record<string, string | undefined>;

export interface EmailConfiguration {
  enabled: boolean;
  apiKey: string | null;
  from: string | null;
  appUrl: string | null;
  missing: string[];
}

export interface PasswordResetEmail {
  to: string;
  username: string;
  token: string;
}

export interface EmailDeliveryResult {
  delivered: boolean;
  reason?: "not-configured";
}

interface SendEmailOptions {
  fetchImpl?: typeof fetch;
  env?: Environment;
}

export function emailConfiguration(
  env: Environment = process.env,
): EmailConfiguration {
  const apiKey = env.RESEND_API_KEY?.trim() || null;
  const from = env.CAMPFIRE_EMAIL_FROM?.trim() || null;
  const appUrl = env.NEXT_PUBLIC_APP_URL?.trim() || null;
  const missing: string[] = [];
  if (!apiKey) missing.push("RESEND_API_KEY");
  if (!from) missing.push("CAMPFIRE_EMAIL_FROM");
  if (!appUrl) missing.push("NEXT_PUBLIC_APP_URL");
  if (appUrl) {
    try {
      new URL(appUrl);
    } catch {
      missing.push("valid NEXT_PUBLIC_APP_URL");
    }
  }
  return {
    enabled: missing.length === 0,
    apiKey,
    from,
    appUrl,
    missing,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendPasswordResetEmail(
  message: PasswordResetEmail,
  options: SendEmailOptions = {},
): Promise<EmailDeliveryResult> {
  const config = emailConfiguration(options.env);
  if (!config.enabled || !config.apiKey || !config.from || !config.appUrl) {
    return { delivered: false, reason: "not-configured" };
  }

  const resetUrl = new URL("/reset-password", config.appUrl);
  resetUrl.searchParams.set("token", message.token);
  const safeUrl = escapeHtml(resetUrl.toString());
  const safeUsername = escapeHtml(message.username);
  const idempotencyKey = createHash("sha256")
    .update(message.token, "utf8")
    .digest("hex");
  const fetchImpl = options.fetchImpl ?? fetch;

  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `campfire-password-reset-${idempotencyKey}`,
    },
    body: JSON.stringify({
      from: config.from,
      to: [message.to],
      subject: "Reset your Campfire password",
      text: [
        `Hi ${message.username},`,
        "",
        "Use this link to reset your Campfire password:",
        resetUrl.toString(),
        "",
        "This link expires in one hour. If you did not request it, you can ignore this email.",
      ].join("\n"),
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1f2937">
          <h1 style="color:#b45309">Reset your Campfire password</h1>
          <p>Hi ${safeUsername},</p>
          <p>Use the button below to choose a new password. This link expires in one hour.</p>
          <p style="margin:28px 0">
            <a href="${safeUrl}" style="background:#d97706;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Reset password</a>
          </p>
          <p style="font-size:12px;color:#6b7280">If you did not request this, you can ignore this email.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    throw new Error(`Password reset email provider returned HTTP ${response.status}`);
  }

  return { delivered: true };
}
