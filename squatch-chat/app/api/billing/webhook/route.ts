import { NextResponse } from "next/server";
import { constructWebhookEvent, handleWebhookEvent, isStripeEnabled } from "@/lib/stripe";
import { claimEvent, completeEvent, releaseEvent } from "@/lib/webhook-idempotency";

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

  // Idempotency (DB-backed — survives restarts, works across nodes): claim
  // the event id before touching billing state.
  if (event.id) {
    const claim = await claimEvent(event.id);
    if (claim === "duplicate") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    if (claim === "in-flight") {
      // Another delivery of this event is mid-handler; let Stripe retry later.
      return NextResponse.json({ error: "Event is being processed" }, { status: 409 });
    }
  }

  try {
    await handleWebhookEvent(event);
  } catch (err) {
    // Release the claim and return 500 so Stripe retries the delivery.
    console.error("[Campfire] Webhook handler error:", err);
    if (event.id) await releaseEvent(event.id);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  if (event.id) await completeEvent(event.id);

  return NextResponse.json({ received: true });
}
