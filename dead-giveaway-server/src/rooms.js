// Room registry: codes, tokens, sockets, disconnect grace, reaping.
//
// The rules (src/rules.js) own the game. This module owns everything about a
// room that is not the game: which socket is which player, the secret token a
// player rejoins with, how long a dropped player is waited for, and when an
// empty room is thrown away. Time is always passed in as `now`.

import { randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';
import * as rules from './rules.js';

// A–Z and 2–9 without O, I, 0, 1: 24 letters + 8 digits = 32 symbols, so one
// random byte masked to 5 bits picks a symbol with no modulo bias.
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;
export const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{5}$/;
export const DEFAULT_GRACE_MS = 90_000;
export const DEFAULT_MAX_ROOMS = 500;

const fail = (error, message) => ({ ok: false, error, message: message || error });

export function normalizeCode(code) {
  if (typeof code !== 'string') return null;
  const c = code.trim().toUpperCase();
  return CODE_PATTERN.test(c) ? c : null;
}

export function createRegistry({
  deck = [],
  graceMs = DEFAULT_GRACE_MS,
  maxRooms = DEFAULT_MAX_ROOMS,
  random = Math.random,
  randomBytes = nodeRandomBytes,
  settings = {},
  timings = {},
} = {}) {
  /** code → { code, game, tokens: Map<pid, token>, sockets: Map<pid, socketId>, graceUntil: Map<pid, ms>, emptySince } */
  const rooms = new Map();

  function newCode() {
    for (let attempt = 0; attempt < 200; attempt++) {
      const bytes = randomBytes(CODE_LENGTH);
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i] & 31];
      if (!rooms.has(code)) return code;
    }
    return null;
  }

  const newPlayerId = () => `p_${randomBytes(8).toString('hex')}`;
  const newToken = () => randomBytes(24).toString('base64url');

  function tokenOwner(entry, token) {
    if (typeof token !== 'string' || token.length < 16 || token.length > 128) return null;
    const given = Buffer.from(token);
    for (const [pid, t] of entry.tokens) {
      const known = Buffer.from(t);
      if (known.length === given.length && timingSafeEqual(known, given)) return pid;
    }
    return null;
  }

  function create({ name, character } = {}, now = Date.now()) {
    if (!rules.validName(name)) return fail('bad_name', `Name must be 1-${rules.NAME_MAX_LEN} characters.`);
    if (!rules.validCharacter(character)) return fail('bad_character', 'Unknown character.');
    if (rooms.size >= maxRooms) return fail('invalid', 'The server is full. Try again later.');
    const code = newCode();
    if (!code) return fail('invalid', 'Could not allocate a room code.');
    const game = rules.createMatch(settings, { code, deck, random, timings });
    const playerId = newPlayerId();
    const added = rules.addPlayer(game, { id: playerId, name, character }, now);
    if (!added.ok) return added;
    const entry = { code, game, tokens: new Map(), sockets: new Map(), graceUntil: new Map(), emptySince: null, createdAt: now };
    const token = newToken();
    entry.tokens.set(playerId, token);
    rooms.set(code, entry);
    return { ok: true, code, playerId, token, entry, player: added.player, rejoined: false };
  }

  /**
   * Join by code. A valid token for a player still seated in the room is a
   * rejoin: same playerId, seat, role and lives; name and character in the
   * payload are ignored. An unknown or stale token is a fresh join.
   */
  function join({ code, name, character, token } = {}, now = Date.now()) {
    const c = normalizeCode(code);
    const entry = c && rooms.get(c);
    if (!entry) return fail('room_not_found', 'No table with that code.');
    const owner = token ? tokenOwner(entry, token) : null;
    if (owner && rules.findPlayer(entry.game, owner)) {
      const previousSocketId = entry.sockets.get(owner) || null;
      rules.reconnectPlayer(entry.game, owner, now);
      entry.graceUntil.delete(owner);
      entry.emptySince = null;
      return {
        ok: true,
        code: c,
        playerId: owner,
        token: entry.tokens.get(owner),
        entry,
        player: rules.findPlayer(entry.game, owner),
        rejoined: true,
        previousSocketId,
      };
    }
    const playerId = newPlayerId();
    const added = rules.addPlayer(entry.game, { id: playerId, name, character }, now);
    if (!added.ok) return added;
    const fresh = newToken();
    entry.tokens.set(playerId, fresh);
    entry.emptySince = null;
    return { ok: true, code: c, playerId, token: fresh, entry, player: added.player, rejoined: false, previousSocketId: null };
  }

  function attachSocket(code, playerId, socketId) {
    const entry = rooms.get(code);
    if (entry && rules.findPlayer(entry.game, playerId)) entry.sockets.set(playerId, socketId);
  }

  function socketOf(code, playerId) {
    return rooms.get(code)?.sockets.get(playerId) || null;
  }

  /**
   * A socket dropped. Ignored when it is not the player's current socket (a
   * replaced tab disconnecting late must not knock the new one offline).
   */
  function disconnect(code, playerId, socketId, now = Date.now()) {
    const entry = rooms.get(code);
    if (!entry || !rules.findPlayer(entry.game, playerId)) return { ok: false, changed: false };
    if (socketId && entry.sockets.get(playerId) !== socketId) return { ok: true, changed: false };
    entry.sockets.delete(playerId);
    rules.disconnectPlayer(entry.game, playerId, now);
    entry.graceUntil.set(playerId, now + graceMs);
    return { ok: true, changed: true };
  }

  /** room:leave — immediate, any phase. Returns closed:true when the room went with them. */
  function leave(code, playerId, now = Date.now()) {
    const entry = rooms.get(code);
    if (!entry) return { ok: false, closed: false };
    rules.removePlayer(entry.game, playerId, now);
    forget(entry, playerId);
    if (entry.game.players.length === 0) {
      rooms.delete(code);
      return { ok: true, closed: true };
    }
    return { ok: true, closed: false };
  }

  function forget(entry, playerId) {
    entry.tokens.delete(playerId);
    entry.sockets.delete(playerId);
    entry.graceUntil.delete(playerId);
  }

  /**
   * Drive time: grace expiry, phase timeouts, reaping. Returns one record per
   * room that changed or closed: [{ code, entry, changed, closed, expired: [pid] }].
   */
  function tick(now = Date.now()) {
    const out = [];
    for (const [code, entry] of rooms) {
      let changed = false;
      const expired = [];
      for (const [pid, until] of entry.graceUntil) {
        if (now < until) continue;
        entry.graceUntil.delete(pid);
        const p = rules.findPlayer(entry.game, pid);
        if (!p || p.connected) continue;
        rules.abandonPlayer(entry.game, pid, now);
        expired.push(pid);
        changed = true;
      }
      if (rules.due(entry.game, now)) changed = true;

      // Anyone the rules dropped (lobby removal, abandoned players cleared on
      // return to the lobby) loses their token and socket mapping too.
      for (const pid of [...entry.tokens.keys()]) {
        if (!rules.findPlayer(entry.game, pid)) forget(entry, pid);
      }

      const players = entry.game.players;
      if (players.some((p) => p.connected)) entry.emptySince = null;
      else if (entry.emptySince === null) entry.emptySince = now;

      if (players.length === 0 || (entry.emptySince !== null && now - entry.emptySince >= graceMs)) {
        rooms.delete(code);
        out.push({ code, entry, changed: true, closed: true, expired });
      } else if (changed) {
        out.push({ code, entry, changed: true, closed: false, expired });
      }
    }
    return out;
  }

  function close(code) {
    return rooms.delete(code);
  }

  return {
    rooms,
    create,
    join,
    leave,
    disconnect,
    attachSocket,
    socketOf,
    tick,
    close,
    get: (code) => rooms.get(code) || null,
    get size() {
      return rooms.size;
    },
    graceMs,
  };
}
