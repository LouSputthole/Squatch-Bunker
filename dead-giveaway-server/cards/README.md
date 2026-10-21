# Category cards

Every `*.json` file in this directory is loaded when the server starts (in
file-name order) and validated by `src/cards.js`. `npm test` fails if any
shipped card is invalid. At runtime a bad card is logged and skipped rather
than taking the table down; the server refuses to start only if no card at
all is valid.

## Format

One card per file:

```json
{
  "id": "bing-bar",
  "category": "Behind the Bing bar",
  "words": [
    "Whiskey", "Vodka", "Gin", "Rum",
    "Tequila", "Bourbon", "Ice", "Lime",
    "Cherry", "Olive", "Shaker", "Napkin",
    "Tip jar", "Bottle opener", "Soda gun", "Bar rag"
  ]
}
```

or a whole pack in one file, as an array of the same objects:

```json
[
  { "id": "vorp-01", "category": "...", "words": ["...16 words..."] },
  { "id": "vorp-02", "category": "...", "words": ["...16 words..."] }
]
```

Rules the validator enforces:

| field | rule |
|---|---|
| `id` | lowercase letters, digits and dashes, 1-64 characters, unique across every file |
| `category` | non-empty after trimming, at most 60 characters |
| `words` | exactly 16 strings, each non-empty after trimming, at most 24 characters, no two the same (case-insensitive) |

The server shuffles the 16 words once per deal, so file order does not matter;
every player sees the same shuffled order. A room draws each card at most once
until the whole deck has been used.

## Adding the owner's VORP category cards

The VORP cards were not in any repository when this server was written. To
add them, put one JSON file per card (or one file per pack) in this directory
in the format above, give each an id that cannot collide with the starter deck
(a `vorp-` prefix is the simplest), and run `npm test`. Restart the server to
pick them up. `DG_CARDS_DIR` points the server at a different directory if the
pack lives somewhere else.

## Writing a good card

- Sixteen things a table can clue in a word or three. If you need a sentence
  to explain a word, it is the wrong word.
- Close enough that the Rat can bluff, far enough apart that the Family can
  tell a good clue from a vague one. Two words that mean the same thing make
  the round unfair; cut one.
- Universe cards (the Bing, the cabin, Lou's office) should still be playable
  by someone who has never seen the game: the place is the flavour, the words
  are ordinary.
- Play it straight. The category is said the way the Family would say it.
