# Campfire

Campfire is an open-source, self-hostable voice and chat community app: Discord-shaped servers, channels, DMs, roles, text, and voice, with a warmer “sit around the fire” identity.

> **Current status: pre-release stabilization.** The current worktree is suitable for development and invited self-hosted alpha testing after the release gates pass. It is not yet claimed to have Discord parity, Discord-scale voice, a production SLA, or production-ready mobile/desktop distribution. Read the [gap analysis](./docs/GAP_ANALYSIS.md) and [release checklist](./docs/RELEASE_CHECKLIST.md) before exposing it publicly.

## What Campfire includes

The existing foundation includes:

- servers, categories, text and voice channels, membership, roles, channel permissions, invites, and moderation;
- messages, replies, threads, reactions, pins, search, authenticated private attachments, scheduled delivery, polls, and voice notes;
- friends, DMs, presence, profiles, personal blocks, guest access, and notification controls;
- WebRTC mesh voice, camera, screen sharing, push-to-talk, speaking indicators, per-user volume, device controls, and Socket.IO signaling;
- themes and the Campfire circle view, with SQLite or PostgreSQL persistence.

### Ten new Campfire features

1. **Managed invites** — rotate/revoke links, expiry, use limits, safe preview, and atomic use counting.
2. **Personal block/ignore** — directional block management that closes friend and DM paths.
3. **Campfire voice notes** — record, preview, cancel, send, and play microphone messages.
4. **Purpose-driven voice rooms and shared scenes** — Hangout, Game Night, Quiet Room, Workshop, and Story Time.
5. **Pass the Lantern** — a realtime speaking holder and request queue for a listening circle.
6. **Leave-no-trace rooms** — 1-, 7-, or 30-day text retention with scheduled cleanup.
7. **Camp Journal** — personal durable snapshots of messages worth keeping.
8. **Camp Votes** — channel polls with single/multiple choice and scheduled or manual close.
9. **Camp Gatherings** — scheduled events, RSVPs, reminders, counts, and active-room join links.
10. **Offshoots** — ephemeral side voice bubbles that can return to the main camp.

The exact authorization, lifecycle, and privacy boundaries are documented in [GAP_ANALYSIS.md](./docs/GAP_ANALYSIS.md). In particular, Lantern and Offshoot state is currently process-local, and Offshoot audio separation is client-side routing inside the parent WebRTC mesh—not a security boundary.

## Quick start: local or trusted-LAN self-host

Prerequisites:

- Node.js 22 LTS (`.nvmrc`; minimum supported by Next.js is 20.9)
- npm

From this directory:

```bash
npm install
npm run host
```

When neither `.env` nor `DATABASE_URL` exists, install creates a local `.env` with a random JWT secret, configures SQLite, generates the Prisma client, and initializes `data/campfire.db`. Open <http://localhost:3000>.

`npm run host` is the canonical runtime command. It starts the custom unified server that serves Next.js, attaches Socket.IO, and runs scheduled-message, leave-no-trace, and abandoned-private-upload workers. **Do not substitute `npm start`/`next start` for a complete Campfire service.**

The printed network URL is useful on a trusted LAN. Browsers generally require HTTPS for microphone, camera, and screen-capture access, so a plain `http://192.168.x.x` client may have text access without working media.

## Development and verification

```bash
# Full local service (run separately)
npm run host

# Automated release checks
npm run db:check
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Focused tests are useful during development, but a release candidate must run the full clean-checkout matrix in [RELEASE_CHECKLIST.md](./docs/RELEASE_CHECKLIST.md).

## PostgreSQL

SQLite is intended for a small, single Campfire instance. For a managed or larger deployment, set a PostgreSQL URL before database setup:

```bash
DATABASE_URL="postgresql://user:password@host:5432/campfire?schema=public"
npm install
npm run db:migrate
npm run db:check
npm run build
npm run host
```

How you set environment variables depends on your shell or service manager. Do not commit `.env`, and do not use the example JWT secret in production.

The database commands are provider-specific: `db:migrate` and `db:migrate:dev` use the PostgreSQL migration track, while `db:sync`, `db:push`, `db:studio`, and `db:reset` operate on SQLite. `db:generate` and `db:check` cover both provider-specific clients.

## Docker

The production Compose path is PostgreSQL-only. It includes the app plus PostgreSQL, database-aware health checks, dependency ordering, and persistent database/public-media/private-attachment volumes:

```bash
# Set strong, unique JWT_SECRET and DB_PASSWORD values first.
docker compose -f docker-compose.prod.yml up -d --build
```

Docker does not remove the need for a reverse proxy, HTTPS, TURN, encrypted backups, monitoring, updates, or restore drills. See [DEPLOY.md](./docs/DEPLOY.md) for the public VPS path.

## Public deployment requirements

At minimum, a public Campfire operator owns:

- HTTPS and secure cookies through a correctly configured reverse proxy;
- an exact `CAMPFIRE_TRUST_PROXY_HOPS` value only behind an outer proxy that replaces caller-supplied `X-Forwarded-For`;
- `STRICT_CORS=true` and an explicit `CORS_ORIGINS` allowlist;
- a strong `JWT_SECRET` and protected environment configuration;
- a TURN service tested across different networks;
- persistent database, public upload/avatar, and private-attachment storage;
- encrypted off-host backups and a completed restore drill;
- logs, health monitoring, alerts, patching, and incident response.

Password recovery sends single-use links through Resend. Configure `RESEND_API_KEY`, `CAMPFIRE_EMAIL_FROM`, and the public `NEXT_PUBLIC_APP_URL`. Campfire stores only a digest of each reset token, returns the same response for known and unknown accounts, consumes a valid token atomically, and revokes existing sessions after a successful reset. Production Cloud configuration rejects missing recovery-email settings; Community operators who leave them unset will not deliver recovery messages.

WebRTC voice is currently peer-to-peer mesh. It is appropriate for small rooms; past roughly six active participants, client CPU and upload cost rise quickly. Dormant LiveKit token groundwork exists, but `sfu_voice` remains planned and unavailable to every tier; the SFU client/deployment path is not complete and must not be marketed as shipped scale.

## Windows portable and installer status

Desktop distribution uses an Electron/electron-builder layer around the same custom server. The current worktree generates `Campfire-Portable-0.0.3-x64.exe` and `Campfire-Setup-0.0.3-x64.exe` as local release candidates.

The current worktree passed desktop staging and staged-runtime verification, then rebuilt both Windows candidates. Both binaries are still unsigned, and actual portable/installer launch smoke was not run because this environment requires explicit authorization to execute unsigned local artifacts. Installer state is intended for `%APPDATA%\Campfire`; portable state is intended for `CampfireData` beside the executable. Actual launch, NSIS install/upgrade/repair/uninstall, signing, and independent clean-machine tests remain release gates. These are not production-ready distribution claims.

The packaging entry points are the [electron-builder configuration](./packaging/electron-builder.json), [staging script](./packaging/stage-desktop.mjs), and [Electron launcher](./desktop/main.cjs). See the desktop section of [RELEASE_CHECKLIST.md](./docs/RELEASE_CHECKLIST.md) before publishing artifacts from `desktop/dist/`.

## Editions

- **Campfire Community:** the default free AGPL self-hosted edition. Set `CAMPFIRE_EDITION=community` explicitly in production; the compatibility override `SELF_HOSTED=true` also forces Community. Stripe keys do not silently switch editions and are ignored here.
- **Campfire Cloud:** set `CAMPFIRE_EDITION=cloud` for the managed multi-tenant product. Billing stays disabled when required Stripe configuration is incomplete, and production Cloud configuration validates PostgreSQL, HTTPS, strong JWT, strict CORS, and recovery-email prerequisites. Cloud is not ready to take payment until the live managed-service release gates pass.

The full product and operator contract is in [EDITIONS.md](./docs/EDITIONS.md). The older hosted design notes remain in [HOSTED.md](./docs/HOSTED.md), but the release checklist is the go/no-go authority.

## Security and privacy

- HTTPS protects pages, APIs, attachments, and Socket.IO in transit.
- Browser WebRTC media uses DTLS-SRTP; peer-to-peer media does not pass through the Campfire application server.
- New message and DM attachments use authenticated API URLs outside the public web root; every read rechecks current channel, DM, or Journal access. Legacy `/uploads` media and avatars remain public-by-URL.
- Stored text, DMs, membership data, and all local attachment bytes are readable by the server operator.
- Campfire does not currently offer end-to-end encryption for stored text.

See [SECURITY.md](./docs/SECURITY.md) for the threat model and operator hardening list. Please report vulnerabilities through a private GitHub security advisory rather than posting exploit details publicly.

## Tech stack

| Layer | Technology |
|---|---|
| Web | Next.js 16 App Router, React 19, Tailwind CSS |
| Database | Prisma 7 with SQLite (`better-sqlite3`) or PostgreSQL (`pg`) adapters |
| Realtime | Socket.IO attached to the custom single-port Node server |
| Media | Browser WebRTC mesh with optional STUN/TURN configuration |
| Auth | JWT in HttpOnly cookies; bcrypt password hashes |
| Desktop candidate | Electron and electron-builder packaging |

## Documentation

- [Gap analysis](./docs/GAP_ANALYSIS.md) — what is complete, bounded, or still missing
- [Editions](./docs/EDITIONS.md) — free AGPL self-hosting versus managed hosting
- [Release checklist](./docs/RELEASE_CHECKLIST.md) — evidence required before shipping
- [Deployment guide](./docs/DEPLOY.md) — HTTPS/TURN VPS recipe
- [Security posture](./docs/SECURITY.md) — encryption, operator trust, and hardening
- [Roadmap](./ROADMAP.md) — prioritized path from alpha to a durable product

## License

Campfire is licensed under [AGPL-3.0](./LICENSE). You may self-host, modify, and redistribute it under that license. If you provide a modified version as a network service, the AGPL includes corresponding-source obligations; obtain legal advice for your specific use.
