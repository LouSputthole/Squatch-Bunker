import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { emailConfiguration, sendPasswordResetEmail } from "@/lib/email";

const CONFIGURED_ENV = {
  RESEND_API_KEY: "re_test_key",
  CAMPFIRE_EMAIL_FROM: "Campfire <no-reply@campfire.test>",
  NEXT_PUBLIC_APP_URL: "https://chat.campfire.test/base/path",
};

describe("emailConfiguration", () => {
  it("fails closed and identifies every missing setting", () => {
    expect(emailConfiguration({})).toEqual({
      enabled: false,
      apiKey: null,
      from: null,
      appUrl: null,
      missing: [
        "RESEND_API_KEY",
        "CAMPFIRE_EMAIL_FROM",
        "NEXT_PUBLIC_APP_URL",
      ],
    });
  });

  it("rejects an invalid public app URL", () => {
    expect(
      emailConfiguration({
        ...CONFIGURED_ENV,
        NEXT_PUBLIC_APP_URL: "not a URL",
      }),
    ).toMatchObject({ enabled: false, missing: ["valid NEXT_PUBLIC_APP_URL"] });
  });
});

describe("sendPasswordResetEmail", () => {
  it("returns not-configured without contacting the provider", async () => {
    const fetchImpl = vi.fn();

    await expect(
      sendPasswordResetEmail(
        { to: "user@campfire.test", username: "Camper", token: "secret" },
        { env: {}, fetchImpl: fetchImpl as typeof fetch },
      ),
    ).resolves.toEqual({ delivered: false, reason: "not-configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends through Resend with an escaped template and token-safe idempotency key", async () => {
    const fetchImpl = vi.fn(
      async (...args: Parameters<typeof fetch>) => {
        void args;
        return new Response(null, { status: 202 });
      },
    );
    const token = "reset-token<&?";

    await expect(
      sendPasswordResetEmail(
        {
          to: "user@campfire.test",
          username: `<Camper & \"Friend\" 'Scout'>`,
          token,
        },
        { env: CONFIGURED_ENV, fetchImpl: fetchImpl as typeof fetch },
      ),
    ).resolves.toEqual({ delivered: true });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer re_test_key",
        "Content-Type": "application/json",
        "Idempotency-Key": `campfire-password-reset-${createHash("sha256")
          .update(token, "utf8")
          .digest("hex")}`,
      },
    });

    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      from: CONFIGURED_ENV.CAMPFIRE_EMAIL_FROM,
      to: ["user@campfire.test"],
      subject: "Reset your Campfire password",
    });
    expect(body.text).toContain(
      "https://chat.campfire.test/reset-password?token=reset-token%3C%26%3F",
    );
    expect(body.html).toContain(
      "&lt;Camper &amp; &quot;Friend&quot; &#39;Scout&#39;&gt;",
    );
    expect(body.html).not.toContain(`<Camper & \"Friend\" 'Scout'>`);
    expect(String(init?.headers)).not.toContain(token);
  });

  it("throws a bounded error when the provider returns a non-success status", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("provider included sensitive details", { status: 503 }),
    );

    await expect(
      sendPasswordResetEmail(
        {
          to: "user@campfire.test",
          username: "Camper",
          token: "must-not-leak",
        },
        { env: CONFIGURED_ENV, fetchImpl: fetchImpl as typeof fetch },
      ),
    ).rejects.toThrow("Password reset email provider returned HTTP 503");
  });
});
