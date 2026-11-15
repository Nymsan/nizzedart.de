// Rules of the board: where letters fit, how text is laid out and read back.
// Pure functions over plain tiles `{ ch, x, row, flip, loose }` (plus an `id`
// while a board is being edited). `x` is the left edge, `row` the groove.

import {
  BOARD_H,
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
    const gap = gapBetween(ch, tile.ch);
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
    at = tileRight(blocker) + gapBetween(ch, blocker.ch);
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
      const gap = gapBetween(ch, blocker.ch);
      at = direction > 0 ? tileRight(blocker) + gap : blocker.x - gap - glyphWidth(ch);
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

/** Where a typed letter lands: at the cursor, or on the first following line with room. */
export function typingSlot(tiles, ch, cursor) {
  let { x, row } = cursor;
  const lines = Math.ceil((ROW_MAX - ROW_MIN + 1) / LINE_STEP) + 1;
  for (let i = 0; i < lines; i += 1) {
    const free = freeXForward(tiles, ch, x, row);
    if (free !== null) return { x: free, row };
    ({ x, row } = nextLine(row));
  }
  return null;
}

/** Lay out lines of text the way typing them would. `lines` is `[{ text, row }]`. */
export function layoutText(lines) {
  const tiles = [];
  for (const { text, row } of lines) {
    let x = MARGIN_X;
    for (const ch of text) {
      if (ch === " ") {
        x += WORD_GAP;
      } else {
        tiles.push({ ch, x, row, flip: false, loose: false });
        x += glyphWidth(ch) + gapAfter(ch);
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
 * Dump the letters that were not used in a pile at the bottom of the board,
 * some of them upside down. The pile starts a couple of lines below the
 * message when there is room, and creeps upwards when there is not.
 */
export function scatterLeftovers(message, leftovers, random = Math.random) {
  const lastRow = message.reduce((row, tile) => Math.max(row, tile.row), ROW_MIN - LINE_STEP);
  const pileRow = Math.round((BOARD_H * 0.66) / GROOVE);
  const closest = lastRow + LINE_STEP;
  // Grow the pile upwards a line at a time, so it is no taller than it has to be.
  for (let top = Math.max(pileRow, closest + LINE_STEP); top >= closest; top -= LINE_STEP) {
    const pile = tryScatter(message, leftovers, Math.min(top, ROW_MAX), random);
    if (pile) return pile;
  }
  const anywhere = tryScatter(message, leftovers, ROW_MIN, random);
  if (anywhere) return anywhere;
  // The board is so full that the letters cannot be kept apart: let them overlap.
  return leftovers.map(({ ch }) => looseTile(ch, randomInt(random, 0, maxX(ch)), randomInt(random, pileRow, ROW_MAX), random));
}

function looseTile(ch, x, row, random) {
  return { ch, x, row, flip: random() < 0.5, loose: true };
}

function tryScatter(message, leftovers, topRow, random) {
  const taken = [...message];
  const pile = [];
  for (const { ch } of leftovers) {
    let spot = null;
    for (let attempt = 0; attempt < 40 && !spot; attempt += 1) {
      const x = randomInt(random, 0, maxX(ch));
      const row = randomInt(random, topRow, ROW_MAX);
      if (!blockerAt(taken, ch, x, row)) spot = { x, row };
    }
    for (let row = ROW_MAX; row >= topRow && !spot; row -= 1) {
      const x = freeXForward(taken, ch, 0, row);
      if (x !== null) spot = { x, row };
    }
    if (!spot) return null;
    const tile = looseTile(ch, spot.x, spot.row, random);
    taken.push(tile);
    pile.push(tile);
  }
  return pile;
}
