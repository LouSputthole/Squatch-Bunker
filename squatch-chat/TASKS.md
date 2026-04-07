# Campfire — 10 Priority Tasks for Helper Coder

## IMPORTANT: Project Context

The app is a **Next.js 16 App Router** project located at `squatch-chat/` in the repo.
**Branch from:** `main` (each task = its own branch, PR separately)
**Reference branch:** `claude/build-squatchchat-app-4LUJb` has the latest integrated code.

### Key Paths
- Components: `squatch-chat/components/` (React .tsx)
- API routes: `squatch-chat/app/api/`
- Pages: `squatch-chat/app/`
- Hooks: `squatch-chat/hooks/`
- Schema: `squatch-chat/prisma/schema.prisma`
- Socket server: `squatch-chat/realtime/server.ts`
- Globals CSS: `squatch-chat/app/globals.css` (tokens already defined)

### Design Rules
- CSS vars already exist: `var(--bg)`, `var(--panel)`, `var(--text)`, `var(--muted)`, `var(--accent)`, `var(--accent-2)`, `var(--danger)`
- Colors: deep charcoal `#1a1a1e`, warm amber `#f59e0b`, burnt orange accents
- No external UI libraries. Keep components under 400 lines.
- Do NOT create new CSS files — use the existing globals.css vars.

### Tech Notes
- Next.js 16: `params` is a Promise (must `await params`), `cookies()` is async
- Prisma v7 with `@prisma/adapter-pg`
- Socket.IO for realtime (attached to same HTTP server, path `/api/socketio`)
- Auth: JWT in HTTP-only cookie `squatch-token`, use `getSession()` from `@/lib/auth`
- Database: `import { prisma } from "@/lib/db"`

---

## Task 1: `feat/error-boundaries`
**Custom error & 404 pages**

Create these files:
- `squatch-chat/app/error.tsx` — Global error boundary. "use client". Shows error message, retry button, link to /chat. Campfire-themed (logo, "Something went wrong around the campfire").
- `squatch-chat/app/not-found.tsx` — 404 page. "Lost in the woods" theme. Shows Campfire logo, message, link back to `/chat`.
- `squatch-chat/app/chat/error.tsx` — Chat-specific error boundary. "use client". Preserves the sidebar layout, only the content area shows the error.

Style with existing CSS vars. Use `/Campfire-Logo.png` for the logo image.

**Acceptance:** All three pages render correctly. Error boundaries catch runtime errors. 404 shows for invalid routes.

---

## Task 2: `feat/password-reset`
**Forgot password flow**

Schema changes in `prisma/schema.prisma` — add to User model:
```prisma
resetToken   String?
resetExpiry  DateTime?
```

Create:
- `squatch-chat/app/api/auth/forgot-password/route.ts` — POST takes `{ email }`. Generates a random token (crypto.randomUUID), stores it on User with 1hr expiry. Returns success (don't reveal if email exists).
- `squatch-chat/app/api/auth/reset-password/route.ts` — POST takes `{ token, password }`. Validates token exists and not expired. Hashes new password with bcrypt, clears token. Returns success.
- `squatch-chat/app/forgot-password/page.tsx` — Form with email input. Submits to forgot-password API. Shows success message after submit.
- `squatch-chat/app/reset-password/page.tsx` — Reads `?token=xxx` from URL. Form with new password + confirm. Submits to reset-password API. Redirects to /login on success.

Add "Forgot password?" link on `squatch-chat/app/login/page.tsx` below the password field.

**Acceptance:** Full flow works: request reset → get token → use token → password changed → can login.

---

## Task 3: `feat/message-attachments-preview`
**Rich file previews in chat messages**

Edit `squatch-chat/components/MessageBubble.tsx`.

Messages already have `attachmentUrl` and `attachmentName` fields. Currently they render as plain links. Add rich previews based on file extension:

- **Images** (.jpg, .png, .gif, .webp): Inline `<img>` with max-height 300px, rounded corners, click opens ImageLightbox (component already exists at `components/ImageLightbox.tsx`)
- **Videos** (.mp4, .webm, .mov): Inline `<video>` with controls, max-width 400px
- **Audio** (.mp3, .wav, .ogg): Inline `<audio>` with controls, styled progress bar
- **Other files**: Download card showing icon, filename (`attachmentName`), and download link

Helper function to detect type:
```typescript
function getFileType(name: string): "image" | "video" | "audio" | "file" {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["jpg","jpeg","png","gif","webp","svg"].includes(ext)) return "image";
  if (["mp4","webm","mov","avi"].includes(ext)) return "video";
  if (["mp3","wav","ogg","m4a","flac"].includes(ext)) return "audio";
  return "file";
}
```

**Acceptance:** Each file type renders with appropriate preview. Images open lightbox on click. Videos/audio play inline.

---

## Task 4: `feat/notification-system`
**Browser push notifications + notification bell**

Create:
- `squatch-chat/hooks/useNotifications.ts` — Hook that:
  - Requests Notification API permission on mount
  - Exposes `notify(title, body, onClick?)` function
  - Checks `document.hidden` before firing (only notify when tab not focused)
  - Plays a short notification sound using Web Audio API (sine wave, 200ms, 800Hz)

- `squatch-chat/components/NotificationBell.tsx` — Bell icon (SVG) for the user bar:
  - Shows red badge with unread count when > 0
  - Click opens dropdown with recent notifications (last 10, stored in state)
  - Each notification: sender name, preview text, timestamp
  - "Mark all read" button

Wire into `squatch-chat/app/chat/page.tsx`:
- Import NotificationBell, place next to ShareLink in user bar
- On socket `message:channel:*` events (when tab hidden): call notify
- On DM received: call notify
- On friend request: call notify

**Acceptance:** Browser notification appears when tab is not focused and a message arrives. Bell shows count. Sound plays.

---

## Task 5: `feat/channel-categories`
**Collapsible channel groups in sidebar**

Edit `squatch-chat/components/ChannelList.tsx`.

The Channel model already has a `category` field (String?, in schema). Group channels by category:

- Channels with `null`/empty category → group under "General"
- Each category renders as a collapsible header (click to toggle)
- Collapsed state persisted in localStorage key `collapsed-categories`
- Category header shows channel count
- Owner-only: right-click category header → rename (prompt or inline edit)
- Drag channels between categories (update via PATCH to `/api/channels/[channelId]` with `{ category: "newName" }`)

Visual: Category headers in uppercase, small text, var(--muted) color, with a chevron icon that rotates when collapsed.

**Acceptance:** Channels grouped by category. Collapse/expand works and persists. Owner can rename categories.

---

## Task 6: `feat/user-status-message`
**Custom status text + presets**

The User model already has `statusMessage` field.

Create:
- `squatch-chat/app/api/auth/status/route.ts` — PATCH takes `{ statusMessage }`. Updates current user's statusMessage. Max 128 chars. Import getSession from `@/lib/auth`, prisma from `@/lib/db`.

Edit `squatch-chat/app/chat/page.tsx`:
- In the status dropdown menu (where online/idle/dnd/invisible are), add:
  - Text input for custom status (placeholder: "What are you up to?")
  - Quick preset buttons: "Available", "Busy", "AFK", "In a meeting", "Gaming"
  - "Clear" button to remove status
  - Saves via fetch to `/api/auth/status`

Edit `squatch-chat/components/MemberList.tsx`:
- Show status message below username in member list (truncated to ~30 chars, tooltip for full text)
- Gray/muted text, italic

Edit `squatch-chat/components/ProfileCard.tsx`:
- Show status message if set

**Acceptance:** User can set/clear custom status. Status appears in member list and profile card. Presets work.

---

## Task 7: `feat/emoji-picker`
**Full searchable emoji picker for reactions**

Create `squatch-chat/components/EmojiPicker.tsx`:
- Grid of common emojis organized by category tabs: Smileys, People, Animals, Food, Activities, Objects, Symbols
- Search input at top that filters emojis
- "Recent" row at top (last 16 used, persisted in localStorage key `recent-emojis`)
- Click emoji → calls `onSelect(emoji: string)` callback
- Dismiss on outside click or Escape
- Compact: ~280px wide, max 300px tall, scrollable grid
- Build with plain emoji characters (no library needed). Use a static array of ~200 common emojis.

Edit `squatch-chat/components/MessageBubble.tsx`:
- Replace the existing small emoji popup (triggered by the 😀 button) with the new EmojiPicker
- On emoji select → call existing `onReact` handler
- Position picker above the message, anchored to the react button

**Acceptance:** Picker opens, search works, categories switch, recent persists, selecting emoji triggers reaction.

---

## Task 8: `feat/server-invite-modal`
**Polished invite link sharing UI**

Create `squatch-chat/components/InviteModal.tsx`:
- Modal overlay showing server invite link
- Displays: server name, server icon (or placeholder), member count
- Invite URL: `{window.location.origin}/join/{inviteCode}` in a readonly input
- "Copy Link" button (copies to clipboard, shows "Copied!" feedback)
- Owner sees "Regenerate Link" button (calls PATCH `/api/servers/[serverId]` with `{ regenerateInvite: true }`)
- Close button and click-outside-to-dismiss

Edit `squatch-chat/components/ChannelList.tsx`:
- Add "Invite People" button in the channel list header area (visible to all members)
- Opens InviteModal with current server data

Check `squatch-chat/app/join/[inviteCode]/page.tsx`:
- Verify it works. Should show server preview (name, icon, member count) before joining.
- If it just auto-joins, add a preview screen with "Join Server" button.

**Acceptance:** Invite modal opens from channel list. Link copies. Owner can regenerate. Join page shows preview.

---

## Task 9: `feat/typing-indicators`
**"User is typing..." display in chat**

Socket events `typing:start` and `typing:stop` already exist on the server (see `realtime/server.ts`). The server broadcasts `typing:update` events with `{ channelId, userId, username, isTyping }`.

Edit `squatch-chat/components/ChatPanel.tsx`:
- On keypress in message input: emit `typing:start` via socket (debounce — only emit once per 2 seconds)
- On message send OR 3 seconds of no typing: emit `typing:stop`
- Listen for `typing:update` events on the current channel
- Track typing users in state: `Map<userId, username>`
- Remove user from typing map when `isTyping: false` or after 4s timeout (safety)

Display below the message list, above the input:
- 1 user: "Alice is typing..."
- 2 users: "Alice and Bob are typing..."
- 3+ users: "Several people are typing..."
- Animated dots: CSS-only animation (three dots with staggered opacity pulse)

Height: fixed ~20px so the layout doesn't jump. Show/hide with opacity transition.

**Acceptance:** Typing indicator appears when another user types. Disappears when they stop or send. Dots animate.

---

## Task 10: `feat/unread-indicators`
**Unread message badges on channels and servers**

Edit `squatch-chat/hooks/useChannels.ts` (or create `squatch-chat/hooks/useUnread.ts`):
- Track last-read message timestamp per channel in localStorage: key `lastRead:{channelId}`
- On channel switch: update lastRead to current timestamp
- Listen for socket `message:channel:{channelId}` events
- Maintain unread count per channel in state

Edit `squatch-chat/components/ChannelList.tsx`:
- Show unread count badge (small circle with number) next to channel name if unread > 0
- Bold the channel name if it has unreads
- Badge style: var(--accent) background, white text, small rounded pill

Edit `squatch-chat/components/ServerList.tsx`:
- Show a small dot indicator on server icons that have any channel with unreads
- Dot: small white circle at bottom-right of the server icon

**Acceptance:** Switching away from a channel, then receiving messages shows unread count. Switching back clears it. Server dots appear when any child channel has unreads.
