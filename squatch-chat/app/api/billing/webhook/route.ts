import { NextResponse } from "next/server";
import { constructWebhookEvent, handleWebhookEvent, isStripeEnabled } from "@/lib/stripe";

// In-memory idempotency guard: track Stripe event IDs we've already applied so a
// replayed or retried delivery doesn't grant/revoke premium twice. This only
// lives for the lifetime of the process, which is enough to absorb the rapid
// retries/replays Stripe (or an attacker re-POSTing a captured event) may send.
const processedEvents = new Set<string>();
const MAX_TRACKED_EVENTS = 10_000;

export async function POST(req: Request) {
  if (!isStripeEnabled()) {
    return NextResponse.json({ error: "Billing not available" }, { status: 404 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // Read the RAW body. Stripe's signature is computed over the exact bytes it
  // sent, so we must NOT parse it as JSON first or verification will fail.
  const rawBody = await req.text();

  let event: { id?: string; type: string; data: { object: Record<string, unknown> } } | null;
  try {
    event = await constructWebhookEvent(rawBody, signature);
  } catch (err) {
    // constructEvent throws on a bad/forged signature.
    console.error("[Campfire] Webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (!event) {
    // Webhook secret missing or Stripe SDK unavailable — we can't verify, so reject.
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Idempotency: silently acknowledge an event we've already processed.
  if (event.id && processedEvents.has(event.id)) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleWebhookEvent(event);
  } catch (err) {
    // Don't mark as processed — return 500 so Stripe retries the delivery.
    console.error("[Campfire] Webhook handler error:", err);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  // Record the event only after it was applied successfully.
  if (event.id) {
    if (processedEvents.size >= MAX_TRACKED_EVENTS) {
      // Bound memory: evict the oldest tracked id (Set preserves insertion order).
      const oldest = processedEvents.values().next().value;
      if (oldest !== undefined) processedEvents.delete(oldest);
    }
    processedEvents.add(event.id);
  }

  return NextResponse.json({ received: true });
}
