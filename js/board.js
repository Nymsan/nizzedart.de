// Rules of the board: where letters fit, how text is laid out and read back.
// Pure functions over plain tiles `{ ch, x, row, flip, loose }` (plus an `id`
// while a board is being edited). `x` is the left edge, `row` the groove.

import {
  BOARD_W,
  GROOVE,
  LINE_STEP,
  MARGIN_X,
  ROW_MAX,
  ROW_MIN,
  WORD_GAP,
  gapAfter,
  gapBetween,
  glyphReading,
  glyphWidth,
} from "./glyphs.js";

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const clampRow = (row) => clamp(Math.round(row), ROW_MIN, ROW_MAX);
export const rowAt = (y) => clampRow(y / GROOVE);
export const tileRight = (tile) => tile.x + glyphWidth(tile.ch);

const maxX = (ch) => BOARD_W - glyphWidth(ch);

/** The first tile that a letter `ch` placed at (x, row) would be too close to. */
export function blockerAt(tiles, ch, x, row, ignoreId = null) {
  const right = x + glyphWidth(ch);
  for (const tile of tiles) {
    if (ignoreId !== null && tile.id === ignoreId) continue;
    if (Math.abs(tile.row - row) >= LINE_STEP) continue;
    const isLeft = tile.x + tileRight(tile) < x + right; // comparing the middles of the two
    const gap = isLeft ? gapBetween(tile.ch, ch) : gapBetween(ch, tile.ch);
    if (x < tileRight(tile) + gap && tile.x < right + gap) return tile;
  }
  return null;
}

/** The first free x at or after `x` on `row`, or null if the row is full from there. */
export function freeXForward(tiles, ch, x, row) {
  let at = Math.max(0, x);
  while (at <= maxX(ch)) {
    const blocker = blockerAt(tiles, ch, at, row);
    if (!blocker) return at;
    at = tileRight(blocker) + gapBetween(blocker.ch, ch);
  }
  return null;
}

/** The free x on `row` closest to `x`, or null if the letter fits nowhere on the row. */
export function freeXNearest(tiles, ch, x, row, ignoreId = null) {
  const start = clamp(Math.round(x), 0, maxX(ch));
  const search = (direction) => {
    let at = start;
    while (at >= 0 && at <= maxX(ch)) {
      const blocker = blockerAt(tiles, ch, at, row, ignoreId);
      if (!blocker) return at;
      at = direction > 0 ? tileRight(blocker) + gapBetween(blocker.ch, ch) : blocker.x - gapBetween(ch, blocker.ch) - glyphWidth(ch);
    }
    return null;
  };
  const left = search(-1);
  const right = search(1);
  if (left === null) return right;
  if (right === null) return left;
  return start - left <= right - start ? left : right;
}

export const homeCursor = () => ({ x: MARGIN_X, row: ROW_MIN });

/** Where the cursor goes on Enter. Past the last line it wraps to the top. */
export function nextLine(row) {
  const next = row + LINE_STEP;
  return { x: MARGIN_X, row: next > ROW_MAX ? ROW_MIN : next };
}

/**
 * Where a typed letter lands: at the cursor, or on the first following line
 * with room. Typed right after another letter, it is kerned against that one.
 */
export function typingSlot(tiles, ch, cursor) {
  let { x, row } = cursor;
  const before = tiles.find((tile) => tile.row === row && tileRight(tile) + gapAfter(tile.ch) === x);
  if (before) x = tileRight(before) + gapBetween(before.ch, ch);
  const lines = Math.ceil((ROW_MAX - ROW_MIN + 1) / LINE_STEP) + 1;
  for (let i = 0; i < lines; i += 1) {
    const free = freeXForward(tiles, ch, x, row);
    if (free !== null) return { x: free, row };
    ({ x, row } = nextLine(row));
  }
  return null;
}

/**
 * Where the letters `chars` land when typed one after the other from the start
 * of line `top`, kept between that line and the last one. Null if they do not
 * all fit there.
 */
export function typingRun(tiles, chars, top) {
  const placed = [...tiles];
  const slots = [];
  let cursor = { x: MARGIN_X, row: top };
  for (const ch of chars) {
    const slot = typingSlot(placed, ch, cursor);
    if (!slot || slot.row < top) return null; // wrapped around to the top of the board
    const tile = { ch, ...slot };
    placed.push(tile);
    slots.push(slot);
    cursor = { x: tileRight(tile) + gapAfter(ch), row: slot.row };
  }
  return slots;
}

/** The first line of the fewest lines at the bottom of the board that `chars` fit on, typed in, or null. */
export function bottomRun(tiles, chars) {
  for (let top = ROW_MAX; top >= ROW_MIN; top -= LINE_STEP) {
    const slots = typingRun(tiles, chars, top);
    if (slots) return slots;
  }
  return null;
}

/** Lay out lines of text the way typing them would. `lines` is `[{ text, row }]`. */
export function layoutText(lines) {
  const tiles = [];
  for (const { text, row } of lines) {
    let x = MARGIN_X;
    let before = null;
    for (const ch of text) {
      if (ch === " ") {
        x += WORD_GAP;
        before = null;
      } else {
        if (before) x += gapBetween(before, ch) - gapAfter(before);
        tiles.push({ ch, x, row, flip: false, loose: false });
        x += glyphWidth(ch) + gapAfter(ch);
        before = ch;
      }
    }
  }
  return tiles;
}

/** The board read line by line, top to bottom. */
export function readLines(tiles) {
  const rows = new Map();
  for (const tile of tiles) {
    if (!rows.has(tile.row)) rows.set(tile.row, []);
    rows.get(tile.row).push(tile);
  }
  return [...rows.keys()]
    .sort((a, b) => a - b)
    .map((row) => {
      const line = rows.get(row).sort((a, b) => a.x - b.x);
      return line
        .map((tile, i) => {
          const isNewWord = i > 0 && tile.x - tileRight(line[i - 1]) > WORD_GAP * 0.7;
          return (isNewWord ? " " : "") + glyphReading(tile.ch, tile.flip);
        })
        .join("");
    });
}

/** The message on a board as one line of text, leaving out the unused letters. */
export function messageText(tiles) {
  const message = tiles.filter((tile) => !tile.loose);
  return readLines(message.length ? message : tiles).join(" ");
}

const randomInt = (random, min, max) => min + Math.floor(random() * (max - min + 1));

/**
 * Put the letters that were not used aside: they lie loose on the table in
 * front of the board, the right way up and in no particular order, for the
 * next person to use. Where a loose letter would be on the board does not
 * matter: the table has its own layout (see board-view.js).
 */
export function putAside(leftovers, random = Math.random) {
  const loose = leftovers.map(({ ch }) => ({ ch, x: 0, row: ROW_MAX, flip: false, loose: true }));
  for (let i = loose.length - 1; i > 0; i -= 1) {
    const j = randomInt(random, 0, i);
    [loose[i], loose[j]] = [loose[j], loose[i]];
  }
  return loose;
}
