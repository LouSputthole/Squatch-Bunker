# Campfire — Developer Notes

> Quick-start guide for anyone picking up this codebase.

---

## What Is This?

**Campfire** is a Discord-like private chat app with text channels, voice chat (WebRTC), server/channel management, and user profiles. It was originally called "SquatchChat" — some internal identifiers (cookie name, guest IDs) still reflect that.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16 (App Router, Turbopack) |
| Database | PostgreSQL + Prisma v7 (`@prisma/adapter-pg`) |
| Realtime | Socket.IO (separate server on port 3001) |
| Voice | WebRTC peer-to-peer audio, Socket.IO signaling |
| Auth | JWT in HttpOnly cookies (`squatch-token` cookie name kept for backward compat) |
| Styling | Tailwind CSS with CSS custom properties for theming |

---

## Project Structure

```
squatch-chat/
├── app/                    # Next.js App Router pages & API routes
│   ├── api/
│   │   ├── auth/           # login, register, guest, me, logout, avatar upload
│   │   ├── channels/       # create channels (text or voice)
│   │   ├── messages/       # CRUD messages, pagination
│   │   ├── servers/        # create servers, join via invite, list members
│   ├── chat/               # Main chat page (SPA-style with query params)
│   ├── login/              # Login page
│   ├── register/           # Register page
│   └── join/[inviteCode]/  # Invite link handler
├── components/
│   ├── Avatar.tsx           # Shared avatar (image or initials fallback)
│   ├── ChannelList.tsx      # Sidebar: text channels (#) + voice channels (speaker icon)
│   ├── ChatPanel.tsx        # Text chat: messages, typing indicators, optimistic sends
│   ├── MemberList.tsx       # Right sidebar: online/offline members, role badges, context menu
│   ├── MessageBubble.tsx    # Single message: edit/delete, avatar, reactions, attachments
│   ├── SearchPanel.tsx      # Debounced message search across server
│   ├── ServerList.tsx       # Left rail: server icons, create/join
│   ├── SettingsModal.tsx    # Settings: Audio tab + Account tab (avatar upload)
│   ├── VoicePanel.tsx       # Headless WebRTC engine (forwardRef, VAD, PTT)
│   └── VoiceRoom.tsx        # Voice room view: participant grid, speaking indicators
├── hooks/                   # Modular state hooks (extracted from chat page)
│   ├── useAuth.ts           # User state, login check, logout, avatar updates
│   ├── useServers.ts        # Server list, active server, create/join/select
│   ├── useChannels.ts       # Active channel, URL sync, unread counts
│   ├── usePresence.ts       # Online members, user role in server
│   ├── useVoice.ts          # Voice channel, participants, PTT, state, ref
│   └── useKeyboardShortcuts.ts # All hotkeys (Ctrl+K, Ctrl+M, Ctrl+D, Esc)
├── types/
│   └── chat.ts              # Shared interfaces: Channel, Server, User, VoiceParticipant
├── lib/
│   ├── auth.ts              # JWT token/session management, cookie helpers
│   ├── db.ts                # Prisma singleton with PrismaPg adapter
│   ├── permissions.ts       # Role hierarchy, permission checks, colors, labels
│   ├── socket.ts            # Client-side Socket.IO singleton
│   └── utils.ts             # displayName(), truncateName(), initials()
├── realtime/
│   └── server.ts            # Socket.IO server: presence, chat, voice signaling
├── prisma/
│   ├── schema.prisma        # Models: User, Server, ServerMember, Channel, Message
│   └── migrations/          # SQL migrations
├── public/
│   └── avatars/             # Uploaded profile pictures (userId.ext)
├── Dockerfile               # Multi-stage production build
├── docker-compose.prod.yml  # Full stack: postgres + app
└── ROADMAP.md               # 20-section voice product roadmap with status
```

---

## Key Architecture Decisions

### Authentication
- JWT stored in HttpOnly cookie named `squatch-token` (legacy name, kept for session compat)
- Guest access: JWT-only session, no DB row required. Guest usernames are `{name}#{hex}` format
- `displayName()` in `lib/utils.ts` strips the `#discriminator` suffix for display

### Realtime (Socket.IO)
- Separate server on port 3001 (`realtime/server.ts`)
- JWT verified at handshake from cookie — no separate auth step
- Socket rooms: `server:{id}` (presence), `channel:{id}` (text messages), `voice:{id}` (voice)
- Events: `message:send`, `message:edit`, `message:delete`, `typing:start/stop`, `voice:join/leave/mute/deafen`
- Voice participant updates broadcast to both `voice:{channelId}` and `server:{serverId}` rooms

### Voice Chat (WebRTC)
- **VoicePanel** (`components/VoicePanel.tsx`): Headless WebRTC connection manager
  - Uses `forwardRef` + `useImperativeHandle` to expose `toggleMute`, `toggleDeafen`, `disconnect`, `togglePTT`, `isPTT`
  - Reports state via `onStateChange` callback (includes speaking state per participant)
  - Voice activity detection (VAD) using AudioContext AnalyserNode — emits `voice:speaking` events
  - Push-to-talk mode: mic stays muted, Space bar hold to transmit
  - Renders `null` — all UI is in VoiceRoom
- **VoiceRoom** (`components/VoiceRoom.tsx`): Visual participant grid + controls
  - Takes over the main panel when user joins a voice channel
  - Control buttons delegate to VoicePanel via ref
- P2P audio via Google STUN servers, SDP offer/answer exchange through Socket.IO
- Notification tones generated with Web Audio API (no audio files)

### Profile Pictures
- `avatar` field on User model (nullable string URL)
- Upload endpoint: `POST /api/auth/avatar` — saves to `public/avatars/{userId}.{ext}`
- Delete endpoint: `DELETE /api/auth/avatar`
- Max 2MB, accepts JPEG/PNG/GIF/WebP
- `Avatar` component shows uploaded image or falls back to initials circle

### Roles & Permissions
- `role` field on ServerMember: `owner`, `admin`, `mod`, `member`
- Hierarchy in `lib/permissions.ts`: owner(4) > admin(3) > mod(2) > member(1)
- Server creator auto-assigned `owner`
- MemberList shows colored role badges + right-click context menu for role management
- API guards: `PATCH /api/servers/:id/members/:userId` (change role), `DELETE` (kick)
- Higher roles can manage lower roles only

### Channels
- Two types: `text` (default) and `voice` — stored in `Channel.type` field
- Text channels show `#` icon, voice channels show speaker icon
- Voice channels show connected participant count and inline names in sidebar

### Messages
- Optimistic rendering with temp IDs, replaced on server confirmation
- Edit/delete with realtime broadcast
- Unread badges on text channels (tracked per-channel)
- Emoji reactions with toggle semantics (click to add/remove)
- File/image attachments (10MB max, inline image preview, file download cards)
- Message search: `GET /api/messages/search?serverId=X&q=term` with debounced UI

---

## Running Locally

```bash
# 1. Start PostgreSQL (or use Docker)
docker compose -f docker-compose.prod.yml up -d postgres

# 2. Install dependencies
pnpm install

# 3. Run migrations
npx prisma migrate deploy

# 4. Generate Prisma client
npx prisma generate

# 5. Start the realtime server
npx tsx realtime/server.ts &

# 6. Start Next.js dev server
pnpm dev
```

The app runs at `http://localhost:3000`, realtime server at `http://localhost:3001`.

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/campfire?schema=public` | PostgreSQL connection |
| `JWT_SECRET` | `campfire-secret-change-me` | JWT signing secret |
| `NEXT_PUBLIC_SOCKET_URL` | `http://localhost:3001` | Socket.IO server URL |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | CORS origin for Socket.IO |
| `SOCKET_PORT` | `3001` | Realtime server port |

---

## Common Patterns

### Adding a new field to User
1. Add field in `prisma/schema.prisma`
2. Create migration: `npx prisma migrate dev --name describe-change`
3. Update API `select` clauses (auth/me, members, messages) to include the new field
4. Update TypeScript interfaces in components

### Dynamic imports for DB resilience
Guest users work without a database. API routes use `try { const { prisma } = await import("@/lib/db"); ... } catch { /* fallback */ }` pattern.

### Modular hooks architecture
The chat page (`app/chat/page.tsx`) is a thin composition layer. All logic lives in `hooks/`:

| Hook | Owns | Touch when... |
|---|---|---|
| `useAuth` | user, login, logout, avatar | changing auth flow |
| `useServers` | server list, create/join | adding server features |
| `useChannels` | active channel, URL, unreads | changing channel behavior |
| `usePresence` | online members, user role | updating presence/roles |
| `useVoice` | voice state, PTT, participants | working on voice features |
| `useKeyboardShortcuts` | all hotkeys | adding shortcuts |

Shared types live in `types/chat.ts`. Each hook is self-contained — work on one without reading the others.

### forwardRef + useImperativeHandle
Used by VoicePanel to expose methods to the parent chat page. The parent holds a ref (`voicePanelRef`) and calls methods like `voicePanelRef.current?.toggleMute()` from VoiceRoom's button callbacks.

---

## What's Built vs. What's Next

See `ROADMAP.md` for the full 20-section voice product roadmap with `[x]` built / `[~]` partial / `[ ]` not started annotations.

**Recently completed (v0.0.5):**
- Roles & permissions (owner/admin/mod/member hierarchy)
- Role badges with color coding in member list
- Right-click context menu for role management + kick
- Speaking indicators via voice activity detection (VAD)
- Push-to-talk (Space bar hold, toggle in voice room)
- Emoji reactions with toggle semantics
- File/image uploads with inline preview
- Message search with debounced API
- Keyboard shortcuts (Ctrl+K search, Ctrl+M mute, Ctrl+D deafen)

**High-priority next items (P0):**
- Reconnect/reliability for voice
- Per-user volume control
- Input sensitivity slider
- SFU for scalable voice (currently P2P, won't scale past ~6 users)
- Channel-specific permissions

**Future:**
- DMs, mentions, link previews
- Screen share, camera
- Stage mode, shared activities

---

## Gotchas

- **Next.js 16 breaking changes**: `params` is a Promise (must `await params`), `cookies()` is async, middleware is deprecated. Check `node_modules/next/dist/docs/` if unsure.
- **Prisma v7**: Requires adapter-based constructor (`@prisma/adapter-pg`), explicit output path in schema.
- **Cookie name**: Still `squatch-token` for backward session compatibility after the rename to Campfire.
- **Guest usernames**: Stored as `alice#a1b2c3d4`. Always use `displayName()` from `lib/utils.ts` for display.
- **Voice P2P limit**: Current WebRTC mesh topology won't scale past ~6 concurrent users in one voice channel.
- **No HTTPS locally**: WebRTC requires a secure context in production. Works on localhost for dev.

---

## Delegated Tasks (in progress by other devs)

Do NOT modify these files/features — separate branches pending merge:

| Branch | Task | Files |
|---|---|---|
| `feat/member-list-skeletons` | Loading skeleton placeholders | `components/MemberList.tsx` |
| `feat/typing-indicator` | Typing "X is typing..." display | `components/ChatPanel.tsx` |
| `feat/message-timestamps` | Hover tooltip with full date/time | `components/MessageBubble.tsx` |
| `feat/server-initials` | Server letter icons + hover animation | `components/ServerList.tsx` |
| `feat/channel-descriptions` | Optional description field + tooltip | `schema.prisma`, `api/channels`, `ChannelList.tsx` |

---

## Dev Communication Style

Short 3-6 word sentences. No filler, preamble, or pleasantries. Run tools first, show result, then stop. Do not narrate. Drop articles ("me fix code" not "I will fix the code").

---

*Last updated: April 2026 — v0.0.5*
