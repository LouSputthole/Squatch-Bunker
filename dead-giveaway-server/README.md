# dead-giveaway-server

The authoritative game server for **Dead Giveaway**: one table under the Bada
Bing, sixteen words, one secret target, and one player, **The Rat**,
pretending to know what the rest of **the Family** knows.

Node 20 or later, `socket.io` 4.8, everything in memory. No database, no build
step, no TypeScript. The wire contract is [`PROTOCOL.md`](PROTOCOL.md); an
identical copy lives in SquatchSmash at `docs/DEAD-GIVEAWAY-PROTOCOL.md`, and
the two must be edited together. The client (`SquatchSmash/deadgiveaway.html`,
`src/deadgiveaway/`) renders `state` snapshots and sends intents. It never
runs the rules.

## Run it

```bash
cd dead-giveaway-server
npm install
DG_STATIC_DIR=../../SquatchSmash npm start
```

Then open `http://localhost:3100/deadgiveaway.html` in three browser windows,
or on three machines on the LAN at `http://<this-host>:3100/deadgiveaway.html`.
Serving the client from the same origin means no CORS setup is needed.
`DG_STATIC_DIR` is resolved from the directory you run `npm start` in; the
path above assumes Squatch-Bunker and SquatchSmash are checked out side by
side.

```bash
npm test        # rules, cards, rooms, TURN, and one end-to-end socket round
curl localhost:3100/dg/health   # {"ok":true}
```

Browsers expose microphone and camera only on secure origins. `localhost`
counts as secure; a LAN IP over plain HTTP does not. Voice and video between
LAN machines therefore need HTTPS (see below), or a browser flag that treats
the origin as secure.

## Environment

| variable | default | |
|---|---|---|
| `DG_PORT` | `3100` | HTTP and socket.io port |
| `DG_HOST` | `0.0.0.0` | bind address; use `127.0.0.1` behind Caddy |
| `DG_STATIC_DIR` | unset | serve this directory (a SquatchSmash checkout). `/` serves `index.html`; dotfiles such as `.git/` are never served |
| `DG_CORS_ORIGINS` | `*` | comma list of allowed page origins. When set it is enforced on the WebSocket upgrade too; same-origin pages always pass |
| `DG_DISCONNECT_GRACE_MS` | `90000` | how long a dropped player keeps their seat before removal (lobby) or `out` (match). An empty room is reaped after the same time |
| `DG_MAX_ROOMS` | `500` | `room:create` answers `invalid` past this |
| `DG_CLUE_MS` | `40000` | each CLUES turn's clock; out of time records a blank clue. Raise it for slow automated runs only |
| `DG_CARDS_DIR` | `./cards` | category cards to load |
| `TURN_URLS` | unset | JSON array of `turn:`/`turns:` URLs (same as Campfire) |
| `TURN_URL` | unset | a single TURN URL, used only when `TURN_URLS` is unset |
| `TURN_AUTH_SECRET` | unset | coturn `static-auth-secret`, at least 32 characters |
| `TURN_CREDENTIAL_TTL_SECONDS` | `900` | credential lifetime, clamped to 60..3600 |

`turn:get` always returns Google STUN. It adds a TURN entry with a short-lived
coturn REST credential only when a URL and the secret are both set. The
algorithm is the one in `squatch-chat/lib/turnCredentials.ts`. A partial TURN
configuration is ignored with a log line, except under `NODE_ENV=production`,
where it stops the server from starting, as it does in Campfire. The secret
never leaves the server.

## Layout

```
src/rules.js     the game: a pure state machine, no timers, injectable random
src/rooms.js     codes, tokens, sockets, disconnect grace, host handover, reaping
src/cards.js     card loader and validator
src/turn.js      ICE servers for turn:get (coturn REST HMAC)
src/guards.js    payload guards, token-bucket rate limits, never-throw wrapper
src/server.js    HTTP + socket.io + static files + the one 250 ms interval
cards/*.json     the starter deck (30 cards); see cards/README.md for the format
tests/           node:test suites, including one real-socket round
```

`server.js` logs one line per room event (create, join, rejoin, leave,
disconnect, grace expiry, every intent, every phase change) and stops cleanly
on SIGINT and SIGTERM. Every socket handler is wrapped, so a malformed packet
gets a rejection rather than taking the process down.

## Behind the Campfire Caddy and coturn

This follows `squatch-chat/docs/DEPLOY.md`: Caddy terminates TLS and proxies
to an app bound to localhost, and coturn runs on its own DNS name with the
shared `static-auth-secret`. Dead Giveaway can share both with an existing
Campfire box.

**1. The service.** `/etc/systemd/system/dead-giveaway.service`, with the
repository under `/opt/campfire/app` as in the Campfire guide and a
SquatchSmash checkout next to it:

```ini
[Unit]
Description=Dead Giveaway
After=network-online.target

[Service]
User=campfire
WorkingDirectory=/opt/campfire/app/dead-giveaway-server
ExecStart=/usr/bin/npm start
Environment=NODE_ENV=production
Environment=DG_HOST=127.0.0.1
Environment=DG_PORT=3100
Environment=DG_STATIC_DIR=/opt/campfire/SquatchSmash
EnvironmentFile=/etc/dead-giveaway.env
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

`/etc/dead-giveaway.env` (mode 600, root-owned) holds the TURN values, using
the **same** secret coturn and Campfire already use:

```bash
TURN_URLS='["turn:turn.campfire.example.com:3478?transport=udp","turn:turn.campfire.example.com:3478?transport=tcp","turns:turn.campfire.example.com:5349?transport=tcp"]'
TURN_AUTH_SECRET="PASTE-EXACT-TURN_AUTH_SECRET-HERE"
TURN_CREDENTIAL_TTL_SECONDS="900"
```

```bash
sudo systemctl enable --now dead-giveaway
curl -s http://127.0.0.1:3100/dg/health   # {"ok":true}
```

**2. Caddy.** The simplest setup is a subdomain, which serves the page and the
socket from one origin and needs no CORS. Add it to `/etc/caddy/Caddyfile`
next to the Campfire block:

```
deadgiveaway.campfire.example.com {
    header Strict-Transport-Security "max-age=31536000"
    reverse_proxy 127.0.0.1:3100
}
```

If the page is hosted somewhere else (for example SquatchSmash on GitHub
Pages), proxy only the server's paths from the existing Campfire site, and
allow that page's origin:

```
campfire.example.com {
    header Strict-Transport-Security "max-age=31536000"
    handle /dg/* {
        reverse_proxy 127.0.0.1:3100
    }
    reverse_proxy 127.0.0.1:3000
}
```

```bash
# in /etc/dead-giveaway.env
DG_CORS_ORIGINS="https://lousputthole.github.io"
```

The client then points at the server with `?server=https://campfire.example.com`,
or with `localStorage['dg.server']`. Caddy proxies WebSockets without extra
directives. With nginx instead, forward `Host`, `Upgrade`, `Connection` and
`X-Forwarded-Proto` yourself. `sudo systemctl reload caddy` after either
change.

**3. coturn.** Nothing changes. Dead Giveaway mints credentials against the
`static-auth-secret` coturn already has. When that secret is rotated
(DEPLOY.md, "Shared-secret rotation"), change `TURN_AUTH_SECRET` in
`/etc/dead-giveaway.env` and restart `dead-giveaway` in the same step as
Campfire.

**4. Firewall.** Nothing new to open. Port 3100 stays closed, the same way
3000 does; only Caddy talks to the app.

## Things the client author must know

- `state` is sent **per socket**: `me` is private. The Rat's `me.targetIndex`
  stays `null` until RESOLVE. `result.ratId`, `result.roles` and
  `result.caught` stay `null` until ROLE_REVEAL, so VOTE_RESULT can show the
  tally and the accused without naming the Rat. `result.targetIndex` becomes
  public at RESOLVE.
- A round can be **voided** (`result.voided: true`) when the Rat leaves, or
  when fewer than 3 players remain, before the vote has closed. It goes
  straight to RESOLVE with no life lost. Show it as "the round is off".
- Rejoin with `room:join {code, token, name, character}`. Always send `name`
  and `character`: an expired token falls back to an ordinary join. An old tab
  for the same player gets `room:closed {reason:'replaced'}`; stop that tab
  reconnecting.
- `chat` comes back to the sender too. `act`, `pose`, `media:speaking` and
  `rtc:hello` do not.
- `turn:get` returns one TURN entry whose `urls` is an array, plus
  `expiresAt` (epoch ms, or `null` when only STUN is returned). Ask again
  before `expiresAt`.
- The host passes on as soon as the host's socket drops, and does not come
  back on rejoin. Read `isHost` from every snapshot rather than caching it.
