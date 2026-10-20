# Dead Giveaway — wire protocol (canonical copy)

Server: `Squatch-Bunker/dead-giveaway-server` (Node, socket.io 4.8.x, in-memory, no DB).
Client: `SquatchSmash/deadgiveaway.html` + `SquatchSmash/src/deadgiveaway/`.
A copy of this file lives at `SquatchSmash/docs/DEAD-GIVEAWAY-PROTOCOL.md`; keep them identical.

Terminology is fixed: the game is **Dead Giveaway**, the hidden player is **The Rat**,
everyone else is **the Family**. Never "impostor", "spy", "civilian".

## Transport

- socket.io default namespace, **path `/dg/socket`**. CORS: `DG_CORS_ORIGINS` (comma list)
  or `*` when unset (self-host default). No cookies, no auth: a room code is the secret.
- Server also serves static files from `DG_STATIC_DIR` (point it at a SquatchSmash checkout)
  so LAN play is same-origin: `http://host:3100/deadgiveaway.html`. `GET /dg/health` → `{ok:true}`.
- Every client→server event that needs a reply uses a socket.io **ack** callback:
  `{ ok: true, ...}` or `{ ok: false, error: '<code>', message }`.
- Error codes: `room_not_found`, `room_full`, `bad_name`, `bad_character`, `not_host`,
  `wrong_phase`, `not_your_turn`, `bad_clue`, `bad_vote`, `bad_word`, `bad_target`,
  `not_rat`, `rate_limited`, `invalid`.

## Identity and reconnect

- `clientId`: random UUID the client keeps in `localStorage` (`dg.clientId`).
- On `room:create`/`room:join` the server returns `playerId` and `token`. The client keeps
  `{code, playerId, token}` in `sessionStorage` (`dg.session`) and on page reload calls
  `room:join` again with the token → same `playerId`, same seat, same role, same lives.
- A player whose socket drops stays in the room with `connected:false` for
  **`DG_DISCONNECT_GRACE_MS` (default 90000)**; then they are removed (in LOBBY) or marked
  `out:true` with their lives kept at whatever they were (in a match). The host role passes
  to the lowest `joinSeq` connected player if the host leaves.
- Every player has `joinSeq` (monotonic per room, bumps on every (re)join). It decides
  WebRTC offer direction: see "Media signaling".

## Room lifecycle

Client → server (all with ack):

| event | payload | notes |
|---|---|---|
| `room:create` | `{clientId, name, character}` | ack `{ok, code, playerId, token, state}` |
| `room:join` | `{clientId, code, name, character, token?}` | ack `{ok, playerId, token, state}` |
| `room:leave` | `{}` | removes player immediately (any phase) |
| `player:character` | `{character}` | LOBBY only |
| `player:seat` | `{seat}` | LOBBY only, seat 0..7 must be free |
| `game:start` | `{}` | host, LOBBY, ≥3 connected players |
| `game:clue` | `{text}` | CLUES, your turn; 1..60 chars after trim |
| `game:skipTurn` | `{}` | host, CLUES; skips the current (usually disconnected) seat |
| `game:readyToVote` | `{ready:boolean}` | DISCUSS; when every alive connected player is ready → VOTE |
| `game:callVote` | `{}` | host, DISCUSS → VOTE immediately |
| `game:vote` | `{target: playerId}` | VOTE; not yourself, target must be alive |
| `game:lastWord` | `{index: 0..15}` | LAST_WORD, Rat only |
| `game:payback` | `{target: playerId}` | PAYBACK, Rat only; alive, not the Rat |
| `game:next` | `{}` | host, RESOLVE → next DEAL (or MATCH_OVER) ; MATCH_OVER → LOBBY |
| `game:abort` | `{}` | host, any phase → LOBBY (lives reset) |

Fire-and-forget (no ack), rate limited server-side:

| event | payload | relayed as | limit |
|---|---|---|---|
| `pose` | `{yaw, pitch}` radians | `pose {playerId, yaw, pitch}` (volatile, to room minus sender) | 15/s |
| `act` | `{kind}` kind ∈ `drink smoke spit point lean shake raise nod` | `act {playerId, kind, ts}` | 2/s |
| `chat` | `{text}` ≤ 200 chars | `chat {playerId, name, text, ts}` | 3/s |
| `media:state` | `{mic:boolean, cam:boolean}` | stored on player, state broadcast | 5/s |
| `media:speaking` | `{speaking:boolean}` | `media:speaking {playerId, speaking}` | 10/s |
| `rtc:hello` | `{}` | `rtc:hello {playerId, joinSeq}` to room minus sender | 1/s |
| `rtc:signal` | `{to: playerId, data}` `data` is an opaque object (`{type:'offer'|'answer'|'ice', sdp?, candidate?}`) ≤ 64 KB | `rtc:signal {from: playerId, data}` to that player's current socket only | 60/s |

With ack:

| event | payload | ack |
|---|---|---|
| `turn:get` | `{}` | `{ok, iceServers:[{urls, username?, credential?}], expiresAt}` — Google STUN always; TURN entries only when `TURN_URLS`/`TURN_URL` + `TURN_AUTH_SECRET` (coturn REST HMAC, same env names and algorithm as squatch-chat `lib/turnCredentials.ts`) are configured. Only answered to a socket that is in a room. |

Server → client:

| event | payload |
|---|---|
| `state` | full room snapshot (below), **per socket** because `me` is private |
| `pose`, `act`, `chat`, `media:speaking`, `rtc:hello`, `rtc:signal` | as relayed above |
| `room:closed` | `{reason}` |
| `error` | `{code, message}` (for fire-and-forget rejections) |

## State snapshot

```js
{
  code: 'BING7',                 // 5 chars, A-Z2-9, no 0/O/1/I
  hostId: 'p_…',
  phase: 'LOBBY',                // see Phases
  round: 0,                      // 1-based once dealing
  startSeat: 0,                  // seat that gives the first clue this round
  turnSeat: null,                // CLUES only: whose turn
  phaseEndsAt: null,             // epoch ms for server-timed phases, else null
  settings: { lives: 3, maxPlayers: 8, minPlayers: 3, clueMaxLen: 60 },
  players: [{
    id: 'p_…', name: 'Lou', character: 'lou', seat: 0, joinSeq: 3,
    connected: true, isHost: true,
    lives: 3, out: false,        // out: eliminated (0 lives) or abandoned mid-match
    mic: true, cam: false,       // last media:state
    clue: null,                  // this round's clue text once submitted
    hasVoted: false,             // VOTE phase
    readyToVote: false           // DISCUSS phase
  }],
  card: null | { id: 'bing-drinks', category: 'Things behind the Bing bar', words: [16 strings] },
  clues: [{ playerId, seat, text, order }],   // this round, in order given
  result: null | {
    tally: { [playerId]: votes },  // VOTE_RESULT and later
    votes: { [voterId]: targetId },
    accusedId: 'p_…' | null,       // plurality winner; null on a tie
    caught: boolean,               // accusedId === ratId
    ratId: 'p_…',                  // ROLE_REVEAL and later (null before)
    roles: { [playerId]: 'rat' | 'family' },  // ROLE_REVEAL and later
    targetIndex: 0..15 | null,     // RESOLVE and later (everyone learns it)
    lastWord: null | { index, correct },
    payback: null | { targetId },
    lifeLoss: null | { playerId, livesAfter }
  },
  match: null | { winnerIds: [], rounds: n },  // MATCH_OVER
  me: { playerId, role: 'rat' | 'family' | null, targetIndex: 0..15 | null }
  //  role/targetIndex are null in LOBBY, and targetIndex is ALWAYS null for the Rat
  //  until RESOLVE (then result.targetIndex carries it). The 16 words are the same
  //  array in the same order for everyone.
}
```

## Phases (server-driven, in order)

```
LOBBY        host presses start (≥3 connected, ≤8). Lives reset to settings.lives, out=false.
DEAL         3 s. Rat chosen uniformly among alive players; card drawn (no repeat until deck
             exhausted); targetIndex uniform 0..15; startSeat = alive seat after last round's
             startSeat (round 1: lowest seat). `me` is private per socket.
CLUES        turn walks alive seats from startSeat in seat order; each player submits one clue.
             Disconnected player's turn: host may game:skipTurn (their clue = null, shown as
             "— said nothing —"). No clue timer in v1.
DISCUSS      no timer. Ends when all alive connected players readyToVote, or host callVote.
VOTE         each alive connected player votes once (cannot change). Ends when all have voted,
             or after 90 s (phaseEndsAt) — non-voters count as abstain.
VOTE_RESULT  5 s. tally + accusedId (plurality; TIE → accusedId null, caught false).
ROLE_REVEAL  6 s. Every player's role is revealed, Rat named. Both caught and escaped paths
             pass through here — the reveal happens BEFORE the Rat's guess.
LAST_WORD    only if caught. Rat picks index; 60 s timeout → counts as wrong.
             correct → nobody loses a life. wrong → Rat loses 1.
PAYBACK      only if not caught (including ties). Rat picks an alive non-Rat player; 60 s
             timeout → random alive non-Rat. Victim loses 1. The accused gets no automatic penalty.
RESOLVE      targetIndex public, lifeLoss shown, players at 0 lives become out:true.
             Host presses game:next (or 30 s auto). → DEAL, or MATCH_OVER if alive ≤ 2.
MATCH_OVER   winnerIds = all alive players (lives > 0). Host game:next → LOBBY (lives reset).
```

Edge rules: an `out` player keeps their seat, can talk, chat, gesture, use media, but cannot
clue/vote/be Rat/be a payback target. If the Rat disconnects during LAST_WORD/PAYBACK the
timeout rule applies. If fewer than 3 alive connected players remain mid-round, the round
resolves immediately as a no-penalty RESOLVE.

## Media signaling (full mesh, mirrors Campfire's VoicePanel engine)

- One `RTCPeerConnection` per remote **player** (keyed by playerId, not socket).
- **Who offers:** after a client has joined and its media engine is ready it emits `rtc:hello`
  (once per page load / reconnect). On receiving `rtc:hello {playerId}` every other client closes
  any existing PC to that player and waits for an offer. The hello sender creates one PC per
  connected remote player and sends offers to all of them. Everyone else only answers hello
  senders. Because every (re)load emits hello exactly once, there is no glare.
- The offerer of a PC stays its **initiator** for that PC's lifetime: it alone sends
  renegotiation offers for ICE restarts. Camera renegotiation is the exception below.
- Audio track always added when mic is granted (muted = `track.enabled=false`, still sent).
  Camera on/off = addTrack/removeTrack + a renegotiation offer **from the camera owner** on
  that PC (even if it was the answerer); the other side answers. Both sides must handle an
  incoming offer while stable; if an offer collides with one in flight, the side with the
  higher `joinSeq` rolls back (`setLocalDescription({type:'rollback'})`) and answers. Receivers show the face video only while the roster says `cam:true`.
- ICE: `turn:get` before creating PCs; STUN `stun:stun.l.google.com:19302` always included.
- `connectionState` `failed` → the PC's initiator refreshes ICE servers (`turn:get`), `restartIce()` + offer with `iceRestart:true`, at most once per 5 s. `disconnected` for 5 s → same. Still failed after 3 restarts → close and re-emit `rtc:hello` (fresh mesh).
- Speaking: local VAD (AnalyserNode, 100 ms tick, 300 ms hangover) → `media:speaking` on transitions only.
- Leaving/unload: stop all local tracks, close PCs, emit `room:leave` (or let grace expire).

## Cards

Server `cards/*.json`: `{ "id": "bing-drinks", "category": "Behind the Bing bar", "words": [ …exactly 16 distinct strings… ] }`.
`npm test` in the server rejects a card with ≠16 or duplicate words. The owner's VORP category cards drop in as more files in this format.
