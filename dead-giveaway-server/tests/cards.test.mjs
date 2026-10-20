import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCard, validateDeck, loadDeck } from '../src/cards.js';

const words = (n = 16) => Array.from({ length: n }, (_, i) => `Word ${i}`);
const card = (over = {}) => ({ id: 'test-card', category: 'Things', words: words(), ...over });

test('a well-formed card passes and comes back trimmed', () => {
  const res = validateCard(card({ category: '  Things  ', words: words().map((w) => ` ${w} `) }));
  assert.equal(res.ok, true);
  assert.equal(res.card.category, 'Things');
  assert.equal(res.card.words[0], 'Word 0');
});

test('exactly 16 words', () => {
  assert.equal(validateCard(card({ words: words(15) })).ok, false);
  assert.equal(validateCard(card({ words: words(17) })).ok, false);
  assert.equal(validateCard(card({ words: 'nope' })).ok, false);
});

test('words must be distinct after trimming, ignoring case', () => {
  const w = words();
  w[15] = ' word 0 ';
  const res = validateCard(card({ words: w }));
  assert.equal(res.ok, false);
  assert.match(res.errors.join(), /repeats/);
});

test('words must be non-empty strings', () => {
  for (const bad of ['', '   ', 7, null]) {
    const w = words();
    w[3] = bad;
    assert.equal(validateCard(card({ words: w })).ok, false, `word ${JSON.stringify(bad)}`);
  }
});

test('category must be non-empty; id must be a slug', () => {
  assert.equal(validateCard(card({ category: '   ' })).ok, false);
  assert.equal(validateCard(card({ category: 3 })).ok, false);
  assert.equal(validateCard(card({ id: 'Has Spaces' })).ok, false);
  assert.equal(validateCard(card({ id: '' })).ok, false);
  assert.equal(validateCard(null).ok, false);
  assert.equal(validateCard([]).ok, false);
});

test('a deck rejects duplicate ids', () => {
  const { cards, errors } = validateDeck([
    { source: 'a.json', card: card() },
    { source: 'b.json', card: card() },
  ]);
  assert.equal(cards.length, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0].errors[0], /duplicate/);
});

test('loadDeck reads single cards and packs, and reports bad files without throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dg-cards-'));
  try {
    writeFileSync(join(dir, 'one.json'), JSON.stringify(card({ id: 'one' })));
    writeFileSync(join(dir, 'pack.json'), JSON.stringify([card({ id: 'two' }), card({ id: 'three', words: words(3) })]));
    writeFileSync(join(dir, 'broken.json'), '{ not json');
    writeFileSync(join(dir, 'notes.txt'), 'ignored');
    const { cards, errors } = loadDeck(dir);
    assert.deepEqual(cards.map((c) => c.id).sort(), ['one', 'two']);
    assert.equal(errors.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every shipped card passes, and the starter deck has at least 24', () => {
  const { cards, errors } = loadDeck();
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.ok(cards.length >= 24, `only ${cards.length} cards`);
  for (const c of cards) {
    assert.equal(c.words.length, 16, c.id);
    assert.equal(new Set(c.words.map((w) => w.toLowerCase())).size, 16, c.id);
  }
  assert.equal(new Set(cards.map((c) => c.category)).size, cards.length, 'categories are distinct');
});
