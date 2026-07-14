# Campfire hosted edition — product spec

> Historical hosted-design note. [EDITIONS.md](./EDITIONS.md) defines current product policy and [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) controls release sign-off; dated checked boxes below are not evidence for a later candidate.


One codebase, two distributions (locked decisions: AGPL-3.0, single repo,
this one spec):

| | **Self-host (free)** | **Hosted (paid)** |
|---|---|---|
| Who runs it | You | Us |
| Database | SQLite (default) | Postgres |
| Features | All shipped code features in `CAMPFIRE_EDITION=community` | Cloud Free + Cloud Plus service tiers |
| Voice | WebRTC mesh (~6/room) | The same mesh limit until a measured SFU path ships |
| Setup | `npm install && npm run host` | Zero — sign up and go |

The hosted edition is intended to sell **ops, not a closed-source fork**:
always-on service, backups, TLS, working TURN, monitoring, support, and no VPS
homework. Scalable voice remains a roadmap item, not a current service claim.
The AGPL keeps the application code open either way; convenience is the product.

## Architecture: one multi-tenant instance

The schema is already multi-tenant the way Discord is: one deployment, many
communities ("servers"), global user accounts, per-user billing
(`User.tier` / `stripeCustomerId` / `subscriptionStatus` — all present).
Hosted = one deployment of exactly this code with:

- `CAMPFIRE_EDITION=cloud` selected explicitly
- `DATABASE_URL=postgresql://…` using the PostgreSQL client and migration track
- all four Stripe settings present before billing activates
- `STRICT_CORS=true`, an HTTPS `NEXT_PUBLIC_APP_URL`, recovery email, TURN, and
  the remaining production requirements in [DEPLOY.md](./DEPLOY.md)

Explicitly rejected for v1: instance-per-customer hosting (Mastodon-host
model). It multiplies ops surface, and per-server billing isn't in the
schema. Revisit only if communities demand isolation.

## Billing implementation — release evidence still required

- Premium is per user, with monthly and yearly Stripe Price IDs.
- Prices are controlled by the operator's Stripe catalog; no dollar amount is
  hardcoded in Campfire.
- Cloud Plus currently exposes custom emoji, server banners, channel export,
  scheduled messages, and extended uploads.
- Vanity URLs, insights, authoritative auto-moderation, 2FA, SSO, discovery,
  priority support, and SFU voice remain marked `planned`; they are not
  purchasable entitlements.
- The webhook grants or revokes `tier` from validated subscription events, and
  the customer portal supports self-service billing management. Live Stripe
  drills remain mandatory before charging anyone.

## Voice scaling (the moat)

Mesh voice is fine at friends scale and stays the self-host default forever
(zero infra). Hosted rooms need to beat the ~6-person ceiling:

- LiveKit is the intended SFU direction rather than a claim of shipped scale.
- Dormant server groundwork includes `sfuAvailable` in `/api/config` and a
  membership-gated token route. The `sfu_voice` catalog entry remains
  `planned`, so the feature gate intentionally denies it to every tier.
- Remaining work includes client integration, deployment, room selection,
  moderation, fallback, capacity limits, and observability.
- Any hosted alpha remains on mesh with an explicitly communicated small-room
  limit until that full path is implemented and measured.
- Server-side recording/streaming stays out of scope until SFU exists.

## Launch checklist (hosted v1)

Gate every box before taking money:

- [ ] Validate the history-preserving `prisma/migrations-postgresql` track on
      fresh and previous-version databases; attach exact-candidate deploy and
      drift evidence
- [x] Webhook idempotency moved from in-memory to a DB table
      (`WebhookEvent` claim protocol, race-safe takeover, route +
      protocol tests; 2026-07-11)
- [x] Friendship dup-race on Postgres closed: direction-agnostic unique
      expression index (migration 20260711000002); reversed-pair insert
      verified rejected on a live Postgres, `migrate diff` stays quiet
      about it (2026-07-11)
- [ ] Deploy: docs/DEPLOY.md recipe on real infra + managed Postgres,
      nightly `pg_dump` + uploads snapshot, restore drill performed once
- [ ] Stripe live keys, live webhook signing secret, portal configured
- [ ] Terms, Privacy Policy, acceptable-use terms, and the AGPL corresponding-
      source offer are published and reviewed for the actual service model
- [ ] Status/uptime page (even a bare one)
- [x] Load sanity: 200 concurrent socket clients on one box — measured
      2026-07-11 (`tests/load-sanity.test.ts`, gated `LOAD_TEST=1`):
      connect 276ms, 1→199 fan-out 61ms, 20-sender burst (3,980
      deliveries) 125ms. Nowhere near a ceiling at this scale.
- [x] Abuse basics: per-account upload caps (30 files / 500MB per hour) and
      `POST /api/reports` (validated, deduped, 5/hr) shipped 2026-07-11;
      registration rate-limit already existed

## Open questions (owner decisions, non-blocking to build)

1. Domain + product name for the hosted instance (campfire.gg-style).
2. Final Stripe monthly/yearly prices and discount policy.
3. Support channel for paid users (email? a Campfire server, dogfooding?).
4. Whether guest access stays enabled on the hosted flagship instance
   (spam surface vs. frictionless onboarding).

## Non-goals for v1

Text E2EE (see docs/SECURITY.md), mobile apps, federation, per-customer
instances, server-side voice recording, and any feature that only exists
to pad the premium column. The hosted pitch is "Campfire, running well,
without the homework" — keep it that.
