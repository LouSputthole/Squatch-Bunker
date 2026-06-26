# 🏕️ Campfire

A self-hostable, open-source voice & chat app — built around the feeling of
**sitting around a campfire** rather than a corporate chat grid. Warm by
default, calm motion, presence you can feel.

Think Discord-style servers, channels, and voice rooms — but yours to run,
extend, and theme.

## Features

- **Voice rooms** — WebRTC peer-to-peer audio with mute/deafen, push-to-talk,
  voice-activity detection, per-user volume, camera & screen share
- **Text channels** — messages, replies, edits, reactions, pins, search,
  threads, @mentions, slash commands, emoji & GIF pickers
- **Servers** — create/join via invite link, roles (owner/admin/mod/member),
  categories, channel topics & permissions, slow mode
- **DMs & friends** — direct messages, friend requests, presence (online /
  idle / DND / invisible)
- **Moderation** — kick/ban, server mute/deafen, message purge, audit log,
  auto-mod word filter
- **8 built-in themes** incl. **Campfire** (warm ember), Forest Dark/Light,
  Midnight, Ocean, Dracula, Nord, Solarized — plus a custom-theme creator
- **Guest access** — jump in with just a username, no signup

## Quick start (self-host)

Requires **Node 18+**. No database server, no Docker — runs on SQLite out of
the box.

```bash
npm install      # installs deps + creates .env + sets up a local SQLite DB
npm run host     # Next.js + realtime server on one port
```

Open **http://localhost:3000**. Share the printed **Network URL** to let people
on your LAN join.

That's it. State persists in `data/campfire.db`.

## Database

Campfire auto-selects its database from `DATABASE_URL`:

| `DATABASE_URL`                              | Mode        | Use for            |
|---------------------------------------------|-------------|--------------------|
| unset / `file:./data/campfire.db`           | **SQLite**  | self-host, local   |
| `postgresql://…`                            | **Postgres**| production / hosted |

To use Postgres, set `DATABASE_URL` in `.env`, then:

```bash
npm run db:push   # or: npm run db:migrate  (for migration history)
npm run host
```

## Tech stack

| Layer      | Tech                                            |
|------------|-------------------------------------------------|
| Framework  | Next.js 16 (App Router)                          |
| Database   | Prisma 7 — SQLite (`adapter-better-sqlite3`) or Postgres (`adapter-pg`) |
| Realtime   | Socket.IO (attached to the same HTTP server)     |
| Voice/Video| WebRTC (browser-native), Socket.IO signaling     |
| Auth       | JWT in HttpOnly cookies; bcrypt password hashing |
| Styling    | Tailwind CSS + CSS custom-property theming        |

For internet (not just LAN) voice, put the app behind HTTPS and add a TURN
server (see `.env.example`). The WebRTC mesh works well up to ~6 people per
room; larger rooms need an SFU.

## License

**AGPL-3.0** (see [LICENSE](./LICENSE)). You're free to self-host, modify, and
redistribute. If you run a modified version as a network service, the AGPL
requires you to make your source available to its users.

A managed, hosted edition (zero-setup, backups, scaled voice) is offered
separately — same codebase, you pay for the hosting and ops.
