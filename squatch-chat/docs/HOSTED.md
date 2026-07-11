# Campfire hosted edition — product spec

One codebase, two distributions (locked decisions: AGPL-3.0, single repo,
this one spec):

| | **Self-host (free)** | **Hosted (paid)** |
|---|---|---|
| Who runs it | You | Us |
| Database | SQLite (default) | Postgres |
| Features | Everything unlocked (`SELF_HOSTED` / no Stripe key) | Free tier + Premium subscription |
| Voice | WebRTC mesh (~6/room) | Mesh now → SFU (the moat) |
| Setup | `npm install && npm run host` | Zero — sign up and go |

The hosted edition sells **ops, not features**: always-on, backups, TLS,
TURN that works, voice that scales past a mesh, and no VPS homework. The
AGPL keeps the code open either way; convenience is the product.

## Architecture: one multi-tenant instance

The schema is already multi-tenant the way Discord is: one deployment, many
communities ("servers"), global user accounts, per-user billing
(`User.tier` / `stripeCustomerId` / `subscriptionStatus` — all present).
Hosted = one deployment of exactly this code with:

- `DATABASE_URL=postgresql://…` (the Prisma adapter seam already switches)
- `STRIPE_SECRET_KEY` set → billing activates, `SELF_HOSTED` unset
- `STRICT_CORS=true`, TURN creds, HTTPS per docs/DEPLOY.md

Explicitly rejected for v1: instance-per-customer hosting (Mastodon-host
model). It multiplies ops surface, and per-server billing isn't in the
schema. Revisit only if communities demand isolation.

## Billing (already implemented — verify, don't build)

- Premium is **per-user**, Discord-Nitro-style. Code baseline: $5/mo
  (`lib/features.ts`), monthly + yearly Stripe price IDs supported.
- Webhook (`app/api/billing/webhook`) grants/revokes `tier` on subscription
  events; customer portal wired for self-service cancel.
- Free tier = full core product (chat, voice, DMs, friends, guests,
  uploads ≤10MB). Premium = the `FEATURES` map: custom emoji, banners,
  vanity URLs, insights, backup/restore, auto-mod, scheduled messages,
  2FA, SSO, 100MB uploads, discovery, priority support.
- Pricing decision stays with the owner; the code makes price a Stripe
  dashboard change, not a deploy.

## Voice scaling (the moat)

Mesh voice is fine at friends scale and stays the self-host default forever
(zero infra). Hosted rooms need to beat the ~6-person ceiling:

- **Adopt LiveKit (self-hosted, Apache-2.0)** as the SFU rather than
  building on mediasoup/Janus: it bundles SFU + TURN, has first-class JS
  SDKs, and slots behind a feature flag. New `FEATURES` entry `sfu_voice`
  (premium) — room chooses SFU when available, falls back to mesh.
- Sequencing: hosted launches on mesh (rooms ≤6 enforced by UX copy, not
  hard caps), SFU lands as the first post-launch premium upgrade.
- Server-side recording/streaming stays out of scope until SFU exists.

## Launch checklist (hosted v1)

Gate every box before taking money:

- [ ] **Regenerate Prisma migrations against Postgres** — the committed
      migration history is Postgres-drifted; a fresh hosted DB must
      `prisma migrate deploy` cleanly (known issue, tracked since the
      2026-06-28 security pass)
- [ ] Webhook idempotency moved from in-memory to a DB table (multi-node +
      restart safety); friendship dup-race re-checked on Postgres
- [ ] Deploy: docs/DEPLOY.md recipe on real infra + managed Postgres,
      nightly `pg_dump` + uploads snapshot, restore drill performed once
- [ ] Stripe live keys, live webhook signing secret, portal configured
- [ ] Terms of Service + Privacy Policy pages (AGPL source link in footer
      satisfies §13 network-use clause)
- [ ] Status/uptime page (even a bare one)
- [ ] Load sanity: 200 concurrent socket clients on one box (vitest
      harness exists for the socket layer; extend, don't rewrite)
- [ ] Abuse basics: registration rate-limit exists — add upload-volume cap
      per account and a report-user endpoint before public signup

## Open questions (owner decisions, non-blocking to build)

1. Domain + product name for the hosted instance (campfire.gg-style).
2. Final pricing ($5/mo baseline in code; yearly discount?).
3. Support channel for paid users (email? a Campfire server, dogfooding?).
4. Whether guest access stays enabled on the hosted flagship instance
   (spam surface vs. frictionless onboarding).

## Non-goals for v1

Text E2EE (see docs/SECURITY.md), mobile apps, federation, per-customer
instances, server-side voice recording, and any feature that only exists
to pad the premium column. The hosted pitch is "Campfire, running well,
without the homework" — keep it that.
