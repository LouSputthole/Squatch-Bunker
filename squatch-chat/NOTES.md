# Campfire — Developer Notes

> Quick-start guide for anyone picking up this codebase.

---

## What Is This?

**Campfire** is NOT a Discord clone. It's a social presence platform built around the metaphor of gathering around a fire. Voice rooms are circles, not participant lists. Arrivals feel like sitting down, not spawning. Reactions are embers, not emoji slot machines.

The product identity: **deep charcoal, warm amber, restrained motion, embodied presence.**

---

## Product Vision — What Makes Campfire Different

### The Circle (Core Identity)
Voice rooms use a **circular seat layout** around a central focal point (warm ember glow). Users occupy seats. Speaking brightens your seat. Joining is sitting down. This gives presence *shape* — people understand group dynamics faster with visual structure.

### Offshoots (Side Conversations)
Temporary branches from the main room. Two people can peel off into a side audio bubble without leaving the circle. Not a new channel — a social side pocket. Auto-expires unless saved.

### Arrival/Departure
Joining fills an empty seat with a fade-in + ember pulse. Leaving cools the seat. Quiet rooms show arrivals more; active rooms keep them subtle. Disconnects show "stepped away" state, reconnects feel like sitting back down.

### Pass the Lantern
Lightweight floor-control for voice. One person holds conversational focus (brighter seat, ducked background). Others can request next. Not parliamentary — warm and social. Perfect for story time, D&D recaps, group decisions.

### Ember Reactions
Quick ambient reactions that rise softly toward the center and dissolve. No emoji confetti. Reactions flicker near the reacting user's seat, leave a faint spark trail, fade quickly. Rate-limited, clustered elegantly.

### Room Types (Rooms with a Purpose)
Instead of generic channels, rooms have types with different defaults:
- **Hangout** — circle-first, low pressure
- **Game Night** — party tools, lobby codes, side chatter
- **Watch Together** — shared video in center, circle wraps around
- **Workshop** — screen share, whiteboard, queue to speak
- **Quiet Room** — minimal notifications, subdued visuals
- **Story Time** — lantern built in, speaking queue

### Leave-No-Trace Rooms
Ephemeral by default. Messages auto-delete after configurable period. Voice never recorded. Frame as "casual by default, memory is intentional."

### Ambient Sound Themes
Ultra-low-key room tone: fire crackle, distant rain, vinyl hiss. Off by default, auto-ducks under voices, user-level toggle. Treat like lighting, not content.

### Design Grammar
- Deep charcoal base, warm amber highlights, burnt orange activity accents
- Cooler muted tones when idle
- Soft gradients, rounded geometry, shadows/glow used sparingly
- Motion feels like heat and breath, not RGB seizure
- Unread messages as embers, active rooms warm up, idle rooms cool/dim
- Privacy labels are blunt and readable

### Build Phases
**Phase 1:** Circle presence, arrival animations, ember reactions, room types, leave-no-trace
**Phase 2:** Offshoots, pass the lantern, shared object slot, journal save flow
**Phase 3:** Ambient sound themes, mood controls, richer privacy, self-hosted options

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16 (App Router, Turbopack) |
| Database | PostgreSQL + Prisma v7 (`@prisma/adapter-pg`) |
| Realtime | Socket.IO (separate server on port 3001) |
| Voice | WebRTC peer-to-peer audio, Socket.IO signaling |
| Video | WebRTC camera via existing voice peer connections |
| Screen Share | WebRTC via separate peer connections |
| Auth | JWT in HttpOnly cookies (`squatch-token` cookie name kept for backward compat) |
| Styling | Tailwind CSS with CSS custom properties for theming |
| Desktop | Electron + electron-builder (Win/Mac/Linux installers) |

---

## Project Structure

```
squatch-chat/
├── app/                    # Next.js App Router pages & API routes
│   ├── api/
│   │   ├── auth/           # login, register, guest, me, logout, avatar upload
│   │   ├── channels/       # create channels (text or voice)
│   │   ├── messages/       # CRUD messages, pagination, reactions, search
│   │   ├── servers/        # create, join, settings, members
│   │   └── servers/[id]/   # rename, delete, regenerate invite (owner only)
│   ├── chat/               # Main chat page (SPA-style with query params)
│   ├── login/              # Login page
│   ├── register/           # Register page
│   └── join/[inviteCode]/  # Invite link handler
├── components/
│   ├── Avatar.tsx           # Shared avatar (image or initials fallback)
│   ├── ChannelList.tsx      # Sidebar: text/voice channels, server settings gear
│   ├── ChatPanel.tsx        # Text chat: messages, typing, replies, notifications
│   ├── MemberList.tsx       # Right sidebar: online/offline, roles, context menu, skeletons
│   ├── MessageBubble.tsx    # Message: edit/delete, reactions, replies, emoji picker, timestamps
│   ├── SearchPanel.tsx      # Debounced message search across server
│   ├── ServerList.tsx       # Left rail: server icons with initials, active indicator
│   ├── SettingsModal.tsx    # Settings: Audio/Account/Theme tabs
│   ├── VoicePanel.tsx       # Headless WebRTC engine (voice + camera + screen share)
│   └── VoiceRoom.tsx        # Voice room: participant grid, video, screen viewer, mod tools
├── hooks/
│   ├── useAuth.ts           # User state, login check, logout, avatar updates
│   ├── useServers.ts        # Server list, active server, create/join/select/rename/delete
│   ├── useChannels.ts       # Active channel, URL sync, unread counts
│   ├── usePresence.ts       # Online members, statuses, user role, auto-idle
│   ├── useVoice.ts          # Voice, camera, screen share, mod actions
│   └── useKeyboardShortcuts.ts # All hotkeys
├── types/
│   └── chat.ts              # Shared interfaces: Channel, Server, User, VoiceParticipant
├── lib/
│   ├── auth.ts              # JWT token/session, production-aware cookie flags
│   ├── config.ts            # Centralized env var config (all shared constants)
│   ├── db.ts                # Prisma singleton with PrismaPg adapter
│   ├── permissions.ts       # Role hierarchy, permission checks, colors, labels
│   ├── socket.ts            # Client-side Socket.IO singleton + heartbeat + presence
│   └── utils.ts             # displayName(), truncateName(), initials()
├── realtime/
│   └── server.ts            # Socket.IO: presence, chat, voice, screen, moderation
├── prisma/
│   ├── schema.prisma        # Models: User, Server, ServerMember, Channel, Message, Reaction
│   └── migrations/
├── desktop/                 # Electron desktop app wrapper
│   ├── main.js              # Electron entry point
│   ├── package.json         # electron-builder config
│   └── scripts/build.sh     # Build script
├── public/
│   └── campfire-logo.png    # Logo
├── Dockerfile
├── docker-compose.prod.yml
└── ROADMAP.md
```

---

## Key Architecture Decisions

### Authentication
- JWT stored in HttpOnly cookie named `squatch-token`
- Guest access: JWT-only session, no DB row required
- `displayName()` in `lib/utils.ts` strips `#discriminator` suffix

### Realtime (Socket.IO)
- Separate server on port 3001, JWT verified at handshake
- Heartbeat: 15s interval, 45s timeout, stale session cleanup
- Presence statuses: online, idle, DND, invisible (auto-idle after 5min)
- Single voice room enforcement (server-side)

### Voice Chat (WebRTC)
- **VoicePanel**: Headless engine — voice, camera, screen share all managed here
- **VoiceRoom**: Visual UI — participant grid, video tiles, screen viewer, mod menu
- Voice activity detection (VAD) via AudioContext AnalyserNode
- Push-to-talk (Space bar), per-user volume, input sensitivity
- ICE restart on failed connections, Socket.IO reconnect auto-rejoins voice

### Camera/Video
- Video track added to existing voice peer connections with SDP renegotiation
- Self-view mirrored, responsive grid layout
- Camera state synced via `voice:camera` event

### Screen Share
- Separate RTCPeerConnection set (won't disrupt audio)
- `getDisplayMedia` for capture, signaling via `screen:*` events
- Fullscreen viewer, multi-share tabs, compact participant strip

### Voice Moderation
- Server mute/deafen, kick from voice, move between rooms
- Role validation: mod(2+) required, can't target equal/higher rank
- Force-mute/deafen syncs to target's VoicePanel

### Roles & Permissions
- `role` on ServerMember: owner(4) > admin(3) > mod(2) > member(1)
- Server creator auto-assigned owner
- Right-click context menu for role management + kick

### Config Centralization
All env vars in `lib/config.ts`. Realtime server reads same vars directly. Nothing hardcoded.

---

## Running Locally

```bash
docker compose -f docker-compose.prod.yml up -d postgres
pnpm install
npx prisma migrate deploy
npx prisma generate
npx tsx realtime/server.ts &
pnpm dev
```

App at `http://localhost:3000`, realtime at `http://localhost:3001`.

---

## Environment Variables

See `.env.example` for full list. Key ones:

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | (required) | PostgreSQL connection |
| `JWT_SECRET` | `campfire-secret-change-me` | JWT signing secret |
| `NEXT_PUBLIC_SOCKET_URL` | `http://localhost:3001` | Socket.IO server URL |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | CORS origin |
| `SOCKET_PORT` | `3001` | Realtime server port |
| `CORS_ORIGINS` | (app URL) | Comma-separated allowed origins |
| `COOKIE_NAME` | `squatch-token` | Session cookie name |
| `NODE_ENV` | `development` | `production` enables Secure cookies |

---

## Modular Hooks Architecture

| Hook | Owns | Touch when... |
|---|---|---|
| `useAuth` | user, login, logout, avatar | changing auth flow |
| `useServers` | server list, create/join/rename/delete | adding server features |
| `useChannels` | active channel, URL, unreads | changing channel behavior |
| `usePresence` | online members, statuses, role | updating presence/roles |
| `useVoice` | voice, camera, screen, mod actions | working on media features |
| `useKeyboardShortcuts` | all hotkeys | adding shortcuts |

---

## Deployment

All config via env vars. See `.env.example`.

```bash
# Docker
docker compose -f docker-compose.prod.yml up -d

# Reverse proxy (nginx)
# See .env.example for nginx config example
```

---

## Gotchas

- **Next.js 16**: `params` is a Promise, `cookies()` is async, middleware deprecated
- **Prisma v7**: Adapter-based constructor, explicit output path
- **Cookie name**: `squatch-token` (legacy, kept for compat)
- **Voice P2P limit**: WebRTC mesh won't scale past ~6 users (needs SFU)
- **Camera renegotiation**: Adding/removing video track triggers SDP renegotiation on all peers

---

## Dev Communication Style

Short 3-6 word sentences. No filler, preamble, or pleasantries. Run tools first, show result, then stop. Do not narrate. Drop articles.

---

*Last updated: April 2026 — v0.0.6*
