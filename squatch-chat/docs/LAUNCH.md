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
     and private attachments. A fresh volume is owned by root, but the image
     runs as the `node` user, so every upload fails until you hand it over.
     Once, right after the first deploy (Fly SSH runs as root):

     ```bash
     fly ssh console -C "chown -R node:node /app/media"
     ```

     Then upload a picture to confirm.
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
     (20 pings an hour per address) drops nearly every ping; `/admin` shows a
     warning while it is unset. Fly adds the real client address as
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
   repo's "latest" release. Update the status banner at the top of
   [`squatch-chat/README.md`](../README.md), which still describes an invited
   self-host beta.
5. **Publish the rules, and be ready for trouble.** A public service that
   collects emails and install pings needs, before anyone is invited:
   - the Terms of Service (with its acceptable-use rules) at `/terms` and the
     Privacy Policy at `/privacy`. Both are drafts: have a lawyer review
     them. They only render on `CAMPFIRE_EDITION=cloud`, and `/register`, the
     guest form and GitHub/Google buttons on `/login`, and `/download` link
     them there. Fill in every `[placeholder]` in
     [`lib/legal.ts`](../lib/legal.ts), the one place for your legal name,
     contact, abuse and DMCA addresses, mailing address, governing law,
     effective dates, and hosting providers; until you do, both pages show a
     draft notice and the server logs which values are missing. The document
     text lives in `app/terms/terms.ts` and `app/privacy/privacy.ts`; the
     owner notes at the top of each list what to keep in sync;
   - a DMCA designated agent registered with the US Copyright Office
     (copyright.gov/dmca-directory), matching `DMCA_AGENT` and `DMCA_EMAIL`,
     or the copyright safe harbor doesn't apply;
   - a CyberTipline account with NCMEC, since the Terms promise to report
     child sexual exploitation there;
   - a named person and address for abuse reports, and a habit of checking
     `/admin`'s two report lists (user-level reports, and every message report
     from the last 30 days, including ones a camp's moderators dismissed);
   - a way to keep what the Terms promise in sections 7, 9, and 14 (remove
     content anywhere, ban accounts, end repeat infringers). The app has no
     instance-wide moderation tools yet, so until it does, this is the
     runbook, using the database console and the `/app/media` volume:
     - **Remove illegal or infringing content.** `/admin` shows report,
       message, and account ids. Delete the `"Message"` row, any Camp Journal
       copies (`"JournalEntry"` rows with that `"sourceMessageId"`), and the
       file: an `attachmentUrl` of `/uploads/<name>` is
       `/app/media/uploads/<name>`, and a `privateUploadId` is the
       `"PrivateUpload"` row whose `storageKey` names the file under
       `/app/media/private-uploads/` (delete that row too). For child sexual
       abuse material, report it to the NCMEC CyberTipline and keep a copy of
       the material and the account's details in secure storage before
       deleting: US law (18 U.S.C. 2258A) requires preserving them for a year
       after a report.
     - **Ban an account.** There is no ban switch. Adding 1 to
       `"tokenVersion"` signs the account out everywhere and setting
       `"passwordHash"` to `'banned'` stops password sign-in, but **Forgot
       password** and GitHub/Google sign-in still let the owner back in, and
       nothing stops the same person registering again. Build a real ban (a
       disabled flag checked at sign-in and on every session, and blocked
       email hashes checked at sign-up and GitHub/Google sign-up) before
       relying on the Terms' ban and repeat-infringer promises.
     - **DMCA.** Log every notice and counter-notice with the account it
       names, so you can find repeat infringers (Terms section 9);
   - backups you have restored once: Neon point-in-time recovery on, and Fly
     volume snapshots on for `/app/media`.

   The Stripe items in
   [RELEASE_CHECKLIST.md section 9](./RELEASE_CHECKLIST.md#9-managed-hosted-go-live-additions)
   can wait for the paid switch; these can't.
6. **Share `https://<domain>/download`.**

## How many people

On Campfire Online, open `/admin` (instance admins only). It shows:

- **People on this instance:** Campfire Online's own users, counted directly
  (distinct people who posted), plus sign-ups per day;
- **Campfire in the wild:** installs that pinged in the last day, 7 days, and
  30 days, split into Windows app online, Windows app host-on-PC, and
  self-hosted servers; accounts on those servers; new installs per day; and
  versions in use;
- **GitHub release downloads** for the published exes.

Read the wild numbers as a floor. Opted-out installs never appear. A
self-hosted server only pings in production (`NODE_ENV=production`, as with
Docker or the systemd setup in DEPLOY.md), so a README quick start
(`npm run host`) is never counted. A **Host on this PC** camp counts as one
desktop install: the friends who join it over the LAN are counted nowhere.

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
  new setting). Production servers that have not opted out ping their
  version, so `/admin` shows how many of those still run old ones.

## Turning on paid later

Campfire Online is free while billing is not configured: with no Stripe
settings, nothing can be bought, so every feature is unlocked. When you are
ready, set the four Stripe settings (`STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`) on
Campfire Online and restart. That is the switch: premium tiers turn on there,
and self-hosted Community servers stay fully unlocked. Rewrite section 13 of
the Terms (`app/terms/terms.ts`: price, renewal, cancellation, refunds) first:
it says nothing on Campfire Online can be bought, and the server logs a
warning while billing is on. See
[EDITIONS.md](./EDITIONS.md) and the managed go-live gates in
[RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md#9-managed-hosted-go-live-additions)
before charging anyone.

That switch covers Campfire Online only. A paid **client-hosted** version
(a Campfire a customer runs, or that we run for one customer) does not exist
in code yet: billing can only be on in the cloud edition, self-hosted
Community servers can never charge, and [HOSTED.md](./HOSTED.md) rules out
one instance per customer today. Offering it needs a decision first: managed
per-client instances (reversing HOSTED.md), or a paid license or support plan
for self-hosters.

## Known gaps

- **Unsigned exe.** Windows SmartScreen shows "Windows protected your PC";
  users click **More info**, then **Run anyway**. Code signing is the fix.
- **No GitHub/Google sign-in inside the Windows app.** The app hides those
  buttons: the provider page can't run in the app window, and a sign-in
  finished in the system browser signs in the browser, not the app.
  Email/password and guest sign-in work in the app. Someone who signed up
  with GitHub/Google uses **Forgot password?** once to set a password, then
  signs in to the app with it.
- **Voice over the internet needs TURN.** Without it, calls between people on
  many home, office, and mobile networks fail to connect.
- **Voice rooms are peer-to-peer**, comfortable up to about 6 people per room
  until the SFU work ships.
