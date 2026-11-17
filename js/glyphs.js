// The letter board and its letters, measured in board units.
//
// Every board is BOARD_W x BOARD_H units and is scaled by CSS to whatever size
// it is shown at, so a saved board looks the same on every screen.

import { KERNING, WIDTHS } from "./glyph-metrics.js";

export const BOARD_W = 520;
export const BOARD_H = 640;

/** Distance between two grooves. A letter sits centred on a groove ("row"). */
export const GROOVE = 20;
export const ROW_MIN = 2;
export const ROW_MAX = 30;
/** Letters on rows closer than this overlap, so a line of text takes this many rows. */
export const LINE_STEP = 3;

export const MARGIN_X = 26;
export const LETTER_GAP = 4;
export const WORD_GAP = 22;

/**
 * Every letter that exists. The position of a letter in this string is what a
 * share code stores, so only ever append to it.
 */
export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ0123456789@*'<";

// A letter is as wide as its advance in the board font (the letter plus the
// space the type designer put around it), and pairs the font kerns are kerned
// on the board too. Both tables are measured from the self-hosted font by
// scripts/glyph_metrics.py. They are fixed numbers rather than measured in the
// browser, so a board is laid out the same everywhere.

/** Small marks that are allowed to sit right up against their neighbours. */
const TIGHT = new Set(["*", "'"]);
const TIGHT_GAP = 1;

export const glyphWidth = (ch) => WIDTHS[ch] ?? 30;
/** The space between two letters next to each other, `left` first. */
export const gapBetween = (left, right) => (TIGHT.has(left) || TIGHT.has(right) ? TIGHT_GAP : LETTER_GAP) + (KERNING[left + right] ?? 0);
/** The space after a letter, before it is known what comes next. */
export const gapAfter = (ch) => (TIGHT.has(ch) ? TIGHT_GAP : LETTER_GAP);

/** What is printed on the letter. The arrow is one piece: turned around it points right. */
export const glyphText = (ch) => (ch === "<" ? "←" : ch);

/** Letters that read as another letter when turned upside down. */
const UPSIDE_DOWN = { M: "W", W: "M", 6: "9", 9: "6", "'": ",", "<": "→" };

/** How a letter reads to a human, for titles and screen readers. */
export const glyphReading = (ch, flip) => (flip && UPSIDE_DOWN[ch]) || glyphText(ch);

/** When a letter has run out, the upside-down letter that can stand in for it. */
export const STAND_IN = { M: "W", W: "M", 6: "9", 9: "6" };

// Keys that are not letters on the board, but can be made by turning one around.
const TYPED_UPSIDE_DOWN = { ">": "<", ".": "'", ",": "'" };

/** The letter a typed character asks for, or null if the board has no such letter. */
export function glyphForKey(key) {
  const upper = key.toUpperCase();
  if (upper.length !== 1) return null;
  if (TYPED_UPSIDE_DOWN[upper]) return { ch: TYPED_UPSIDE_DOWN[upper], flip: true };
  return ALPHABET.includes(upper) ? { ch: upper, flip: false } : null;
}
