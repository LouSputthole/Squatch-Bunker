# Campfire (repo: Squatch-Bunker)

A self-hostable, open-source Discord-style voice, text & video chat app —
built around the feeling of **sitting around a campfire** rather than a
corporate chat grid. Servers, channels, and voice rooms, with:

- **Voice rooms** — WebRTC peer-to-peer audio, mute/deafen, push-to-talk,
  voice-activity detection, per-user volume, camera & screen share
- **Text channels** — messages, replies, edits, reactions, pins, search,
  threads, @mentions, slash commands, emoji & GIF pickers
- **Servers** — create/join via invite link, roles (owner/admin/mod/member),
  categories, channel topics & permissions, slow mode
- **DMs & friends** — direct messages, friend requests, presence (online /
  idle / DND / invisible)
- **Moderation** — kick/ban, server mute/deafen, message purge, audit log,
  auto-mod word filter
- **8 built-in themes** incl. Campfire (warm ember), Forest Dark/Light,
  Midnight, Ocean, Dracula, Nord, Solarized — plus a custom-theme creator
- **Guest access** — jump in with just a username, no signup

## Where the app lives

The app itself is in [`squatch-chat/`](./squatch-chat) — a Next.js 16 +
Prisma 7 + Socket.IO project. That's where you `cd` to install, run, and
develop.

## Quick start (self-host)

Requires **Node 22 LTS** (minimum 20.9). No database server, no Docker —
runs on SQLite out of the box.

```bash
cd squatch-chat
npm install      # installs deps + creates .env + sets up a local SQLite DB
npm run host     # Next.js + realtime server on one port
```

Open **http://localhost:3000**. Share the printed **Network URL** to let
people on your LAN join. State persists in `squatch-chat/data/campfire.db`.

For Postgres, migrations, Docker, and the full tech stack, see
**[squatch-chat/README.md](./squatch-chat/README.md)**.

## Desktop app

[`desktop/`](./desktop) is an Electron wrapper that packages the web app as
a native desktop installer (Windows/macOS/Linux). It bundles the same
`squatch-chat` server internally — see [desktop/README.md](./desktop/README.md).

## License

**AGPL-3.0** (see [squatch-chat/LICENSE](./squatch-chat/LICENSE)). You're
free to self-host, modify, and redistribute. If you run a modified version
as a network service, the AGPL requires you to make your source available
to its users.
