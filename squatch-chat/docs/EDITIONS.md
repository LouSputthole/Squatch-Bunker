# Campfire editions and distribution contract

Campfire uses one AGPL-3.0 codebase with two operating models. The free self-hosted edition is not a crippled trial; the managed hosted edition is intended to sell deployment, reliability, backups, monitoring, support, and—once implemented and measured—scalable media.

This page describes product intent, not a service-level agreement or legal advice. A managed offering is not considered launched until the [release checklist](./RELEASE_CHECKLIST.md) says so.

## Edition comparison

| | Free self-hosted | Managed hosted |
|---|---|---|
| License | AGPL-3.0 source | Same AGPL-3.0 application code |
| Price | No Campfire software fee | Recurring fee for hosting and operations |
| Explicit mode | `CAMPFIRE_EDITION=community` (also the safe default) | `CAMPFIRE_EDITION=cloud` |
| Operator | You or your organization | Campfire service operator |
| Core features | All shipped features in `CAMPFIRE_EDITION=community` or legacy `SELF_HOSTED=true`; Stripe presence is irrelevant | Same core product; plans may cover resource and support levels |
| Database | SQLite for a small single instance; PostgreSQL supported | Managed PostgreSQL expected |
| Web/realtime process | Custom unified Node server | Same custom server, operated as a service |
| Voice | WebRTC mesh; operator supplies TURN for reliable internet use | Managed TLS/TURN; SFU is required before claiming large-room scale |
| Backups | Operator designs, runs, encrypts, and restores them | Service must publish and test its backup/restore policy |
| Updates | Operator schedules upgrades and rollback | Service operator owns staged rollout and rollback |
| Monitoring/support | Operator-owned | Included according to the published plan; no SLA is implied yet |
| Data control | Lives on infrastructure chosen by the operator | Lives in the managed service under its privacy and retention terms |

## Free AGPL self-hosted edition

### What is included

- The complete application source, including the ten Campfire features documented in [GAP_ANALYSIS.md](./GAP_ANALYSIS.md).
- SQLite zero-configuration setup for small communities and PostgreSQL support for more durable deployments.
- The web application, custom unified Socket.IO server, peer-to-peer WebRTC voice/video, and background workers.
- Docker and manual VPS deployment paths.
- The open-source Electron/electron-builder packaging layer for portable and installer candidates; artifact readiness is tracked separately below.

There is no feature paywall in Community. Adding Stripe variables never silently changes the edition; they are ignored in Community mode. `SELF_HOSTED=true` remains a compatibility override that forces Community, but production operators should prefer the explicit `CAMPFIRE_EDITION=community` setting.

### What the self-host operator owns

- A supported Node.js runtime, database, DNS, TLS certificate, reverse proxy, firewall, and persistent file storage.
- A TURN server or service for reliable public-internet voice.
- Strong secrets, strict production CORS, operating-system hardening, updates, logs, alerting, and incident response.
- Database, public upload/avatar, and private-attachment backups, encrypted off-host retention, restore tests, and an upgrade/rollback procedure.
- Community rules, moderation, legal compliance, privacy disclosures, and user support.

The app is not “serverless”: `npm run host` must remain running. That custom server attaches Socket.IO and runs scheduled-message and leave-no-trace workers. Launching only `next start` produces an incomplete Campfire service.

### AGPL expectations

The repository is licensed under AGPL-3.0. If you modify Campfire and provide it as a network service, users must be offered the corresponding source as required by the license. Keep the license and source offer visible. Consult qualified counsel for obligations that depend on your distribution or service model.

## Managed hosted edition

The hosted product is convenience and operational confidence, not a closed-source fork. It uses `CAMPFIRE_EDITION=cloud`; production configuration validates PostgreSQL, an HTTPS application URL, a strong JWT secret, strict CORS, and `RESEND_API_KEY` plus `CAMPFIRE_EMAIL_FROM` for account recovery. Billing is enabled only when the Stripe secret, webhook secret, and both configured price IDs are present. Its value proposition is:

- zero-setup provisioning;
- managed PostgreSQL, TLS, TURN, secrets, upgrades, and rollback;
- automated encrypted backups with restore evidence;
- monitoring, abuse response, and a documented support channel;
- capacity controls and, once implemented, SFU-backed larger voice rooms.

The Stripe integration now has database-backed webhook idempotency and source-level safeguards for stale event ordering, approved price and subscription status, Stripe v22 item-level expiry, invoice paid/failed and cancellation transitions, guest rejection, Customer reuse, pending checkout claims, and unique Stripe customer/subscription IDs. Focused tests call the checkout and entitlement handler logic. This is still implementation evidence, not proof that a commercial service is ready: live signed-webhook, checkout, portal, refund, payment-failure, replay, and production-database drills remain release gates, alongside terms, privacy, status, support, restore, and incident response.

Password recovery uses Resend and the configured public application URL. The API gives a generic response for known and unknown accounts, stores only a token digest, consumes the token atomically once, and revokes prior sessions after reset. A managed launch still has to prove its sending domain, deliverability, bounce handling, abuse controls, and recovery monitoring.

## Distribution formats

### Source checkout

This is the canonical distribution and the first release path. It supports local SQLite development and explicit PostgreSQL production deployments. `db:migrate*` uses PostgreSQL; `db:sync`, `db:push`, `db:studio`, and `db:reset` use SQLite; `db:generate` and `db:check` cover both providers.

### Docker image and Compose stack

The production Compose path is PostgreSQL-only. It supplies persistent database, public upload/avatar, and private-attachment volumes, dependency ordering, and database-aware health checks. Operators must supply strong, unique `JWT_SECRET` and `DB_PASSWORD` values plus TLS, TURN, backups, monitoring, and tested upgrades. See [DEPLOY.md](./DEPLOY.md).

### Windows portable and installer candidates

Desktop packaging is an Electron/electron-builder layer around the same custom Campfire server. The intended outputs are:

- a portable Windows executable;
- an NSIS setup executable.

The workflow uses the `packaging/` staging/build layer and writes ignored artifacts under `desktop/dist/`. The current worktree passed staging and staged-runtime verification and rebuilt both candidates. Neither executable is signed, and actual artifact launch/install smoke was not run because this environment requires explicit authorization to execute unsigned local binaries. No independent clean-machine matrix has run. Installer state is intended for `%APPDATA%\Campfire`; portable state is intended for `CampfireData` beside the executable. A desktop artifact must not be advertised as production-ready until it:

1. launches `server.ts` rather than `next start`;
2. stores installer state under per-user application data and portable state under `CampfireData` beside the executable, never under packaged `resources/`;
3. stores and serves public uploads/avatars and private attachments from the same writable, backed-up state root;
4. rebuilds `better-sqlite3` for the bundled Electron ABI;
5. survives install, upgrade, rollback, and uninstall-with-data-retained tests;
6. ships without signing credentials in the repository; and
7. is signed and passes a clean Windows machine smoke test.

Portable means “no installer,” not “stateless.” Its `CampfireData` directory travels beside the executable; moving only the executable leaves that state behind. Mutable data must remain outside packaged application resources, and operators still own backups.

## Data portability and exit

Both editions should preserve a practical exit path:

- export or copy the database in a consistent state;
- copy public uploads/avatars and private attachments with it;
- retain the deployment version and migration state;
- restore into a clean compatible version before declaring the backup valid.

Formal one-click export/import is still a roadmap gap. Until it exists, moving between SQLite and PostgreSQL or between self-hosted and managed environments is an operator-assisted migration, not a promised button.

## Claims we do not make yet

- Discord feature parity or Discord-scale media capacity.
- A production SLA, recovery objective, or data-residency catalog for managed hosting.
- Production-ready mobile packages.
- Production-ready signed desktop installers.
- End-to-end encryption for stored text or direct messages.
- Automatic compliance with an operator’s industry or jurisdiction.

See [SECURITY.md](./SECURITY.md) for the trust model and [ROADMAP.md](../ROADMAP.md) for the work required to strengthen each edition.
