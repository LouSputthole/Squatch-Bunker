# Campfire encryption & privacy posture

What is and isn't protected, layer by layer. Short version: **deploy with
HTTPS (docs/DEPLOY.md) and everything in transit is encrypted; voice/video
never touches the server at all.** The person running the server can read
stored text — same trust model as Discord or Slack, except here the operator
is you.

## In transit

| Traffic | Protection |
|---|---|
| Pages, API, uploads | TLS via your reverse proxy (Caddy recipe in DEPLOY.md) |
| Realtime (Socket.IO) | Same — the client connects to the page origin, so an `https://` page always yields `wss://`. There is no hardcoded `ws://` anywhere to downgrade to. |
| Voice / video / screen share | **Always encrypted, end-to-end.** WebRTC mandates DTLS-SRTP; browsers cannot send unencrypted media. Media flows peer-to-peer between participants — the Campfire server only carries signaling, and a TURN relay only ever sees ciphertext it cannot decrypt. |

Caveats, honestly stated:

- **Plain-HTTP modes are plaintext.** `npm run host` without a proxy, and the
  desktop app's LAN sharing, serve HTTP — fine on a trusted home LAN, readable
  by anyone who can sniff that network. Anything beyond a trusted LAN goes
  behind HTTPS (30-minute recipe in DEPLOY.md).
- **LAN voice limit:** browsers only unlock the microphone on secure origins,
  so visitors on `http://192.168.x.x` get text and browsing but not voice
  (the machine hosting the app is exempt via `127.0.0.1`). Internet-grade
  voice = the HTTPS deploy. (Power users: Chrome's
  `--unsafely-treat-insecure-origin-as-secure=http://<host>:<port>` flag
  exists; it is exactly as unsafe as it sounds.)
- **Media E2EE trusts signaling:** peers are introduced by your server. A
  hostile *server operator* could in principle insert themselves during call
  setup (true of every WebRTC app without out-of-band identity verification).
  If you don't trust the operator, don't use their server — see "at rest".

## At rest

| Data | Protection |
|---|---|
| Passwords | bcrypt hashes, never plaintext |
| Sessions | JWT in `HttpOnly` cookies (`Secure` on HTTPS), revocable server-side via `tokenVersion` |
| TURN credentials | Served by `/api/config` to authenticated sessions only |
| Message / DM attachments | Random storage keys outside the public root; authenticated API reads recheck current channel, DM, or Journal access. The server operator can still read the bytes. |
| Legacy uploads / avatars | Randomized public-by-URL files. Do not treat these URLs as an authorization boundary. |
| Messages, DMs, memberships | **Plaintext in the database.** The server operator can read them. Server-side search, history sync, and moderation depend on this. |

What that last row means in practice: self-hosting is the privacy feature.
Your community's chat sits in `data/campfire.db` and its configured media root on hardware you control.
No third company can read, mine, or subpoena-proxy it. Protect the box
itself: full-disk encryption (BitLocker/LUKS) on the host, and treat `.env`,
the database, public media, and private attachments as secrets when backing up.

## Not provided today

- **End-to-end encryption of text** (Signal-style). It would blind the
  server, which currently powers search, pins, history for new members, and
  moderation. Discord doesn't E2EE text either. A realistic future shape is
  opt-in E2EE for 1:1 DMs only — tracked on the roadmap, not promised.
- **Encrypted database at rest** (SQLCipher). Full-disk encryption on the
  host covers the same threat with zero app complexity.

## Operator hardening checklist

- [ ] HTTPS in front of anything not on a trusted LAN (DEPLOY.md)
- [ ] `STRICT_CORS=true` + `CORS_ORIGINS=<your origin>` in `.env`
- [ ] `CAMPFIRE_TRUST_PROXY_HOPS` is unset for direct service exposure or equals the exact trusted proxy count; the outermost proxy replaces inbound `X-Forwarded-For`
- [ ] `JWT_SECRET` is generated (postinstall does this) — never the example value; server refuses to boot with the default
- [ ] Full-disk encryption on the host; backups of the database, `.env`, public media, and private attachments stored encrypted
- [ ] `min-port`/`max-port` pinned in turnserver.conf and mirrored in the firewall
- [ ] Update by `git pull` + rebuild on a schedule (see DEPLOY.md → Updating)

Found a vulnerability? Open a GitHub security advisory or issue at
<https://github.com/LouSputthole/Squatch-Bunker> — please don't post exploits
in public issues before a fix ships.
