// The letter board and its letters, measured in board units.
//
// The board's felt is FELT_W x BOARD_H units, and is scaled by CSS to whatever
// size it is shown at, so a saved board looks the same on every screen. A strip
// of EDGE units on either side is kept clear, so letters go from x = 0 to
// BOARD_W. In the design, one unit is 8/15 of a pixel.

import { PIECES } from "./glyph-metrics.js";

export const EDGE = 12;
export const BOARD_W = 580;
export const FELT_W = BOARD_W + 2 * EDGE;
export const BOARD_H = 885;

/** Distance between two grooves. A letter hangs by its middle in a groove ("row"); groove 0 is the top edge. */
export const GROOVE = 20;
export const ROW_MIN = 2;
export const ROW_MAX = 42;
/** Letters on rows closer than this overlap, so a line of text takes this many rows. */
export const LINE_STEP = 3;
/** How tall a piece is, in board units. Its capitals are 41.25 units. */
export const PIECE_H = 60;

export const MARGIN_X = 20;
/** The space typing leaves between two letters, and the least there can be. */
export const LETTER_GAP = 10;
export const MIN_GAP = 1;
/** What a space adds to the gap after a letter. */
export const WORD_GAP = 26;

/**
 * Every letter that exists. The position of a letter in this string is what a
 * share code stores, so only ever append to it. ">" is the arrow, which points
 * right the right way up and left upside down.
 */
export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ0123456789@*'>-_,";

export const glyphWidth = (ch) => PIECES[ch]?.[0] ?? 30;
/** How far the glyph is moved (em) to sit right on its piece: [dx, dy]. */
export const glyphPlacement = (ch) => PIECES[ch]?.slice(1) ?? [0, 0];
/** The space between two letters next to each other, `left` first, below which they would touch. */
export const gapBetween = () => MIN_GAP;
/** The space typing leaves after a letter. */
export const gapAfter = () => LETTER_GAP;

/** What is on the letter, as text. The arrow is drawn instead (ARROW in js/board-view.js). */
export const glyphText = (ch) => (ch === ">" ? "→" : ch);

/** Letters that read as another letter when turned upside down. */
const UPSIDE_DOWN = { M: "W", W: "M", 6: "9", 9: "6", "'": ",", ",": "'", ">": "←" };

/** How a letter reads to a human, for titles and screen readers. */
export const glyphReading = (ch, flip) => (flip && UPSIDE_DOWN[ch]) || glyphText(ch);

/** When a letter has run out, the upside-down letter that can stand in for it. */
export const STAND_IN = { M: "W", W: "M", 6: "9", 9: "6", ",": "'", "'": "," };

// Keys that are not letters on the board, but can be made by turning one around.
const TYPED_UPSIDE_DOWN = { "<": ">", ".": "'" };

/** The letter a typed character asks for, or null if the board has no such letter. */
export function glyphForKey(key) {
  const upper = key.toUpperCase();
  if (upper.length !== 1) return null;
  if (TYPED_UPSIDE_DOWN[upper]) return { ch: TYPED_UPSIDE_DOWN[upper], flip: true };
  return ALPHABET.includes(upper) ? { ch: upper, flip: false } : null;
}

/** The order "sorter a-z" lays the letters out in, as in the design: letters, digits, marks, arrows. */
const SORT_ORDER = "ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ0123456789-_,'>@*";
export const sortKey = (ch) => SORT_ORDER.indexOf(ch);
