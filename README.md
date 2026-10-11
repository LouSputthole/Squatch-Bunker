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

## Use Campfire

All free, three ways in:

- **In your browser** — Campfire Online, the shared hosted Campfire (public
  address announced at launch). Nothing to install.
- **Windows app** — the setup or portable `.exe` from
  [Releases](https://github.com/LouSputthole/Squatch-Bunker/releases). It
  joins Campfire Online by default; switch to **Host on this PC** from the
  tray menu to run a camp for your own network. Builds are unsigned for now, so SmartScreen may
  ask you to click **More info → Run anyway**.
- **Host your own** — see the [quick start](#quick-start-self-host) below.

Production servers and the Windows app send a small anonymous usage ping
(version and install counts, nothing personal) —
[TELEMETRY.md](./squatch-chat/docs/TELEMETRY.md) shows exactly what is sent
and how to turn it off.

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
npm run host:prod  # builds once, then Next.js + realtime server on one port
```

Open **http://localhost:3000**. Share the printed **Network URL** to let
people on your LAN join. State persists in `squatch-chat/data/campfire.db`.

For Postgres, migrations, Docker, and the full tech stack, see
**[squatch-chat/README.md](./squatch-chat/README.md)**.

## Desktop app

The supported Windows packaging pipeline lives with the application under
[`squatch-chat/desktop`](./squatch-chat/desktop) and
[`squatch-chat/packaging`](./squatch-chat/packaging). From `squatch-chat`, run
`npm run desktop:stage`, `npm run desktop:verify`, or `npm run desktop:dist`.
Published desktop artifacts remain release candidates until the desktop gates
in [RELEASE_CHECKLIST.md](./squatch-chat/docs/RELEASE_CHECKLIST.md) pass.

The repository-root [`desktop/`](./desktop) implementation is archived source;
its tray, LAN-sharing, and update-checker work now lives in the supported
pipeline. It must not be used to produce releases because its database
migration bundle predates the current Campfire schema.

## License

**AGPL-3.0** (see [squatch-chat/LICENSE](./squatch-chat/LICENSE)). You're
free to self-host, modify, and redistribute. If you run a modified version
as a network service, the AGPL requires you to make your source available
to its users.
