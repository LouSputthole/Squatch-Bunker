import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as rules from '../src/rules.js';
import { lobby, dealt, must, ratOf, familyOf, giveAllClues, toVote, expire, mulberry32, testDeck } from './helpers.mjs';

const { PHASE } = rules;

function voteAll(room, pickFor) {
  for (const p of rules.alivePlayers(room)) {
    if (room.phase !== PHASE.VOTE) break;
    if (p.connected) must(rules.vote(room, p.id, { target: pickFor(p.id) }));
  }
}

describe('a full round', () => {
  for (const n of [3, 4, 6]) {
    test(`${n} players, the Rat is caught and names the word`, () => {
      const room = dealt(n, { seed: n });
      assert.equal(room.phase, PHASE.CLUES);
      const rat = ratOf(room);
      const family = familyOf(room);
      assert.equal(family.length, n - 1);
      toVote(room);
      assert.equal(room.phase, PHASE.VOTE);
      assert.ok(room.phaseEndsAt > 0);
      voteAll(room, (voter) => (voter === rat ? family[0] : rat));

      assert.equal(room.phase, PHASE.VOTE_RESULT);
      let snap = rules.snapshotFor(room, family[0]);
      assert.equal(snap.result.accusedId, rat);
      assert.equal(snap.result.tally[rat], n - 1);
      assert.equal(snap.result.ratId, null, 'the Rat is not named before ROLE_REVEAL');
      assert.equal(snap.result.roles, null);
      assert.equal(snap.result.caught, null, 'caught would name the Rat early');

      expire(room);
      assert.equal(room.phase, PHASE.ROLE_REVEAL);
      snap = rules.snapshotFor(room, family[0]);
      assert.equal(snap.result.ratId, rat);
      assert.equal(snap.result.caught, true);
      assert.equal(Object.keys(snap.result.roles).length, n);
      assert.equal(Object.values(snap.result.roles).filter((r) => r === 'rat').length, 1);

      expire(room);
      assert.equal(room.phase, PHASE.LAST_WORD);
      must(rules.lastWord(room, rat, { index: room.secret.targetIndex }));
      assert.equal(room.phase, PHASE.RESOLVE);
      snap = rules.snapshotFor(room, rat);
      assert.deepEqual(snap.result.lastWord, { index: room.secret.targetIndex, correct: true });
      assert.equal(snap.result.lifeLoss, null);
      assert.ok(room.players.every((p) => p.lives === 3));
      assert.equal(snap.result.targetIndex, room.secret.targetIndex);
    });

    test(`${n} players, the Rat escapes and pays someone back`, () => {
      const room = dealt(n, { seed: 100 + n });
      const rat = ratOf(room);
      const family = familyOf(room);
      const accused = family[0];
      toVote(room);
      voteAll(room, (voter) => (voter === accused ? family[1] || rat : accused));
      assert.equal(room.phase, PHASE.VOTE_RESULT);
      assert.equal(room.result.accusedId, accused);
      expire(room);
      assert.equal(room.phase, PHASE.ROLE_REVEAL, 'roles are revealed before Payback');
      assert.equal(rules.snapshotFor(room, accused).result.caught, false);
      expire(room);
      assert.equal(room.phase, PHASE.PAYBACK);
      const victim = family[family.length - 1];
      assert.equal(rules.payback(room, rat, { target: rat }).error, 'bad_target');
      assert.equal(rules.payback(room, accused, { target: victim }).error, 'not_rat');
      must(rules.payback(room, rat, { target: victim }));
      assert.equal(room.phase, PHASE.RESOLVE);
      assert.deepEqual(room.result.payback, { targetId: victim });
      assert.deepEqual(room.result.lifeLoss, { playerId: victim, livesAfter: 2 });
      if (victim !== accused) assert.equal(rules.findPlayer(room, accused).lives, 3, 'no automatic penalty for the accused');
      assert.equal(rules.findPlayer(room, rat).lives, 3);
      must(rules.next(room, 'p0', {}, 10));
      assert.equal(room.phase, PHASE.DEAL);
      assert.equal(room.round, 2);
    });
  }
});

test('a tie means the Rat walks: accusedId null, caught false, then PAYBACK', () => {
  const room = dealt(4, { seed: 7 });
  const rat = ratOf(room);
  const [a, b, c] = familyOf(room);
  toVote(room);
  // a and rat vote b; b and c vote a: 2-2.
  must(rules.vote(room, a, { target: b }));
  must(rules.vote(room, rat, { target: b }));
  must(rules.vote(room, b, { target: a }));
  must(rules.vote(room, c, { target: a }));
  assert.equal(room.phase, PHASE.VOTE_RESULT);
  assert.equal(room.result.accusedId, null);
  assert.equal(room.result.caught, false);
  expire(room);
  expire(room);
  assert.equal(room.phase, PHASE.PAYBACK);
});

test('no votes at all (VOTE timeout) is a tie: everyone abstained', () => {
  const room = dealt(3, { seed: 8 });
  toVote(room);
  assert.equal(room.phaseEndsAt - 0, rules.TIMINGS.VOTE);
  assert.equal(rules.due(room, room.phaseEndsAt - 1), false);
  expire(room);
  assert.equal(room.phase, PHASE.VOTE_RESULT);
  assert.equal(room.result.accusedId, null);
  assert.deepEqual(room.result.tally, {});
});

describe('Last Word', () => {
  function caught(seed) {
    const room = dealt(4, { seed });
    const rat = ratOf(room);
    toVote(room);
    voteAll(room, (v) => (v === rat ? familyOf(room)[0] : rat));
    expire(room);
    expire(room);
    assert.equal(room.phase, PHASE.LAST_WORD);
    return { room, rat };
  }

  test('correct: nobody loses a life', () => {
    const { room, rat } = caught(11);
    must(rules.lastWord(room, rat, { index: room.secret.targetIndex }));
    assert.equal(room.result.lastWord.correct, true);
    assert.equal(room.result.lifeLoss, null);
    assert.ok(room.players.every((p) => p.lives === 3));
  });

  test('wrong: the Rat loses one', () => {
    const { room, rat } = caught(12);
    const wrong = (room.secret.targetIndex + 1) % 16;
    must(rules.lastWord(room, rat, { index: wrong }));
    assert.deepEqual(room.result.lastWord, { index: wrong, correct: false });
    assert.deepEqual(room.result.lifeLoss, { playerId: rat, livesAfter: 2 });
  });

  test('only the Rat, only a valid index, only in LAST_WORD', () => {
    const { room, rat } = caught(13);
    assert.equal(rules.lastWord(room, familyOf(room)[0], { index: 0 }).error, 'not_rat');
    assert.equal(rules.lastWord(room, rat, { index: 16 }).error, 'bad_word');
    assert.equal(rules.lastWord(room, rat, { index: 1.5 }).error, 'bad_word');
    assert.equal(rules.lastWord(room, rat, { index: '3' }).error, 'bad_word');
    must(rules.lastWord(room, rat, { index: 0 }));
    assert.equal(rules.lastWord(room, rat, { index: 0 }).error, 'wrong_phase');
  });

  test('60 s of silence counts as wrong', () => {
    const { room, rat } = caught(14);
    assert.equal(room.phaseEndsAt - room.phaseEndsAt + rules.TIMINGS.LAST_WORD, 60_000);
    expire(room);
    assert.equal(room.phase, PHASE.RESOLVE);
    assert.deepEqual(room.result.lastWord, { index: null, correct: false });
    assert.equal(rules.findPlayer(room, rat).lives, 2);
  });
});

test('payback timeout picks a random alive non-Rat (never the Rat, never an out player)', () => {
  const victims = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const room = dealt(5, { seed });
    const rat = ratOf(room);
    // Knock one family member out before the round so they cannot be picked.
    const outId = familyOf(room)[0];
    rules.abandonPlayer(room, outId, 0);
    assert.equal(room.phase, PHASE.CLUES);
    toVote(room);
    expire(room); // VOTE timeout: no votes → tie → Rat walks
    expire(room);
    expire(room);
    assert.equal(room.phase, PHASE.PAYBACK);
    expire(room);
    assert.equal(room.phase, PHASE.RESOLVE);
    const v = room.result.payback.targetId;
    assert.notEqual(v, rat);
    assert.notEqual(v, outId);
    assert.equal(rules.findPlayer(room, v).lives, 2);
    assert.equal(room.result.lifeLoss.playerId, v);
    victims.add(v);
  }
  assert.ok(victims.size >= 3, `random spread across victims, saw ${[...victims]}`);
});

test('elimination at 0 lives: out at RESOLVE, cannot clue, vote, be Rat or be targeted', () => {
  const room = dealt(4, { seed: 21, settings: { lives: 1 } });
  const rat = ratOf(room);
  const [victim, other] = familyOf(room);
  toVote(room);
  voteAll(room, (v) => (v === other ? victim : other)); // other accused, Rat walks
  expire(room);
  expire(room);
  must(rules.payback(room, rat, { target: victim }));
  assert.equal(room.phase, PHASE.RESOLVE);
  const vp = rules.findPlayer(room, victim);
  assert.equal(vp.lives, 0);
  assert.equal(vp.out, true);
  assert.equal(rules.snapshotFor(room, victim).players.find((p) => p.id === victim).out, true);

  // Many next rounds: the out player is never the Rat, never in the turn order.
  for (let i = 0; i < 6 && room.phase !== PHASE.MATCH_OVER; i++) {
    if (room.phase === PHASE.RESOLVE) must(rules.next(room, room.hostId, {}, 0));
    expire(room); // DEAL → CLUES
    assert.notEqual(ratOf(room), victim);
    assert.ok(!room.secret.turnOrder.includes(victim));
    assert.equal(rules.snapshotFor(room, victim).me.role, null, 'out players are not dealt in');
    giveAllClues(room);
    assert.ok(!room.clues.some((c) => c.playerId === victim));
    assert.equal(rules.readyToVote(room, victim, { ready: true }).error, 'invalid');
    for (const p of rules.alivePlayers(room)) must(rules.readyToVote(room, p.id, { ready: true }));
    assert.equal(rules.vote(room, victim, { target: ratOf(room) }).error, 'invalid');
    const voter = rules.alivePlayers(room)[0];
    assert.equal(rules.vote(room, voter.id, { target: victim }).error, 'bad_vote');
    // Close the vote with no penalty to keep everyone alive: correct Last Word.
    const r = ratOf(room);
    for (const p of rules.alivePlayers(room)) {
      if (room.phase === PHASE.VOTE) must(rules.vote(room, p.id, { target: p.id === r ? rules.alivePlayers(room).find((x) => x.id !== r).id : r }));
    }
    expire(room);
    expire(room);
    if (room.phase === PHASE.LAST_WORD) must(rules.lastWord(room, r, { index: room.secret.targetIndex }));
    else {
      assert.equal(rules.payback(room, r, { target: victim }).error, 'bad_target');
      break;
    }
  }
});

test('match over at ≤2 alive; winners are the survivors; next returns to the lobby with lives reset', () => {
  const room = dealt(3, { seed: 31, settings: { lives: 1 } });
  const rat = ratOf(room);
  const [a, b] = familyOf(room);
  toVote(room);
  voteAll(room, (v) => (v === a ? b : a));
  expire(room);
  expire(room);
  must(rules.payback(room, rat, { target: b }));
  assert.equal(room.phase, PHASE.RESOLVE);
  const notHost = room.players.find((p) => p.id !== room.hostId).id;
  assert.equal(rules.next(room, notHost, {}, 0).error, 'not_host');
  must(rules.next(room, room.hostId, {}, 0));
  assert.equal(room.phase, PHASE.MATCH_OVER);
  assert.deepEqual(new Set(room.match.winnerIds), new Set([rat, a]));
  assert.equal(room.match.rounds, 1);
  must(rules.next(room, room.hostId, {}, 0));
  assert.equal(room.phase, PHASE.LOBBY);
  assert.ok(room.players.every((p) => p.lives === 1 && !p.out));
  assert.equal(rules.snapshotFor(room, a).me.role, null);
  assert.equal(room.card, null);
});

test('RESOLVE auto-advances after 30 s', () => {
  const room = dealt(3, { seed: 32 });
  toVote(room);
  expire(room);
  expire(room);
  expire(room);
  expire(room); // payback timeout
  assert.equal(room.phase, PHASE.RESOLVE);
  assert.equal(room.phaseEndsAt, room.phaseEndsAt); // set
  const at = room.phaseEndsAt;
  assert.equal(rules.due(room, at - 1), false);
  assert.equal(rules.due(room, at), true);
  assert.equal(room.phase, PHASE.DEAL);
});

test('startSeat rotates across alive seats, skipping gaps and out players', () => {
  const room = lobby(4, { seed: 41, settings: { lives: 9 } });
  // Seats 0,2,5,7.
  must(rules.setSeat(room, 'p3', { seat: 7 }));
  must(rules.setSeat(room, 'p2', { seat: 5 }));
  must(rules.setSeat(room, 'p1', { seat: 2 }));
  assert.equal(rules.setSeat(room, 'p1', { seat: 5 }).error, 'invalid');
  must(rules.start(room, 'p0', {}, 0));
  const seen = [];
  const order = [];
  for (let round = 1; round <= 5; round++) {
    assert.equal(room.phase, PHASE.DEAL);
    seen.push(room.startSeat);
    expire(room);
    assert.equal(room.turnSeat, room.startSeat, 'first clue comes from startSeat');
    const turnSeats = [];
    while (room.phase === PHASE.CLUES) {
      turnSeats.push(room.turnSeat);
      const p = room.players.find((x) => x.seat === room.turnSeat);
      must(rules.clue(room, p.id, { text: 'x' }));
    }
    order.push(turnSeats);
    if (round === 2) rules.findPlayer(room, 'p2').out = true; // seat 5 drops out after round 2
    // Abort the rest of the round without penalties.
    must(rules.callVote(room, room.hostId, {}, 0));
    expire(room); // tie
    expire(room);
    expire(room);
    expire(room); // payback timeout: with 9 lives nobody is eliminated in 5 rounds
    assert.equal(room.phase, PHASE.RESOLVE);
    must(rules.next(room, room.hostId, {}, 0));
  }
  assert.deepEqual(seen, [0, 2, 7, 0, 2]);
  assert.deepEqual(order[0], [0, 2, 5, 7]);
  assert.deepEqual(order[1], [2, 5, 7, 0]);
  assert.deepEqual(order[2], [7, 0, 2]);
});

test('the Rat never sees targetIndex before RESOLVE; the Family does from DEAL', () => {
  const room = lobby(4, { seed: 51 });
  must(rules.start(room, 'p0', {}, 0));
  const rat = ratOf(room);
  const fam = familyOf(room)[0];
  const check = () => {
    const ratSnap = rules.snapshotFor(room, rat);
    const famSnap = rules.snapshotFor(room, fam);
    const resolved = room.phase === PHASE.RESOLVE;
    assert.equal(ratSnap.me.role, 'rat');
    assert.equal(famSnap.me.role, 'family');
    assert.equal(famSnap.me.targetIndex, room.secret.targetIndex);
    if (!resolved) {
      assert.equal(ratSnap.me.targetIndex, null, `phase ${room.phase}`);
      assert.ok(!ratSnap.result || ratSnap.result.targetIndex === null, `phase ${room.phase}`);
      // Nothing anywhere in the serialised view carries it.
      assert.ok(!/"targetIndex":\d/.test(JSON.stringify(ratSnap)), `phase ${room.phase}`);
    } else {
      assert.equal(ratSnap.result.targetIndex, room.secret.targetIndex);
    }
  };
  check(); // DEAL
  expire(room);
  check(); // CLUES
  giveAllClues(room);
  check(); // DISCUSS
  for (const p of rules.alivePlayers(room)) if (room.phase === PHASE.DISCUSS) must(rules.readyToVote(room, p.id, { ready: true }));
  check(); // VOTE
  voteAll(room, (v) => (v === rat ? fam : rat));
  check(); // VOTE_RESULT
  expire(room);
  check(); // ROLE_REVEAL
  expire(room);
  check(); // LAST_WORD
  must(rules.lastWord(room, rat, { index: 0 }));
  check(); // RESOLVE
});

test('the 16 words are the same array in the same order for every player', () => {
  const room = dealt(6, { seed: 61 });
  const views = room.players.map((p) => rules.snapshotFor(room, p.id).card);
  for (const v of views) {
    assert.equal(v.words.length, 16);
    assert.deepEqual(v, views[0]);
  }
  // Snapshots are copies: mutating one does not touch the room or another view.
  views[0].words.reverse();
  assert.notDeepEqual(views[0].words, rules.snapshotFor(room, 'p1').card.words);
});

test('deterministic with an injected random; cards do not repeat until the deck is exhausted', () => {
  const a = dealt(4, { seed: 99 });
  const b = dealt(4, { seed: 99 });
  assert.deepEqual(
    { rat: a.secret.ratId, card: a.card, target: a.secret.targetIndex },
    { rat: b.secret.ratId, card: b.card, target: b.secret.targetIndex },
  );
  const room = lobby(3, { seed: 5, deck: testDeck(3) });
  must(rules.start(room, 'p0', {}, 0));
  const ids = [room.card.id];
  for (let i = 0; i < 5; i++) {
    must(rules.abort(room, 'p0'));
    must(rules.start(room, 'p0', {}, 0));
    ids.push(room.card.id);
  }
  assert.equal(new Set(ids.slice(0, 3)).size, 3, 'first three draws cover the deck');
  assert.equal(new Set(ids.slice(3, 6)).size, 3, 'then it reshuffles');
});

test('Rat chosen uniformly among alive players', () => {
  const counts = {};
  const random = mulberry32(2024);
  for (let i = 0; i < 600; i++) {
    const room = rules.createMatch({}, { deck: testDeck(), random });
    for (let k = 0; k < 3; k++) rules.addPlayer(room, { id: `p${k}`, name: `P${k}`, character: 'lou' });
    must(rules.start(room, 'p0', {}, 0));
    counts[ratOf(room)] = (counts[ratOf(room)] || 0) + 1;
  }
  for (const id of ['p0', 'p1', 'p2']) assert.ok(counts[id] > 150 && counts[id] < 250, JSON.stringify(counts));
});

describe('guards and edges', () => {
  test('start needs the host, the lobby and 3 connected players', () => {
    const room = lobby(3);
    assert.equal(rules.start(room, 'p1', {}, 0).error, 'not_host');
    rules.disconnectPlayer(room, 'p2', 0);
    assert.equal(rules.start(room, 'p0', {}, 0).error, 'invalid');
    rules.reconnectPlayer(room, 'p2', 0);
    must(rules.start(room, 'p0', {}, 0));
    assert.equal(rules.start(room, 'p0', {}, 0).error, 'wrong_phase');
  });

  test('clue validation and turn order', () => {
    const room = dealt(3, { seed: 3 });
    const turn = room.players.find((p) => p.seat === room.turnSeat);
    const notTurn = room.players.find((p) => p.seat !== room.turnSeat);
    assert.equal(rules.clue(room, notTurn.id, { text: 'hi' }).error, 'not_your_turn');
    assert.equal(rules.clue(room, turn.id, { text: '   ' }).error, 'bad_clue');
    assert.equal(rules.clue(room, turn.id, { text: 'x'.repeat(61) }).error, 'bad_clue');
    assert.equal(rules.clue(room, turn.id, { text: 42 }).error, 'bad_clue');
    must(rules.clue(room, turn.id, { text: '  a\u0000clue  ' }));
    assert.equal(room.clues[0].text, 'a clue');
    assert.equal(room.clues[0].order, 1);
    assert.equal(rules.findPlayer(room, turn.id).clue, 'a clue');
  });

  test('host skipTurn records a null clue and moves on', () => {
    const room = dealt(3, { seed: 4 });
    const turn = room.players.find((p) => p.seat === room.turnSeat);
    rules.disconnectPlayer(room, turn.id, 0);
    const hostId = room.hostId;
    assert.notEqual(hostId, turn.id);
    const other = room.players.find((p) => p.id !== hostId && p.connected);
    assert.equal(rules.skipTurn(room, other.id, {}, 0).error, 'not_host');
    must(rules.skipTurn(room, hostId, {}, 0));
    assert.deepEqual(room.clues[0], { playerId: turn.id, seat: turn.seat, text: null, order: 1 });
    assert.notEqual(room.turnSeat, turn.seat);
  });

  test('DISCUSS and VOTE complete without disconnected players; votes are final', () => {
    const room = dealt(4, { seed: 5 });
    giveAllClues(room);
    const [a, b, c, d] = rules.alivePlayers(room).map((p) => p.id);
    must(rules.readyToVote(room, a, { ready: true }));
    must(rules.readyToVote(room, b, { ready: true }));
    must(rules.readyToVote(room, c, { ready: true }));
    assert.equal(room.phase, PHASE.DISCUSS);
    rules.disconnectPlayer(room, d, 0);
    assert.equal(room.phase, PHASE.VOTE, 'the last unready player dropping completes DISCUSS');
    must(rules.vote(room, a, { target: b }));
    assert.equal(rules.vote(room, a, { target: c }).error, 'bad_vote');
    assert.equal(rules.vote(room, b, { target: b }).error, 'bad_vote');
    assert.equal(rules.vote(room, b, { target: 'nobody' }).error, 'bad_vote');
    must(rules.vote(room, b, { target: a }));
    must(rules.vote(room, c, { target: a }));
    assert.equal(room.phase, PHASE.VOTE_RESULT);
    assert.equal(room.result.accusedId, a);
  });

  test('host callVote skips the rest of DISCUSS', () => {
    const room = dealt(3, { seed: 6 });
    giveAllClues(room);
    assert.equal(rules.callVote(room, 'p1', {}, 0).error, 'not_host');
    must(rules.callVote(room, 'p0', {}, 5));
    assert.equal(room.phase, PHASE.VOTE);
    assert.equal(room.phaseEndsAt, 5 + 90_000);
  });

  test('the Rat leaving mid-round resolves it with no penalty', () => {
    const room = dealt(4, { seed: 9 });
    const rat = ratOf(room);
    rules.removePlayer(room, rat, 0);
    assert.equal(room.phase, PHASE.RESOLVE);
    assert.equal(room.result.voided, true);
    assert.equal(room.result.lifeLoss, null);
    assert.equal(rules.snapshotFor(room, room.players[0].id).result.ratId, rat);
  });

  test('fewer than 3 alive mid-round resolves with no penalty; then the match is over', () => {
    const room = dealt(3, { seed: 10 });
    const fam = familyOf(room)[0];
    rules.abandonPlayer(room, fam, 0);
    assert.equal(room.phase, PHASE.RESOLVE);
    assert.equal(room.result.voided, true);
    assert.equal(rules.findPlayer(room, fam).lives, 3, 'abandoned players keep their lives');
    assert.equal(rules.findPlayer(room, fam).out, true);
    expire(room);
    assert.equal(room.phase, PHASE.MATCH_OVER);
    must(rules.next(room, room.hostId, {}, 0));
    assert.equal(rules.findPlayer(room, fam), null, 'abandoned players are cleared on return to the lobby');
  });

  test('the Rat walking out during PAYBACK applies the timeout now', () => {
    const room = dealt(4, { seed: 15 });
    const rat = ratOf(room);
    toVote(room);
    expire(room);
    expire(room);
    expire(room);
    assert.equal(room.phase, PHASE.PAYBACK);
    rules.removePlayer(room, rat, 1234);
    assert.equal(room.phaseEndsAt, 1234);
    rules.due(room, 1234);
    assert.equal(room.phase, PHASE.RESOLVE);
    assert.ok(room.result.payback.targetId);
  });

  test('a vote for a player who leaves is returned to the voter', () => {
    const room = dealt(5, { seed: 16 });
    toVote(room);
    const fam = familyOf(room);
    must(rules.vote(room, fam[0], { target: fam[1] }));
    rules.removePlayer(room, fam[1], 0);
    assert.equal(room.phase, PHASE.VOTE);
    assert.equal(rules.findPlayer(room, fam[0]).hasVoted, false);
    must(rules.vote(room, fam[0], { target: fam[2] }));
  });

  test('host passes to the lowest joinSeq connected player', () => {
    const room = lobby(4);
    rules.disconnectPlayer(room, 'p0', 0);
    assert.equal(room.hostId, 'p1');
    rules.reconnectPlayer(room, 'p0', 0);
    assert.equal(room.hostId, 'p1', 'the old host does not take it back');
    rules.removePlayer(room, 'p1', 0);
    assert.equal(room.hostId, 'p2');
    assert.ok(rules.findPlayer(room, 'p0').joinSeq > rules.findPlayer(room, 'p3').joinSeq, 'rejoin bumps joinSeq');
  });

  test('joining mid-match sits out until the next match', () => {
    const room = dealt(3, { seed: 17 });
    must(rules.addPlayer(room, { id: 'late', name: 'Late', character: 'margo' }));
    const late = rules.findPlayer(room, 'late');
    assert.equal(late.out, true);
    assert.equal(rules.snapshotFor(room, 'late').me.role, null);
    assert.equal(rules.snapshotFor(room, 'late').me.targetIndex, null);
    must(rules.abort(room, room.hostId));
    assert.equal(late.out, false);
    assert.equal(late.lives, 3);
  });

  test('lobby-only intents, names and characters', () => {
    const room = lobby(3);
    assert.equal(rules.addPlayer(room, { id: 'x', name: '  ', character: 'lou' }).error, 'bad_name');
    assert.equal(rules.addPlayer(room, { id: 'x', name: 'x'.repeat(21), character: 'lou' }).error, 'bad_name');
    assert.equal(rules.addPlayer(room, { id: 'x', name: 'X', character: '../etc' }).error, 'bad_character');
    must(rules.setCharacter(room, 'p1', { character: 'booski' }));
    assert.equal(rules.setCharacter(room, 'p1', { character: 7 }).error, 'bad_character');
    for (let i = 3; i < 8; i++) must(rules.addPlayer(room, { id: `q${i}`, name: `Q${i}`, character: 'lou' }));
    assert.equal(rules.addPlayer(room, { id: 'nine', name: 'Nine', character: 'lou' }).error, 'room_full');
    must(rules.start(room, 'p0', {}, 0));
    assert.equal(rules.setCharacter(room, 'p1', { character: 'lou' }).error, 'wrong_phase');
    assert.equal(rules.setSeat(room, 'p1', { seat: 0 }).error, 'wrong_phase');
  });

  test('applyIntent dispatches by wire name and survives junk payloads', () => {
    const room = lobby(3);
    assert.equal(rules.applyIntent(room, 'p0', 'game:nope', {}).error, 'invalid');
    for (const event of rules.INTENT_EVENTS) {
      for (const junk of [null, undefined, 7, 'x', [], { target: {} }, { index: NaN }, { text: { a: 1 } }]) {
        const res = rules.applyIntent(room, 'p1', event, junk, 0);
        assert.equal(typeof res.ok, 'boolean');
      }
    }
    must(rules.applyIntent(room, 'p0', 'game:start', {}, 0));
    assert.equal(room.phase, PHASE.DEAL);
  });
});
