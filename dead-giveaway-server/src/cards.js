// Category cards: loader and validator.
//
// A card is { id, category, words: [16 strings] }. A file in cards/ holds one
// card object or an array of them (a whole pack). See cards/README.md.

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORDS_PER_CARD = 16;
export const MAX_WORD_LEN = 24;
export const MAX_CATEGORY_LEN = 60;
export const CARD_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const DEFAULT_CARDS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'cards');

/**
 * Validate one card. Returns { ok: true, card } with trimmed strings, or
 * { ok: false, errors: [string] }.
 */
export function validateCard(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['card must be an object'] };
  }
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!CARD_ID_PATTERN.test(id)) errors.push(`id "${raw.id}" must be lowercase letters, digits and dashes (1-64)`);

  const category = typeof raw.category === 'string' ? raw.category.trim() : '';
  if (!category) errors.push('category must be a non-empty string');
  else if (category.length > MAX_CATEGORY_LEN) errors.push(`category longer than ${MAX_CATEGORY_LEN} characters`);

  let words = [];
  if (!Array.isArray(raw.words)) {
    errors.push('words must be an array');
  } else {
    if (raw.words.length !== WORDS_PER_CARD) errors.push(`words must have exactly ${WORDS_PER_CARD} entries, found ${raw.words.length}`);
    const seen = new Map();
    raw.words.forEach((w, i) => {
      if (typeof w !== 'string' || !w.trim()) {
        errors.push(`word ${i} must be a non-empty string`);
        return;
      }
      const t = w.trim().replace(/\s+/g, ' ');
      if (t.length > MAX_WORD_LEN) errors.push(`word "${t}" longer than ${MAX_WORD_LEN} characters`);
      const key = t.toLowerCase();
      if (seen.has(key)) errors.push(`word "${t}" repeats word ${seen.get(key)}`);
      else seen.set(key, i);
      words.push(t);
    });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, card: { id, category, words } };
}

/**
 * Validate a list of cards as a deck: each card valid, ids unique.
 * Returns { cards, errors: [{ source, id, errors }] }; invalid cards are left out.
 */
export function validateDeck(entries) {
  const cards = [];
  const errors = [];
  const ids = new Set();
  for (const { source, card: raw } of entries) {
    const res = validateCard(raw);
    if (!res.ok) {
      errors.push({ source, id: raw?.id ?? null, errors: res.errors });
      continue;
    }
    if (ids.has(res.card.id)) {
      errors.push({ source, id: res.card.id, errors: [`duplicate card id "${res.card.id}"`] });
      continue;
    }
    ids.add(res.card.id);
    cards.push(res.card);
  }
  return { cards, errors };
}

/** Read every *.json in `dir` (sorted by name), each a card or an array of cards. */
export function loadDeck(dir = DEFAULT_CARDS_DIR) {
  const entries = [];
  const errors = [];
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch (err) {
    return { cards: [], errors: [{ source: dir, id: null, errors: [`cannot read cards directory: ${err.message}`] }] };
  }
  for (const file of files) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (err) {
      errors.push({ source: file, id: null, errors: [`invalid JSON: ${err.message}`] });
      continue;
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    list.forEach((card, i) => entries.push({ source: list.length > 1 ? `${file}[${i}]` : file, card }));
  }
  const deck = validateDeck(entries);
  return { cards: deck.cards, errors: [...errors, ...deck.errors] };
}
