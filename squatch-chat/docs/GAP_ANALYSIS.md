# Campfire gap analysis

Snapshot: 2026-07-13, based on the current stabilization worktree.

Campfire now has a credible private-alpha feature set and a distinct product identity. It is not yet a Discord replacement for large public communities, and this document is not a production certification. “Implemented” below means the source and focused tests exist in this worktree; every release candidate must still pass the full [release checklist](./RELEASE_CHECKLIST.md) on clean SQLite and PostgreSQL environments.

## Executive verdict

- **Private self-hosted alpha:** reasonable after a clean install, build, full test run, and a backup/restore drill.
- **Public self-hosted beta:** requires HTTPS, strict CORS, TURN, persistent storage, monitoring, and an operator who owns updates and incident response.
- **Managed hosted launch:** not ready to take money until the managed-service, legal, billing, restore, monitoring, and support gates are complete.
- **Discord parity:** not claimed. Mobile clients, scalable SFU media, mature notifications, account security such as 2FA/SSO, and several large-community workflows remain open.

## Ten product features completed in this wave

| # | Capability | What is implemented | Honest boundary |
|---|---|---|---|
| 1 | Managed invites | Owners can rotate or revoke invite codes, set expiry and use limits, preview a valid destination, and consume limited uses atomically. | No discovery trust system, approval queue, or enterprise invite policy yet. |
| 2 | Personal block/ignore | Directional user blocks remove an existing friendship and prevent new friend requests and direct messages in either direction; users can manage their block list. | This is not a full report, trust-and-safety, or moderator escalation system. |
| 3 | Campfire voice notes | Browser microphone capture, recording timer, local preview, cancel, upload, send, and message playback are integrated into chat. | Browser permission and codec support still need a release browser matrix; transcription is not included. |
| 4 | Purpose-driven voice rooms and shared scenes | Voice rooms can be Hangout, Game Night, Quiet Room, Workshop, or Story Time, with validated shared scene presets and the Campfire circle/grid presentation. | A mode changes presentation and intent; it is not yet a separately enforced permission or media policy. |
| 5 | Pass the Lantern | A realtime holder and request queue can be started, passed, released, and moderated inside a voice room. | Lantern state is process-local and advisory; it does not forcibly mute everyone except the holder and is lost on server restart. |
| 6 | Leave-no-trace rooms | Text channels can retain messages for 1, 7, or 30 days; the unified server runs an hourly expiry sweep and removes unreferenced local uploads. | Retention is not a legal-hold system, and delivery is hourly rather than exact-to-the-minute. Operators must validate backups and external storage behavior. |
| 7 | Camp Journal | A member can save a personal, durable snapshot of a visible message and attachment metadata with an optional note, then list or remove their entries. | Journal entries are private per member, not a shared wiki, collaborative notebook, or export/archive system. |
| 8 | Camp Votes | Members with channel send access can create single- or multiple-choice polls with 2–10 unique options and optional closing times; creators or moderators can close them. | No anonymous ballots, ranked choice, quorum, reminders, or audit-grade election guarantees. |
| 9 | Camp Gatherings | Members can schedule a future gathering, optionally link a channel, RSVP going/maybe/declined, see counts and a 15-minute reminder, and join the linked room while active. | No recurring events, calendar sync, timezone preference layer, push reminders, or waitlists. |
| 10 | Offshoots | Voice-room members can form ephemeral side bubbles, rejoin the main camp, and close bubbles with creator/moderator controls; limits are three bubbles per parent and four members per bubble. | Offshoot state is process-local. Audio separation is implemented by client-side peer volume routing inside the parent WebRTC mesh, so it is a conversational convenience—not a security or privacy boundary. |

## Hardening and bug-fix wave

These changes address concrete correctness, authorization, and operations risks. They still require the clean-environment checks in the release checklist.

| Area | Fix in the current worktree | Risk addressed |
|---|---|---|
| Clean install | Postinstall generates the Prisma client before database setup. | A successful install no longer leaves database-backed imports missing. |
| SQLite upgrades | Safe synchronization recognizes newly added default-free nullable unique columns as initially NULL while still refusing unsafe uniqueness changes. | Allows private-attachment schema upgrades without weakening duplicate-data protection. |
| Channel authorization | Shared channel access resolution is used across HTTP and realtime paths. | Reduces permission drift between loading, sending, polling, and socket subscription paths. |
| Hidden projections | Server, channel, welcome, scheduled-message, and realtime projections omit channels the caller cannot view. | Prevents hidden-channel metadata and events from leaking through adjacent list or worker paths. |
| Message mutations | Detail, reaction, pin, thread, purge, retention, and deletion paths recheck current visibility and mutation authority. | Prevents stale membership or guessed IDs from mutating messages outside current access. |
| Realtime authority | Socket identity comes from the validated session; channel and DM events re-load authoritative records before broadcast. | Prevents client-supplied identity or message IDs from becoming trusted realtime events. |
| Realtime abuse controls | Per-user, per-event limits survive reconnects and multiple tabs; proxy headers are trusted only for an explicitly configured hop count. | Reduces reconnect bypass and caller-supplied-IP spoofing in authentication and Socket.IO controls. |
| Scheduled messages | Delivery is authenticated, worker-driven, and claimed atomically before broadcast. | Reduces unauthorized triggering and duplicate delivery under concurrent workers. |
| Link previews | Preview fetching pins validated public DNS results through the connection and revalidates every redirect with bounded response handling. | Blocks private-network, redirect, and DNS-rebinding SSRF targets. |
| Replies and threads | Referenced messages must belong to the same authorized channel. | Closes cross-channel reference/IDOR paths. |
| Roles and bans | Banned/inactive memberships and role mutations are checked consistently. | Prevents banned or insufficiently privileged members from retaining protected access. |
| Role hierarchy | Server role assignment, member moderation, and deletion respect owner/moderator hierarchy and protect the last owner. | Prevents equal-or-higher-role takeovers and orphaned servers. |
| Deletion and session lifecycle | Server/channel/message/DM deletion clears dependent realtime state and unreferenced files; password reset revokes active HTTP and Socket.IO sessions. | Prevents ghost subscriptions, stale access, and abandoned attachment data after destructive actions or credential recovery. |
| Instance administration | Global admin access is deny-by-default and accepts immutable user IDs only. | Avoids accidental wildcard or username-based instance administrators. |
| Password reset | Generic responses hide account existence; raw tokens are delivered through Resend while only digests are stored; reset consumption is atomic and revokes existing sessions. | Closes the former no-delivery/plain-token gap and reduces enumeration, replay, and session-persistence risk. |
| Invite preview | Invite landing data comes from a narrow authenticated preview endpoint. | Avoids leaking full server membership data before join. |
| Private attachments | New message/DM uploads use random storage keys outside the public root, an owner-bound atomic claim, authenticated `GET`/`HEAD`/Range reads, current channel/DM/Journal authorization, immediate revocation, reference-safe cleanup, and a 24-hour abandoned-pending sweep. | Replaces public capability URLs for the primary composer flow and prevents stale membership from preserving file access. |
| Production container | The PostgreSQL-only Compose path requires a JWT secret, persists public uploads, avatars, private attachments, and the database, waits for PostgreSQL, and exposes a database-aware health check. | Removes common secret, startup-order, and ephemeral-data deployment failures; operators must still override the default database password. |
| Framework/tooling | Next.js/Stripe dependencies and Turbopack-related configuration were corrected. | Reduces clean-build and runtime incompatibilities. |
| Edition safety | Community is the fail-safe default; Cloud must be explicit, incomplete billing disables checkout, and production Cloud validates PostgreSQL, HTTPS, JWT, CORS, and recovery-email prerequisites. | Prevents a stray Stripe key from silently turning a community server into a paid hosted product or deploying Cloud without account recovery. |
| Billing integrity | Checkout rejects guests, reuses Customers, and claims attempts idempotently; webhook state validates approved prices/status, ignores stale events, reads Stripe v22 item expiry, reconciles invoices/cancellation, and uses unique Stripe IDs. | Focused handler tests cover the entitlement state machine without treating checkout completion as an access grant. |

## Remaining gaps

### P0 — release and managed-service gates

1. **Clean release evidence.** The current dirty Node 24 worktree is locally green (61 passing files, 373 passing tests, lint, typecheck, dual-provider Prisma checks, idempotent SQLite sync, production build, high-severity audit, and 200-client sanity), but release evidence still requires an untracked-file-free Node 22 checkout plus fresh SQLite upgrade, live PostgreSQL migration, and Docker checks.
2. **Backup and restore operations.** Define retention, encryption, ownership, off-host storage, and recovery objectives; then restore the database, public media, and private attachments into a clean environment. Campfire currently documents backups but does not provide a managed backup product.
3. **Public media reliability.** Configure and exercise TURN across residential, corporate, and mobile networks. The current peer-to-peer mesh remains a practical small-room design, not a large-room media architecture.
4. **SFU client integration.** Dormant LiveKit token groundwork is not Discord-scale voice. `sfu_voice` remains planned and denied to every tier; the browser client, deployment, capacity model, failure fallback, moderation, and observability still have to be completed and tested.
5. **Managed-service readiness.** Legal pages, privacy terms, data-processing posture, live billing/webhook drills, status page, on-call ownership, abuse handling, support channel, and restore evidence are required before charging users.
6. **Distribution verification.** The current worktree passed desktop staging and verification and rebuilt portable/NSIS candidates with recorded checksums. Both remain unsigned, and this environment did not execute the actual binaries without explicit unsigned-artifact authorization. Installer state under `%APPDATA%\Campfire`, portable state under adjacent `CampfireData`, actual launch, install/upgrade/repair/uninstall, clean-machine coverage, signing, backup/restore, and failure paths remain release gates.
7. **Live billing and recovery proof.** Source-level entitlement and password-reset safeguards now exist, but a paid launch still needs live Stripe signature/replay/checkout/portal/refund/payment-failure drills, production-database transition tests, and verified Resend domain, delivery, bounce, abuse, and monitoring behavior.

### P1 — major Discord/product gaps

- **Mobile:** no native iOS/Android applications, reliable background audio, lock-screen controls, push notifications, or completed touch/accessibility matrix.
- **Large voice/video rooms:** no production SFU path, region selection, adaptive subscriptions, media quality telemetry, recording consent workflow, or load-tested screen sharing at scale.
- **Account security:** 2FA and SSO remain roadmap items. Session/device management, recovery-delivery monitoring, and security-event notifications need a formal product pass.
- **Community operations:** reporting/escalation workflows, mature anti-spam controls, granular notification settings, moderation queues, legal holds, and trust tooling remain limited.
- **Discord-shaped workflows:** stage channels, forum channels, robust server discovery, application/bot ecosystem, webhooks, rich integrations, and mature role/channel-permission tooling are not at Discord depth.
- **Notifications and search:** cross-device push, fine-grained per-server/channel notification policy, global discovery, and large-history search quality are not release-proven.
- **Legacy public media migration:** the primary message/DM composer now uses authenticated private attachments, but the legacy `/api/upload` and existing `/uploads` records remain public-by-URL. Sensitive historical media needs an explicit migration/deprecation plan.
- **Multi-node coordination:** attachment bytes still require shared durable storage, while rate limits and Lantern/Offshoot state are process-local. Horizontal replicas need shared storage, pub/sub/state, and distributed abuse controls.
- **Desktop/mobile distribution:** the web app remains the canonical experience. Desktop portable/installer work is a release candidate until the packaging checklist is complete; mobile packages do not exist.

### P2 — Campfire differentiation to deepen

- Persist or deliberately expire Lantern and Offshoot state across server restarts, and make those lifecycle rules visible.
- Move Offshoot media separation from client-side attenuation to an SFU-backed routing boundary if private side conversations become a promise.
- Give voice-room modes behavioral defaults—notifications, layout, queueing, privacy, and moderation—rather than presentation alone.
- Add Journal search/export and an explicitly shared journal mode without weakening source-channel authorization.
- Add recurring Gatherings, external calendar integration, push reminders, and host controls.
- Establish a consistent warm, accessible Campfire interaction language across desktop, mobile web, and future native packages.

## Architecture and operator constraints

- Production must launch the custom unified server through `npm run host`; `next start` does not attach Socket.IO or run scheduled-delivery and retention workers.
- SQLite is the zero-configuration single-instance option and uses `db:sync`/`db:push`; PostgreSQL is the expected managed/multi-instance database and uses `db:migrate*`. `db:generate` and `db:check` cover both provider-specific clients, but fresh and upgrade behavior must still be verified for both before release.
- WebRTC media is peer-to-peer and encrypted in transit, but text, DMs, memberships, and uploads are readable by the server operator. See [SECURITY.md](./SECURITY.md).
- Public voice requires HTTPS and a working TURN path. See [DEPLOY.md](./DEPLOY.md).
- Realtime limiter maps, abandoned-upload sweep scheduling, Lantern, and Offshoot state currently live in one Node.js process. Horizontal replicas need shared limiter/worker coordination, realtime state, and pub/sub before they are safe.
- The current media design requires persistent public upload/avatar and private-attachment storage plus coordinated database-and-media backup. Stateless containers lose user files; desktop media must also be proven writable and served from its selected state root rather than packaged resources.

## Recommended release sequence

1. Freeze a release candidate and complete every automated and migration gate.
2. Prove one documented self-hosted web deployment, including HTTPS, TURN, backup, restore, upgrade, and rollback.
3. Authorize and smoke the rebuilt unsigned desktop artifacts internally, then add signing, clean-machine, upgrade, and data-retention tests.
4. Run a small invited alpha and collect join reliability, media quality, retention, moderation, and support data.
5. Fix alpha blockers and publish a self-hosted beta.
6. Only then complete the additional managed-service gates and consider a paid hosted beta.

See [ROADMAP.md](../ROADMAP.md) for sequencing, [EDITIONS.md](./EDITIONS.md) for the distribution contract, and [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) for go/no-go evidence.
