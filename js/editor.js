// Editing a board: a cursor to type at, and letters that come from a supply.
//
// A supply answers `find(ch)` with a piece `{ ch, src, flip }` or null, and is
// told when a piece is taken or put back.

import {
  clamp,
  clampRow,
  freeXNearest,
  homeCursor,
  nextLine,
  tileRight,
  typingSlot,
} from "./board.js";
import { BOARD_W, LINE_STEP, WORD_GAP, gapAfter } from "./glyphs.js";

/**
 * The letters of the previous message. Each is either on the board ("used",
 * as a tile of the editor) or lying on the table next to it, at `table`:
 * `{ x, y, flip }` in felt units, x its left edge and y its middle. A letter
 * that has just come off the board goes back where it lay on the table, if it
 * came from there; if not, it has no place on the table yet (null), and the
 * workspace finds it one. `x`, `row` and `flip` are where it was last on the
 * board (`wasOnBoard`).
 */
export class Pool {
  constructor(tiles) {
    this.tiles = tiles.map(({ ch, x, row, flip, loose }, i) => ({
      ch,
      x,
      row,
      flip,
      loose,
      id: `s${i}`,
      used: false,
      table: null,
      lastTable: null,
      wasOnBoard: !loose,
    }));
  }

  tile(id) {
    return this.#tile(id) ?? null;
  }

  find(ch) {
    const tile = this.#firstUnused(ch);
    return tile ? { ch, src: tile.id, flip: false } : null;
  }

  /** The piece for one particular letter, or null if it is on the board. */
  piece(id) {
    const tile = this.#tile(id);
    return tile && !tile.used ? { ch: tile.ch, src: id, flip: false } : null;
  }

  take(piece) {
    const tile = this.#tile(piece.src);
    Object.assign(tile, { used: true, lastTable: tile.table, table: null });
  }

  /** The letter comes off the board. `from` is the tile it was there, `{ x, row, flip }`. */
  putBack(src, from = null) {
    const tile = this.#tile(src);
    tile.used = false;
    tile.table = tile.lastTable && { ...tile.lastTable };
    if (from) Object.assign(tile, { x: from.x, row: from.row, flip: Boolean(from.flip), wasOnBoard: true });
  }

  /** Lay a letter that is not on the board somewhere on the table. */
  lay(id, place) {
    const tile = this.#tile(id);
    if (tile && !tile.used) tile.table = { x: place.x, y: place.y, flip: Boolean(place.flip) };
  }

  /** The letters on the table, or about to be. */
  get leftovers() {
    return this.tiles.filter((tile) => !tile.used);
  }

  #tile(id) {
    return this.tiles.find((tile) => tile.id === id);
  }

  /** Letters are taken from the table in reading order of where they lie. */
  #firstUnused(ch) {
    const at = (tile) => tile.table ?? { x: tile.x, y: tile.row * 20 };
    return this.tiles
      .filter((tile) => !tile.used && tile.ch === ch)
      .sort((a, b) => at(a).y - at(b).y || at(a).x - at(b).x)[0];
  }
}

const CURSOR_STEP = 18;

export class Editor {
  tiles = [];
  cursor = homeCursor();
  #supply;
  #onChange;
  #nextId = 0;
  /** What was typed since the cursor was last moved by hand, so Backspace can undo it. */
  #typed = [];

  constructor(supply, onChange = () => {}) {
    this.#supply = supply;
    this.#onChange = onChange;
  }

  tile(id) {
    return this.tiles.find((tile) => tile.id === id);
  }

  /** Put back pieces `[{ src, x, row, flip }]` taken from the supply earlier. Stale ones, and ones not on the board, are skipped. */
  restore(items) {
    for (const { src, x, row, flip } of items) {
      const piece = this.#supply.piece?.(src);
      if (!piece || !Number.isFinite(x) || !Number.isFinite(row)) continue;
      const free = freeXNearest(this.tiles, piece.ch, x, clampRow(row));
      if (free !== null) this.#add(piece, { x: free, row: clampRow(row) }, Boolean(flip));
    }
    this.#onChange();
  }

  /** Type a letter at the cursor. Returns "ok", "missing" (none left) or "full" (no room). */
  type(ch, flip = false) {
    const piece = this.#supply.find(ch);
    if (!piece) return "missing";
    return this.place(piece, flip !== piece.flip);
  }

  /** Put a piece at the cursor, as if it had been typed. */
  place(piece, flip = false) {
    const result = this.#placeAtCursor(piece, flip);
    if (result === "ok") this.#onChange();
    return result;
  }

  #placeAtCursor(piece, flip) {
    const slot = typingSlot(this.tiles, piece.ch, this.cursor);
    if (!slot) return "full";
    const tile = this.#add(piece, slot, flip);
    this.#typed.push({ cursor: this.cursor, tileId: tile.id });
    this.cursor = { x: tileRight(tile) + gapAfter(tile.ch), row: tile.row };
    return "ok";
  }

  /** Put a piece as close to (x, row) as it fits. */
  drop(piece, x, row, flip = false) {
    const free = freeXNearest(this.tiles, piece.ch, x, clampRow(row));
    if (free === null) return "full";
    this.#add(piece, { x: free, row: clampRow(row) }, flip);
    this.#typed = [];
    this.#onChange();
    return "ok";
  }

  space() {
    this.#typed.push({ cursor: this.cursor, tileId: null });
    this.cursor = { x: Math.min(this.cursor.x + WORD_GAP, BOARD_W), row: this.cursor.row };
    this.#onChange();
  }

  newLine() {
    this.#typed.push({ cursor: this.cursor, tileId: null });
    this.cursor = nextLine(this.cursor.row);
    this.#onChange();
  }

  /** Undo the last thing typed. With nothing to undo, take away the letter before the cursor. */
  backspace() {
    const last = this.#typed.pop();
    if (last) {
      if (last.tileId) this.#discard(last.tileId);
      this.cursor = last.cursor;
    } else {
      const { x, row } = this.cursor;
      const onLine = (tile) => Math.abs(tile.row - row) < LINE_STEP;
      const before =
        this.tiles.filter((tile) => onLine(tile) && tileRight(tile) <= x + 1).sort((a, b) => b.x - a.x)[0] ??
        this.tiles.filter((tile) => tile.row < row && !onLine(tile)).sort((a, b) => b.row - a.row || b.x - a.x)[0];
      if (!before) return;
      this.#discard(before.id);
      this.cursor = { x: before.x, row: before.row };
    }
    this.#onChange();
  }

  moveCursor(columns, lines) {
    this.setCursor(this.cursor.x + columns * CURSOR_STEP, this.cursor.row + lines * LINE_STEP);
  }

  setCursor(x, row) {
    this.cursor = { x: clamp(Math.round(x), 0, BOARD_W - CURSOR_STEP), row: clampRow(row) };
    this.#typed = [];
    this.#onChange();
  }

  cursorAfter(id) {
    const tile = this.tile(id);
    if (tile) this.setCursor(tileRight(tile) + gapAfter(tile.ch), tile.row);
  }

  /** Move a tile as close to (x, row) as it fits. It stays put if the row has no room. */
  moveTo(id, x, row) {
    const tile = this.tile(id);
    const free = tile && freeXNearest(this.tiles, tile.ch, x, clampRow(row), id);
    if (free === null || free === undefined) return;
    Object.assign(tile, { x: free, row: clampRow(row), loose: false });
    this.#typed = [];
    this.#onChange();
  }

  flip(id) {
    const tile = this.tile(id);
    if (!tile) return;
    tile.flip = !tile.flip;
    this.#onChange();
  }

  remove(id) {
    this.#discard(id);
    this.#typed = [];
    this.#onChange();
  }

  /** Take away the tile that was made from supply piece `src`. */
  removeBySource(src) {
    const tile = this.tiles.find((candidate) => candidate.src === src);
    if (tile) this.remove(tile.id);
  }

  /** Everything about the board, to have it back with `restoreSnapshot` (for undo). */
  snapshot() {
    return { tiles: this.tiles.map((tile) => ({ ...tile })), cursor: { ...this.cursor }, typed: [...this.#typed] };
  }

  /** Put the board back as `snapshot` had it. The supply is put back by its owner. */
  restoreSnapshot({ tiles, cursor, typed }) {
    this.tiles = tiles.map((tile) => ({ ...tile }));
    this.cursor = { ...cursor };
    this.#typed = [...typed];
  }

  clear() {
    for (const tile of [...this.tiles]) this.#discard(tile.id);
    this.cursor = homeCursor();
    this.#typed = [];
    this.#onChange();
  }

  #add(piece, { x, row }, flip) {
    this.#supply.take(piece);
    const tile = { id: this.#newId(), src: piece.src, ch: piece.ch, x, row, flip, loose: false };
    this.tiles.push(tile);
    return tile;
  }

  #discard(id) {
    const index = this.tiles.findIndex((tile) => tile.id === id);
    if (index < 0) return;
    const [tile] = this.tiles.splice(index, 1);
    if (tile.src !== null) this.#supply.putBack(tile.src, tile);
  }

  #newId() {
    this.#nextId += 1;
    return `t${this.#nextId}`;
  }
}
