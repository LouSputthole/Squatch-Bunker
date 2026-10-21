// Shared test helpers (not a test file: no `.test.` in the name).
import * as rules from '../src/rules.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function testDeck(n = 4) {
  return Array.from({ length: n }, (_, c) => ({
    id: `card-${c}`,
    category: `Category ${c}`,
    words: Array.from({ length: 16 }, (_, w) => `Word ${c}-${w}`),
  }));
}

/** A LOBBY room with n connected players p0..p(n-1) in seats 0..n-1; p0 hosts. */
export function lobby(n, { seed = 1, settings = {}, deck = testDeck() } = {}) {
  const room = rules.createMatch(settings, { code: 'TEST2', deck, random: mulberry32(seed) });
  for (let i = 0; i < n; i++) {
    const res = rules.addPlayer(room, { id: `p${i}`, name: `Player ${i}`, character: 'lou' }, 0);
    if (!res.ok) throw new Error(res.error);
  }
  return room;
}

/** Started and dealt; advanced into CLUES. */
export function dealt(n, opts) {
  const room = lobby(n, opts);
  must(rules.start(room, 'p0', {}, 0));
  rules.due(room, room.phaseEndsAt);
  return room;
}

export function must(res) {
  if (!res || !res.ok) throw new Error(`expected ok, got ${JSON.stringify(res)}`);
  return res;
}

export const ratOf = (room) => room.secret.ratId;
export const familyOf = (room) => rules.alivePlayers(room).filter((p) => p.id !== room.secret.ratId).map((p) => p.id);

/** Everyone whose turn it is gives a clue until DISCUSS. */
export function giveAllClues(room, now = 0) {
  let guard = 0;
  while (room.phase === rules.PHASE.CLUES) {
    const p = room.players.find((x) => x.seat === room.turnSeat);
    must(rules.clue(room, p.id, { text: `clue from ${p.id}` }, now));
    if (++guard > 20) throw new Error('clue loop');
  }
}

/** CLUES → DISCUSS → VOTE with every alive connected player ready. */
export function toVote(room, now = 0) {
  giveAllClues(room, now);
  for (const p of rules.alivePlayers(room)) {
    if (p.connected && room.phase === rules.PHASE.DISCUSS) must(rules.readyToVote(room, p.id, { ready: true }, now));
  }
}

/** Fire the current phase's timeout. */
export function expire(room) {
  return rules.due(room, room.phaseEndsAt);
}
