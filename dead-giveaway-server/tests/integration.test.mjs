// Boots src/server.js on an ephemeral port and plays a round over real sockets.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io as connect } from 'socket.io-client';
import { startServer } from '../src/server.js';

let srv;
let url;
const sockets = [];

before(async () => {
  srv = await startServer({
    port: 0,
    host: '127.0.0.1',
    env: {}, // no TURN, no stray DG_* from the shell
    log: () => {},
    tickMs: 20,
    timings: { DEAL: 40, VOTE_RESULT: 40, ROLE_REVEAL: 40, REVEAL_STEP: 10 },
  });
  url = `http://127.0.0.1:${srv.port}`;
});

after(async () => {
  for (const s of sockets) s.close();
  await srv.close();
});

function client() {
  const s = connect(url, { path: '/dg/socket', transports: ['websocket'], forceNew: true, reconnection: false });
  s.state = null;
  s.phases = [];
  s.on('state', (st) => {
    s.state = st;
    if (s.phases[s.phases.length - 1] !== st.phase) s.phases.push(st.phase);
  });
  sockets.push(s);
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

function request(s, event, payload = {}) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ack for ${event}`)), 2000);
    s.emit(event, payload, (ack) => {
      clearTimeout(t);
      resolve(ack);
    });
  });
}

function waitFor(s, pred, label = 'state', ms = 3000) {
  if (s.state && pred(s.state)) return Promise.resolve(s.state);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      s.off('state', on);
      reject(new Error(`timed out waiting for ${label}; last phase ${s.state?.phase}`));
    }, ms);
    function on(st) {
      if (!pred(st)) return;
      clearTimeout(t);
      s.off('state', on);
      resolve(st);
    }
    s.on('state', on);
  });
}

function nextEvent(s, event, ms = 1000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no ${event}`)), ms);
    s.once(event, (data) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

function silence(s, event, ms = 200) {
  return new Promise((resolve, reject) => {
    const on = (data) => reject(new Error(`unexpected ${event}: ${JSON.stringify(data)}`));
    s.on(event, on);
    setTimeout(() => {
      s.off(event, on);
      resolve();
    }, ms);
  });
}

test('health check answers', async () => {
  const res = await fetch(`${url}/dg/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('three players: create, join, start, clues, vote, reveal, last word, resolve', async () => {
  const [a, b, c, outsider] = await Promise.all([client(), client(), client(), client()]);

  // turn:get is refused outside a room.
  const refused = await request(outsider, 'turn:get');
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'room_not_found');

  const created = await request(a, 'room:create', { clientId: randomUUID(), name: 'Lou', character: 'lou' });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.match(created.code, /^[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(created.state.phase, 'LOBBY');
  assert.equal(created.state.me.playerId, created.playerId);
  assert.equal(created.state.me.role, null);

  const bad = await request(b, 'room:join', { clientId: randomUUID(), code: 'ZZZZZ', name: 'Booski', character: 'booski' });
  assert.equal(bad.error, 'room_not_found');

  const joinedB = await request(b, 'room:join', { clientId: randomUUID(), code: created.code.toLowerCase(), name: 'Booski', character: 'booski' });
  assert.equal(joinedB.ok, true, JSON.stringify(joinedB));
  const joinedC = await request(c, 'room:join', { clientId: randomUUID(), code: created.code, name: 'Sauce', character: 'sauce' });
  assert.equal(joinedC.ok, true);
  await waitFor(a, (st) => st.players.length === 3, 'three seated');
  const ids = { a: created.playerId, b: joinedB.playerId, c: joinedC.playerId };
  const byId = { [ids.a]: a, [ids.b]: b, [ids.c]: c };
  assert.equal(a.state.hostId, ids.a);
  assert.ok(!JSON.stringify(a.state).includes(joinedB.token), 'tokens never appear in state');

  // turn:get inside the room: STUN always, no TURN configured here.
  const ice = await request(a, 'turn:get');
  assert.equal(ice.ok, true);
  assert.deepEqual(ice.iceServers, [{ urls: 'stun:stun.l.google.com:19302' }]);

  // rtc:hello reaches everyone but the sender.
  const helloB = nextEvent(b, 'rtc:hello');
  const helloC = nextEvent(c, 'rtc:hello');
  const helloA = silence(a, 'rtc:hello');
  a.emit('rtc:hello', {});
  assert.equal((await helloB).playerId, ids.a);
  assert.equal(typeof (await helloC).joinSeq, 'number');
  await helloA;

  // rtc:signal reaches only the addressee, stamped with the sender.
  const toB = nextEvent(b, 'rtc:signal');
  const notC = silence(c, 'rtc:signal');
  const notA = silence(a, 'rtc:signal');
  a.emit('rtc:signal', { to: ids.b, data: { type: 'offer', sdp: 'v=0' } });
  assert.deepEqual(await toB, { from: ids.a, data: { type: 'offer', sdp: 'v=0' } });
  await notC;
  await notA;

  // A signal to someone who is not at this table is rejected, not relayed.
  const err = nextEvent(outsider, 'error');
  outsider.emit('rtc:signal', { to: ids.b, data: { type: 'ice' } });
  assert.equal((await err).code, 'room_not_found');
  const err2 = nextEvent(c, 'error');
  c.emit('rtc:signal', { to: 'p_nobody', data: { type: 'ice' } });
  assert.equal((await err2).code, 'bad_target');

  // Junk never kills the server.
  for (const junk of [null, 7, 'x', [1, 2], { to: ids.a, data: 'x'.repeat(70_000) }]) a.emit('rtc:signal', junk);
  assert.equal((await request(a, 'game:clue', 'not an object')).error, 'invalid');
  assert.equal((await request(b, 'game:start')).error, 'not_host');

  // Start.
  assert.equal((await request(a, 'game:start')).ok, true);
  const states = await Promise.all([a, b, c].map((s) => waitFor(s, (st) => st.phase === 'CLUES', 'CLUES')));
  for (const st of states) {
    assert.equal(st.card.words.length, 16);
    assert.deepEqual(st.card, states[0].card, 'same 16 words in the same order for everyone');
  }
  const roles = states.map((st) => st.me.role);
  assert.equal(roles.filter((r) => r === 'rat').length, 1, 'exactly one Rat');
  assert.equal(roles.filter((r) => r === 'family').length, 2);
  const ratState = states.find((st) => st.me.role === 'rat');
  const famState = states.find((st) => st.me.role === 'family');
  const ratId = ratState.me.playerId;
  const familyIds = [ids.a, ids.b, ids.c].filter((id) => id !== ratId);
  assert.equal(ratState.me.targetIndex, null, 'the Rat does not see the word');
  assert.ok(Number.isInteger(famState.me.targetIndex));
  assert.ok(states.every((st) => st.me.role === 'rat' || st.me.targetIndex === famState.me.targetIndex));
  const targetIndex = famState.me.targetIndex;

  // Clues, in turn order.
  let given = 0;
  while (a.state.phase === 'CLUES') {
    const turnSeat = a.state.turnSeat;
    const turnPlayer = a.state.players.find((p) => p.seat === turnSeat);
    const someoneElse = a.state.players.find((p) => p.seat !== turnSeat);
    assert.equal((await request(byId[someoneElse.id], 'game:clue', { text: 'out of turn' })).error, 'not_your_turn');
    const res = await request(byId[turnPlayer.id], 'game:clue', { text: `clue ${given + 1}` });
    assert.equal(res.ok, true, JSON.stringify(res));
    given += 1;
    await waitFor(a, (st) => st.clues.length === given, `clue ${given}`);
  }
  assert.equal(given, 3);
  assert.deepEqual(a.state.clues.map((cl) => cl.order), [1, 2, 3]);
  assert.equal(a.state.clues[0].seat, a.state.startSeat);
  assert.equal(a.state.phase, 'DISCUSS');

  // Discuss → vote.
  for (const s of [a, b, c]) assert.equal((await request(s, 'game:readyToVote', { ready: true })).ok, true);
  await waitFor(a, (st) => st.phase === 'VOTE', 'VOTE');
  assert.ok(a.state.phaseEndsAt > Date.now());

  // Both Family vote the Rat; the Rat votes a Family member. Caught.
  for (const fid of familyIds) assert.equal((await request(byId[fid], 'game:vote', { target: ratId })).ok, true);
  assert.equal((await request(byId[ratId], 'game:vote', { target: familyIds[0] })).ok, true);

  const reveal = await waitFor(a, (st) => st.phase === 'ROLE_REVEAL', 'ROLE_REVEAL');
  assert.equal(reveal.result.ratId, ratId);
  assert.equal(reveal.result.caught, true);
  assert.equal(reveal.result.accusedId, ratId);
  assert.equal(reveal.result.targetIndex, null, 'the word stays hidden through the reveal');
  await waitFor(a, (st) => st.phase === 'LAST_WORD', 'LAST_WORD');
  const order = a.phases.slice(a.phases.indexOf('VOTE'));
  assert.deepEqual(order.slice(0, 4), ['VOTE', 'VOTE_RESULT', 'ROLE_REVEAL', 'LAST_WORD'], 'vote result → roles revealed → only then the guess');

  // Last Word: a Family member cannot answer; the Rat names it.
  assert.equal((await request(byId[familyIds[0]], 'game:lastWord', { index: targetIndex })).error, 'not_rat');
  assert.equal((await request(byId[ratId], 'game:lastWord', { index: targetIndex })).ok, true);
  const resolved = await Promise.all([a, b, c].map((s) => waitFor(s, (st) => st.phase === 'RESOLVE', 'RESOLVE')));
  for (const st of resolved) {
    assert.equal(st.result.targetIndex, targetIndex);
    assert.deepEqual(st.result.lastWord, { index: targetIndex, correct: true });
    assert.equal(st.result.lifeLoss, null);
    assert.ok(st.players.every((p) => p.lives === 3));
  }

  // Chat goes to everyone, sender included, with the server's name for the sender.
  const chats = [a, b, c].map((s) => nextEvent(s, 'chat'));
  b.emit('chat', { text: '  Nice and easy.  ' });
  for (const msg of await Promise.all(chats)) {
    assert.equal(msg.playerId, ids.b);
    assert.equal(msg.name, 'Booski');
    assert.equal(msg.text, 'Nice and easy.');
  }

  // Next round deals again.
  assert.equal((await request(a, 'game:next')).ok, true);
  for (const s of [a, b, c]) await waitFor(s, (st) => st.round === 2, 'round 2');

  // Reload: a fresh socket with the token is the same player in the same seat.
  const seatB = a.state.players.find((p) => p.id === ids.b).seat;
  const roleB = b.state.me.role;
  const replaced = nextEvent(b, 'room:closed');
  const b2 = await client();
  const back = await request(b2, 'room:join', { clientId: randomUUID(), code: created.code, name: 'Booski', character: 'booski', token: joinedB.token });
  assert.equal(back.ok, true);
  assert.equal(back.playerId, ids.b);
  assert.equal(back.state.players.find((p) => p.id === ids.b).seat, seatB);
  assert.equal(back.state.me.role, roleB);
  assert.equal((await replaced).reason, 'replaced');

  // Leave.
  assert.equal((await request(c, 'room:leave')).ok, true);
  await waitFor(a, (st) => !st.players.some((p) => p.id === ids.c), 'C gone');
  const after = await request(c, 'turn:get');
  assert.equal(after.ok, false, 'turn:get refused once out of the room');
});

test('fire-and-forget floods are rate limited, not relayed', async () => {
  const [x, y, z] = await Promise.all([client(), client(), client()]);
  const made = await request(x, 'room:create', { clientId: randomUUID(), name: 'Gratin', character: 'gratin' });
  await request(y, 'room:join', { clientId: randomUUID(), code: made.code, name: 'Seff', character: 'seff' });
  await request(z, 'room:join', { clientId: randomUUID(), code: made.code, name: 'Margo', character: 'margo' });
  let acts = 0;
  y.on('act', () => (acts += 1));
  const limited = nextEvent(x, 'error');
  for (let i = 0; i < 20; i++) x.emit('act', { kind: 'drink' });
  assert.equal((await limited).code, 'rate_limited');
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(acts >= 1 && acts <= 3, `relayed ${acts} of 20 acts`);
});
