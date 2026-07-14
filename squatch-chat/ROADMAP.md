# Campfire product and engineering roadmap

Updated: 2026-07-13

Campfire’s direction is **Discord-shaped community infrastructure with a warmer, more intentional social layer**. The goal is not to copy every Discord surface at once. The sequence is: make the current product trustworthy for small communities, prove operations, scale media, then deepen both parity and Campfire’s own identity.

Status notation:

- **Complete in worktree** — source and focused tests exist; still subject to release gates.
- **Next** — required before a self-hosted beta.
- **Later** — valuable after the operating foundation is proven.

## Product decisions

1. Campfire is the canonical product line; release work should stabilize this application rather than revive the earlier in-memory prototype.
2. The free self-hosted edition remains AGPL and feature-unlocked. Managed hosting sells operations and scale, not a crippled community edition.
3. The custom unified Node server is part of the product. Socket.IO and background workers make `npm run host` the production entry point.
4. SQLite serves small single-instance communities. PostgreSQL is the expected managed and multi-instance database.
5. Peer-to-peer WebRTC remains a simple small-room option. Larger-room claims wait for a completed, measured SFU path.
6. “Private” features must name their trust boundary. Client-side Offshoot routing is not a cryptographic or server-enforced private room.

## Complete in the current worktree

### Ten-feature Campfire wave

1. **Managed invites** — rotation, revocation, expiry, use limits, safe preview, and atomic use consumption.
2. **Personal block/ignore** — directional blocks, block-list UI, friendship removal, and DM/friend enforcement.
3. **Campfire voice notes** — microphone recording, preview/cancel, upload/send, and playback.
4. **Purpose-driven voice rooms and shared scenes** — five room modes, validated scenes, and circle/grid presentation.
5. **Pass the Lantern** — realtime holder, queue, pass/release, host/moderator control, and disconnect cleanup.
6. **Leave-no-trace rooms** — 1/7/30-day retention with a custom-server expiry worker and upload cleanup.
7. **Camp Journal** — personal message snapshots, optional notes, attachment metadata, list, and delete.
8. **Camp Votes** — channel polls, single/multiple choice, optional closing time, and creator/moderator close.
9. **Camp Gatherings** — schedule/edit/delete, linked channel, RSVP counts, reminders, and active join.
10. **Offshoots** — ephemeral side bubbles with membership/capacity rules, creator/moderator close, and return to main camp.

### Stabilization and security wave

- Clean-install Prisma generation.
- Shared HTTP/realtime channel-access resolution.
- Session-authoritative Socket.IO and database-authoritative channel/DM broadcasts.
- Authenticated, atomic scheduled-message delivery through the custom server.
- SSRF-aware bounded link previews.
- Same-channel reply/thread reference enforcement.
- Banned-member and role-authorization hardening.
- Deny-by-default instance administration by immutable user ID.
- Password recovery with generic anti-enumeration responses, digested reset tokens, Resend delivery, atomic single-use consumption, and session revocation.
- Narrow invite preview endpoint.
- PostgreSQL-only production Compose wiring for secrets, persistent database/media volumes, dependency health, migrations, and a database-aware application health check.
- Next.js, Stripe dependency, and Turbopack compatibility fixes.
- Explicit fail-safe Community versus Cloud edition selection and production Cloud configuration validation.
- Stripe checkout and entitlement hardening: guest rejection, Customer reuse, checkout claims, approved price/status validation, Stripe v22 item-period handling, stale-event rejection, invoice/cancellation transitions, unique Stripe IDs, and handler-level regression tests.

These lists describe implementation scope, not a public release. The authoritative boundaries are in [docs/GAP_ANALYSIS.md](./docs/GAP_ANALYSIS.md).

## Milestone 0 — release-candidate evidence

Priority: **Next / blocking**

- Freeze a candidate commit and remove unrelated worktree drift.
- Pass clean `npm ci`, `npm run db:check`, full tests, lint, typecheck, and production build on Node 22.
- Repeat desktop staging, native-module probing, packaging, and packaged-runtime smoke tests against the frozen candidate; attach exact artifact evidence.
- Prove fresh and upgrade paths for SQLite sync and the history-preserving PostgreSQL migration track.
- Run authorization regressions across HTTP and Socket.IO.
- Complete the ten-feature acceptance pass on real browsers.
- Publish migrations, breaking changes, operator actions, limitations, and rollback notes.
- Verify the production container from empty volumes through restart and restore.
- Complete every applicable gate in [docs/RELEASE_CHECKLIST.md](./docs/RELEASE_CHECKLIST.md).

Exit: a reproducible candidate with attached evidence, known issues, and a rollback plan.

## Milestone 1 — invited self-hosted alpha

Priority: **Next**

- Operate one real HTTPS deployment with strict CORS, PostgreSQL or backed-up SQLite, TURN, persistent uploads, monitoring, and alerts.
- Perform a database-plus-uploads backup and clean restore drill.
- Invite a small set of communities; cap and communicate peer-to-peer room size.
- Measure registration/join success, time to first message, time to voice, reconnect rate, TURN usage, media failures, worker failures, and support load.
- Validate leave-no-trace expectations, Offshoot trust copy, moderator workflows, and block behavior with real users.
- Fix accessibility, empty-state, responsive-layout, and browser compatibility blockers discovered in alpha.

Exit: multiple communities can operate for several weeks without data loss or unresolved critical authorization/media failures.

## Milestone 2 — self-hosted beta and desktop distribution

Priority: **Next after alpha**

- Turn backup/restore, update, rollback, and log collection into repeatable operator procedures.
- Publish a support matrix for operating systems, browsers, SQLite/PostgreSQL, reverse proxies, and TURN.
- Make the current portable and NSIS candidate generation reproducible on a clean release builder, with versioned evidence and rollback notes.
- Keep the Electron 43 `better-sqlite3` rebuild covered on every supported builder; prove installer state under `%APPDATA%\Campfire`, portable state under adjacent `CampfireData`, and writable/served media outside packaged resources.
- Test install, upgrade, rollback, move-portable, and uninstall-with-data-retained behavior without data loss.
- Add code signing, checksums, clean-machine artifact smoke tests, and published known issues.
- Improve mobile-web navigation, touch targets, media permissions, accessibility, and reduced-motion behavior.
- Add product-facing diagnostics for microphone, speaker, WebRTC connection, TURN, Socket.IO, database, and worker health.

Exit: a documented self-hosted beta plus signed desktop candidates that pass the artifact checklist. Native mobile apps remain out of scope for this milestone.

## Milestone 3 — managed hosted beta

Priority: **After self-host operations are proven**

- Publish Terms of Service, Privacy Policy, acceptable-use, retention/deletion, AGPL source offer, and support/escalation policies.
- Verify Community versus Cloud remains explicit and fails closed when hosted billing or password-recovery configuration is incomplete.
- Preserve the implemented Stripe entitlement invariants with production-database and end-to-end tests that exercise the real checkout and webhook handlers.
- Verify the Resend sending domain, delivery/bounce handling, reset-link base URL, rate limits, and account-recovery monitoring in the managed environment.
- Prove live webhook signatures, replay/idempotency, checkout, portal, upgrade/downgrade, cancellation, failed payment, refund, and access-expiry flows.
- Automate encrypted PostgreSQL/upload backups and attach repeatable restore evidence.
- Launch monitoring, alerting, status page, incident ownership, abuse response, support, and staged rollout/rollback.
- Complete tenant-isolation tests for APIs, realtime rooms, uploads, admin analytics, and billing data.

Exit: invited tenants can be billed without entitlement ambiguity, with documented support and recovery. No public SLA is promised until operating data supports it.

## Milestone 4 — scalable voice, video, and realtime

Priority: **Required for large-community claims**

- Complete LiveKit/SFU browser integration, room selection, moderation, failure fallback, and deployment.
- Replace static TURN credentials with short-lived credentials and capacity/abuse controls.
- Add region selection or routing, adaptive subscriptions, audio priority, media quality indicators, and device hot-swap.
- Measure join time, RTT, jitter, loss, bitrate, reconnects, CPU, and outbound bandwidth.
- Move Lantern/Offshoot state from one process into a shared realtime state design before horizontal app replicas.
- If Offshoots promise private side audio, route media at the SFU rather than relying on client volume controls.
- Load-test large voice rooms, screen share, camera grids, and failover with explicit supported limits.

Exit: Campfire can publish measured room-size and availability claims rather than inheriting Discord-scale expectations.

## Milestone 5 — account safety and community parity

Priority: **After release reliability**

- 2FA, SSO, session/device management, recovery-event notifications, and administrative recovery controls.
- Report queues, abuse evidence, rate-limit administration, suspension/appeal, and moderator case history.
- Fine-grained notification settings, cross-device push, mobile background behavior, and do-not-disturb schedules.
- Stage/listener rooms, request-to-speak moderation, forum-style channels, and richer event workflows.
- Server discovery governance, onboarding questions, membership screening, rule acceptance, and anti-raid controls.
- Bot/app API, webhooks, OAuth installation, permission scopes, auditability, and a safe extension model.
- Large-history search, export/import, server transfer, and formal data deletion tooling.

Exit: Campfire covers the high-value Discord workflows its target communities actually use, with safety and operator costs measured before adding breadth.

## Next five build-outs

These are the ranked follow-on features after the current ten-feature wave:

1. **Ranger Desk** — a moderation case inbox with evidence, assignment, action history, escalation, and appeals.
2. **Fireside Stage** — listener/speaker voice rooms with a request-to-speak queue, host promotion, moderation, and capacity rules.
3. **Trail Boards** — forum-style channels with tags, searchable posts, resolved/archived states, and durable topic ownership.
4. **Ember Inbox** — a persistent notification center with unread state, per-space policy, push/digest delivery, and quiet hours.
5. **Gathering Seasons** — recurring Gatherings with external calendar links, host controls, capacity, waitlists, and reminder policy.

Treat these as planned work, not shipped capability. Ranger Desk and Ember Inbox come first because safety and reliable attention management are prerequisites for larger public communities.

## Milestone 6 — deepen Campfire’s own flare

Priority: **Continuous, after foundations**

- Give each purpose-driven room behavioral defaults for layout, notification tone, privacy, queueing, and moderation.
- Persist or explicitly expire Lantern/Offshoot state and show that lifecycle to participants.
- Add recurring Gatherings, external calendar links, host controls, waitlists, and push reminders.
- Add Journal search, export, collections, and an opt-in shared community journal.
- Expand Camp Votes with quorum, anonymous-community mode where safe, reminders, and result exports.
- Make the Circle, arrival/departure motion, ember reactions, ambient scenes, and shared-object slot coherent and accessible rather than decorative clutter.
- Explore watch-together, collaborative workshop objects, story circles, and quiet co-presence only after media and moderation foundations support them.

Exit: a community can explain why it prefers Campfire without saying only “it is open-source Discord.”

## Explicit remaining gaps

The following are not “basically done”:

- native iOS/Android apps and reliable background/lock-screen audio;
- a production SFU and Discord-scale voice/video capacity;
- automated managed backups with published and proven recovery targets;
- production-ready 2FA/SSO;
- live billing/recovery operations and a commercially ready hosted service;
- mature trust-and-safety operations, notifications, stages/forums, and app ecosystem;
- end-to-end encryption for stored text or DMs;
- signed, upgrade-tested desktop artifacts.

## Product health signals

Before adding broad feature parity, track:

| Area | Signal |
|---|---|
| Activation | Create/join success, time to first message, time to first voice join |
| Reliability | API/socket error rate, reconnect success, worker failures, failed uploads |
| Voice | Join time, TURN usage, RTT/jitter/loss, drop rate, room size, CPU/bandwidth |
| Safety | Reports, block rate, moderation actions, repeat abuse, response time |
| Data | Backup success, restore duration, migration failures, retention sweep results |
| Product | Weekly active communities, returning voice rooms, Gatherings attendance, Journal/Vote use |
| Operations | Incidents, support volume, cost per active community, rollback frequency |

## Definition of done

A roadmap item is complete only when:

1. authorization and validation rules are explicit;
2. data lifecycle and privacy boundaries are documented;
3. focused tests and relevant regression tests pass;
4. realtime and HTTP behavior agree where both apply;
5. UI covers loading, empty, error, unauthorized, mobile, keyboard, and reduced-motion states;
6. operators know the configuration, monitoring, backup, upgrade, and rollback impact; and
7. the release checklist proves the behavior on the distributed artifact.

See [docs/EDITIONS.md](./docs/EDITIONS.md) for edition promises and [docs/RELEASE_CHECKLIST.md](./docs/RELEASE_CHECKLIST.md) for the actual ship gate.
