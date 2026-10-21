// Dead Giveaway — the rules, as a state machine.
//
// Dependency-free and timer-free. Every reducer takes the room it acts on, the
// acting playerId, its payload and `now` (epoch ms), mutates only that room,
// and returns `{ ok: true }` or `{ ok: false, error, message }`. Nothing here
// reads the clock or Math.random on its own: time arrives as `now`, chance
// arrives as the `random` the room was created with. Given the same random and
// the same sequence of calls, a room plays out identically.
//
// The server drives timed phases by calling `due(room, now)` from its one
// interval. `snapshotFor(room, playerId)` is the only way state leaves this
// module, and it is the place secrets are withheld.

export const SEAT_COUNT = 8;
export const WORDS_PER_CARD = 16;

export const PHASE = Object.freeze({
  LOBBY: 'LOBBY',
  DEAL: 'DEAL',
  CLUES: 'CLUES',
  DISCUSS: 'DISCUSS',
  VOTE: 'VOTE',
  VOTE_RESULT: 'VOTE_RESULT',
  ROLE_REVEAL: 'ROLE_REVEAL',
  LAST_WORD: 'LAST_WORD',
  PAYBACK: 'PAYBACK',
  RESOLVE: 'RESOLVE',
  MATCH_OVER: 'MATCH_OVER',
});

// Milliseconds. PROTOCOL.md "Phases".
export const TIMINGS = Object.freeze({
  DEAL: 3_000,
  /* Owner, first playtest: "Lets also time each turn. Like 40 seconds to
   * write a word for each person. Enters blank if no choice." */
  CLUE: 40_000,
  VOTE: 90_000,
  VOTE_RESULT: 5_000,
  /* The reveal goes one head at a time, the Family first and the Rat last
   * (owner: "The reveal should go one player at a time over their head").
   * ROLE_REVEAL is the Rat's own beat; REVEAL_STEP is added per Family
   * member, so eight seats run 7 × 1.5 + 4 = 14.5 s and three run 7 s. */
  ROLE_REVEAL: 4_000,
  REVEAL_STEP: 1_500,
  LAST_WORD: 60_000,
  PAYBACK: 60_000,
  RESOLVE: 30_000,
});

export const DEFAULT_SETTINGS = Object.freeze({
  lives: 3,
  maxPlayers: 8,
  minPlayers: 3,
  /* Owner: "Limit answers to like 50 characters." */
  clueMaxLen: 50,
});

export const NAME_MAX_LEN = 20;
/* A host whose socket merely hiccups keeps the chair. The first full-round
 * verifier run lost the host inside the lobby: three Chromium contexts on a
 * software rasteriser stalled one tab past engine.io's ping timeout, the host
 * passed to seat 2 in the same instant, and the Deal button vanished for the
 * player who had opened the room. Ten seconds covers a reconnect; a host who is
 * really gone still hands over long before the 90 s grace. */
export const HOST_HANDOVER_MS = 10000;
export const CHAT_MAX_LEN = 200;
export const ACT_KINDS = Object.freeze(['drink', 'smoke', 'spit', 'point', 'lean', 'shake', 'raise', 'nod', 'finger']);

const CHARACTER_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

// Phases inside a round where the round can still be called off.
const ROUND_OPEN = new Set([PHASE.DEAL, PHASE.CLUES, PHASE.DISCUSS, PHASE.VOTE]);
// Phases where the roles (and so the Rat) are public.
const ROLES_PUBLIC = new Set([PHASE.ROLE_REVEAL, PHASE.LAST_WORD, PHASE.PAYBACK, PHASE.RESOLVE, PHASE.MATCH_OVER]);
// Phases where the target word is public.
const TARGET_PUBLIC = new Set([PHASE.RESOLVE, PHASE.MATCH_OVER]);

const ok = (extra) => (extra ? { ok: true, ...extra } : { ok: true });
const fail = (error, message) => ({ ok: false, error, message: message || error });

// ─── text helpers (shared with the server) ────────────────────────────────

// Strip C0/C1 control characters and bidi overrides, collapse whitespace, trim.
export function cleanText(value) {
  if (typeof value !== 'string') return null;
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validName(value) {
  const name = cleanText(value);
  if (!name || name.length > NAME_MAX_LEN) return null;
  return name;
}

export function validCharacter(value) {
  return typeof value === 'string' && CHARACTER_PATTERN.test(value) ? value : null;
}

// ─── room construction ────────────────────────────────────────────────────

/**
 * Create a room in LOBBY.
 * @param {object} settings  overrides for DEFAULT_SETTINGS (lives, maxPlayers, minPlayers, clueMaxLen)
 * @param {object} options   { code, deck: card[], random: () => [0,1), timings }
 */
export function createMatch(settings = {}, { code = null, deck = [], random = Math.random, timings = {} } = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...pickSettings(settings) };
  merged.maxPlayers = clampInt(merged.maxPlayers, 3, SEAT_COUNT);
  merged.minPlayers = clampInt(merged.minPlayers, 3, merged.maxPlayers);
  merged.lives = clampInt(merged.lives, 1, 9);
  merged.clueMaxLen = clampInt(merged.clueMaxLen, 1, 200);
  return {
    code,
    hostId: null,
    phase: PHASE.LOBBY,
    round: 0,
    startSeat: 0,
    turnSeat: null,
    phaseEndsAt: null,
    settings: merged,
    players: [],
    card: null,
    clues: [],
    result: null,
    match: null,
    // private, never serialised as-is
    deck: Array.isArray(deck) ? deck : [],
    usedCardIds: [],
    random,
    timings: { ...TIMINGS, ...timings },
    joinCounter: 0,
    lastStartSeat: null,
    secret: null, // { ratId, targetIndex, roles, turnOrder, turnIdx, votes }
  };
}

function pickSettings(s) {
  const out = {};
  if (!s || typeof s !== 'object') return out;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (Number.isFinite(s[key])) out[key] = s[key];
  }
  return out;
}

function clampInt(v, lo, hi) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function randInt(room, n) {
  const r = Number(room.random());
  const x = Number.isFinite(r) ? r : 0;
  return Math.min(n - 1, Math.max(0, Math.floor(x * n)));
}

// ─── queries ──────────────────────────────────────────────────────────────

export function findPlayer(room, playerId) {
  return room.players.find((p) => p.id === playerId) || null;
}

export function isAlive(p) {
  return !!p && !p.out && p.lives > 0;
}

export function alivePlayers(room) {
  return room.players.filter(isAlive).sort((a, b) => a.seat - b.seat);
}

function aliveConnected(room) {
  return alivePlayers(room).filter((p) => p.connected);
}

function host(room, playerId) {
  return room.hostId === playerId;
}

// ─── membership ───────────────────────────────────────────────────────────

/**
 * Seat a new player. Joining mid-match seats them as out (lives 0) until the
 * next match: they can watch, talk and gesture but were never dealt in.
 */
export function addPlayer(room, { id, name, character }, now = 0) {
  if (typeof id !== 'string' || !id) return fail('invalid', 'Missing player id.');
  if (findPlayer(room, id)) return fail('invalid', 'Player already seated.');
  const cleanName = validName(name);
  if (!cleanName) return fail('bad_name', `Name must be 1-${NAME_MAX_LEN} characters.`);
  const cleanCharacter = validCharacter(character);
  if (!cleanCharacter) return fail('bad_character', 'Unknown character.');
  if (room.players.length >= room.settings.maxPlayers) return fail('room_full', 'The table is full.');
  const seat = lowestFreeSeat(room);
  if (seat === null) return fail('room_full', 'The table is full.');
  const inLobby = room.phase === PHASE.LOBBY;
  const player = {
    id,
    name: cleanName,
    character: cleanCharacter,
    seat,
    joinSeq: ++room.joinCounter,
    connected: true,
    lives: inLobby ? room.settings.lives : 0,
    out: !inLobby,
    abandoned: false,
    mic: false,
    cam: false,
    clue: null,
    hasVoted: false,
    readyToVote: false,
  };
  room.players.push(player);
  if (!room.hostId || !findPlayer(room, room.hostId)?.connected) room.hostId = id;
  void now;
  return ok({ player });
}

function lowestFreeSeat(room) {
  const taken = new Set(room.players.map((p) => p.seat));
  for (let s = 0; s < SEAT_COUNT; s++) if (!taken.has(s)) return s;
  return null;
}

/** A known player (token rejoin) is back on a socket. Same id, seat, role, lives. */
export function reconnectPlayer(room, playerId, now = 0) {
  const p = findPlayer(room, playerId);
  if (!p) return fail('room_not_found', 'Player is no longer at this table.');
  p.connected = true;
  p.disconnectedAt = null;
  p.abandoned = false; // still out for the rest of the match if they were abandoned
  p.joinSeq = ++room.joinCounter;
  reassignHostIfNeeded(room);
  void now;
  return ok({ player: p });
}

/** Socket dropped. The player stays seated (connected:false) until grace expiry. */
export function disconnectPlayer(room, playerId, now = 0) {
  const p = findPlayer(room, playerId);
  if (!p) return fail('room_not_found');
  p.connected = false;
  p.disconnectedAt = now;
  // The host keeps the chair for HOST_HANDOVER_MS; sweepHost() passes it on.
  if (room.hostId !== playerId) reassignHostIfNeeded(room);
  settleProgress(room, now);
  return ok();
}

/**
 * Timer-driven: pass the host on once the host has been offline for
 * HOST_HANDOVER_MS. Returns true when the host changed.
 */
export function sweepHost(room, now = 0) {
  const current = findPlayer(room, room.hostId);
  if (!current || current.connected) return false;
  if (now - (current.disconnectedAt ?? now) < HOST_HANDOVER_MS) return false;
  const before = room.hostId;
  reassignHostIfNeeded(room);
  return room.hostId !== before;
}

/**
 * Grace expired. In LOBBY the player is removed; in a match they become
 * out:true, lives kept, and the round copes without them.
 */
export function abandonPlayer(room, playerId, now = 0) {
  const p = findPlayer(room, playerId);
  if (!p) return fail('room_not_found');
  if (room.phase === PHASE.LOBBY) return removePlayer(room, playerId, now);
  p.connected = false;
  p.abandoned = true;
  p.out = true;
  p.readyToVote = false;
  reassignHostIfNeeded(room);
  playerGone(room, playerId, now);
  return ok();
}

/** room:leave — gone immediately, any phase. */
export function removePlayer(room, playerId, now = 0) {
  const idx = room.players.findIndex((p) => p.id === playerId);
  if (idx < 0) return fail('room_not_found');
  room.players.splice(idx, 1);
  if (room.hostId === playerId) room.hostId = null;
  reassignHostIfNeeded(room);
  if (room.phase !== PHASE.LOBBY) playerGone(room, playerId, now);
  return ok();
}

/** Host passes to the lowest-joinSeq connected player when the host is gone or offline. */
export function reassignHostIfNeeded(room) {
  const current = findPlayer(room, room.hostId);
  if (current && current.connected) return;
  const candidates = room.players.filter((p) => p.connected).sort((a, b) => a.joinSeq - b.joinSeq);
  if (candidates.length) room.hostId = candidates[0].id;
  else if (!current) room.hostId = room.players.length ? [...room.players].sort((a, b) => a.joinSeq - b.joinSeq)[0].id : null;
}

// A player no longer takes part in this round (left, or grace expired).
function playerGone(room, playerId, now) {
  const s = room.secret;
  if (!s) return;
  if ((room.phase === PHASE.LAST_WORD || room.phase === PHASE.PAYBACK) && playerId === s.ratId) {
    // The Rat walked out on their own guess: the timeout rule applies, now.
    room.phaseEndsAt = now;
    return;
  }
  if (!ROUND_OPEN.has(room.phase)) return;
  if (playerId === s.ratId || alivePlayers(room).length < room.settings.minPlayers) {
    voidRound(room, now);
    return;
  }
  if (room.phase === PHASE.CLUES) {
    const current = s.turnOrder[s.turnIdx];
    if (current === playerId) advanceTurn(room, now);
    return;
  }
  if (room.phase === PHASE.VOTE) {
    delete s.votes[playerId];
    for (const [voter, target] of Object.entries(s.votes)) {
      if (target === playerId) {
        delete s.votes[voter];
        const v = findPlayer(room, voter);
        if (v) v.hasVoted = false; // their pick left the table; they vote again
      }
    }
  }
  settleProgress(room, now);
}

// After anyone drops out of the count, the phase may already be complete.
function settleProgress(room, now) {
  if (room.phase === PHASE.DISCUSS) maybeAllReady(room, now);
  else if (room.phase === PHASE.VOTE) maybeAllVoted(room, now);
}

// ─── lobby intents ────────────────────────────────────────────────────────

export function setCharacter(room, playerId, { character } = {}) {
  const p = findPlayer(room, playerId);
  if (!p) return fail('room_not_found');
  if (room.phase !== PHASE.LOBBY) return fail('wrong_phase', 'Characters change in the lobby only.');
  const c = validCharacter(character);
  if (!c) return fail('bad_character', 'Unknown character.');
  p.character = c;
  return ok();
}

export function setSeat(room, playerId, { seat } = {}) {
  const p = findPlayer(room, playerId);
  if (!p) return fail('room_not_found');
  if (room.phase !== PHASE.LOBBY) return fail('wrong_phase', 'Seats change in the lobby only.');
  if (!Number.isInteger(seat) || seat < 0 || seat >= SEAT_COUNT) return fail('invalid', 'Seat must be 0-7.');
  if (p.seat === seat) return ok();
  if (room.players.some((o) => o.seat === seat)) return fail('invalid', 'That seat is taken.');
  p.seat = seat;
  return ok();
}

export function setMedia(room, playerId, { mic, cam } = {}) {
  const p = findPlayer(room, playerId);
  if (!p) return fail('room_not_found');
  if (typeof mic !== 'boolean' || typeof cam !== 'boolean') return fail('invalid', 'mic and cam must be booleans.');
  const changed = p.mic !== mic || p.cam !== cam;
  p.mic = mic;
  p.cam = cam;
  return ok({ changed });
}

export function start(room, playerId, _payload, now = 0) {
  if (!findPlayer(room, playerId)) return fail('room_not_found');
  if (!host(room, playerId)) return fail('not_host', 'Only the host starts the game.');
  if (room.phase !== PHASE.LOBBY) return fail('wrong_phase');
  const connected = room.players.filter((p) => p.connected).length;
  if (connected < room.settings.minPlayers) {
    return fail('invalid', `Need at least ${room.settings.minPlayers} connected players.`);
  }
  if (!room.deck.length) return fail('invalid', 'No cards loaded.');
  for (const p of room.players) {
    p.lives = room.settings.lives;
    p.out = false;
    p.abandoned = false;
  }
  room.round = 0;
  room.lastStartSeat = null;
  room.match = null;
  deal(room, now);
  return ok();
}

// ─── round flow ───────────────────────────────────────────────────────────

function setPhase(room, phase, now, duration) {
  room.phase = phase;
  room.phaseEndsAt = duration == null ? null : now + duration;
  if (phase !== PHASE.CLUES) room.turnSeat = null;
}

function deal(room, now) {
  const alive = alivePlayers(room);
  room.round += 1;

  // startSeat: the alive seat after last round's startSeat (round 1: lowest).
  let startSeat = alive[0].seat;
  if (room.lastStartSeat !== null) {
    const after = alive.find((p) => p.seat > room.lastStartSeat);
    startSeat = after ? after.seat : alive[0].seat;
  }
  room.lastStartSeat = startSeat;
  room.startSeat = startSeat;

  const rat = alive[randInt(room, alive.length)];

  let unused = room.deck.filter((c) => !room.usedCardIds.includes(c.id));
  if (!unused.length) {
    room.usedCardIds = [];
    unused = room.deck.slice();
  }
  const card = unused[randInt(room, unused.length)];
  room.usedCardIds.push(card.id);
  const words = card.words.slice();
  for (let i = words.length - 1; i > 0; i--) {
    const j = randInt(room, i + 1);
    [words[i], words[j]] = [words[j], words[i]];
  }
  room.card = { id: card.id, category: card.category, words };

  const targetIndex = randInt(room, WORDS_PER_CARD);
  const roles = {};
  for (const p of alive) roles[p.id] = p.id === rat.id ? 'rat' : 'family';
  const startIdx = alive.findIndex((p) => p.seat === startSeat);
  const turnOrder = [...alive.slice(startIdx), ...alive.slice(0, startIdx)].map((p) => p.id);

  room.secret = { ratId: rat.id, targetIndex, roles, turnOrder, turnIdx: 0, votes: {} };
  room.clues = [];
  room.result = null;
  for (const p of room.players) {
    p.clue = null;
    p.hasVoted = false;
    p.readyToVote = false;
  }
  setPhase(room, PHASE.DEAL, now, room.timings.DEAL);
}

function beginClues(room, now) {
  setPhase(room, PHASE.CLUES, now, null);
  room.secret.turnIdx = -1;
  advanceTurn(room, now);
}

function advanceTurn(room, now) {
  const s = room.secret;
  let idx = s.turnIdx + 1;
  while (idx < s.turnOrder.length && !isAlive(findPlayer(room, s.turnOrder[idx]))) idx++;
  s.turnIdx = idx;
  if (idx >= s.turnOrder.length) {
    setPhase(room, PHASE.DISCUSS, now, null);
    maybeAllReady(room, now);
    return;
  }
  room.turnSeat = findPlayer(room, s.turnOrder[idx]).seat;
  room.phaseEndsAt = now + room.timings.CLUE; // every turn gets its own clock
}

function currentTurnPlayer(room) {
  const s = room.secret;
  return s ? findPlayer(room, s.turnOrder[s.turnIdx]) : null;
}

function recordClue(room, player, text) {
  player.clue = text;
  room.clues.push({ playerId: player.id, seat: player.seat, text, order: room.clues.length + 1 });
}

export function clue(room, playerId, { text } = {}, now = 0) {
  const p = findPlayer(room, playerId);
  if (!p) return fail('room_not_found');
  if (room.phase !== PHASE.CLUES) return fail('wrong_phase');
  if (!isAlive(p)) return fail('invalid', 'You are out of this match.');
  if (currentTurnPlayer(room)?.id !== playerId) return fail('not_your_turn');
  const cleaned = cleanText(text);
  if (!cleaned || cleaned.length > room.settings.clueMaxLen) {
    return fail('bad_clue', `A clue is 1-${room.settings.clueMaxLen} characters.`);
  }
  recordClue(room, p, cleaned);
  advanceTurn(room, now);
  return ok();
}

export function skipTurn(room, playerId, _payload, now = 0) {
  if (!findPlayer(room, playerId)) return fail('room_not_found');
  if (!host(room, playerId)) return fail('not_host');
  if (room.phase !== PHASE.CLUES) return fail('wrong_phase');
  const current = currentTurnPlayer(room);
  if (current) recordClue(room, current, null);
  advanceTurn(room, now);
  return ok();
}

export function readyToVote(room, playerId, { ready } = {}, now = 0) {
  const p = findPlayer(room, playerId);
  if (!p) return fail('room_not_found');
  if (room.phase !== PHASE.DISCUSS) return fail('wrong_phase');
  if (!isAlive(p)) return fail('invalid', 'You are out of this match.');
  if (typeof ready !== 'boolean') return fail('invalid', 'ready must be a boolean.');
  p.readyToVote = ready;
  maybeAllReady(room, now);
  return ok();
}

function maybeAllReady(room, now) {
  const voters = aliveConnected(room);
  if (voters.length && voters.every((p) => p.readyToVote)) enterVote(room, now);
}

export function callVote(room, playerId, _payload, now = 0) {
  if (!findPlayer(room, playerId)) return fail('room_not_found');
  if (!host(room, playerId)) return fail('not_host');
  if (room.phase !== PHASE.DISCUSS) return fail('wrong_phase');
  enterVote(room, now);
  return ok();
}

function enterVote(room, now) {
  room.secret.votes = {};
  for (const p of room.players) p.hasVoted = false;
  setPhase(room, PHASE.VOTE, now, room.timings.VOTE);
}

export function vote(room, playerId, { target } = {}, now = 0) {
  const p = findPlayer(room, playerId);
  if (!p) return fail('room_not_found');
  if (room.phase !== PHASE.VOTE) return fail('wrong_phase');
  if (!isAlive(p)) return fail('invalid', 'You are out of this match.');
  if (p.hasVoted) return fail('bad_vote', 'Votes are final.');
  if (typeof target !== 'string' || target === playerId) return fail('bad_vote', 'You cannot vote for yourself.');
  if (!isAlive(findPlayer(room, target))) return fail('bad_vote', 'Vote for a player still in the match.');
  room.secret.votes[playerId] = target;
  p.hasVoted = true;
  maybeAllVoted(room, now);
  return ok();
}

function maybeAllVoted(room, now) {
  const voters = aliveConnected(room);
  if (voters.length && voters.every((p) => p.hasVoted)) closeVote(room, now);
}

function closeVote(room, now) {
  const s = room.secret;
  const votes = { ...s.votes };
  const tally = {};
  for (const target of Object.values(votes)) tally[target] = (tally[target] || 0) + 1;
  let best = 0;
  let leaders = [];
  for (const [id, n] of Object.entries(tally)) {
    if (n > best) {
      best = n;
      leaders = [id];
    } else if (n === best) leaders.push(id);
  }
  const accusedId = leaders.length === 1 ? leaders[0] : null; // a tie (or no votes) means the Rat walks
  room.result = {
    tally,
    votes,
    accusedId,
    caught: accusedId !== null && accusedId === s.ratId,
    ratId: s.ratId,
    roles: { ...s.roles },
    targetIndex: s.targetIndex,
    lastWord: null,
    payback: null,
    lifeLoss: null,
    voided: false,
  };
  setPhase(room, PHASE.VOTE_RESULT, now, room.timings.VOTE_RESULT);
}

export function lastWord(room, playerId, { index } = {}, now = 0) {
  if (!findPlayer(room, playerId)) return fail('room_not_found');
  if (room.phase !== PHASE.LAST_WORD) return fail('wrong_phase');
  if (room.secret.ratId !== playerId) return fail('not_rat');
  if (!Number.isInteger(index) || index < 0 || index >= WORDS_PER_CARD) return fail('bad_word', 'Pick a word 0-15.');
  resolveLastWord(room, index, now);
  return ok();
}

function resolveLastWord(room, index, now) {
  const correct = index !== null && index === room.secret.targetIndex;
  room.result.lastWord = { index, correct };
  if (!correct) loseLife(room, room.secret.ratId);
  enterResolve(room, now);
}

export function payback(room, playerId, { target } = {}, now = 0) {
  if (!findPlayer(room, playerId)) return fail('room_not_found');
  if (room.phase !== PHASE.PAYBACK) return fail('wrong_phase');
  if (room.secret.ratId !== playerId) return fail('not_rat');
  const victim = typeof target === 'string' ? findPlayer(room, target) : null;
  if (!isAlive(victim) || victim.id === room.secret.ratId) {
    return fail('bad_target', 'Pick a player still in the match who is not you.');
  }
  applyPayback(room, victim.id, now);
  return ok();
}

function applyPayback(room, targetId, now) {
  room.result.payback = targetId ? { targetId } : null;
  if (targetId) loseLife(room, targetId);
  enterResolve(room, now);
}

function loseLife(room, playerId) {
  const p = findPlayer(room, playerId);
  if (!p) return; // left the table; nothing to take
  p.lives = Math.max(0, p.lives - 1);
  room.result.lifeLoss = { playerId, livesAfter: p.lives };
}

function voidRound(room, now) {
  const s = room.secret;
  room.result = {
    tally: {},
    votes: {},
    accusedId: null,
    caught: false,
    ratId: s.ratId,
    roles: { ...s.roles },
    targetIndex: s.targetIndex,
    lastWord: null,
    payback: null,
    lifeLoss: null,
    voided: true,
  };
  enterResolve(room, now);
}

function enterResolve(room, now) {
  for (const p of room.players) if (p.lives <= 0) p.out = true;
  setPhase(room, PHASE.RESOLVE, now, room.timings.RESOLVE);
}

function afterResolve(room, now) {
  const alive = alivePlayers(room);
  if (alive.length <= 2) {
    room.match = { winnerIds: alive.map((p) => p.id), rounds: room.round };
    setPhase(room, PHASE.MATCH_OVER, now, null);
    return;
  }
  deal(room, now);
}

export function next(room, playerId, _payload, now = 0) {
  if (!findPlayer(room, playerId)) return fail('room_not_found');
  if (!host(room, playerId)) return fail('not_host');
  if (room.phase === PHASE.RESOLVE) afterResolve(room, now);
  else if (room.phase === PHASE.MATCH_OVER) toLobby(room);
  else return fail('wrong_phase');
  return ok();
}

export function abort(room, playerId, _payload, _now = 0) {
  if (!findPlayer(room, playerId)) return fail('room_not_found');
  if (!host(room, playerId)) return fail('not_host');
  toLobby(room);
  return ok();
}

function toLobby(room) {
  room.players = room.players.filter((p) => !p.abandoned);
  for (const p of room.players) {
    p.lives = room.settings.lives;
    p.out = false;
    p.clue = null;
    p.hasVoted = false;
    p.readyToVote = false;
  }
  room.phase = PHASE.LOBBY;
  room.phaseEndsAt = null;
  room.round = 0;
  room.startSeat = 0;
  room.turnSeat = null;
  room.card = null;
  room.clues = [];
  room.result = null;
  room.match = null;
  room.secret = null;
  room.lastStartSeat = null;
  reassignHostIfNeeded(room);
}

// ─── the clock ────────────────────────────────────────────────────────────

/** Apply any timeout that has come due. Returns true when the room changed. */
export function due(room, now) {
  if (room.phaseEndsAt === null || now < room.phaseEndsAt) return false;
  switch (room.phase) {
    case PHASE.DEAL:
      beginClues(room, now);
      return true;
    case PHASE.CLUES: {
      // Out of time: the turn is recorded as silence, exactly like a skip.
      const current = currentTurnPlayer(room);
      if (current) recordClue(room, current, null);
      advanceTurn(room, now);
      return true;
    }
    case PHASE.VOTE:
      closeVote(room, now); // non-voters abstain
      return true;
    case PHASE.VOTE_RESULT: {
      const family = Object.values(room.result.roles).filter((r) => r === 'family').length;
      setPhase(room, PHASE.ROLE_REVEAL, now, room.timings.ROLE_REVEAL + family * room.timings.REVEAL_STEP);
      return true;
    }
    case PHASE.ROLE_REVEAL:
      if (room.result.caught) setPhase(room, PHASE.LAST_WORD, now, room.timings.LAST_WORD);
      else setPhase(room, PHASE.PAYBACK, now, room.timings.PAYBACK);
      return true;
    case PHASE.LAST_WORD:
      resolveLastWord(room, null, now); // silence counts as wrong
      return true;
    case PHASE.PAYBACK: {
      const victims = alivePlayers(room).filter((p) => p.id !== room.secret.ratId);
      applyPayback(room, victims.length ? victims[randInt(room, victims.length)].id : null, now);
      return true;
    }
    case PHASE.RESOLVE:
      afterResolve(room, now);
      return true;
    default:
      room.phaseEndsAt = null;
      return false;
  }
}

// ─── intents by wire name ─────────────────────────────────────────────────

const INTENTS = {
  'player:character': (room, id, p) => setCharacter(room, id, p),
  'player:seat': (room, id, p) => setSeat(room, id, p),
  'game:start': start,
  'game:clue': clue,
  'game:skipTurn': skipTurn,
  'game:readyToVote': readyToVote,
  'game:callVote': callVote,
  'game:vote': vote,
  'game:lastWord': lastWord,
  'game:payback': payback,
  'game:next': next,
  'game:abort': abort,
};

export const INTENT_EVENTS = Object.freeze(Object.keys(INTENTS));

export function applyIntent(room, playerId, event, payload, now = 0) {
  const reducer = INTENTS[event];
  if (!reducer) return fail('invalid', `Unknown intent ${event}.`);
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  return reducer(room, playerId, body, now);
}

// ─── the view ─────────────────────────────────────────────────────────────

/** The per-player `state` snapshot. Fresh objects every call; safe to serialise. */
export function snapshotFor(room, playerId) {
  const phase = room.phase;
  const s = room.secret;
  const rolesPublic = ROLES_PUBLIC.has(phase);
  const targetPublic = TARGET_PUBLIC.has(phase);
  const r = room.result;

  const role = phase !== PHASE.LOBBY && s ? s.roles[playerId] || null : null;
  let myTarget = null;
  if (s && role === 'family') myTarget = s.targetIndex;
  if (s && targetPublic && role) myTarget = s.targetIndex;

  return {
    code: room.code,
    hostId: room.hostId,
    phase,
    round: room.round,
    startSeat: room.startSeat,
    turnSeat: phase === PHASE.CLUES ? room.turnSeat : null,
    phaseEndsAt: room.phaseEndsAt,
    settings: { ...room.settings },
    players: [...room.players]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        id: p.id,
        name: p.name,
        character: p.character,
        seat: p.seat,
        joinSeq: p.joinSeq,
        connected: p.connected,
        isHost: p.id === room.hostId,
        lives: p.lives,
        out: p.out,
        mic: p.mic,
        cam: p.cam,
        clue: p.clue,
        hasVoted: p.hasVoted,
        readyToVote: p.readyToVote,
      })),
    card: room.card ? { id: room.card.id, category: room.card.category, words: room.card.words.slice() } : null,
    clues: room.clues.map((c) => ({ ...c })),
    result: r
      ? {
          tally: { ...r.tally },
          votes: { ...r.votes },
          accusedId: r.accusedId,
          caught: rolesPublic ? r.caught : null,
          ratId: rolesPublic ? r.ratId : null,
          roles: rolesPublic ? { ...r.roles } : null,
          targetIndex: targetPublic ? r.targetIndex : null,
          lastWord: r.lastWord ? { ...r.lastWord } : null,
          payback: r.payback ? { ...r.payback } : null,
          lifeLoss: r.lifeLoss ? { ...r.lifeLoss } : null,
          voided: r.voided,
        }
      : null,
    match: room.match ? { winnerIds: room.match.winnerIds.slice(), rounds: room.match.rounds } : null,
    me: { playerId, role, targetIndex: myTarget },
  };
}
