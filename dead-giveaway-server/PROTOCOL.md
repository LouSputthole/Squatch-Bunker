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
  Paths with a segment starting `.` (e.g. `.git/`) are never served.
- When `DG_CORS_ORIGINS` is set the list is also enforced on the WebSocket upgrade (which
  browser CORS does not cover); a same-origin page and a request without `Origin` always pass.
- Every client→server event that needs a reply uses a socket.io **ack** callback:
  `{ ok: true, ...}` or `{ ok: false, error: '<code>', message }`.
- Error codes: `room_not_found`, `room_full`, `bad_name`, `bad_character`, `not_host`,
  `wrong_phase`, `not_your_turn`, `bad_clue`, `bad_vote`, `bad_word`, `bad_target`,
  `not_rat`, `rate_limited`, `invalid`.
  `invalid` also covers: a payload that is not a plain object, `game:start` with fewer than
  3 connected players, `player:seat` on a taken seat, and any clue/ready/vote intent from an
  `out` player. Intents sent while not in a room answer `room_not_found`.
- Names are 1..20 characters after trimming (control characters stripped). `character` is
  an id matching `^[A-Za-z0-9_-]{1,32}$`; the server does not know the roster.

## Identity and reconnect

- `clientId`: random UUID the client keeps in `localStorage` (`dg.clientId`).
- On `room:create`/`room:join` the server returns `playerId` and `token`. The client keeps
  `{code, playerId, token}` in `sessionStorage` (`dg.session`) and on page reload calls
  `room:join` again with the token → same `playerId`, same seat, same role, same lives.
  On a token rejoin the payload's `name`/`character` are ignored (the seated ones are kept).
  A token the room no longer knows (player removed) is ignored and the call is an ordinary
  fresh join, so send `name`/`character` every time. If the same player is still connected on
  another socket, that socket receives `room:closed {reason:'replaced'}` and is detached.
- Codes are case-insensitive on `room:join` (the server upper-cases them).
- A player whose socket drops stays in the room with `connected:false` for
  **`DG_DISCONNECT_GRACE_MS` (default 90000)**; then they are removed (in LOBBY) or marked
  `out:true` with their lives kept at whatever they were (in a match). The host role passes
  to the lowest `joinSeq` connected player if the host leaves **or disconnects** (immediately,
  so a host-only action is never stuck behind a dropped socket); a returning former host does
  not take it back. Players abandoned mid-match are removed when the room returns to LOBBY.
- Joining mid-match (not a token rejoin) is allowed while seats remain: the newcomer sits
  `out:true` with `lives:0`, is not dealt in (`me.role` null), and plays from the next match.
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
| `game:start` | `{}` | host, LOBBY, ≥3 connected players (disconnected players still inside their grace are dealt in too) |
| `game:clue` | `{text}` | CLUES, your turn; 1..60 chars after trim |
| `game:skipTurn` | `{}` | host, CLUES; skips the current (usually disconnected) seat |
| `game:readyToVote` | `{ready:boolean}` | DISCUSS; when every alive connected player is ready → VOTE |
| `game:callVote` | `{}` | host, DISCUSS → VOTE immediately |
| `game:vote` | `{target: playerId}` | VOTE; not yourself, target must be alive |
| `game:lastWord` | `{index: 0..15}` | LAST_WORD, Rat only |
| `game:payback` | `{target: playerId}` | PAYBACK, Rat only; alive, not the Rat |
| `game:next` | `{}` | host, RESOLVE → next DEAL (or MATCH_OVER) ; MATCH_OVER → LOBBY |
| `game:abort` | `{}` | host, any phase → LOBBY (lives reset) |

Every acked event is rate limited per player (per socket before joining): `room:create` and
`room:join` 5 burst then 1 per 2 s; `room:leave` 5 burst, 2/s; `turn:get` 5 burst, 1/s; each
`player:*`/`game:*` event 10/s. Over the limit the ack is `{ok:false, error:'rate_limited'}`.

Fire-and-forget (no ack), rate limited server-side:

| event | payload | relayed as | limit |
|---|---|---|---|
| `pose` | `{yaw, pitch}` radians (finite, abs ≤ 1000) | `pose {playerId, yaw, pitch}` (volatile, to room minus sender) | 15/s |
| `act` | `{kind}` kind ∈ `drink smoke spit point lean shake raise nod` | `act {playerId, kind, ts}` to room minus sender | 2/s |
| `chat` | `{text}` 1..200 chars after trim | `chat {playerId, name, text, ts}` to the whole room **including the sender** (text trimmed, control chars stripped) | 3/s |
| `media:state` | `{mic:boolean, cam:boolean}` (both required) | stored on player, state broadcast if changed | 5/s |
| `media:speaking` | `{speaking:boolean}` | `media:speaking {playerId, speaking}` to room minus sender | 10/s |
| `rtc:hello` | `{}` | `rtc:hello {playerId, joinSeq}` to room minus sender | 1/s |
| `rtc:signal` | `{to: playerId, data}` `data` is an opaque object (`{type:'offer'|'answer'|'ice', sdp?, candidate?}`) ≤ 64 KB | `rtc:signal {from: playerId, data}` to that player's current socket only | 60/s |

With ack:

| event | payload | ack |
|---|---|---|
| `turn:get` | `{}` | `{ok, iceServers:[{urls, username?, credential?}], expiresAt}` — Google STUN always; TURN entries only when `TURN_URLS`/`TURN_URL` + `TURN_AUTH_SECRET` (coturn REST HMAC, same env names and algorithm as squatch-chat `lib/turnCredentials.ts`) are configured. Only answered to a socket that is in a room (otherwise `{ok:false, error:'room_not_found'}`). The TURN entry is one object whose `urls` is an array of every configured URL; its username is `<expiryUnix>:<playerId>`. `expiresAt` is epoch ms of the TURN credential's expiry, or `null` when only STUN is returned. |

`rtc:signal` is relayed only to a player seated in the sender's room, at that player's current
socket. A signal to an unknown or currently disconnected player is dropped with
`error {code:'bad_target'}`; one whose `data` is not a plain object or serialises over 64 KB is
dropped with `error {code:'invalid'}`. Packets over 100 KB close the connection (socket.io
`maxHttpBufferSize`). The `error` event for a fire-and-forget rejection is sent at most once per
second per event and code.

Server → client:

| event | payload |
|---|---|
| `state` | full room snapshot (below), **per socket** because `me` is private |
| `pose`, `act`, `chat`, `media:speaking`, `rtc:hello`, `rtc:signal` | as relayed above |
| `room:closed` | `{reason}` — `'replaced'` (same player joined on another socket), `'empty'` (last player left), `'expired'` (room reaped after everyone was gone for the grace), `'shutdown'` |
| `error` | `{code, message}` (for fire-and-forget rejections) |

## State snapshot

```js
{
  code: 'BUNK7',                 // 5 chars, A-Z2-9, no 0/O/1/I (so never 'BING7': no I)
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
  clues: [{ playerId, seat, text, order }],   // this round, in order given; order is 1-based;
                                              // text null = skipped ("— said nothing —")
  result: null | {               // null until VOTE_RESULT
    tally: { [playerId]: votes },  // VOTE_RESULT and later
    votes: { [voterId]: targetId },
    accusedId: 'p_…' | null,       // plurality winner; null on a tie (or no votes at all)
    caught: boolean | null,        // accusedId === ratId; null during VOTE_RESULT (it would name the Rat early)
    ratId: 'p_…' | null,           // ROLE_REVEAL and later (null before)
    roles: { [playerId]: 'rat' | 'family' } | null,  // ROLE_REVEAL and later; only players dealt into this round
    targetIndex: 0..15 | null,     // RESOLVE and later (everyone learns it)
    lastWord: null | { index: 0..15 | null, correct },  // index null = Last Word timed out
    payback: null | { targetId },
    lifeLoss: null | { playerId, livesAfter },
    voided: boolean                // true = round called off (see Edge rules); no votes, no penalty
  },
  match: null | { winnerIds: [], rounds: n },  // MATCH_OVER
  me: { playerId, role: 'rat' | 'family' | null, targetIndex: 0..15 | null }
  //  role/targetIndex are null in LOBBY, and targetIndex is ALWAYS null for the Rat
  //  until RESOLVE (then result.targetIndex carries it, and me.targetIndex is set for
  //  every dealt player). The 16 words are the same array in the same order for
  //  everyone; the server shuffles a card's words once per deal. Players who were out
  //  at the deal (eliminated, abandoned, joined mid-match) are not dealt in: role null,
  //  targetIndex null until RESOLVE.
  //  In MATCH_OVER, card/clues/result still hold the final round.
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
VOTE_RESULT  5 s. tally + votes + accusedId (plurality; TIE → accusedId null, caught false —
             but `caught` is sent as null until ROLE_REVEAL so the result cannot name the Rat).
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

How the server reads those rules (exactly what it does):

- "Connected" in the mid-round rule means *still at the table*: connected, or disconnected but
  inside `DG_DISCONNECT_GRACE_MS`. A page reload therefore never calls a round off. The round
  is called off (`result.voided:true`, straight to RESOLVE, no life lost, `ratId`/`roles`/
  `targetIndex` all shown) during DEAL, CLUES, DISCUSS or VOTE when, after a `room:leave` or
  a grace expiry, fewer than 3 alive players remain **or the Rat is the one who went**. After
  VOTE closes the round always plays out by its timeouts.
- If the Rat `room:leave`s during LAST_WORD or PAYBACK the timeout rule applies at once
  (wrong guess / random victim) instead of waiting out the 60 s. A Rat who has left loses no
  life (`lifeLoss` null) because there is nobody to take it from.
- DISCUSS completes when every alive *connected* player is ready, and VOTE when every alive
  *connected* player has voted; a disconnect can complete either. A disconnected player's
  CLUES turn waits for the host's `game:skipTurn`; a player who leaves or is abandoned is
  skipped automatically (no clue entry).
- A vote cast for a player who then leaves is handed back: that voter's `hasVoted` returns to
  false and they vote again.
- Abandoned players (grace expired mid-match) are `out:true` with lives kept; at
  MATCH_OVER they are not winners. They may still token-rejoin to watch.

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
A file may also hold an array of such objects (a pack). Ids are lowercase slugs, unique across
files; words are compared trimmed and case-insensitively, at most 24 characters each;
categories at most 60. See the server's `cards/README.md`.
