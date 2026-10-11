# Launching Campfire: owner runbook

How to take Campfire public, see how many people use it, and get them
updates. Everything is free for now.

## What we have

- **Campfire Online:** one shared Campfire that everyone uses in the browser.
  It is this same code running with `CAMPFIRE_EDITION=cloud`. People sign up
  (or join as a guest), create servers, and invite friends.
- **The Windows app:** an installer (`Campfire-Setup-<version>-x64.exe`) and a
  portable exe. A fresh install opens Campfire Online, so desktop and browser
  users meet in the same place. Its other mode, **Host on this PC**, runs a
  private Campfire on that computer, with optional LAN sharing. People
  upgrading from an older build that already has a local camp stay on Host on
  this PC. Anyone can switch from the tray menu.
- **Self-host:** anyone can run their own server with `npm run host` or
  Docker (see the [README](../README.md)). Every feature is unlocked.
- **`/download`:** the public page that links all three.

All of it is free. Nothing can be bought until Stripe is configured on
Campfire Online (see [Turning on paid later](#turning-on-paid-later)).

## Go-live checklist

1. **Pick the domain.** Below, `https://<domain>` means it.
2. **Deploy Campfire Online** from the Docker image in
   [`squatch-chat/Dockerfile`](../Dockerfile). Recommended: a Fly.io app plus
   managed PostgreSQL such as Neon.
   - Run **exactly one** app machine. Rate limits and live voice-room state
     are per process.
   - The container serves port `3000`, has a health check at `/api/health`,
     only accepts a PostgreSQL `DATABASE_URL`, and runs `npm run db:migrate`
     on every start, so migrations happen on deploy. (Running from source
     instead? Run `npm run db:migrate` yourself before `npm run host`.)
   - Create a Fly volume and mount it at `/app/media` for uploads, avatars,
     and private attachments. Upload a picture right after the first deploy:
     the image runs as the `node` user, and a fresh volume can be owned by
     root.
   - Set these as Fly secrets / environment
     (names match [`.env.example`](../.env.example)):

     | Variable | Value |
     |---|---|
     | `CAMPFIRE_EDITION` | `cloud` |
     | `DATABASE_URL` | `postgresql://...` from Neon |
     | `JWT_SECRET` | output of `openssl rand -hex 32`. Never change it later: that logs everyone out. |
     | `NEXT_PUBLIC_APP_URL` | `https://<domain>` |
     | `STRICT_CORS` | `true` |
     | `CORS_ORIGINS` | `https://<domain>` |
     | `RESEND_API_KEY`, `CAMPFIRE_EMAIL_FROM` | password-reset email (Resend), e.g. `Campfire <account@<domain>>` |
     | `CAMPFIRE_UPLOAD_DIR` | `/app/media` |
     | `CAMPFIRE_TELEMETRY_COLLECTOR` | `1` (accept install pings, show counts on `/admin`) |
     | `INSTANCE_ADMIN_USER_IDS` | your user ID: register, open `/api/auth/me`, copy `user.id`, set it, restart |
     | `TURN_URLS`, `TURN_AUTH_SECRET` | voice across the internet ([DEPLOY.md section 3](./DEPLOY.md#3-turn-with-coturn-internet-voice)) |

     Cloud refuses to start in production without PostgreSQL, an HTTPS app
     URL, a 32+ character `JWT_SECRET`, the two Resend settings, and strict
     CORS. Leave every `STRIPE_*` variable unset (that is what keeps it
     free). Optional: GitHub/Google sign-in pairs, or
     `CAMPFIRE_BETA_ACCESS_CODE` for an invite-only soft launch (it cannot be
     combined with GitHub/Google sign-in).
   - **Proxy hops matter.** Rate limits key on the caller's address. Behind
     Fly's proxy, every request arrives from Fly unless
     `CAMPFIRE_TRUST_PROXY_HOPS` is set, so all visitors share one bucket:
     logins get rate-limited at busy times, and the install-ping collector
     (20 pings an hour per address) drops nearly every ping. Fly adds the real client address as
     the last `X-Forwarded-For` entry, which is what
     `CAMPFIRE_TRUST_PROXY_HOPS=1` reads. Check that against the proxy rules
     in [DEPLOY.md](./DEPLOY.md#1-campfire-itself) before launch; a wrong
     value lets clients spoof their address.
   - TURN needs a wide UDP port range that Fly does not offer; the simplest
     path is a small VPS running coturn as in DEPLOY.md.
   - Point the domain at Fly (`fly certs add <domain>`), then sign up, post a
     message, upload a file, and make a voice call from two networks.
3. **Build the domain into the releases.** Set `OFFICIAL_CLOUD_URL` in
   [`lib/telemetry.ts`](../lib/telemetry.ts) to `https://<domain>` (where
   self-hosted servers send their ping), and set `campfireCloudUrl` in
   [`desktop/package.json`](../desktop/package.json) (or
   `CAMPFIRE_CLOUD_URL=https://<domain>` in the environment when you run
   `npm run desktop:stage`); the staging log prints the URL it baked in.
   Until this is set, the Windows app only offers Host on this PC and nothing
   pings anywhere.
4. **Build and publish the Windows app.** Follow the desktop section of
   [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md#7-windows-portable-and-installer-workflow):
   `npm run desktop:dist`, smoke-test both exes, then create a GitHub release
   with both files attached. Publish it as a normal release, **not** a
   pre-release or draft: `/download` and the in-app update check only see the
   repo's "latest" release.
5. **Share `https://<domain>/download`.**

## How many people

On Campfire Online, open `/admin` (instance admins only). It shows:

- **People on this instance:** Campfire Online's own users, counted directly
  (distinct people who posted), plus sign-ups per day;
- **Campfire in the wild:** installs that pinged in the last day, 7 days, and
  30 days, split into Windows app online, Windows app host-on-PC, and
  self-hosted servers; accounts on those servers; new installs per day; and
  versions in use;
- **GitHub release downloads** for the published exes.

What the pings contain, and how people opt out, is in
[TELEMETRY.md](./TELEMETRY.md). Download counts are also one command away:

```bash
gh api repos/LouSputthole/Squatch-Bunker/releases --jq '.[] | {tag: .tag_name, downloads: [.assets[] | {name, download_count}]}'
```

## Shipping updates

- **Browser users:** redeploy Campfire Online (`fly deploy`). Everyone has the
  new version on their next page load. Migrations run on start.
- **Windows app users:** bump `version` in `package.json` **and**
  `desktop/package.json` (staging refuses a mismatch), build, and publish a
  new GitHub release as above (see
  [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md)). Every installed app checks
  about 15 seconds after its next launch and offers **Download / Later /
  Skip this version**. Download opens the release page; running the new setup
  upgrades in place and keeps their data. Online-client users get most
  improvements from the web redeploy alone; the exe only needs updating for
  desktop changes.
- **Self-hosters:** write clear release notes (what changed, any migration or
  new setting). Servers that have not opted out ping their version, so
  `/admin` shows how many still run old ones.

## Turning on paid later

Campfire Online is free while billing is not configured: with no Stripe
settings, nothing can be bought, so every feature is unlocked. When you are
ready, set the four Stripe settings (`STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`) on
Campfire Online and restart. That is the switch: premium tiers turn on there,
and self-hosted Community servers stay fully unlocked. See
[EDITIONS.md](./EDITIONS.md) and the managed go-live gates in
[RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md#9-managed-hosted-go-live-additions)
before charging anyone. A paid offer for self-hosters is a later decision.

## Known gaps

- **Unsigned exe.** Windows SmartScreen shows "Windows protected your PC";
  users click **More info**, then **Run anyway**. Code signing is the fix.
- **GitHub/Google sign-in inside the Windows app** opens the system browser,
  so the sign-in lands in the browser, not the app. Email/password and guest
  sign-in work in the app itself.
- **Voice over the internet needs TURN.** Without it, calls between people on
  many home, office, and mobile networks fail to connect.
- **Voice rooms are peer-to-peer**, comfortable up to about 6 people per room
  until the SFU work ships.
