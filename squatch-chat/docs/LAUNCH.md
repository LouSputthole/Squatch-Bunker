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
- **Self-host:** anyone can run their own server with `npm run host:prod` or
  Docker (see the [README](../README.md)). Every feature is unlocked.
- **`/download`:** the public page that links all three.

All of it is free. Nothing can be bought until Stripe is configured on
Campfire Online (see [Turning on paid later](#turning-on-paid-later)).

## Go live

A copy-paste runbook for Campfire Online on Fly.io. Everything in
`<angle brackets>` is yours to fill in. `<domain>` is the public address
people will type, without `https://` (for example `campfire.chat`). Run the
commands from `squatch-chat/` in a Bash shell (Git Bash on Windows). You do
not need Docker: `fly deploy` builds the [`Dockerfile`](../Dockerfile) on
Fly's builders.

What gets deployed is [`fly.toml`](../fly.toml): one always-on machine (sockets,
voice signaling, and background jobs live in one process, so it never sleeps
and never runs a second copy), the uploads volume at `/app/media`, the health
check at `/api/health`, and the non-secret settings (`CAMPFIRE_EDITION=cloud`,
`STRICT_CORS=true`, `CAMPFIRE_TELEMETRY_COLLECTOR=1`,
`CAMPFIRE_TRUST_PROXY_HOPS=2`). Each deploy first runs `npm run deploy:release`
in a throwaway machine: the [launch check](../scripts/launch-checklist.ts)
fails the deploy if a required secret is missing, then database migrations
run, and only then is the live machine replaced.

### What it costs

Prices checked 2026-10-11 (sources: [Fly.io](https://fly.io/docs/about/pricing/),
[Neon](https://neon.com/pricing),
[DigitalOcean](https://www.digitalocean.com/pricing/droplets),
[Resend](https://resend.com/pricing)).

| Piece | Choice | Per month |
|---|---|---|
| App server | Fly.io `shared-cpu-1x`, 1 GB RAM, always on, region `iad` | $6.70 |
| Uploads | Fly volume, 1 GB ($0.15 per GB); daily snapshots, first 10 GB free | $0.15 |
| Bandwidth | Fly, $0.02/GB out in North America/Europe (50 GB shown) | ~$1 |
| HTTPS, IPv4, IPv6 | Fly shared IPv4, IPv6, certificate | $0 |
| Database | Neon Launch: 0.25 CU awake all month (182.5 CU-hours at $0.106), 1 GB storage ($0.35), about 1 GB of 7-day restore history ($0.20) | ~$20 |
| Voice relay (TURN) | coturn on a DigitalOcean Basic droplet (1 GB RAM, 1 TB transfer) | $6 |
| Password-reset email | Resend Free (3,000 a month, 100 a day) | $0 |
| Domain | about $12 a year | ~$1 |
| **Total** | | **about $35** |

- **Why not Neon Free:** Campfire checks for due scheduled messages every 15
  seconds, so the database never idles the 5 minutes it needs to sleep. That
  is about 182 CU-hours a month; Free includes 100 and then suspends the
  database until the next month (around day 16).
- **What grows the bill:** Neon compute when it autoscales above 0.25 CU under
  load, volume size, bandwidth past 50 GB, and a 2 GB machine (about $12.70) if
  `fly logs` ever shows the server running out of memory. The app idles at
  about 300 MB.

### 1. Accounts (once)

- **Fly.io:** sign up and add a card (new accounts have no free tier), install
  `fly` ([instructions](https://fly.io/docs/flyctl/install/)), then:

  ```bash
  fly auth login
  fly auth whoami
  ```

- **Neon** (database), **Resend** (password-reset email), **DigitalOcean** or
  any small VPS (voice relay), and access to your domain's DNS.
- In Resend, add `<domain>` and create the DNS records it shows, so mail can
  come from `account@<domain>`. Until it is verified, the sender
  `Campfire <onboarding@resend.dev>` works, but only delivers to your own
  Resend login email.

### 2. Database (Neon)

1. Create a project in region **AWS US East 1 (N. Virginia)**, next to Fly's
   `iad`. Prefer another Fly region? Pick the matching Neon region and change
   `primary_region` in `fly.toml`.
2. Move the account to the **Launch** plan. In the branch's compute settings,
   set autoscaling to **min 0.25, max 1** CU and turn **scale to zero off**.
3. Click **Connect**, turn **connection pooling off**, and copy the connection
   string: its host has no `-pooler`. Prisma migrations need this direct
   connection, and one machine needs only a few connections. It looks like
   `postgresql://neondb_owner:...@ep-....us-east-1.aws.neon.tech/neondb?sslmode=require`.
   With it, `fly logs` shows an SSL-mode `SECURITY WARNING` at each start; it
   is harmless (that mode already checks Neon's certificate fully).

### 3. Voice relay (coturn)

Fly cannot host TURN well: UDP there needs a dedicated IPv4 and a special bind
address, and coturn also needs a wide UDP relay port range. Use a small VPS:

1. Create a DigitalOcean droplet: Ubuntu 24.04, Basic, $6 a month (1 GB RAM,
   1 TB transfer), in the region nearest your users.
2. At your DNS provider, add an `A` record `turn.<domain>` pointing at the
   droplet's IPv4 address.
3. On the droplet, follow [DEPLOY.md: TURN-only host](./DEPLOY.md#turn-only-host-campfire-on-flyio).
   It ends with the shared secret you paste as `TURN_AUTH_SECRET` below.

Voice works without this between most home networks; it fails between many
office, school, and mobile networks. You can launch without it and add it
later (step 5's TURN lines, then the app restarts).

### 4. Create the app and its volume

```bash
fly apps create campfire-online
fly volumes create campfire_media --region iad --size 1 --yes
```

App names are global. If `campfire-online` is taken, choose another name,
change `app` in `fly.toml`, and use that name wherever these steps say
`campfire-online`. `--yes` accepts Fly's advice to create two volumes:
Campfire runs one machine on purpose.

### 5. Secrets

```bash
fly secrets set --stage \
  DATABASE_URL='<neon-direct-connection-string>' \
  JWT_SECRET="$(openssl rand -hex 32)" \
  NEXT_PUBLIC_APP_URL='https://<domain>' \
  CORS_ORIGINS='https://<domain>,https://campfire-online.fly.dev' \
  RESEND_API_KEY='<re_...>' \
  CAMPFIRE_EMAIL_FROM='Campfire <account@<domain>>' \
  TURN_URLS='["turn:turn.<domain>:3478?transport=udp","turn:turn.<domain>:3478?transport=tcp","turns:turn.<domain>:5349?transport=tcp"]' \
  TURN_AUTH_SECRET='<the-coturn-shared-secret>'
```

- No domain yet? Use `https://campfire-online.fly.dev` for
  `NEXT_PUBLIC_APP_URL`, and switch in step 8.
- No TURN yet? Leave out the two `TURN_` lines.
- Never change `JWT_SECRET` later: that signs everyone out. Fly keeps it; you
  do not need a copy.
- Leave every `STRIPE_*` setting unset: that is what keeps everything free.
  Optional: GitHub/Google sign-in pairs (`GITHUB_CLIENT_ID` +
  `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`), or
  `CAMPFIRE_BETA_ACCESS_CODE` for an invite-only soft launch (it cannot be
  combined with GitHub/Google sign-in).
- Check without deploying: `fly secrets list` shows names only. Locally,
  `npm run launch:check` runs the same check against your shell's environment.

### 6. Deploy

```bash
fly deploy --ha=false
fly status
curl -fsS https://campfire-online.fly.dev/api/health
```

The health check prints `{"status":"ok"}`. Watch the logs with `fly logs`. If
the deploy stops at the release step with `FIX:` lines, set those secrets and
run `fly deploy --ha=false` again; the live site is untouched until a release
step passes.

### 7. First admin

1. Open `https://campfire-online.fly.dev` and register your own account.
2. In the same browser, open `https://campfire-online.fly.dev/api/auth/me` and
   copy `user.id`.
3. Allow it into `/admin` (the app restarts in a few seconds):

   ```bash
   fly secrets set INSTANCE_ADMIN_USER_IDS='<your-user-id>'
   ```

4. Upload a picture in any channel. If it fails, the volume is not writable
   (Fly normally hands it to the app's user automatically); fix it once with
   `fly ssh console -C "chown -R node:node /app/media"`.

### 8. Your domain

```bash
fly certs add <domain>
```

Create exactly the DNS records it prints, then wait until
`fly certs check <domain>` reports the certificate as issued. If you used the
`fly.dev` address in step 5, switch now:

```bash
fly secrets set NEXT_PUBLIC_APP_URL='https://<domain>' CORS_ORIGINS='https://<domain>,https://campfire-online.fly.dev'
```

### 9. Prove the proxy setting

Rate limits (sign-in, sign-up, the install-ping collector's 20 pings an hour)
key on the caller's address. Fly's proxy appends the caller's address and then
its own to `X-Forwarded-For`, so `fly.toml` reads the second address from the
right (`CAMPFIRE_TRUST_PROXY_HOPS=2`). Prove it once, from your own network:

```bash
for i in $(seq 21); do curl -s -o /dev/null -w '%{http_code} ' -X POST -d '{}' https://<domain>/api/telemetry/ping; done; echo
curl -s -o /dev/null -w '%{http_code}\n' -X POST -d '{}' -H 'X-Forwarded-For: 203.0.113.9' https://<domain>/api/telemetry/ping
```

1. The first line prints twenty `400` and then one `429`: your address hit
   its limit.
2. The second line prints `429`: a forged header does not get a fresh limit.
   If it prints `400`, callers can forge their address: set
   `fly secrets set CAMPFIRE_TRUST_PROXY_HOPS=1`, and repeat from a new
   network.
3. Run the first line from another network (a phone hotspot). It must start
   with `400`. If it starts with `429`, everyone shares one limit: report it,
   because `lib/clientIp.ts` then needs to read Fly's `Fly-Client-IP` header.

Your own Windows app's ping from that network is dropped for the hour.

### 10. Build the domain into the releases

Set `OFFICIAL_CLOUD_URL` in [`lib/telemetry.ts`](../lib/telemetry.ts) to
`https://<domain>` (where self-hosted servers send their ping), and set
`campfireCloudUrl` in [`desktop/package.json`](../desktop/package.json) (or
`CAMPFIRE_CLOUD_URL=https://<domain>` in the environment when you run
`npm run desktop:stage`); the staging log prints the URL it baked in. Until
this is set, the Windows app only offers Host on this PC and nothing pings
anywhere. Settle the domain before this step: installed apps keep the URL
they were built with.

### 11. Publish the Windows app

Follow the desktop section of
[RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md#7-windows-portable-and-installer-workflow):
`npm run desktop:dist`, smoke-test both exes, then create a GitHub release
with all four files attached (the setup exe, its `.blockmap`, `latest.yml`,
and the portable exe) using the `gh release create` command there. Publish it
as a normal release, **not** a pre-release or draft: `/download`, portable
copies and installs on stable versions only see the repo's "latest" release,
and a release without `latest.yml` silently stops auto-update.

### 12. Smoke test, then share

- Sign up, post a message, upload a file, and make a voice call between a
  laptop and a phone on mobile data. The full TURN proof is the acceptance
  gate in [DEPLOY.md](./DEPLOY.md#turn-live-acceptance-gate).
- Free uptime alerts: point any uptime monitor at `https://<domain>/api/health`.
- Backups: Neon keeps 7 days of point-in-time history on Launch, and Fly
  snapshots the uploads volume daily for 5 days (`fly volumes list`, then
  `fly volumes snapshots list <volume-id>`).
- Share `https://<domain>/download`.

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
  [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md)). Installed copies check
  about 15 seconds after launch and then every 6 hours, download the new
  version in the background, and ask **Restart now / Later**; Later installs
  it the next time Campfire quits. Data is kept. Portable copies (and builds
  from before auto-update, once) instead offer **Download / Later / Skip this
  version**, which opens the release page. Online-client users get most
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

## Announcing a new version or Campfire Pro

One Fly secret on Campfire Online puts a dismissible banner in front of
everyone:

```bash
fly secrets set CAMPFIRE_NOTICE='{"id":"v0-2","text":"Campfire 0.2 is out: smoother voice and threads.","url":"https://<domain>/download","urlLabel":"Get it"}'
```

From PowerShell, pipe it instead so the quotes survive:
`'CAMPFIRE_NOTICE={"id":"v0-2","text":"..."}' | fly secrets import`.

Setting a secret restarts the app (a few seconds; live voice calls drop), so
pick a quiet moment, or add `--stage` to `fly secrets set` and it goes live
with the next `fly deploy`.

- **`id`**: letters, digits, `-` or `_`. People who dismiss a notice don't see
  that id again, so use a **new id** for each announcement (and when fixing a
  typo people should re-read).
- **`text`**: at most 280 characters.
- **`url`** and **`urlLabel`** (optional): an `https://` link and its button
  text (default "Learn more"), opened in a new tab.
- Check it with `curl https://<domain>/api/notice`. An invalid value shows
  nothing and logs one `CAMPFIRE_NOTICE is not a valid notice` line
  (`fly logs`).
- Clear it with `fly secrets unset CAMPFIRE_NOTICE`.

Who sees it:

- **Browser users of Campfire Online:** a banner at the top of chat until they
  dismiss it (remembered per browser).
- **Windows app in Campfire Online mode:** the same banner; that window is
  Campfire Online.
- **Windows app in Host on this PC mode:** no banner (the window is their own
  server); the launcher receives the notice in the answer to its ping (about
  20 seconds after launch, then daily) and shows it once per id as a small
  dialog ([TELEMETRY.md](./TELEMETRY.md#the-answer-broadcast-notices)). Users
  who turned the usage ping off don't get it.
- **Self-hosted servers:** never. Their reporter ignores the notice, and their
  users only see a `CAMPFIRE_NOTICE` their own operator sets.

For a new Windows release, publish the GitHub release first (the in-app
update prompt picks it up on its own), then point the notice at
`https://<domain>/download`. For Campfire Pro, point it at the Pro page once
it exists.
