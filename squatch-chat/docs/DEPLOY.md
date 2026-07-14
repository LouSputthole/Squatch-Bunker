# Deploying Campfire on the public internet

The self-host quick start (`npm ci && npm run host`) covers LAN use. This
guide takes the same build to a public domain with HTTPS and working
internet voice. Target: one small VPS (1–2 GB RAM), Ubuntu 22.04/24.04, a
domain name, ~30 minutes.

What you end up with:

```
Internet ──▶ Caddy (:443, auto-TLS) ──▶ Campfire (127.0.0.1:3000, systemd)
        └──▶ coturn (:3478 + UDP relay)   ← WebRTC media when P2P fails
```

Voice media stays peer-to-peer when it can; the TURN server only relays for
peers whose NATs won't connect directly. Everything else (pages, sockets,
uploads) goes through Caddy.

## 1. Campfire itself

```bash
# Node 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

sudo useradd -r -m -d /opt/campfire campfire
sudo -u campfire git clone https://github.com/LouSputthole/Squatch-Bunker.git /opt/campfire/app
cd /opt/campfire/app/squatch-chat
sudo -u campfire npm ci           # creates .env with a random JWT_SECRET, SQLite DB
sudo -u campfire npm run build
```

SQLite is fine for a friends-and-community server; switch `DATABASE_URL` to
Postgres only when you outgrow it (see README → Database).

Edit `.env` for a public deploy:

```bash
CAMPFIRE_EDITION=community
CAMPFIRE_BIND_HOST=127.0.0.1
NEXT_PUBLIC_APP_URL="https://campfire.example.com"
STRICT_CORS=true
CORS_ORIGINS="https://campfire.example.com"
CAMPFIRE_TRUST_PROXY_HOPS=1
```

`CAMPFIRE_BIND_HOST` enforces the loopback-only hop shown above instead of
relying on the firewall alone. The public application URL is required for
password-reset links and any OAuth or Stripe return URLs you later enable.
`CAMPFIRE_TRUST_PROXY_HOPS=1` is correct only for the single Caddy hop shown
here. Set the exact trusted hop count, and ensure the outermost proxy replaces
caller-supplied `X-Forwarded-For`; a directly exposed process must leave it
unset. Authentication and realtime limits otherwise use the socket address.

Run it under systemd — `/etc/systemd/system/campfire.service`:

```ini
[Unit]
Description=Campfire
After=network-online.target

[Service]
User=campfire
WorkingDirectory=/opt/campfire/app/squatch-chat
ExecStart=/usr/bin/npm run host
Environment=NODE_ENV=production
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now campfire
curl -sI http://127.0.0.1:3000 | head -1   # expect HTTP/1.1 307 (login redirect)
```

## 2. HTTPS with Caddy

Point an A record for `campfire.example.com` at the VPS, then:

```bash
sudo apt-get install -y caddy
```

`/etc/caddy/Caddyfile` — this is the whole config; Caddy gets Let's Encrypt
certificates automatically and proxies WebSockets without extra directives:

```
campfire.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

Caddy's forwarded host and protocol let `/api/config` derive browser runtime
URLs. `NODE_ENV=production` makes authentication cookies `Secure`.
`NEXT_PUBLIC_APP_URL` remains explicit because email, OAuth, and Stripe cannot
rely on request-time inference. If you use nginx instead, forward `Host`,
`Upgrade`, `Connection`, and `X-Forwarded-Proto` yourself.

Getting HTTPS right is not optional for voice: browsers only expose
microphone/camera (getUserMedia) on secure origins.

## 3. TURN with coturn (internet voice)

STUN alone connects most peers; TURN is the fallback relay that makes voice
work for the rest (symmetric NAT, strict firewalls, most mobile networks).

```bash
sudo apt-get install -y coturn
sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
```

`/etc/turnserver.conf` (replace the password and IPs):

```
listening-port=3478
fingerprint
lt-cred-mech
user=campfire:REPLACE-WITH-LONG-RANDOM-PASSWORD
realm=campfire.example.com
# advertise the VPS public IP (required on any cloud with NAT, e.g. AWS/GCP)
external-ip=YOUR.PUBLIC.IP
# keep the relay port range small so the firewall rule is small
min-port=49160
max-port=49200
no-cli
no-tlsv1
no-tlsv1_1
```

```bash
sudo systemctl enable --now coturn
```

Then in Campfire's `.env` (and restart the `campfire` service):

```bash
TURN_URL="turn:campfire.example.com:3478"
TURN_USERNAME="campfire"
TURN_CREDENTIAL="REPLACE-WITH-LONG-RANDOM-PASSWORD"
```

Campfire only hands these credentials to logged-in users (`/api/config`
withholds them from anonymous callers), but they are still one shared static
secret — fine at friends scale.
<!-- ponytail: static TURN creds; move to coturn use-auth-secret + per-user
     HMAC minting if relay abuse ever matters -->

## 4. Firewall

```bash
sudo ufw allow 22/tcp 80/tcp 443/tcp
sudo ufw allow 3478/tcp 3478/udp        # TURN
sudo ufw allow 49160:49200/udp          # TURN relay range (match turnserver.conf)
sudo ufw enable
```

Port 3000 stays closed — only Caddy talks to the app.

## 5. Verify

1. `https://campfire.example.com` loads with a padlock; register, create a
   server, send a message.
2. Voice across networks: join a voice room from two devices on different
   networks (e.g. one on phone LTE). If LAN-to-LAN works but LTE fails, TURN
   is misconfigured — test it at
   <https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/>
   with your `turn:` URL + credentials: you must see a `relay` candidate.
3. `sudo journalctl -u campfire -f` while a friend connects.

4. Upload an attachment, verify authenticated full, `HEAD`, and byte-range
   reads, revoke that member's channel access, and confirm both messages and
   the attachment immediately fail closed for that member.

## Updating

Treat the application checkout, database, media, and `.env` as one release
unit. Keep Campfire offline from the start of the backup until the upgraded
service is healthy. In particular, do not run `npm ci` while the old
process is still writing to SQLite.

```bash
cd /opt/campfire/app
git rev-parse HEAD                       # record this rollback commit
sudo systemctl stop campfire

# Take the coordinated database + media + .env backup described below now.
# Do not continue if either half of that backup fails.

sudo -u campfire git pull --ff-only
cd squatch-chat
sudo -u campfire npm ci

# SQLite only. postinstall already runs this, but the explicit command makes
# the offline migration gate visible and is safe to repeat.
sudo -u campfire npm run db:sync

# PostgreSQL only (run this instead of db:sync).
# sudo -u campfire npm run db:migrate

sudo -u campfire npm run build
sudo systemctl start campfire
curl -fsSI http://127.0.0.1:3000 >/dev/null
sudo systemctl --no-pager --full status campfire
```

If any install, migration, build, or health check fails, stop the service and
leave it stopped. Restore the database, media, and `.env` from the same
pre-upgrade snapshot, check out the recorded commit, reinstall/build that
version, and only then start Campfire. Do not run old application code against
a database that has already been migrated forward.

SQLite schema synchronization runs during `npm ci` or `npm run setup`, not
during `npm run host`. Do not skip it on an SQLite upgrade. PostgreSQL upgrades
use `npm run db:migrate` while the service is stopped.

## Backups

Persistent state is split across `data/campfire.db` (plus its WAL/SHM files),
`data/private-uploads/`, `public/uploads/`, `public/avatars/`, and `.env`
(losing the JWT secret logs everyone out). A database backup alone is not a
Campfire backup. If `CAMPFIRE_UPLOAD_DIR` is set, back up its `uploads/`,
`avatars/`, and `private-uploads/` subdirectories instead of those default
media paths.

Stop Campfire first, then create a consistent database backup and snapshot all
media directories with the same timestamp. Keep it stopped until both commands
finish and the upgrade completes:

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
sudo -u campfire mkdir -p \
  /opt/campfire/app/squatch-chat/data/private-uploads \
  /opt/campfire/app/squatch-chat/public/uploads \
  /opt/campfire/app/squatch-chat/public/avatars
sqlite3 /opt/campfire/app/squatch-chat/data/campfire.db \
  ".backup /var/backups/campfire-$STAMP.db"
tar -czf /var/backups/campfire-media-$STAMP.tar.gz \
  -C /opt/campfire/app/squatch-chat \
  data/private-uploads public/uploads public/avatars .env
```

For PostgreSQL, use `pg_dump` instead of the SQLite command. Encrypt and copy
the database and media snapshots off host, define retention, and restore both
into a clean compatible version before calling the backup valid.

### Docker Compose backup and clean restore

The production Compose stack stores PostgreSQL plus uploads, avatars, and
private attachments in four named volumes; `.env` remains outside those
volumes. Stop the app before taking the database and media snapshots so they
represent one recovery point. Run these commands from `squatch-chat` with the
active `.env` present. They create a plaintext recovery set: encrypt it, move
it off host, apply retention, and test the encrypted copy before calling it a
backup.

```bash
set -euo pipefail
umask 077
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="${BACKUP_ROOT:-$HOME/campfire-backups}/campfire-compose-$STAMP"
install -d -m 700 "$BACKUP_DIR"
git rev-parse HEAD > "$BACKUP_DIR/commit.txt"

docker compose -f docker-compose.prod.yml stop app
docker compose -f docker-compose.prod.yml exec -T db sh -c \
  'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "$BACKUP_DIR/database.dump"
docker compose -f docker-compose.prod.yml run --rm --no-deps -T \
  --entrypoint sh app -c \
  'exec tar -C /app/media -czf - uploads avatars private-uploads' \
  > "$BACKUP_DIR/media.tar.gz"
install -m 600 .env "$BACKUP_DIR/.env"
test -s "$BACKUP_DIR/database.dump"
test -s "$BACKUP_DIR/media.tar.gz"
(
  cd "$BACKUP_DIR"
  sha256sum database.dump media.tar.gz .env commit.txt > SHA256SUMS
)

docker compose -f docker-compose.prod.yml up -d --wait --wait-timeout 180 app
docker compose -f docker-compose.prod.yml ps
```

If the dump, media archive, or `.env` copy fails, leave the app stopped and
repair the backup process; do not continue an upgrade with a partial recovery
set.

Rehearse restore against the exact recorded commit on a separate disposable
host or VM; the fixed container names and published port prevent a safe
side-by-side drill on the production host. The following commands intentionally
destroy every Compose database and media volume for this project.
`docker compose down -v` is irreversible; run it only in that disposable
environment or during an approved recovery after the encrypted recovery set
and checksums have been verified.

```bash
set -euo pipefail
RESTORE_DIR="/secure/path/to/campfire-compose-YYYYMMDDTHHMMSSZ"
(cd "$RESTORE_DIR" && sha256sum -c SHA256SUMS)
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$(cat "$RESTORE_DIR/commit.txt")"
install -m 600 "$RESTORE_DIR/.env" .env
docker compose -f docker-compose.prod.yml build --pull app

docker compose -f docker-compose.prod.yml down -v
docker compose -f docker-compose.prod.yml up -d --wait --wait-timeout 120 db
docker compose -f docker-compose.prod.yml exec -T db sh -c \
  'exec pg_restore --clean --if-exists --no-owner --no-privileges \
    --exit-on-error --single-transaction \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < "$RESTORE_DIR/database.dump"
docker compose -f docker-compose.prod.yml run --rm --no-deps -T \
  --entrypoint sh app -c 'exec tar -C /app/media -xzf -' \
  < "$RESTORE_DIR/media.tar.gz"
docker compose -f docker-compose.prod.yml up -d --wait --wait-timeout 180 app
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml exec -T app \
  npm run runtime:verify:realtime -- http://127.0.0.1:3000
```

Finish the drill by logging in, opening representative messages and all three
media classes, and recording restore duration and data-loss window. Keep the
old recovery set until that acceptance passes.

### PostgreSQL databases without migration history

The supported v0.0.3 PostgreSQL upgrade path starts from a database created by
`npm run db:migrate`. Its first three migration names and checksums remain
unchanged, so the normal offline `npm run db:migrate` step applies the beta
migrations.

Do not try to baseline an untracked PostgreSQL database by marking those
migrations applied. The v0.0.3 `db:push` script selected the SQLite schema; it
did not create a supported PostgreSQL installation. A PostgreSQL database with
no `_prisma_migrations` history is therefore hand-built or otherwise outside
the published path, and may have provider-specific or operator drift that a
generic command cannot prove safe.

For such a database, stop the service, make a coordinated `pg_dump` plus
media/`.env` backup, and restore it into a disposable environment. Capture
`pg_dump --schema-only`, compare it with the actual v0.0.3 PostgreSQL migration
SQL, and have a PostgreSQL-qualified operator choose an explicit repair or data
export/import plan. Do not run beta `db:migrate` or `prisma migrate resolve`
against it until that review is complete.

## No-VPS alternatives

- **Cloudflare Tunnel / ngrok** get you HTTPS signaling in minutes with no
  server exposed — but voice media does not go through the tunnel (WebRTC is
  peer-to-peer), so cross-network voice still needs a TURN server somewhere.
  A rented TURN service (e.g. metered.ca) plugs into the same three env vars.
- **PaaS (Fly.io etc.)** needs persistent database storage plus persistent
  public uploads, avatars, and private attachments. Prefer one durable
  `CAMPFIRE_UPLOAD_DIR` with all three subdirectories; mounting only `data/`
  or only public media loses part of user media. Coturn wants a plain VM with
  a wide UDP range; if you're
  renting a machine for TURN anyway, the VPS recipe above is less moving
  parts.

## Scale ceiling

WebRTC voice here is a full mesh: every speaker uploads to every listener.
Past ~6 people in one room, upload bandwidth and CPU climb fast. That's an
architectural limit of mesh — bigger rooms need an SFU, which is on the
hosted-edition roadmap (`docs/HOSTED.md`), not a knob on this deploy.
