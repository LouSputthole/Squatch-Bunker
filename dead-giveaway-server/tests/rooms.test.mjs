import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry, CODE_ALPHABET, CODE_PATTERN, normalizeCode } from '../src/rooms.js';
import * as rules from '../src/rules.js';
import { testDeck, mulberry32 } from './helpers.mjs';

const GRACE = 1000;
const make = (opts = {}) => createRegistry({ deck: testDeck(), graceMs: GRACE, random: mulberry32(3), ...opts });

function tableOf(reg, n, now = 0) {
  const host = reg.create({ name: 'Lou', character: 'lou' }, now);
  assert.equal(host.ok, true);
  reg.attachSocket(host.code, host.playerId, 's0');
  const seats = [host];
  for (let i = 1; i < n; i++) {
    const j = reg.join({ code: host.code, name: `P${i}`, character: 'booski' }, now);
    assert.equal(j.ok, true);
    reg.attachSocket(host.code, j.playerId, `s${i}`);
    seats.push(j);
  }
  return { code: host.code, seats, game: reg.get(host.code).game };
}

test('codes are 5 characters of A-Z 2-9 without O, 0, 1 or I, and unique', () => {
  assert.equal(CODE_ALPHABET.length, 32);
  for (const bad of ['O', '0', '1', 'I']) assert.ok(!CODE_ALPHABET.includes(bad));
  const reg = make({ maxRooms: 5000 });
  const codes = new Set();
  for (let i = 0; i < 2000; i++) {
    const r = reg.create({ name: 'Lou', character: 'lou' });
    assert.match(r.code, CODE_PATTERN);
    assert.match(r.code, /^[A-HJ-NP-Z2-9]{5}$/);
    codes.add(r.code);
  }
  assert.equal(codes.size, 2000);
  assert.equal(normalizeCode(' bunk7 '), 'BUNK7');
  assert.equal(normalizeCode('BINGO'), null, 'O is not in the alphabet');
  assert.equal(normalizeCode('BUNK'), null);
  assert.equal(normalizeCode('BING7'), null, 'I is not in the alphabet either');
  assert.equal(normalizeCode(42), null);
});

test('create and join validate; unknown codes are room_not_found; the table fills at 8', () => {
  const reg = make();
  assert.equal(reg.create({ name: '', character: 'lou' }).error, 'bad_name');
  assert.equal(reg.create({ name: 'Lou', character: '' }).error, 'bad_character');
  assert.equal(reg.join({ code: 'ZZZZZ', name: 'X', character: 'lou' }).error, 'room_not_found');
  const { code } = tableOf(reg, 8);
  assert.equal(reg.join({ code, name: 'Nine', character: 'lou' }).error, 'room_full');
  const full = make({ maxRooms: 1 });
  full.create({ name: 'A', character: 'lou' });
  assert.equal(full.create({ name: 'B', character: 'lou' }).error, 'invalid');
});

test('token rejoin keeps playerId, seat, role and lives; a bad token is a fresh join', () => {
  const reg = make();
  const { code, seats, game } = tableOf(reg, 3);
  rules.start(game, game.hostId, {}, 0);
  const target = seats[2];
  const role = rules.snapshotFor(game, target.playerId).me.role;
  rules.findPlayer(game, target.playerId).lives = 2;
  const seat = rules.findPlayer(game, target.playerId).seat;
  const seqBefore = rules.findPlayer(game, target.playerId).joinSeq;

  reg.disconnect(code, target.playerId, 's2', 10);
  assert.equal(rules.findPlayer(game, target.playerId).connected, false);
  const back = reg.join({ code, token: target.token, name: 'ignored', character: 'lou' }, 20);
  assert.equal(back.ok, true);
  assert.equal(back.rejoined, true);
  assert.equal(back.playerId, target.playerId);
  assert.equal(back.token, target.token);
  const p = rules.findPlayer(game, target.playerId);
  assert.equal(p.seat, seat);
  assert.equal(p.lives, 2);
  assert.equal(p.connected, true);
  assert.equal(p.name, 'P2', 'name is kept on rejoin');
  assert.ok(p.joinSeq > seqBefore, 'joinSeq bumps on rejoin');
  assert.equal(rules.snapshotFor(game, target.playerId).me.role, role);

  const stranger = reg.join({ code, token: 'x'.repeat(32), name: 'Stranger', character: 'lou' }, 30);
  assert.equal(stranger.rejoined, false);
  assert.notEqual(stranger.playerId, target.playerId);
  assert.equal(rules.findPlayer(game, stranger.playerId).out, true, 'joined mid-match: sits out');
});

test('a rejoin on a new socket reports the old one so the server can replace it; a stale disconnect is ignored', () => {
  const reg = make();
  const { code, seats } = tableOf(reg, 3);
  const res = reg.join({ code, token: seats[1].token }, 5);
  assert.equal(res.previousSocketId, 's1');
  reg.attachSocket(code, res.playerId, 's1b');
  const stale = reg.disconnect(code, res.playerId, 's1', 6);
  assert.equal(stale.changed, false);
  assert.equal(rules.findPlayer(reg.get(code).game, res.playerId).connected, true);
  assert.equal(reg.socketOf(code, res.playerId), 's1b');
});

test('grace expiry: removed in the lobby, out with lives kept in a match', () => {
  const reg = make();
  const lobbyTable = tableOf(reg, 3);
  const gone = lobbyTable.seats[2].playerId;
  reg.disconnect(lobbyTable.code, gone, 's2', 100);
  assert.equal(reg.tick(100 + GRACE - 1).length, 0);
  const recs = reg.tick(100 + GRACE);
  assert.deepEqual(recs.find((r) => r.code === lobbyTable.code).expired, [gone]);
  assert.equal(rules.findPlayer(lobbyTable.game, gone), null);
  assert.equal(reg.join({ code: lobbyTable.code, token: lobbyTable.seats[2].token, name: 'New', character: 'lou' }).rejoined, false, 'the old token is dead');

  const reg2 = make();
  const t = tableOf(reg2, 4);
  rules.start(t.game, t.game.hostId, {}, 0);
  const pid = t.seats[3].playerId;
  rules.findPlayer(t.game, pid).lives = 2;
  reg2.disconnect(t.code, pid, 's3', 0);
  reg2.tick(GRACE);
  const p = rules.findPlayer(t.game, pid);
  assert.equal(p.out, true);
  assert.equal(p.lives, 2);
  // They can still come back and watch.
  const back = reg2.join({ code: t.code, token: t.seats[3].token }, GRACE + 1);
  assert.equal(back.rejoined, true);
  assert.equal(rules.findPlayer(t.game, pid).out, true);
});

test('rejoining inside the grace cancels the expiry', () => {
  const reg = make();
  const t = tableOf(reg, 3);
  const pid = t.seats[1].playerId;
  reg.disconnect(t.code, pid, 's1', 0);
  reg.join({ code: t.code, token: t.seats[1].token }, GRACE / 2);
  reg.tick(GRACE * 2);
  assert.ok(rules.findPlayer(t.game, pid));
  assert.equal(rules.findPlayer(t.game, pid).connected, true);
});

test('host handover on disconnect and on leave', () => {
  // A grace longer than the handover window, or the lobby removal would move
  // the host first and prove nothing about the window.
  const reg = make({ graceMs: rules.HOST_HANDOVER_MS * 6 });
  const t = tableOf(reg, 3);
  const [h, a, b] = t.seats.map((s) => s.playerId);
  assert.equal(t.game.hostId, h);
  reg.disconnect(t.code, h, 's0', 0);
  assert.equal(t.game.hostId, h, 'a dropped socket does not move the host at once');
  reg.tick(rules.HOST_HANDOVER_MS - 1);
  assert.equal(t.game.hostId, h, 'still the host inside the handover window');
  reg.tick(rules.HOST_HANDOVER_MS);
  assert.equal(t.game.hostId, a, 'passes to the lowest joinSeq connected player after the window');
  reg.leave(t.code, a, rules.HOST_HANDOVER_MS + 1);
  assert.equal(t.game.hostId, b);
  assert.equal(rules.findPlayer(t.game, a), null);
});

test('rooms are reaped once empty for the grace, and closed at once when the last player leaves', () => {
  const reg = make();
  const t = tableOf(reg, 3);
  t.seats.forEach((s, i) => reg.disconnect(t.code, s.playerId, `s${i}`, 0));
  reg.tick(1);
  assert.ok(reg.get(t.code));
  const recs = reg.tick(1 + GRACE);
  assert.equal(recs.find((r) => r.code === t.code).closed, true);
  assert.equal(reg.get(t.code), null);

  const solo = reg.create({ name: 'Solo', character: 'lou' });
  const res = reg.leave(solo.code, solo.playerId, 0);
  assert.equal(res.closed, true);
  assert.equal(reg.get(solo.code), null);
});

test('tick drives phase timeouts', () => {
  const reg = make();
  const t = tableOf(reg, 3);
  rules.start(t.game, t.game.hostId, {}, 1000);
  assert.equal(t.game.phase, 'DEAL');
  assert.equal(reg.tick(1000 + 2999).length, 0);
  assert.equal(reg.tick(1000 + 3000).length, 1);
  assert.equal(t.game.phase, 'CLUES');
});
