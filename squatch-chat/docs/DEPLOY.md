# Deploying Campfire on the public internet

The self-host quick start (`npm ci && npm run host`) covers LAN use. This
guide takes the same build to a public domain with HTTPS and working
internet voice. Target: one small VPS (1–2 GB RAM), Ubuntu 22.04/24.04, a
domain name, ~30 minutes.

What you end up with:

```
Internet ──▶ Caddy (:443, auto-TLS) ──▶ Campfire (127.0.0.1:3000, systemd)
        └──▶ coturn (:3478 UDP/TCP, :5349 TLS/TCP + relay UDP)
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

Edit `.env` for a public deploy. Generate a separate invited-beta
access code first, then paste the output into the block below.
`openssl rand -hex 16` provides 128 bits of randomness; do not put the
command itself in `.env` or expose its output in tickets or logs.

```bash
openssl rand -hex 16
```

```bash
CAMPFIRE_EDITION=community
CAMPFIRE_BIND_HOST=127.0.0.1
NEXT_PUBLIC_APP_URL="https://campfire.example.com"
STRICT_CORS=true
CORS_ORIGINS="https://campfire.example.com"
CAMPFIRE_TRUST_PROXY_HOPS=1
CAMPFIRE_BETA_ACCESS_CODE="PASTE-THE-GENERATED-CODE-HERE"
```

`CAMPFIRE_BIND_HOST` enforces the loopback-only hop shown above instead of
relying on the firewall alone. The public application URL is required for
password-reset links and any OAuth or Stripe return URLs you later enable.
`CAMPFIRE_TRUST_PROXY_HOPS=1` is correct only for the single Caddy hop shown
here. Set the exact trusted hop count, and ensure the outermost proxy replaces
caller-supplied `X-Forwarded-For`; a directly exposed process must leave it
unset. Authentication and realtime limits otherwise use the socket address.

`CAMPFIRE_BETA_ACCESS_CODE` is required for new permanent accounts and
guest sessions; existing users can continue to log in. Keep it in the same
secret store as `JWT_SECRET` and distribute it only to invited testers.
GitHub and Google OAuth must stay disabled while this gate is set because OAuth
signup would bypass the code. Remove (do not populate) `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, and
`GOOGLE_CLIENT_SECRET`. Campfire refuses to start if the beta gate and
any OAuth provider are enabled together.

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
    header Strict-Transport-Security "max-age=31536000"
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

STUN alone connects most peers; TURN is the required fallback for symmetric
NAT, restrictive firewalls, and mobile networks. Use a dedicated DNS name such
as `turn.campfire.example.com`. Point its A record directly at the TURN
host; publish AAAA only after the IPv6 listener and relay path pass the same
acceptance gate. Caddy does not proxy TURN traffic.

Install coturn and generate one 256-bit shared secret. The root-owned temporary
file keeps it out of shell history and command output. Store the value in the
deployment secret manager, paste the exact same value into coturn's
`static-auth-secret` and Campfire's `TURN_AUTH_SECRET`, then
remove the temporary file under the host's secret-handling policy.

```bash
sudo apt-get install -y coturn
sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo sh -c 'umask 077; openssl rand -hex 32 > /root/campfire-turn-auth-secret'
sudo awk 'length($0) >= 32 { valid=1 } END { exit !valid }' \
  /root/campfire-turn-auth-secret
```

Provision a publicly trusted certificate whose SAN includes
`turn.campfire.example.com`. The Ubuntu package normally runs as group
`turnserver`; substitute the actual service group if it differs. Copy
renewed material into stable coturn-readable paths instead of granting coturn
access to an entire ACME account directory.

```bash
sudo install -d -o root -g turnserver -m 750 /etc/coturn/tls
sudo install -o root -g turnserver -m 640 \
  /secure/path/to/turn-fullchain.pem /etc/coturn/tls/fullchain.pem
sudo install -o root -g turnserver -m 640 \
  /secure/path/to/turn-privkey.pem /etc/coturn/tls/privkey.pem
```

Use this `/etc/turnserver.conf`. Replace both placeholders. Behind
one-to-one NAT use `external-ip=PUBLIC_IP/PRIVATE_IP` and preserve relay
port numbers through the mapping.

```
listening-port=3478
tls-listening-port=5349
fingerprint
use-auth-secret
static-auth-secret=PASTE-EXACT-TURN_AUTH_SECRET-HERE
realm=turn.campfire.example.com
stale-nonce=600
max-allocate-lifetime=900

# Limits for the small public-beta host.
user-quota=4
total-quota=40
max-bps=3000000
bps-capacity=25000000

external-ip=YOUR.PUBLIC.IP
min-port=49160
max-port=49200

cert=/etc/coturn/tls/fullchain.pem
pkey=/etc/coturn/tls/privkey.pem
no-tlsv1
no-tlsv1_1
no-dtls

# Client-to-coturn may be TCP/TLS; WebRTC peer relays remain UDP.
no-tcp-relay
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
no-cli

syslog
new-log-timestamp
```

`max-bps` and `bps-capacity` are bytes per second, with input
and output treated separately. The example caps one allocation at 3 MB/s and
the host at 25 MB/s. Tune only from measured link capacity and keep
`total-quota` within the bounded relay-port capacity. Do not enable
`verbose`, `log-binding`, or username-labeled metrics in steady
state; retain allocation, usage, and error records without logging secrets.

The denied peer ranges stop authenticated TURN clients from using the relay to
reach loopback, private, carrier-grade NAT, link-local, or cloud-metadata
addresses visible from the host. Add every deployment-specific internal range;
do not add an `allowed-peer-ip` override unless the security review explicitly
requires and approves that destination.

Protect the config, start coturn, and verify both listeners and the certificate.
Configuration changes require a coturn restart.

```bash
sudo chown root:turnserver /etc/turnserver.conf
sudo chmod 640 /etc/turnserver.conf
sudo systemctl enable coturn
sudo systemctl restart coturn
sudo systemctl --no-pager --full status coturn
sudo ss -lntup | grep -E ':(3478|5349)\b'
openssl s_client -connect turn.campfire.example.com:5349 \
  -servername turn.campfire.example.com \
  -verify_hostname turn.campfire.example.com -verify_return_error \
  </dev/null
```

Certificate automation must atomically install each renewed certificate and key
with the ownership above, then reload TLS material. Verify the new certificate
serial and expiry after every renewal. If the installed coturn lacks
`SIGUSR2` certificate reload, schedule `systemctl restart coturn`
and expect active relay allocations to reconnect.

```bash
sudo systemctl kill --kill-who=main --signal=SIGUSR2 coturn
```

Configure Campfire with this one-line JSON array in transport preference order.
Paste the same secret generated above; it remains server-only. Fifteen-minute
credentials are the beta default.

```bash
TURN_URLS='["turn:turn.campfire.example.com:3478?transport=udp","turn:turn.campfire.example.com:3478?transport=tcp","turns:turn.campfire.example.com:5349?transport=tcp"]'
TURN_AUTH_SECRET="PASTE-EXACT-TURN_AUTH_SECRET-HERE"
TURN_CREDENTIAL_TTL_SECONDS="900"
TURN_ALLOW_LEGACY_STATIC_CREDENTIALS="0"
```

Do not set `TURN_URL`, `TURN_USERNAME`, or
`TURN_CREDENTIAL` for the beta. Restart Campfire only after coturn is
healthy:

```bash
sudo systemctl restart campfire
sudo journalctl -u campfire -u coturn --since '-5 minutes' --no-pager
```

Authenticated `/api/config` responses contain only time-limited
`timestamp:user-id` credentials and the three URLs. Anonymous responses
contain none of them, and `TURN_AUTH_SECRET` must never reach a browser.

### Non-beta legacy compatibility

Singular `TURN_URL` plus static username/password remains only for old
private installations. It does not satisfy beta readiness and is rejected
unless explicitly enabled:

```bash
TURN_ALLOW_LEGACY_STATIC_CREDENTIALS="1"
TURN_URL="turn:legacy-turn.example.com:3478?transport=udp"
TURN_USERNAME="legacy-username"
TURN_CREDENTIAL="legacy-password"
```

### Shared-secret rotation

Coturn accepts multiple `static-auth-secret` entries for bounded
overlap, but config changes still require a restart:

1. Generate a new secret with `openssl rand -hex 32`. Keep the old
   `static-auth-secret` line and add the new one; restart coturn in an
   announced reconnect window.
2. Change Campfire's `TURN_AUTH_SECRET` to the new value, restart
   Campfire, and prove newly issued credentials allocate through all transports.
3. Wait at least `TURN_CREDENTIAL_TTL_SECONDS` plus
   `max-allocate-lifetime` (30 minutes here), while confirming active
   calls refresh and reconnect.
4. Remove the old coturn secret, restart coturn in a second announced reconnect
   window, and prove old credentials fail while new credentials still work.

Treat either restart as disruptive to active relays. Record non-secret secret
version IDs, restart times, reconnect results, and the operator who removed the
old value.

## 4. Firewall

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3478/tcp                 # TURN over TCP
sudo ufw allow 3478/udp                 # TURN over UDP
sudo ufw allow 5349/tcp                 # TURN over TLS/TCP
sudo ufw allow 49160:49200/udp          # UDP relay range
sudo ufw enable
```

Port 3000 stays closed — only Caddy talks to the app.

## 5. Verify

Run the public-only automated staging gate first (details and limitations are
in [`STAGING_VERIFICATION.md`](STAGING_VERIFICATION.md)):

```bash
npm run staging:verify -- https://campfire.example.com
```

That gate verifies the public application boundary but cannot prove that coturn
allocates or relays media. Complete every live check below on staging with
dedicated test accounts. Use the authenticated `/api/config` response's
temporary username, credential, expiry, and `turnUrls`; never enter
`TURN_AUTH_SECRET` into a browser or test tool. Do not retain raw
temporary credentials in screenshots, logs, or release evidence.

### TURN live acceptance gate

1. **Exposure and positive control.** Confirm anonymous `/api/config`
   contains no TURN URLs or credentials. Confirm an authenticated response
   contains exactly the UDP, TCP, and TLS/TCP URLs, an expiry-bearing
   `timestamp:user-id` username, a non-empty HMAC credential, and
   `turnExpiresAt`. With those temporary values, the
   [WebRTC Trickle ICE sample](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
   must produce a `relay` candidate.
2. **Wrong credential.** Change one character of the temporary credential and
   request a new allocation. It must produce no `relay` candidate, while
   coturn records an authentication rejection without logging the submitted
   password or shared secret.
3. **Expired credential.** Keep one captured temporary credential until after
   `turnExpiresAt`; a new allocation with it must fail. Fetch
   `/api/config` again and prove the replacement credential succeeds.
   An isolated staging drill may temporarily set
   `TURN_CREDENTIAL_TTL_SECONDS=60`; restore `900` afterward.
4. **UDP and plain TCP.** Test the `turn:` URL with
   `transport=udp`, then the separate `transport=tcp` URL. Each
   must independently produce a relay candidate. Record the selected
   client-to-TURN transport, not any credential.
5. **UDP-blocked TLS fallback.** From a client network that blocks outbound UDP,
   use the `turns:` URL on 5349 with `transport=tcp`. Verify the
   certificate hostname/chain and a relay candidate, then complete a media
   session. A TCP connection to 3478 is not evidence for the TLS fallback.
6. **TTL survival and reconnect.** Keep a forced-relay two-device call active
   for at least `TURN_CREDENTIAL_TTL_SECONDS + 120` seconds and confirm
   uninterrupted bidirectional audio. Disconnect after the original expiry,
   reconnect without reloading the page, and confirm the browser obtained fresh
   credentials and relayed again.
7. **Quota and recovery.** Using one test account, create four concurrent relay
   allocations. A fifth must be rejected by `user-quota=4`. Close one,
   wait for coturn to release it, and confirm a replacement allocation succeeds.
   Separately exercise the total-quota alert before production load approaches
   `total-quota=40`; never exhaust the production host deliberately.
8. **Secret rotation.** Perform [Shared-secret rotation](#shared-secret-rotation).
   Prove credentials minted under the new secret work, the retired-secret
   credential fails after the overlap, active calls recover from each announced
   coturn restart, and no secret appears in logs or evidence.
9. **Two-device media acceptance.** Put two physical devices on different
   networks (for example wired/Wi-Fi and mobile data), force relay-only ICE, and
   verify the selected candidate pair is `relay`. Exercise bidirectional
   voice for ten minutes, mute/unmute, push-to-talk, camera, screen share,
   disconnect/reconnect, and device unplug/replug. Repeat with UDP blocked on one
   side so TLS/TCP fallback is proven by a real call rather than candidate
   gathering alone.

Record UTC times, release commit, device/browser/OS and network, redacted TURN
username expiry, URL/transport, selected candidate types, coturn allocation and
`rb`/`sb` usage records, quota result, reconnect duration, and
operator/verifier signoff. Any missing transport, unexpected static credential,
failed negative test, media drop, secret exposure, or unacknowledged alert
blocks the beta.

### Application acceptance

1. Load `https://campfire.example.com` with a valid certificate; use the
   invited-beta code, create a server, send a message, and verify an existing
   account can still log in.
2. Upload an attachment; verify authenticated full, `HEAD`, and
   byte-range reads. Revoke that member's channel access and confirm messages
   and the attachment immediately fail closed.
3. Follow `sudo journalctl -u campfire -u coturn -f` during acceptance
   and attach redacted failure-free excerpts plus the monitoring evidence
   required below.

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

### Source/systemd backup and clean restore

Install `sqlite3` for an SQLite deployment or a `postgresql-client`
version compatible with the PostgreSQL server. The procedure below reads
`.env` with Node instead of sourcing it as shell code. It stops the only
supported beta application instance before taking the database and media
snapshots, and normalizes both default and `CAMPFIRE_UPLOAD_DIR` media
layouts into one archive. If any other process writes this database or media
root, stop that writer too.

Run the complete block. For an upgrade, leave Campfire stopped after the
recovery set succeeds and continue with [Updating](#updating). For a standalone
backup, start it again only after the checksums and encrypted off-host copy have
been verified.

```bash
set -euo pipefail
umask 077
APP_DIR=/opt/campfire/app/squatch-chat
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="/var/backups/campfire/source-$STAMP"

sudo systemctl stop campfire
if sudo systemctl is-active --quiet campfire; then
  echo "Campfire is still active; refusing an inconsistent backup." >&2
  exit 1
fi
sudo install -d -m 700 -o campfire -g campfire "$BACKUP_DIR"

sudo -u campfire -H env APP_DIR="$APP_DIR" BACKUP_DIR="$BACKUP_DIR" \
  bash <<'CAMPFIRE_BACKUP'
set -euo pipefail
umask 077
cd "$APP_DIR"
test -s .env
git rev-parse HEAD > "$BACKUP_DIR/commit.txt"
install -m 600 .env "$BACKUP_DIR/.env"

DATABASE_URL="$(env -u DATABASE_URL node --env-file=.env -p \
  'process.env.DATABASE_URL || "file:./data/campfire.db"')"
case "$DATABASE_URL" in
  file:*)
    DB_KIND=sqlite
    DB_FILE=database.sqlite
    SQLITE_DB="${DATABASE_URL#file:}"
    case "$SQLITE_DB" in
      /*) ;;
      *) SQLITE_DB="$APP_DIR/${SQLITE_DB#./}" ;;
    esac
    SQLITE_DB="$(readlink -m "$SQLITE_DB")"
    mkdir -p "$(dirname "$SQLITE_DB")"
    test -f "$SQLITE_DB"
    sqlite3 "$SQLITE_DB" 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null
    test "$(sqlite3 "$SQLITE_DB" 'PRAGMA integrity_check;')" = ok
    sqlite3 "$SQLITE_DB" ".backup '$BACKUP_DIR/$DB_FILE'"
    ;;
  postgres://*|postgresql://*)
    DB_KIND=postgresql
    DB_FILE=database.dump
    PGDATABASE="$(env -u DATABASE_URL node --env-file=.env -e '
      const url = new URL(process.env.DATABASE_URL);
      url.searchParams.delete("schema");
      process.stdout.write(url.href);
    ')"
    export PGDATABASE
    pg_dump --format=custom --no-owner --no-privileges \
      --file="$BACKUP_DIR/$DB_FILE"
    pg_restore --list "$BACKUP_DIR/$DB_FILE" >/dev/null
    unset PGDATABASE
    ;;
  *)
    echo "Unsupported DATABASE_URL; refusing backup." >&2
    exit 1
    ;;
esac

MEDIA_ROOT="$(env -u CAMPFIRE_UPLOAD_DIR node --env-file=.env -e '
  const path = require("node:path");
  const root = process.env.CAMPFIRE_UPLOAD_DIR?.trim();
  process.stdout.write(root ? path.resolve(root) : "");
')"
if test -n "$MEDIA_ROOT"; then
  mkdir -p "$MEDIA_ROOT"/{uploads,avatars,private-uploads}
  tar -C "$MEDIA_ROOT" -czf "$BACKUP_DIR/media.tar.gz" \
    uploads avatars private-uploads
  MEDIA_TARGET="$MEDIA_ROOT"
else
  mkdir -p data/private-uploads public/uploads public/avatars
  tar -czf "$BACKUP_DIR/media.tar.gz" \
    -C "$APP_DIR/public" uploads avatars \
    -C "$APP_DIR/data" private-uploads
  MEDIA_TARGET=default
fi

cat > "$BACKUP_DIR/manifest.txt" <<EOF
created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
database=$DB_KIND
database_file=$DB_FILE
media_target=$MEDIA_TARGET
EOF
test -s "$BACKUP_DIR/$DB_FILE"
test -s "$BACKUP_DIR/media.tar.gz"
tar -tzf "$BACKUP_DIR/media.tar.gz" >/dev/null
(
  cd "$BACKUP_DIR"
  sha256sum "$DB_FILE" media.tar.gz .env commit.txt manifest.txt > SHA256SUMS
  sha256sum -c SHA256SUMS
)
CAMPFIRE_BACKUP
```

The directory is a plaintext recovery set containing secrets and user data.
Encrypt it with the organization's approved tool, copy the encrypted artifact
off host, verify the copied artifact's checksum, apply retention, and record its
immutable storage location. A local `SHA256SUMS` pass alone is not an
off-host backup. Never restart the service or continue an upgrade after a
partial set.

Rehearse the clean restore on a separate disposable host or VM at the same
source path. The block below deliberately replaces the selected database and
all three media directories. Run it on production only during an approved
recovery. Restore the encrypted set to `RESTORE_DIR`, restrict it to the
`campfire` user, install the matching database client, and make the
explicit approval assignment in your shell before running the block:

```bash
export CAMPFIRE_APPROVED_DESTRUCTIVE_RESTORE=YES
```

```bash
set -euo pipefail
APP_DIR=/opt/campfire/app/squatch-chat
RESTORE_DIR=/secure/path/to/source-YYYYMMDDTHHMMSSZ
PUBLIC_URL=https://campfire.example.com

test "${CAMPFIRE_APPROVED_DESTRUCTIVE_RESTORE:-}" = YES
test -d "$RESTORE_DIR"
(cd "$RESTORE_DIR" && sha256sum -c SHA256SUMS)
sudo chown -R campfire:campfire "$RESTORE_DIR"
sudo chmod -R go-rwx "$RESTORE_DIR"
sudo -u campfire git -C "$APP_DIR" fetch --tags --prune origin
sudo systemctl stop campfire
if sudo systemctl is-active --quiet campfire; then
  echo "Campfire is still active; refusing restore." >&2
  exit 1
fi

sudo -u campfire -H env \
  APP_DIR="$APP_DIR" RESTORE_DIR="$RESTORE_DIR" \
  CAMPFIRE_APPROVED_DESTRUCTIVE_RESTORE=YES bash <<'CAMPFIRE_RESTORE'
set -euo pipefail
umask 077
test "$CAMPFIRE_APPROVED_DESTRUCTIVE_RESTORE" = YES
cd "$RESTORE_DIR"
sha256sum -c SHA256SUMS
COMMIT="$(cat commit.txt)"
printf '%s\n' "$COMMIT" | grep -Eq '^[0-9a-f]{40}$'
git -C "$APP_DIR" cat-file -e "$COMMIT^{commit}"
test -z "$(git -C "$APP_DIR" status --porcelain --untracked-files=no)"
DB_KIND="$(sed -n 's/^database=//p' manifest.txt)"
DB_FILE="$(sed -n 's/^database_file=//p' manifest.txt)"
test -n "$DB_KIND"
test -n "$DB_FILE"
if tar -tzf media.tar.gz | grep -Eq '(^|/)\.\.(/|$)|^/'; then
  echo "Unsafe media archive path; refusing restore." >&2
  exit 1
fi
MEDIA_STAGE="$(mktemp -d "$APP_DIR/.restore-media.XXXXXX")"
trap 'rm -rf "$MEDIA_STAGE"' EXIT
tar -xzf media.tar.gz -C "$MEDIA_STAGE"
test -d "$MEDIA_STAGE/uploads"
test -d "$MEDIA_STAGE/avatars"
test -d "$MEDIA_STAGE/private-uploads"

git -C "$APP_DIR" checkout --detach "$COMMIT"
install -m 600 .env "$APP_DIR/.env"
cd "$APP_DIR"
DATABASE_URL="$(env -u DATABASE_URL node --env-file=.env -p \
  'process.env.DATABASE_URL || "file:./data/campfire.db"')"
MEDIA_ROOT="$(env -u CAMPFIRE_UPLOAD_DIR node --env-file=.env -e '
  const path = require("node:path");
  const root = process.env.CAMPFIRE_UPLOAD_DIR?.trim();
  process.stdout.write(root ? path.resolve(root) : "");
')"

case "$DB_KIND:$DATABASE_URL" in
  sqlite:file:*)
    test "$DB_FILE" = database.sqlite
    test "$(sqlite3 "$RESTORE_DIR/$DB_FILE" 'PRAGMA integrity_check;')" = ok
    SQLITE_DB="${DATABASE_URL#file:}"
    case "$SQLITE_DB" in
      /*) ;;
      *) SQLITE_DB="$APP_DIR/${SQLITE_DB#./}" ;;
    esac
    SQLITE_DB="$(readlink -m "$SQLITE_DB")"
    test -n "$SQLITE_DB"
    test "$SQLITE_DB" != /
    mkdir -p "$(dirname "$SQLITE_DB")"
    rm -f -- "$SQLITE_DB" "$SQLITE_DB-wal" "$SQLITE_DB-shm"
    install -m 600 "$RESTORE_DIR/$DB_FILE" "$SQLITE_DB"
    ;;
  postgresql:postgres://*|postgresql:postgresql://*)
    test "$DB_FILE" = database.dump
    pg_restore --list "$RESTORE_DIR/$DB_FILE" >/dev/null
    PGDATABASE="$(env -u DATABASE_URL node --env-file=.env -e '
      const url = new URL(process.env.DATABASE_URL);
      url.searchParams.delete("schema");
      process.stdout.write(url.href);
    ')"
    export PGDATABASE
    psql -v ON_ERROR_STOP=1 -Atc 'SELECT 1' >/dev/null
    psql -v ON_ERROR_STOP=1 --single-transaction <<'SQL'
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
SQL
    pg_restore --clean --if-exists --no-owner --no-privileges \
      --exit-on-error --single-transaction "$RESTORE_DIR/$DB_FILE"
    unset PGDATABASE
    ;;
  *)
    echo "Manifest and restored DATABASE_URL do not match; refusing restore." >&2
    exit 1
    ;;
esac

if test -n "$MEDIA_ROOT"; then
  test "$MEDIA_ROOT" != /
  mkdir -p "$MEDIA_ROOT"
  rm -rf -- "$MEDIA_ROOT/uploads" "$MEDIA_ROOT/avatars" \
    "$MEDIA_ROOT/private-uploads"
  mv "$MEDIA_STAGE/uploads" "$MEDIA_STAGE/avatars" \
    "$MEDIA_STAGE/private-uploads" "$MEDIA_ROOT/"
else
  rm -rf -- public/uploads public/avatars data/private-uploads
  mkdir -p public data
  mv "$MEDIA_STAGE/uploads" public/uploads
  mv "$MEDIA_STAGE/avatars" public/avatars
  mv "$MEDIA_STAGE/private-uploads" data/private-uploads
fi
test -z "$(git status --porcelain --untracked-files=no)"

npm ci
if test "$DB_KIND" = sqlite; then
  npm run db:sync
else
  npm run db:migrate
fi
npm run build
CAMPFIRE_RESTORE

sudo systemctl start campfire
curl -fsS "$PUBLIC_URL/api/health" | grep -F '"status":"ok"' >/dev/null
sudo -u campfire -H bash -c '
  cd /opt/campfire/app/squatch-chat
  node --env-file=.env ./node_modules/tsx/dist/cli.mjs \
    scripts/verify-realtime.ts "$1" "$1"
' _ "$PUBLIC_URL"
sudo systemctl --no-pager --full status campfire
```

Finish the drill by logging in, opening representative messages plus public
uploads, avatars, and private attachments, and recording the recovery-set ID,
restore start/end time, achieved RTO, and data-loss window. Keep the old set
until acceptance passes. On any failure, leave Campfire stopped; do not mix a
database from one set with media or `.env` from another.

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

## Monitoring and alert response

Monitoring is a launch gate, not a post-launch task. Before inviting testers,
assign named people and a tested paging route for the application, database and
backups, and network/TURN roles. The primary on-call owns first response; page
the specialist owner shown below and the release owner whenever a page lasts
15 minutes, risks data loss, or affects more than one tester.

Wire independent monitors around these operator-executable probes. The
authenticated realtime probe creates and removes a unique smoke user and
actually opens Socket.IO through the public reverse proxy; an HTTP-only check
does not prove realtime works.

```bash
set -o pipefail
APP_DIR=/opt/campfire/app/squatch-chat
PUBLIC_URL=https://campfire.example.com
HOST=campfire.example.com

# Database-aware HTTP health.
curl -fsS "$PUBLIC_URL/api/health" | grep -F '"status":"ok"' >/dev/null

# Authenticated allowed-Origin Socket.IO plus hostile-Origin rejection.
sudo -u campfire -H bash -c '
  cd /opt/campfire/app/squatch-chat
  node --env-file=.env ./node_modules/tsx/dist/cli.mjs \
    scripts/verify-realtime.ts "$1" "$1"
' _ "$PUBLIC_URL"

# Process state and cumulative restart count (source/systemd).
systemctl is-active --quiet campfire
systemctl show campfire --property=ActiveState,SubState,NRestarts

# Container state and cumulative restart count (Compose).
docker inspect --format '{{.State.Status}} {{.RestartCount}}' campfire-app

# Exact application/worker failure patterns; no output is the healthy result.
sudo journalctl -u campfire --since '-15 minutes' --no-pager |
  grep -E 'scheduled message\(s\) will be retried|Retention sweep failed|uncaughtException|unhandledRejection' || true
docker logs --since 15m campfire-app 2>&1 |
  grep -E 'scheduled message\(s\) will be retried|Retention sweep failed|uncaughtException|unhandledRejection' || true

# Filesystem capacity, inodes, and state growth.
cd "$APP_DIR"
MEDIA_ROOT="$(env -u CAMPFIRE_UPLOAD_DIR node --env-file=.env -e '
  const path = require("node:path");
  const root = process.env.CAMPFIRE_UPLOAD_DIR?.trim();
  process.stdout.write(root ? path.resolve(root) : "");
')"
STATE_ROOT="${MEDIA_ROOT:-$APP_DIR}"
df -P "$APP_DIR" "$STATE_ROOT" /var/backups/campfire
df -Pi "$APP_DIR" "$STATE_ROOT" /var/backups/campfire
if test -n "$MEDIA_ROOT"; then
  du -sx "$APP_DIR/data" "$MEDIA_ROOT"
else
  du -sx "$APP_DIR/data" "$APP_DIR/public/uploads" "$APP_DIR/public/avatars"
fi

# Source/systemd PostgreSQL connection use (automatically skipped on SQLite).
DATABASE_URL="$(env -u DATABASE_URL node --env-file=.env -p \
  'process.env.DATABASE_URL || "file:./data/campfire.db"')"
case "$DATABASE_URL" in
  postgres://*|postgresql://*)
    PGDATABASE="$(env -u DATABASE_URL node --env-file=.env -e '
      const url = new URL(process.env.DATABASE_URL);
      url.searchParams.delete("schema");
      process.stdout.write(url.href);
    ')"
    export PGDATABASE
    psql -Atc "SELECT count(*)::text || '/' ||
                      current_setting('max_connections')
               FROM pg_stat_activity;"
    unset PGDATABASE
    ;;
esac
unset DATABASE_URL

# Compose PostgreSQL connection use.
docker compose -f docker-compose.prod.yml exec -T db sh -c \
  'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$1"' _ \
  "SELECT count(*)::text || '/' || current_setting('max_connections')
   FROM pg_stat_activity;"

# A daily source backup must have a checksum manifest newer than 26 hours.
find /var/backups/campfire -name SHA256SUMS -type f -mmin -1560 \
  -print -quit | grep -q .

# Certificate chain and hostname must validate and remain valid for 14 days.
openssl s_client -connect "$HOST:443" -servername "$HOST" \
  -verify_hostname "$HOST" -verify_return_error </dev/null 2>/dev/null |
  openssl x509 -noout -enddate -checkend 1209600

# TURN process plus allocation, session-usage (rb/sb), and failure logs.
systemctl is-active --quiet coturn
sudo journalctl -u coturn --since '-15 minutes' --no-pager |
  grep -Ei 'allocation|usage:|error|denied|cannot' || true
```

Use these initial beta thresholds and tighten them from observed baselines:

| Signal | Cadence and threshold | Owner and response |
| --- | --- | --- |
| `/api/health` | Every 60 seconds. Warn after 2 consecutive failures; page at 5 minutes. | Application owner; inspect app/database state, restart only after capturing logs. |
| Authenticated Socket.IO | Every 5 minutes. Retry once after 30 seconds, then page. | Application owner; distinguish TLS/proxy, Origin policy, database, and unified-server failure. |
| Service/container restarts | Record the counter every minute. Warn on any unplanned increment; page on 2 in 15 minutes. | Application owner; capture the previous boot/container logs before restarting again. |
| Worker/runtime failures | Warn on the first scheduled-message or retention failure. Page on 2 in 15 minutes or any `uncaughtException`/`unhandledRejection`. | Application owner; preserve the failed job IDs/error and confirm retry or cleanup. |
| Disk, inodes, and volume growth | Check every 5 minutes: warn at 80%, page at 90%. Review database/media growth above 20% in 24 hours. | Platform owner; stop uploads or expand storage before exhaustion. |
| PostgreSQL connections | Check every minute: warn at 70%, page at 85% of `max_connections`. | Database owner; identify callers and leaks before raising the limit. |
| Backups | Page on job, checksum, encryption, or off-host-copy failure. Page if the daily set is older than 26 hours or the restore drill is overdue. | Backup/database owner; keep upgrades blocked until a complete set succeeds. |
| TLS | Check daily: warn below 30 days, page below 14 days or on chain/hostname failure. | Platform/security owner; inspect Caddy renewal and DNS reachability. |
| TURN | Check process every minute. Warn above 70% and page above 85% of relay-port or provisioned bandwidth capacity; page on failed cross-network relay or sustained allocation errors. | Network/TURN owner; preserve coturn allocation lifecycle and `rb`/`sb` session-usage logs. |

The coturn log sink must retain enough allocation start/end and `usage:`
records to derive concurrent allocations and relayed receive/send bytes. The
systemd and Compose restart counters are cumulative, so alert on deltas rather
than their absolute value. A monitor must never include `.env`, JWTs,
beta codes, TURN credentials, database URLs, cookies, or message contents in
alerts.

For every launch-gate run, alert, backup, and restore drill, retain:

- UTC start/end time, environment, public base URL, and release commit or image
  digest;
- monitor/check name, exact command or monitor version, observed value,
  threshold, pass/fail result, and raw artifact location;
- recovery-set ID, encrypted off-host object/version, checksum result, backup
  data window, restore RTO, and measured data-loss window when applicable;
- assigned owner, alert/incident ID, acknowledgement time, remediation, verifier,
  and next due date.

Before launch, deliberately trigger one safe failure for every paging route,
confirm the named owner receives and acknowledges it, then attach that evidence
to the beta go/no-go record.

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
