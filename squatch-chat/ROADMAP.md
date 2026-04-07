# Campfire Voice Product Roadmap

> "Five products wearing one trench coat: a real-time media system, a chat system, a room/presence system, a moderation/admin system, and a social hangout layer."

---

## Status Legend

- [x] Built
- [~] Partially built
- [ ] Not started

---

## P0: Must Have for a Real Product

### 1. Persistent Voice Rooms [~]

**What exists:**
- [x] Voice channels persist in DB (Channel model with type="voice")
- [x] Voice channel list in UI with create button
- [x] Occupancy indicators (participant count badge)
- [x] Instant join button (click channel to join)
- [x] Real-time roster updates via Socket.IO
- [x] Presence state: who is in room, muted, deafened

**Still needed:**
- [ ] Room model enhancements: member capacity, permissions, type variants (stage, private)
- [x] Speaking indicator (voice activity detection)
- [ ] Streaming/video presence states
- [x] Session lifecycle: reconnect after drop, server-side stale session cleanup
- [x] Heartbeats to detect disconnects (15s interval, 45s timeout)
- [ ] Join target: under 1-2 seconds
- [x] Dropped clients disappear after timeout (heartbeat-based)
- [ ] Reconnect returns to prior room

### 2. Real-Time Voice Transport [~]

**What exists:**
- [x] WebRTC peer-to-peer audio transport
- [x] Signaling service via Socket.IO (SDP exchange, ICE candidates)
- [x] STUN servers (Google public STUN)
- [x] Mic capture with echo cancellation, noise suppression, AGC
- [x] Playback handling via HTMLAudioElement

**Still needed:**
- [ ] TURN fallback for hard NAT cases (self-hosted or service)
- [ ] SFU for multi-user scalability (current P2P mesh won't scale past ~6 users)
- [ ] Codec strategy / bitrate adaptation
- [ ] Jitter buffer / packet loss concealment
- [ ] Metrics: RTT, jitter, packet loss, bitrate, reconnect frequency
- [ ] Device switching without restart
- [x] Push-to-talk support (Space bar)

### 3. Low-Friction Join/Leave [~]

**What exists:**
- [x] One-click join (click voice channel)
- [x] Fast leave (disconnect button)
- [x] Clear UI states: connecting, connected
- [x] No modal spam

**Still needed:**
- [ ] Silent join option
- [ ] Move user between channels
- [ ] Return to previous room after reconnect
- [ ] Race condition handling: double join, join while reconnecting, fast room switching
- [ ] Join/leave state machine (formal)
- [x] Reconnecting state in UI
- [ ] Preserve room context while app minimized
- [x] Prevent user in two voice rooms at once (server-side enforcement)

### 4. Audio Controls [~]

**What exists:**
- [x] Mute / unmute with SVG icon
- [x] Deafen with SVG icon
- [x] Device selection (input + output) in Settings modal
- [x] Input/output volume sliders
- [x] Mic test with real-time level meter
- [x] Output test tone
- [x] Settings persist to localStorage
- [x] Echo cancellation, noise suppression, AGC (browser defaults)

**Still needed:**
- [x] Push-to-talk with hotkey support (Space bar)
- [x] Voice activity detection (speaking indicator)
- [x] Per-user volume control (right-click participant → volume slider)
- [x] Input sensitivity slider (Settings → Audio)
- [x] Hotkey support for mute toggle (Ctrl+M)
- [ ] Debug panel: mic detected? input level? output routed? permission denied?
- [x] Speaking indicator animation (green glow ring)
- [ ] Push-to-talk while app backgrounded

### 5. Permissions and Roles [~]

**What exists:**
- [x] Role model (owner, admin, mod, member) on ServerMember
- [x] Permission hierarchy with level-based checks
- [x] Role badges with color coding in member list
- [x] Right-click context menu for role assignment
- [x] Kick member (admin+)
- [x] Permission guards on API routes
- [x] Server creator auto-assigned owner role

**Still needed:**
- [ ] Custom roles
- [ ] Permission inheritance
- [ ] Channel overrides
- [ ] Special perms: connect, speak, mute members, move members, manage channel, stream, video, priority speaker, stage speaker
- [ ] Cached permission resolution
- [ ] Audit log for mod actions
- [ ] Channel-specific permission UI

### 6. Moderation Basics [~]

**What exists:**
- [x] Right-click user actions (context menu)
- [x] Mod badges / role indicators
- [x] Kick member from server

**Still needed:**
- [ ] Server mute (mod forces mute on user)
- [ ] Server deafen
- [ ] Kick from voice
- [ ] Move between rooms
- [ ] Temporary speaking suppression
- [ ] Block screen share / camera
- [ ] Report abuse flow
- [ ] Clear UI state when user is force-muted

### 7. Reconnect / Reliability [~]

**What exists:**
- [x] Reconnect flow (Socket.IO auto-reconnect + voice room rejoin)
- [x] ICE restart / media renegotiation (auto-detect failed peers, restart ICE)
- [x] Reconnecting UI state (yellow "Reconnecting..." banner)
- [x] Silent recovery when possible (re-syncs mute/deafen state on reconnect)
- [x] Retry backoff (Socket.IO exponential backoff 1s-10s, 10 attempts)

**Still needed:**
- [ ] Resume session token
- [ ] Channel fallback on server failure
- [ ] Grace period for transient disconnects (server-side)
- [ ] Health checks / heartbeats
- [ ] Fallback to audio-only if video dies

### 8. Mobile-Capable Audio [ ]

**Still needed:**
- [ ] Responsive/touch-friendly voice controls
- [ ] Background audio behavior
- [ ] Bluetooth routing
- [ ] Speaker/earpiece handling
- [ ] OS permission flow
- [ ] Battery-conscious media strategy
- [ ] Reduced UI complexity for mobile
- [ ] Lock-screen controls
- [ ] Graceful downgrade from video to audio

### 9. Presence / Roster [~]

**What exists:**
- [x] Online/offline member list per server
- [x] Voice participants shown in channel list
- [x] Mute/deafen indicators per participant

**Still needed:**
- [x] Presence statuses: online, idle, DND, invisible (with auto-idle after 5min)
- [x] Speaking indicator
- [ ] Fine-grained notification settings
- [ ] Friends online indicator
- [ ] Presence in server/channel list

### 10. Basic Observability [ ]

**Still needed:**
- [ ] Product analytics: room join rate, time-to-join, session duration, drop rate
- [ ] Media telemetry: packet loss, RTT, jitter, bitrate
- [ ] Admin dashboard: active rooms, occupancy, failed joins
- [ ] Client diagnostic panel
- [ ] Logging and tracing
- [ ] Alerting

---

## P1: Makes It Competitive

### 11. In-Room Text Chat [~]
- [ ] Text thread bound to voice room ID
- [ ] Message persistence
- [x] Reactions
- [x] Attachments (file/image uploads)
- [x] Mentions (@username highlighting), clickable link rendering
- [ ] Split-pane or tabbed UI
- [ ] Unread indicators inside voice room

### 12. Screen Share / App Streaming [ ]
- [ ] Screen capture pipeline
- [ ] Window capture
- [ ] Audio capture for shared content
- [ ] Stream start/stop/pause
- [ ] SFU support for screen video tracks
- [ ] Viewer grid or pinned layout
- [ ] Fullscreen mode

### 13. Camera / Video [ ]
- [ ] Webcam device selection
- [ ] Video track publishing
- [ ] Grid/speaker/pinned layouts
- [ ] Camera toggle with preview
- [ ] Low-bandwidth mode
- [ ] Per-user video subscriptions

### 14. Noise Suppression Tuning [ ]
- [ ] Presets: Standard, Low Latency, High Suppression
- [ ] Ability to disable processing
- [ ] Background voice isolation option
- [ ] Clipping/suppression metrics

### 15. Region / Bitrate Controls [ ]
- [ ] Region selection or auto-region
- [ ] Bitrate tiers
- [ ] Bandwidth estimation
- [ ] Audio priority over video/screen share
- [ ] Network health indicator

### 16. Invite / Social Flows [~]
**What exists:**
- [x] Server invite codes
- [x] Join by invite code
- [x] Copy invite button

**Still needed:**
- [ ] User profiles
- [ ] Friend relationships
- [ ] Voice-specific status
- [ ] Follow friend into room
- [ ] Hover/profile cards
- [ ] Blocked-user behavior

### 17. Stage / Event Mode [ ]
- [ ] Room type: stage
- [ ] Speaker/listener roles
- [ ] Request-to-speak queue
- [ ] Bring-to-stage action
- [ ] Suppressed audience mic
- [ ] Distinct UI from normal voice rooms

---

## P2: Makes It Sticky and Differentiated

### 18. Shared Activities / Watch Together [ ]
- [ ] Activity launcher
- [ ] Session binding to room
- [ ] Shared state sync
- [ ] Playback sync
- [ ] Embedded app framework

### 19. Safety / Abuse / Privacy [~]
**What exists:**
- [x] JWT auth (prevents spoofing)

**Still needed:**
- [ ] Block user
- [ ] Ignore user
- [ ] Report user
- [ ] Room privacy options
- [ ] Invite-only/private rooms
- [ ] Consent handling for recording
- [ ] Safety escalation tooling

### 20. Core UX Polish [~]
**What exists:**
- [x] Muted/deafened icons
- [x] Join/leave sounds
- [x] Clear connecting state
- [x] Keyboard shortcuts (Ctrl+K search, Ctrl+M mute, Ctrl+D deafen, Esc close)
- [x] Message search
- [x] Logo/branding integration

**Still needed:**
- [x] Speaking indicators (green glow)
- [ ] Drag-and-drop user move for mods
- [ ] Idle-in-room behavior
- [ ] Lightweight overlays / mini controls
- [ ] No surprise device switching
- [ ] Good empty states for rooms

### 21. Advanced Admin Tooling [ ]
- [ ] Rich diagnostics
- [ ] Advanced layout and stream controls
- [ ] Soundboards / voice messages

---

## Engineering Epics

1. **Identity, membership, and room model**
2. **Presence and real-time event infrastructure**
3. **Voice media transport**
4. **Audio device and processing layer**
5. **Permissions and moderation**
6. **Screen share and video**
7. **In-room text and shared context**
8. **Stage/events mode**
9. **Mobile experience**
10. **Observability and support tooling**
11. **Safety and abuse systems**
12. **Social features and activities**

---

## Current Architecture

- **Frontend**: Next.js 16 App Router + React 19 + Tailwind CSS
- **Realtime**: Socket.IO (port 3001) for signaling + presence
- **Voice**: WebRTC P2P mesh (works for small groups, needs SFU for scale)
- **Database**: PostgreSQL + Prisma v7
- **Auth**: JWT in HttpOnly cookies, bcrypt passwords
- **Deployment**: Docker + docker-compose.prod.yml

## Version History

- v0.0.1 — Initial chat app: servers, channels, messages, guest login
- v0.0.2 — Message edit/delete, optimistic sends, URL routing, unread badges
- v0.0.3 — Separate voice/text channels, WebRTC voice, mute/deafen icons, settings modal, notification sounds, Docker hosting
- v0.0.4 — Profile pictures, emoji reactions, file/image uploads, message search, keyboard shortcuts, logo integration
- v0.0.5 — Roles & permissions (owner/admin/mod/member), speaking indicators (VAD), push-to-talk, role management UI
