# Campfire release checklist

Use this for every web, Docker, portable, installer, or managed-hosted release. A checked box means evidence was produced for the exact candidate commit and artifact—not merely that supporting source code exists.

## Release record

- Version/tag: `____________________`
- Commit SHA: `____________________`
- Release owner: `____________________`
- Candidate date: `____________________`
- Target: `[ ] source  [ ] Docker  [ ] portable  [ ] installer  [ ] managed hosted`
- Evidence location: `____________________`
- Rollback version: `____________________`

## 1. Scope and source control

- [ ] Candidate commit is reviewed and the worktree is clean.
- [ ] Release notes separate features, bug fixes, migrations, operator actions, and known limitations.
- [ ] The ten feature claims match [GAP_ANALYSIS.md](./GAP_ANALYSIS.md); advisory/process-local limitations are retained.
- [ ] No secret, database, upload, log, signing certificate, or generated artifact is tracked.
- [ ] License notices and an AGPL source link are present in the distributed experience.
- [ ] Community and Cloud are selected explicitly for release; a Stripe key alone cannot switch editions.
- [ ] Rollback is defined before rollout; destructive or irreversible migrations are called out explicitly.

## 2. Clean automated verification

Run from a clean checkout on Node 22 LTS.

- [ ] `npm ci` succeeds without relying on an existing `.env`, generated client, database, or `node_modules`.
- [ ] Postinstall creates a random local JWT secret, selects SQLite, generates Prisma, and initializes the local database when `.env` is absent.
- [ ] `npm test` passes in full with no shared-database or open-handle failures.
- [ ] `npm run lint` passes.
- [ ] `npx tsc --noEmit` passes.
- [ ] `npm run db:check` confirms the derived PostgreSQL schema, both provider-specific clients, and PostgreSQL migration history are internally consistent.
- [ ] `npm run build` passes after generating both provider-specific clients.
- [ ] A second clean generation/build proves generated files and the derived PostgreSQL schema are reproducible.
- [ ] Dependency advisories and licenses are reviewed; every accepted risk has an owner and expiry date.

Record commands, versions, and output in the release evidence rather than pasting a moving “latest run” into this file.

## 3. Database and data lifecycle

- [ ] Fresh SQLite install starts, creates a user, sends a message, restarts, and retains state.
- [ ] Fresh PostgreSQL migration deploy completes with no schema drift.
- [ ] Upgrade from the previous supported version succeeds on a realistic copy of data.
- [ ] Failed migration behavior and rollback/recovery are rehearsed.
- [ ] Invite use limits, scheduled-message claims, poll votes, and Gathering RSVPs remain atomic under concurrent requests.
- [ ] Leave-no-trace expiry is verified for 1-, 7-, and 30-day rooms.
- [ ] Journal snapshots expected to survive source-message expiry remain readable.
- [ ] Expired local attachments are removed only when no retained record references them.
- [ ] Pending private uploads older than 24 hours are reclaimed, while freshly uploaded and claimed files remain intact.
- [ ] Reference-safe attachment cleanup is exercised through message/channel/server deletion, purge, retention, account deletion, and Journal retention.
- [ ] Database plus public uploads/avatars and private attachments are backed up consistently, encrypted off host, and restored into a clean environment.
- [ ] Recovery time and recovery point observations are recorded; do not publish an RTO/RPO until the process repeatedly meets it.

## 4. Authorization and security regression

- [ ] HTTP and Socket.IO channel view/send permissions agree for members, restricted members, banned members, and outsiders.
- [ ] Socket events derive identity from the validated session and reject forged message, channel, conversation, and target IDs.
- [ ] Hidden or revoked servers, channels, messages, pins, search results, bookmarks, welcome data, and scheduled-message projections fail closed.
- [ ] Message, server, channel, role, and member mutations recheck current authority, including owner/moderator hierarchy and last-owner protection.
- [ ] Ban, kick, role, permission, channel, server, password-reset, and session revocation immediately remove unauthorized realtime subscriptions.
- [ ] DM reads, sends, typing, and notifications are limited to conversation participants and respect personal blocks.
- [ ] Cross-channel reply, thread, pin, poll, Journal, and Gathering references are rejected.
- [ ] Managed invite preview exposes only intended metadata; revoked, expired, and exhausted links fail closed.
- [ ] Password reset returns a generic response, stores only a reset-token digest, delivers the raw token only by email, consumes it atomically once, hashes the replacement password, and revokes prior sessions.
- [ ] `RESEND_API_KEY`, `CAMPFIRE_EMAIL_FROM`, and `NEXT_PUBLIC_APP_URL` are correct for the target; sending-domain ownership, delivery, bounce handling, rate limits, and provider failure behavior are exercised.
- [ ] Instance admin remains deny-by-default and accepts only explicit immutable user IDs.
- [ ] Link preview requests reject private, loopback, link-local, unsafe redirect, oversized, and unsupported targets, including DNS changes between validation and connection.
- [ ] Private attachment upload, owner-only pending preview, atomic one-message/DM claim, current channel/DM/Journal authorization, `GET`/`HEAD`/single-range/`416` behavior, non-public storage, safe disposition, immediate revocation, and cleanup are exercised.
- [ ] Authentication and realtime limits use a trusted client address without accepting spoofed forwarding headers; reconnects and multiple tabs cannot reset per-user socket limits.
- [ ] Production refuses the example JWT secret; cookies are `Secure` behind HTTPS.
- [ ] Community ignores Stripe credentials and remains feature-unlocked; incomplete Cloud billing returns unavailable rather than partially enabling checkout.
- [ ] Strict CORS is enabled and tested against the real public origins.
- [ ] Security and privacy claims still match [SECURITY.md](./SECURITY.md).

## 5. Ten-feature acceptance pass

- [ ] **Managed invites:** rotate, revoke, expiry, max-use, preview, duplicate join, and final-use race.
- [ ] **Personal block/ignore:** block, unblock, friendship removal, DM/friend denial in both directions, and settings UI.
- [ ] **Voice notes:** permission denial, record, stop, preview, cancel, upload, send, playback, size/type limit, and unsupported browser.
- [ ] **Purpose-driven voice rooms/scenes:** create/edit every mode, default scene, explicit scene, unauthorized edit, reconnect, and mobile layout.
- [ ] **Pass the Lantern:** start, request, pass, release, moderator stop, holder disconnect, queue cleanup, and restart limitation copy.
- [ ] **Leave-no-trace rooms:** configure each window, hourly worker, retained message, expired message, attachment cleanup, and Journal preservation.
- [ ] **Camp Journal:** save visible message, reject hidden/cross-server message, optional note, list only the viewer’s entries, delete, and expired source.
- [ ] **Camp Votes:** 2–10 unique options, single/multiple voting, toggle/change vote, scheduled/manual close, channel authorization, and moderator close.
- [ ] **Camp Gatherings:** create/edit/delete authorization, future/duration validation, cross-server channel rejection, RSVP counts, reminder, active join, and ended event.
- [ ] **Offshoots:** create/join/leave/close, creator disconnect, moderator close, parent-room authorization, three-room/four-member caps, audio routing, reconnect, and privacy-boundary copy.

## 6. Web and Docker operations

- [ ] Production launches with `npm run host`, not `npm start`; Socket.IO, scheduled delivery, and retention workers are all observed.
- [ ] The PostgreSQL-only Compose stack starts from empty volumes with strong, unique `JWT_SECRET` and `DB_PASSWORD` values supplied by the operator.
- [ ] PostgreSQL dependency health, migrations, application health check, shutdown, and restart are verified.
- [ ] Database, public uploads/avatars, and private attachments survive container replacement.
- [ ] Reverse proxy forwards the original host/protocol and WebSocket upgrades, replaces inbound `X-Forwarded-For`, and matches the exact `CAMPFIRE_TRUST_PROXY_HOPS` count.
- [ ] HTTPS works for pages, APIs, uploads, secure cookies, and `wss://` Socket.IO.
- [ ] TURN produces relay candidates and carries a call across two different restrictive networks.
- [ ] Firewall exposes only intended web, SSH, and TURN ports.
- [ ] Logs, disk growth, database connections, worker failures, socket count, and process health have monitoring and alerts.
- [ ] An operator follows [DEPLOY.md](./DEPLOY.md) without undocumented shell history or local state.

## 7. Windows portable and installer workflow

The packaging source of truth is the [electron-builder configuration](../packaging/electron-builder.json), [desktop staging script](../packaging/stage-desktop.mjs), and [Electron launcher](../desktop/main.cjs). Artifacts belong under ignored `desktop/dist/`.

These packaging commands are operational in the current worktree, but a release still requires the exact-candidate evidence below:

```text
npm run desktop:stage
npm run desktop:verify -- --require-stage
npm run desktop:portable
npm run desktop:installer
npm run desktop:dist
```

Historical `0.0.3` worktree evidence (2026-07-13; not beta sign-off): Node
v24.14.1/npm 11.11.0 passed 373 tests, lint, TypeScript, provider checks,
SQLite sync, production build, audit, load sanity, private-attachment HTTP
acceptance, desktop staging/verification, and unsigned desktop builds. None of those artifact results carry forward to `0.1.0-beta.1`; the exact-candidate gates below remain authoritative.

- [ ] `desktop:stage` produces a complete staged app without copying `.env`, development databases, user uploads, or signing secrets.
- [ ] The staged launcher starts the custom Campfire server and waits for a healthy local endpoint before opening a window.
- [ ] `better-sqlite3` is rebuilt for the packaged Electron ABI on a clean builder.
- [ ] Installer database, `media/uploads`, `media/avatars`, `media/private-uploads`, logs, and generated JWT secret live under `%APPDATA%\Campfire`, never packaged `resources/`.
- [ ] Portable database, `media/uploads`, `media/avatars`, `media/private-uploads`, logs, and generated JWT secret live under `CampfireData` beside the executable and travel with that directory.
- [ ] Public uploads/avatars and private attachments are served from the selected writable state root and survive restart, move/upgrade, and backup/restore.
- [ ] NSIS setup installs, launches, upgrades, repairs, and uninstalls while retaining `%APPDATA%\Campfire` as configured; manual data removal is documented.
- [ ] Second launch does not spawn duplicate servers or corrupt the SQLite database.
- [ ] Port collision, locked database, missing write permission, antivirus delay, and crash-recovery paths show actionable errors.
- [ ] Portable and installer artifacts are code-signed; credentials come from the release environment and never enter the repository or artifact payload.
- [ ] SHA-256 checksums, exact filenames, sizes, supported Windows versions, and signature verification instructions are published.
- [ ] Smoke tests run against the actual portable and installer artifacts, not only the staged directory.

Historical `0.0.3` local artifact fingerprints (not beta sign-off; both Authenticode `NotSigned`):

- `desktop/dist/Campfire-Portable-0.0.3-x64.exe` — 125232117 bytes; SHA-256 `0C6E4C34C318F2CB0C72C3B9BBEFD57BD041A4B1E43E8AE69693A715D322FD81`
- `desktop/dist/Campfire-Setup-0.0.3-x64.exe` — 125499964 bytes; SHA-256 `BAA288D624FC15E3146F44D08E1568C8C324D7E167FB316377DC23754589BBC8`

## 8. Media and client matrix

- [ ] Current Chrome, Edge, Firefox, and Safari complete text, upload, voice-note, voice, camera, and screen-share smoke tests where supported.
- [ ] Windows and macOS input/output device selection, unplug/replug, permission denial, mute/deafen, and push-to-talk are tested.
- [ ] Android and iOS mobile web complete the documented supported subset; background-audio limitations are explicit.
- [ ] Peer-to-peer room size is capped or clearly communicated; CPU, upload bandwidth, join time, packet loss, and recovery are measured.
- [ ] TURN credentials and relay capacity cannot be trivially abused; rotation and incident response are documented.
- [ ] Offshoots are described as client-routed conversation bubbles, not cryptographic/private rooms.

## 9. Managed hosted go-live additions

- [ ] Terms of Service, Privacy Policy, source offer, data retention/deletion, and acceptable-use policy are published and reviewed.
- [ ] Live Stripe keys, prices, webhook signature verification, replay/idempotency, customer portal, cancellation, refund, and failed-payment flows are exercised.
- [ ] Checkout grants no entitlement until the expected product/SKU and an eligible subscription status are verified; 24-hour guest accounts cannot purchase a durable subscription.
- [ ] Out-of-order and duplicate subscription/checkout/invoice events converge on the correct entitlement, including cancellation followed by delayed older events.
- [ ] Stripe v22 subscription-period data is read from the correct subscription-item fields and produces a tested non-null expiry when the plan has one.
- [ ] Invoice paid and failed events update access according to the published grace/cancellation policy.
- [ ] Checkout reuses the user’s existing Stripe Customer; Stripe customer/subscription identifiers are unique where the data model requires it.
- [ ] Entitlement transition tests call the real handler logic rather than mocking the behavior under test.
- [ ] Focused billing safeguards are repeated against the release database and a Stripe test environment; passing in-memory handler tests alone is not treated as go-live proof.
- [ ] Tenant isolation tests cover servers, channels, DMs, uploads, billing records, admin analytics, and realtime rooms.
- [ ] Managed PostgreSQL backups and upload snapshots run automatically; a full restore drill is attached as evidence.
- [ ] TLS, TURN, secrets, monitoring, alerting, status page, support channel, escalation, and on-call ownership are live.
- [ ] Abuse reports, account suspension, data export/deletion, and incident communication have named owners.
- [ ] Capacity and cost limits are defined before marketing large communities; no SFU-scale claim is made while clients remain on mesh.
- [ ] A staged rollout and rollback have been rehearsed with an internal or invited tenant.

## 10. Final smoke and sign-off

- [ ] Register/login/logout/reset; create/join/leave server; text/reply/thread/react/pin/search; DM/friend/block.
- [ ] Join/leave/reconnect voice; mute/deafen/PTT; camera/screen share; Lantern/Offshoot; TURN call across networks.
- [ ] All ten new feature acceptance rows pass on the target artifact.
- [ ] Restart the service or desktop app and confirm durable data remains while process-local Lantern/Offshoot state resets as documented.
- [ ] Backup, upgrade, rollback, and restore are executed against the candidate.
- [ ] Known issues are published with workarounds and owners.
- [ ] Engineering sign-off: `____________________`
- [ ] Security/operations sign-off: `____________________`
- [ ] Product/support sign-off: `____________________`
- [ ] Final go/no-go decision and timestamp: `____________________`
