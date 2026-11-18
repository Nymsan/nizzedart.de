// Editing a board: a cursor to type at, and letters that come from a supply.
//
// A supply answers `find(ch)` with a piece `{ ch, src, flip }` or null, and is
// told when a piece is taken or put back. `flip` is set when the piece is a
// stand-in that has to be turned upside down to read as `ch`.

import {
  blockerAt,
  bottomRun,
  clamp,
  clampRow,
  freeXNearest,
  homeCursor,
  nextLine,
  tileRight,
  typingSlot,
} from "./board.js";
import { BOARD_W, LINE_STEP, STAND_IN, WORD_GAP, gapAfter } from "./glyphs.js";

/**
 * The letters of the previous message: each can be used once. They can be
 * moved about on their own board too, which changes nothing but where they lie.
 */
export class Pool {
  constructor(tiles) {
    this.tiles = tiles.map((tile, i) => ({ ...tile, id: `s${i}`, used: false }));
  }

  tile(id) {
    return this.#tile(id) ?? null;
  }

  /** Move an unused letter as close to (x, row) on its board as it fits. It stays put if the row has no room. */
  moveTo(id, x, row) {
    const tile = this.#tile(id);
    if (!tile || tile.used) return;
    const free = freeXNearest(this.#onBoard(), tile.ch, x, clampRow(row), id);
    if (free !== null) Object.assign(tile, { x: free, row: clampRow(row), loose: false });
  }

  /** Put a letter back exactly where it was, `{ x, row, loose }`, as at the start of a drag. */
  setPlace(id, { x, row, loose }) {
    const tile = this.#tile(id);
    if (tile) Object.assign(tile, { x, row, loose });
  }

  find(ch) {
    const exact = this.#firstUnused(ch);
    if (exact) return { ch, src: exact.id, flip: false };
    const standIn = STAND_IN[ch] && this.#firstUnused(STAND_IN[ch]);
    return standIn ? { ch: standIn.ch, src: standIn.id, flip: true } : null;
  }

  /** The piece for one particular tile, or null if it is already used. */
  piece(id) {
    const tile = this.#tile(id);
    return tile && !tile.used ? { ch: tile.ch, src: id, flip: false } : null;
  }

  take(piece) {
    this.#tile(piece.src).used = true;
  }

  /**
   * The letter comes back to its board, where it was. If another letter has
   * been moved there in the meantime, it goes to the nearest free place on its
   * line, or on the table if the line is full.
   */
  putBack(src) {
    const tile = this.#tile(src);
    tile.used = false;
    if (tile.loose || !blockerAt(this.#onBoard(), tile.ch, tile.x, tile.row, tile.id)) return;
    const free = freeXNearest(this.#onBoard(), tile.ch, tile.x, tile.row, tile.id);
    if (free === null) tile.loose = true;
    else tile.x = free;
  }

  get leftovers() {
    return this.tiles.filter((tile) => !tile.used);
  }

  #tile(id) {
    return this.tiles.find((tile) => tile.id === id);
  }

  /** The letters that are to be seen on the board: not used, and not lying on the table. */
  #onBoard() {
    return this.tiles.filter((tile) => !tile.used && !tile.loose);
  }

  #firstUnused(ch) {
    return this.tiles
      .filter((tile) => !tile.used && tile.ch === ch)
      .sort((a, b) => a.row - b.row || a.x - b.x)[0];
  }
}

/** A supply that never runs out, for writing a board from scratch. */
export const ENDLESS = {
  find: (ch) => ({ ch, src: null, flip: false }),
  take() {},
  putBack() {},
};

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

  /** Start from existing tiles that do not come from the supply. */
  load(tiles) {
    this.tiles = tiles.map((tile) => ({ ...tile, id: this.#newId(), src: null }));
    this.cursor = typingSlot(this.tiles, "A", homeCursor()) ?? homeCursor();
    this.#typed = [];
    this.#onChange();
  }

  /** Put back pieces `[{ src, x, row, flip }]` taken from the supply earlier. Stale ones are skipped. */
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

  /** Put pieces at the cursor one after the other, the right way up. Stops when the board is full. */
  placeAll(pieces) {
    let result = "ok";
    for (const piece of pieces) {
      result = this.#placeAtCursor(piece, false);
      if (result !== "ok") break;
    }
    this.#onChange();
    return result;
  }

  /**
   * Put pieces at the bottom of the board, the right way up, on as few lines as
   * they fit on. The cursor stays where it is. Where there is no room at the
   * bottom, they go at the cursor instead.
   */
  placeAtBottom(pieces) {
    const slots = bottomRun(this.tiles, pieces.map((piece) => piece.ch));
    if (!slots) return this.placeAll(pieces);
    pieces.forEach((piece, i) => this.#add(piece, slots[i], false));
    this.#onChange();
    return "ok";
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
    if (tile.src !== null) this.#supply.putBack(tile.src);
  }

  #newId() {
    this.#nextId += 1;
    return `t${this.#nextId}`;
  }
}
