# Squatch-Bunker

A Discord-inspired voice chat application built with Node.js, TypeScript, Express, Socket.io, and WebRTC.

## Features

- Real-time voice chat via WebRTC (peer-to-peer audio)
- Multiple voice channels (General, Gaming, Music out of the box)
- Live presence: see who is in each channel, with mute/deafen/speaking indicators
- WebRTC signaling relay (offer/answer/ICE candidates) over Socket.io
- Voice activity detection — speaking state broadcast to room members
- In-memory store (no database required)

## Stack

| Layer       | Technology               |
|-------------|--------------------------|
| Server      | Node.js + TypeScript     |
| HTTP API    | Express                  |
| Real-time   | Socket.io                |
| Audio/Video | WebRTC (browser-native)  |
| Client      | Vanilla HTML/CSS/JS      |

## Setup

### Prerequisites

- Node.js 18+
- npm 9+

### Install

```bash
npm install
```

### Development (auto-restart on changes)

```bash
npm run dev
```

### Production build

```bash
npm run build
npm start
```

The server listens on **http://localhost:3000** by default.  
Set the `PORT` environment variable to override.

## Project Structure

```
src/
  index.ts                 # Express + Socket.io server entry point
  models/
    Room.ts                # Room type definitions
    User.ts                # User type definitions
    Session.ts             # Session type definitions
  services/
    RoomService.ts         # CRUD for rooms, default room seeding
    PresenceService.ts     # Who is in what room, speaking state, heartbeat cleanup
    SessionRegistry.ts     # Maps socket IDs to user+room sessions
    UserService.ts         # In-memory user registration
  routes/
    rooms.ts               # REST: list, get, create, delete rooms
    users.ts               # REST: register (stub auth), get user
  sockets/
    roomHandlers.ts        # join-room, leave-room, heartbeat, mute/deafen/speaking events
    signalingHandlers.ts   # WebRTC offer/answer/ice-candidate relay
client/
  index.html               # Single-page app
  css/style.css            # Discord-inspired dark theme
  js/app.js                # Auth stub, room list, socket events, UI
  js/voiceClient.js        # WebRTC peer connection management + VAD
```

## REST API

| Method | Path                        | Description                       |
|--------|-----------------------------|-----------------------------------|
| POST   | /api/users/register         | Register a username, get userId   |
| GET    | /api/users/:id              | Get user by ID                    |
| GET    | /api/rooms?serverId=default | List rooms with occupancy counts  |
| GET    | /api/rooms/:id              | Room detail + current members     |
| POST   | /api/rooms                  | Create a new voice room           |
| DELETE | /api/rooms/:id              | Delete a room                     |

## Socket Events

### Client → Server

| Event            | Payload                                      | Description                          |
|------------------|----------------------------------------------|--------------------------------------|
| `identify`       | `{ userId, username }`                       | Associate socket with user identity  |
| `join-room`      | `{ roomId, userId, username }`               | Join a voice channel                 |
| `leave-room`     | `{ roomId }`                                 | Leave a voice channel                |
| `heartbeat`      | `{ roomId }`                                 | Keep presence alive                  |
| `mute-toggle`    | `{ roomId, muted }`                          | Toggle mic mute                      |
| `deafen-toggle`  | `{ roomId, deafened }`                       | Toggle deafen                        |
| `speaking`       | `{ roomId, speaking }`                       | Voice activity update                |
| `signal:offer`   | `{ targetUserId, sdp, roomId }`              | WebRTC offer relay                   |
| `signal:answer`  | `{ targetUserId, sdp, roomId }`              | WebRTC answer relay                  |
| `signal:ice-candidate` | `{ targetUserId, candidate, roomId }` | ICE candidate relay                  |

### Server → Client

| Event                    | Payload                          | Description                        |
|--------------------------|----------------------------------|------------------------------------|
| `room:state`             | `{ roomId, members[] }`          | Full room state on join            |
| `presence:member-joined` | `{ roomId, member }`             | Someone joined the room            |
| `presence:member-left`   | `{ userId, roomId }`             | Someone left the room              |
| `presence:state-update`  | `{ roomId, userId, ...patch }`   | Mute/deafen/speaking state changed |
| `signal:offer`           | `{ fromUserId, sdp }`            | Incoming WebRTC offer              |
| `signal:answer`          | `{ fromUserId, sdp }`            | Incoming WebRTC answer             |
| `signal:ice-candidate`   | `{ fromUserId, candidate }`      | Incoming ICE candidate             |

## Notes

- All data is stored in-memory; restarting the server resets all state.
- WebRTC works best on `localhost` or HTTPS. For LAN/remote use, deploy behind HTTPS and consider a TURN server.
- The microphone permission prompt appears when you join a voice channel.
