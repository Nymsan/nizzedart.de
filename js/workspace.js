// The board in play, and the table it stands on.
//
// The letters of the previous message start out on the board, as it was left.
// From there they can be moved about on the board, taken off it onto the table
// next to it (one by one, or all at once), shuffled or sorted there, and put
// back up in a new order. The keyboard types with them too.
//
// Everything is placed in felt units (see js/board-view.js): the table is the
// rest of the page around the board, measured from the corner of the felt. The
// part of it where letters are laid out is the element `.table-zone`.

import { freeXNearest, messageText, putAside, rowAt } from "./board.js";
import { element, onBoard, paintPiece, pieceElement, watchPresses } from "./board-view.js";
import { Editor, Pool } from "./editor.js";
import { BOARD_H, EDGE, FELT_W, GROOVE, glyphForKey, glyphText, glyphWidth, sortKey } from "./glyphs.js";

/** How the letters are laid out on the table, in felt units from the corner of `.table-zone`. Taken from the design. */
const SORTED = { left: 40, top: 96, width: 572, gap: 17.5, line: 69 };
/** The same, under the board (the phone design): the rows in the middle of the table, the first row this far down. */
const SORTED_UNDER = { top: 130, width: 670, gap: 14.5, line: 65 };
const SCATTER = { x: 321, y: 442, rx: 251, ry: 341, count: 61, room: 62 };
/**
 * Letters moved out of the way: how far apart they lie; how much room they
 * leave above and below a line of the letters put down; how close in height
 * letters are to be on one line; how far they look for room, and in what
 * steps. In felt units.
 */
const ROOM = { gap: 4, clear: 30, sameLine: 20, reach: 900, step: 14 };
/** Under the board, the lines of letters taken off it: where the first goes, and how far apart, in felt units. */
const STRAY_LINES = { top: 80, step: 66 };
const MARGIN = 12;
/** Under the board, how far the edge of the table is from the bottom of the page, in pixels (styles.css: --gutter). */
const TABLE_EDGE_PX = 18;
/** Under the board, how far down from the edge of the table its buttons reach, in felt units. */
const TABLE_TOOLS = 30; // how close to the edge of the page a letter may lie
const UNDO_STEPS = 100;
/** How long the letters take to slide to the original and back (keep in step with styles.css). */
const SWAP_MS = 250;

const plain = ({ ch, x, row, flip, loose }) => ({ ch, x, row, flip, loose });

export class Workspace {
  #stage;
  #felt;
  #layer;
  #zoneNode;
  #onChange;
  #notify;
  #pool = new Pool([]);
  #composer = new Editor(this.#pool);
  #source = [];
  #nodes = new Map();
  #cursor = null;
  #cursorShown = false;
  #showingOriginal = false;
  #drag = null;
  /** The letter the last tap turned, and when: a second tap on it takes the turn back, and the letter off. */
  #tapTurn = null;
  /** Whether the letters on the table lie in rows, as "sorter a-z" laid them. */
  #tableSorted = false;
  /** The table the letters on it were laid out on (felt units), to lay them out again when it changes. */
  #laidZone = null;
  /** Whether letters put up from the table go up upside down ("vend", on a phone). */
  #turning = false;
  #swapping = 0;
  /** What things looked like before each thing done, to undo it, and what was undone, to redo it. */
  #undone = [];
  #redone = [];
  /** What the last thing done was, when typing: a run of typing is undone in one go. */
  #lastKind = null;
  #seed = 1;
  /** Whether anything has been done with the letters since they were put in play. */
  #touched = false;

  constructor({ stage, felt, zone, onChange, notify }) {
    this.#stage = stage;
    this.#felt = felt;
    this.#zoneNode = zone;
    this.#onChange = onChange;
    this.#notify = notify;
    this.#layer = element("div", "pieces");
    felt.append(this.#layer);
    watchPresses(felt, this.#gestures());
  }

  /**
   * Put the letters of `tiles` in play. `draft` is how they were left last
   * time, as `draft` gave it. `seed` makes the leftovers lie the same way
   * every time the same board is put in play.
   */
  setSource(tiles, draft = [], seed = 1) {
    this.#tapTurn = null;
    this.#showingOriginal = false;
    this.#cursorShown = false;
    this.#drag = null;
    this.#seed = seed;
    this.#source = tiles.map(plain);
    this.#pool = new Pool(tiles);
    this.#composer = new Editor(this.#pool, () => this.#render());
    if (draft.length > 0) {
      this.#composer.restore(draft.filter((item) => Number.isFinite(item.x)));
      for (const item of draft) {
        if (Number.isFinite(item.tx) && Number.isFinite(item.ty)) this.#pool.lay(item.src, { x: item.tx, y: item.ty, flip: item.flip });
      }
    } else {
      // As the board was left: its message on the board, its leftovers on the table.
      this.#composer.restore(this.#pool.tiles.filter((tile) => !tile.loose).map((tile) => ({ ...tile, src: tile.id })));
      this.#scatterOnTable(
        this.#pool.tiles.filter((tile) => tile.loose && !tile.used),
        seededRandom(seed),
      );
    }
    this.#tableSorted = false;
    this.#laidZone = this.#zone();
    this.#touched = false;
    this.#undone = [];
    this.#redone = [];
    this.#lastKind = null;
    this.#render({ touched: false });
  }

  get isEmpty() {
    return this.#composer.tiles.length === 0;
  }

  /** Whether the board says what it said when it was put in play, letter for letter. */
  get isAsOriginal() {
    const key = ({ ch, x, row, flip }) => `${ch} ${x} ${row} ${Boolean(flip)}`;
    const now = this.#composer.tiles.map(key).sort();
    const then = this.#source.filter((tile) => !tile.loose).map(key).sort();
    return now.length === then.length && now.every((item, i) => item === then[i]);
  }

  get showingOriginal() {
    return this.#showingOriginal;
  }

  get isTouched() {
    return this.#touched;
  }

  /** How things lie now, in the form `setSource` takes it back. */
  get draft() {
    const board = this.#composer.tiles.map(({ src, x, row, flip }) => ({ src, x, row, flip }));
    const table = this.#pool.leftovers
      .filter((tile) => tile.table)
      .map(({ id, table: at }) => ({ src: id, tx: at.x, ty: at.y, flip: at.flip }));
    return [...board, ...table];
  }

  /** Take every letter off the board, onto the table. */
  removeAll() {
    this.#endOriginal();
    if (this.#composer.tiles.length === 0) {
      this.#notify("Tavlen er allerede tom");
      return;
    }
    this.#record(() => {
      // All of them keep their words, also the letters that came from the table.
      for (const tile of this.#composer.tiles) this.#pool.tile(tile.src).lastTable = null;
      this.#composer.clear();
    });
  }

  /** Throw the letters on the table about in a heap. */
  scatter(random = Math.random) {
    const loose = this.#pool.leftovers;
    if (loose.length === 0) return this.#notify("Der ligger ingen bogstaver på bordet");
    this.#tableSorted = false;
    this.#record(() => {
      this.#scatterOnTable(loose, random);
      this.#render();
    });
  }

  /** Lay the letters on the table out in rows, in the order of the alphabet. */
  sortTable() {
    const loose = this.#pool.leftovers;
    if (loose.length === 0) return this.#notify("Der ligger ingen bogstaver på bordet");
    const places = sortedPlaces(
      loose.map((tile) => tile.ch),
      this.#zone(),
    );
    this.#record(() => {
      loose.forEach((tile, i) => this.#pool.lay(tile.id, places[i]));
      this.#tableSorted = true;
      this.#render();
    });
  }

  /** Whether letters put up from the table go up upside down. */
  get turning() {
    return this.#turning;
  }

  set turning(on) {
    this.#turning = Boolean(on);
  }

  /** A space at the cursor, as the space bar types it: for a screen without a keyboard. */
  space() {
    this.handleKey({ key: " " });
  }

  /** Take back the letter before the cursor, as Backspace does it: for a screen without a keyboard. */
  backspace() {
    this.handleKey({ key: "Backspace" });
  }

  /** The cursor to the start of the next line, as Enter does it: for a screen without a keyboard. */
  newLine() {
    this.handleKey({ key: "Enter" });
  }

  /** Take back the last thing done with the letters. */
  undo() {
    this.#step(this.#undone, this.#redone);
  }

  /** Do again what was last taken back. */
  redo() {
    this.#step(this.#redone, this.#undone);
  }

  /** Show the previous message on the board instead of what is on it now (while "vis original" is held), or go back. */
  showOriginal(show) {
    if (this.#showingOriginal === show) return;
    this.#showingOriginal = show;
    // The letters slide to where they go, and back (styles.css).
    clearTimeout(this.#swapping);
    this.#stage.classList.add("is-swapping");
    this.#swapping = setTimeout(() => this.#stage.classList.remove("is-swapping"), SWAP_MS);
    this.#render({ touched: false });
  }

  /**
   * The tiles of the finished board, or null if nothing is written. The letters
   * that were not used lie loose on the table next to the board.
   */
  result() {
    if (this.isEmpty) return null;
    return [...this.#composer.tiles.map(plain), ...putAside(this.#pool.leftovers)];
  }

  /** Lay everything out again, after the page has changed size. */
  relayout() {
    this.#reorganizeTable();
    this.#render({ touched: false });
  }

  /** Returns true if the key was meant for the board. */
  handleKey(event) {
    // Ctrl+Z and Ctrl+Shift+Z or Ctrl+Y, or Cmd on a Mac. AltGr, which types
    // @ on many keyboards, is reported as Ctrl+Alt, and is not one of them.
    const command = (event.ctrlKey || event.metaKey) && !event.altKey;
    const key = event.key.toLowerCase();
    if (command && key === "z") {
      if (event.shiftKey) this.redo();
      else this.undo();
      return true;
    }
    if (command && key === "y") {
      this.redo();
      return true;
    }
    if (event.metaKey || (event.ctrlKey && !event.altKey)) return false;

    const editor = this.#composer;
    const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const run = (action, kind) => {
      this.#endOriginal();
      this.#cursorShown = true;
      this.#record(action, kind);
      this.#render();
      return true;
    };
    if (steps[event.key]) {
      this.#lastKind = null; // moving the cursor ends a run of typing
      return run(() => editor.moveCursor(...steps[event.key]));
    }
    if (event.key === "Backspace") return run(() => editor.backspace(), "erase");
    if (event.key === "Enter") return run(() => editor.newLine(), "type");
    if (event.key === " ") return run(() => editor.space(), "type");

    const glyph = glyphForEvent(event);
    if (!glyph) return false;
    return run(() => this.#type(glyph.ch, glyph.flip), "type");
  }

  // --- Undo ------------------------------------------------------------------

  /**
   * Do `action`, and remember how things were before it, if it changed where
   * any letter is. Actions of the same `kind` one after another (typing, or
   * erasing) are undone together.
   */
  #record(action, kind = null) {
    const before = this.#snapshot();
    action();
    if (sameLetters(before, this.#snapshot())) return;
    if (!kind || kind !== this.#lastKind) {
      this.#undone.push(before);
      if (this.#undone.length > UNDO_STEPS) this.#undone.shift();
    }
    this.#lastKind = kind;
    this.#redone = [];
  }

  #step(from, to) {
    if (this.#drag || from.length === 0) return;
    this.#endOriginal();
    to.push(this.#snapshot());
    const snapshot = from.pop();
    this.#composer.restoreSnapshot(snapshot.board);
    snapshot.letters.forEach((letter, i) =>
      Object.assign(this.#pool.tiles[i], letter, { table: letter.table && { ...letter.table }, lastTable: letter.lastTable && { ...letter.lastTable } }),
    );
    this.#lastKind = null;
    this.#render();
  }

  /** Where every letter is now, and the cursor. */
  #snapshot() {
    return {
      board: this.#composer.snapshot(),
      letters: this.#pool.tiles.map(({ used, x, row, flip, wasOnBoard, table, lastTable }) => ({
        used,
        x,
        row,
        flip,
        wasOnBoard,
        table: table && { ...table },
        lastTable: lastTable && { ...lastTable },
      })),
    };
  }

  #type(ch, flip) {
    const result = this.#composer.type(ch, flip);
    if (result === "missing") this.#notify(`Der er ikke flere ${glyphText(ch)} på bordet`);
    this.#reportFull(result);
  }

  #reportFull(result) {
    if (result === "full") this.#notify("Der er ikke plads til flere bogstaver på tavlen");
  }

  #endOriginal() {
    this.showOriginal(false);
  }

  // --- The table -------------------------------------------------------------

  /** The part of the table where letters are laid out, in felt units. */
  #zone() {
    const felt = this.#felt.getBoundingClientRect();
    const scale = felt.width > 0 ? FELT_W / felt.width : 1;
    const rect = this.#zoneNode.getBoundingClientRect();
    const zone = {
      x: (rect.left - felt.left) * scale,
      y: (rect.top - felt.top) * scale,
      w: rect.width * scale,
      h: rect.height * scale,
    };
    // Beside the board (on a wide screen) or under it (on a narrow one).
    zone.beside = zone.x >= FELT_W;
    return zone;
  }

  /** The page around the board, as far as letters may lie, in felt units. */
  #bounds() {
    const felt = this.#felt.getBoundingClientRect();
    const scale = felt.width > 0 ? FELT_W / felt.width : 1;
    const page = this.#stage.getBoundingClientRect();
    return {
      left: (page.left - felt.left) * scale + MARGIN,
      top: (page.top - felt.top) * scale + MARGIN,
      right: (page.right - felt.left) * scale - MARGIN,
      bottom: (page.bottom - felt.top) * scale - MARGIN,
    };
  }

  /** Where on the table letters are put, in felt units: the part of the table on the page. */
  #tableArea(zone = this.#zone()) {
    const bounds = this.#bounds();
    return {
      left: Math.max(zone.x, bounds.left),
      // Under the board, clear of the buttons on the edge of the table.
      top: Math.max(zone.y + (zone.beside ? 0 : TABLE_TOOLS), bounds.top),
      right: Math.min(zone.x + zone.w, bounds.right),
      bottom: Math.min(zone.y + zone.h, bounds.bottom),
    };
  }

  /**
   * After the window has changed size, lay the letters on the table out on
   * the table as it is now: in rows again, if they were in rows, or where they
   * lay, stretched to the new table and moved apart where they would be on
   * top of each other. Only when the table is a new width, or has moved
   * beside or under the board: a phone's toolbars coming and going leave it be.
   */
  #reorganizeTable() {
    const zone = this.#zone();
    const was = this.#laidZone;
    this.#laidZone = zone;
    if (!was || (was.beside === zone.beside && Math.abs(was.w - zone.w) < 2)) return;
    const loose = this.#pool.leftovers.filter((tile) => tile.table);
    if (loose.length === 0) return;
    let places;
    if (this.#tableSorted) {
      places = sortedPlaces(
        loose.map((tile) => tile.ch),
        zone,
      );
    } else {
      const sx = zone.w / was.w;
      const sy = was.beside === zone.beside ? 1 : zone.h / was.h;
      places = spreadOut(
        loose.map(({ ch, table }) => ({ ch, x: zone.x + (table.x - was.x) * sx, y: zone.y + (table.y - was.y) * sy })),
        this.#tableArea(zone),
        // Under the board, the page can grow longer to make room.
        { spill: !zone.beside },
      );
    }
    loose.forEach((tile, i) => this.#pool.lay(tile.id, { ...places[i], flip: tile.table.flip }));
  }

  #scatterOnTable(tiles, random) {
    const places = scatteredPlaces(
      tiles.map((tile) => tile.ch),
      this.#zone(),
      random,
    );
    tiles.forEach((tile, i) => this.#pool.lay(tile.id, places[i]));
  }

  /**
   * Letters that have just come off the board go on the table where they were
   * on the board, moved over beside it (or under it), as if the board had been
   * tipped out there. Under the board, where the table is not as tall as the
   * board, the lines close up one under the other. The letters already on the
   * table that they would land on move out of the way.
   */
  #layStrays() {
    const strays = this.#pool.leftovers.filter((tile) => !tile.table);
    if (strays.length === 0) return;
    const zone = this.#zone();
    const random = seededRandom(this.#seed + strays.length);
    const jitter = () => (random() - 0.5) * 3;
    if (zone.beside) {
      const fit = Math.min(1, zone.w / FELT_W, zone.h / BOARD_H);
      for (const tile of strays) {
        const at = onBoard(tile);
        this.#pool.lay(tile.id, { x: zone.x + at.x * fit + jitter(), y: zone.y + at.y * fit + jitter(), flip: tile.flip });
      }
    } else {
      const fit = Math.min(1, zone.w / FELT_W);
      const left = zone.x + (zone.w - FELT_W * fit) / 2;
      const rows = [...new Set(strays.map((tile) => tile.row))].sort((a, b) => a - b);
      for (const tile of strays) {
        const at = onBoard(tile);
        const y = zone.y + STRAY_LINES.top + rows.indexOf(tile.row) * STRAY_LINES.step;
        this.#pool.lay(tile.id, { x: left + at.x * fit + jitter(), y: y + jitter() / 2, flip: tile.flip });
      }
    }

    this.#tableSorted = false;
    const area = this.#tableArea(zone);
    const others = this.#pool.leftovers.filter((tile) => tile.table && !strays.includes(tile));
    const places = madeRoom(
      strays.map((tile) => ({ ch: tile.ch, ...tile.table })),
      others.map((tile) => ({ ch: tile.ch, ...tile.table })),
      area,
      // Under the board, the page can grow longer to make room.
      { spill: !zone.beside },
    );
    others.forEach((tile, i) => this.#pool.lay(tile.id, { ...places[i], flip: tile.table.flip }));
  }

  /** Under the board, the page is made long enough to hold every letter on the table (styles.css: --table-end). */
  #growTable() {
    const zone = this.#zone();
    const lowest = Math.max(...this.#pool.leftovers.filter((tile) => tile.table).map((tile) => tile.table.y));
    if (zone.beside || !Number.isFinite(lowest)) {
      this.#stage.style.removeProperty("--table-end");
      return;
    }
    const felt = this.#felt.getBoundingClientRect();
    const scale = felt.width > 0 ? felt.width / FELT_W : 1;
    // The letter, and the edge of the table under it.
    const end = felt.top - this.#stage.getBoundingClientRect().top + (lowest + 32 + MARGIN) * scale + TABLE_EDGE_PX;
    this.#stage.style.setProperty("--table-end", `${Math.ceil(end)}px`);
  }

  // --- Drawing ---------------------------------------------------------------

  /**
   * Every piece there is now: `{ key, tile, ch, flip, place, kind }`, kind
   * "board" or "table". A letter keeps its key wherever it goes.
   */
  #pieces() {
    if (this.#showingOriginal) return this.#originalPieces();
    const pieces = this.#composer.tiles.map((tile) => ({ key: tile.src, tile, ch: tile.ch, flip: tile.flip, place: onBoard(tile), kind: "board" }));
    for (const tile of this.#pool.leftovers) {
      if (tile.table) pieces.push({ key: tile.id, tile, ch: tile.ch, flip: tile.table.flip, place: tile.table, kind: "table" });
    }
    return pieces;
  }

  /**
   * The pieces as they were when the board was put in play, while "vis
   * original" is held: the message up on the board, and the other letters on
   * the table where they lie, or lay before they were put up on the board. A
   * letter with no such place is "away", and not shown.
   */
  #originalPieces() {
    return this.#pool.tiles.map((tile, i) => {
      const source = this.#source[i];
      if (!source.loose) return { key: tile.id, tile, ch: source.ch, flip: source.flip, place: onBoard(source), kind: "board" };
      const at = tile.used ? tile.lastTable : tile.table;
      return { key: tile.id, tile, ch: tile.ch, flip: Boolean(at?.flip), place: at ?? { x: 0, y: 0 }, kind: at ? "table" : "away" };
    });
  }

  #find(key) {
    return this.#pieces().find((piece) => piece.key === key) ?? null;
  }

  #render({ touched = true } = {}) {
    if (touched) this.#touched = true;
    this.#layStrays();
    this.#growTable();
    const bounds = this.#bounds();
    const seen = new Set();
    for (const piece of this.#pieces()) {
      seen.add(piece.key);
      let node = this.#nodes.get(piece.key);
      if (!node) {
        node = pieceElement(piece.key);
        this.#nodes.set(piece.key, node);
        this.#layer.append(node);
      }
      let place = piece.place;
      if (piece.kind !== "board") {
        // Keep it on the page, whatever size the page is now.
        const w = glyphWidth(piece.ch);
        place = { x: clamp(place.x, bounds.left, bounds.right - w), y: clamp(place.y, bounds.top + 30, bounds.bottom - 30) };
      }
      const dragged = this.#drag?.key === piece.key;
      if (dragged && this.#drag.shown) place = this.#drag.shown;
      paintPiece(node, piece.ch, piece.flip, place);
      node.classList.toggle("on-board", piece.kind === "board");
      node.classList.toggle("on-table", piece.kind === "table");
      node.classList.toggle("is-away", piece.kind === "away");
      node.classList.toggle("is-lifted", dragged);
    }
    for (const [key, node] of this.#nodes) {
      if (seen.has(key)) continue;
      node.remove();
      this.#nodes.delete(key);
    }

    this.#stage.classList.toggle("is-showing-original", this.#showingOriginal);

    this.#drawCursor();
    this.#felt.setAttribute("aria-label", `Tavlen: ${messageText(this.#composer.tiles) || "tom"}`);
    this.#onChange();
  }

  #drawCursor() {
    const show = this.#cursorShown && !this.#showingOriginal;
    if (show && !this.#cursor) {
      this.#cursor = element("div", "cursor");
      this.#layer.before(this.#cursor);
    } else if (!show && this.#cursor) {
      this.#cursor.remove();
      this.#cursor = null;
    }
    if (show) {
      const { x, row } = this.#composer.cursor;
      this.#cursor.style.setProperty("--x", EDGE + x);
      this.#cursor.style.setProperty("--y", row * GROOVE);
    }
  }

  // --- Pointer ---------------------------------------------------------------

  /** A pointer position in felt units, and whether it is over the felt. */
  #pointAt({ clientX, clientY }) {
    const rect = this.#felt.getBoundingClientRect();
    const scale = FELT_W / rect.width;
    const inside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    return { x: (clientX - rect.left) * scale, y: (clientY - rect.top) * scale, inside };
  }

  #gestures() {
    const editor = () => this.#composer;
    return {
      canDrag: () => !this.#showingOriginal,
      // Every tap does its thing at once, so tapping keeps up. A letter on the
      // table goes up at the cursor. A letter on the board turns, and a second
      // tap right after takes the turn back and the letter off the board.
      canDoubleTap: (key) => this.#find(key)?.kind === "board",
      tap: (key) => {
        const piece = this.#find(key);
        if (!piece || this.#showingOriginal) return;
        if (piece.kind === "table") {
          // As if typed, and the cursor shows where the next one goes.
          this.#cursorShown = true;
          this.#record(() => this.#reportFull(editor().place(this.#pool.piece(key), piece.flip !== this.#turning)));
          return;
        }
        this.#record(() => editor().flip(piece.tile.id));
        this.#tapTurn = { key, step: this.#undone.length };
      },
      doubleTap: (key) => {
        if (this.#showingOriginal || this.#find(key)?.kind !== "board") return;
        if (this.#tapTurn?.key === key && this.#tapTurn.step === this.#undone.length) this.undo();
        this.#tapTurn = null;
        const piece = this.#find(key);
        if (piece?.kind === "board") this.#record(() => editor().remove(piece.tile.id));
      },
      boardTap: (event) => {
        if (this.#showingOriginal) return;
        const point = this.#pointAt(event);
        this.#cursorShown = true;
        this.#lastKind = null; // moving the cursor ends a run of typing
        editor().setCursor(point.x - EDGE, rowAt(point.y));
      },
      drag: (key, event, start) => {
        // Moving a letter about changes nothing until it is let go.
        const piece = this.#find(key);
        if (!piece) return;
        if (this.#drag?.key !== key) {
          // Hold the letter where it was taken hold of.
          const grab = this.#pointAt(start);
          this.#drag = { key, grab: { x: grab.x - piece.place.x, y: grab.y - piece.place.y } };
        }
        const point = this.#pointAt(event);
        const free = { x: point.x - this.#drag.grab.x, y: point.y - this.#drag.grab.y };
        this.#drag.target = { onBoard: false, ...free };
        this.#drag.shown = free;
        if (point.inside && !this.#showingOriginal) {
          // Over the board, it drops into the groove it would go in.
          const row = rowAt(free.y);
          const others = editor().tiles.filter((tile) => tile !== piece.tile);
          const x = freeXNearest(others, piece.ch, free.x - EDGE, row);
          if (x !== null) {
            this.#drag.target = { onBoard: true, x, row };
            this.#drag.shown = onBoard({ x, row });
          }
        }
        this.#render({ touched: false });
      },
      drop: (key) => {
        const drag = this.#drag;
        this.#drag = null;
        const piece = this.#find(key);
        if (!drag?.target || !piece) {
          this.#render({ touched: false });
          return;
        }
        this.#endOriginal();
        const { target } = drag;
        if (!target.onBoard) this.#tableSorted = false;
        const node = this.#nodes.get(key);
        // What was moved last lies on top.
        node?.parentNode?.append(node);
        this.#record(() => {
          if (piece.kind === "board" && target.onBoard) {
            editor().moveTo(piece.tile.id, target.x, target.row);
          } else if (piece.kind === "board") {
            // Off the board: onto the table, where it was let go.
            editor().remove(piece.tile.id);
            this.#pool.lay(piece.tile.src, { x: target.x, y: target.y, flip: piece.flip });
          } else if (target.onBoard) {
            this.#reportFull(this.#composer.drop(this.#pool.piece(key), target.x, target.row, piece.flip));
          } else {
            this.#pool.lay(key, { x: target.x, y: target.y, flip: piece.flip });
          }
          this.#render();
        });
      },
      cancel: () => {
        this.#drag = null;
        this.#render({ touched: false });
      },
    };
  }
}

/** Whether two snapshots have every letter in the same place, whatever the cursor. */
function sameLetters(a, b) {
  return JSON.stringify([a.board.tiles, a.letters]) === JSON.stringify([b.board.tiles, b.letters]);
}

/** Where letters `chars` go when laid out in rows by "sorter a-z", in the order they are given in. */
export function sortedPlaces(chars, zone) {
  const order = chars.map((_, i) => i).sort((a, b) => sortKey(chars[a]) - sortKey(chars[b]) || a - b);
  const width = Math.max(200, Math.min(zone.beside ? SORTED.width : SORTED_UNDER.width, zone.w - 2 * SORTED.left));
  const left = zone.beside ? zone.x + SORTED.left : zone.x + (zone.w - width) / 2;
  const line = zone.beside ? SORTED.line : SORTED_UNDER.line;
  const gap = zone.beside ? SORTED.gap : SORTED_UNDER.gap;
  let x = left;
  let y = zone.y + (zone.beside ? SORTED.top : SORTED_UNDER.top);
  const places = [];
  for (const i of order) {
    const w = glyphWidth(chars[i]);
    if (x > left && x + w > left + width) {
      x = left;
      y += line;
    }
    places[i] = { x, y, flip: false };
    x += w + gap;
  }
  return places;
}

/** Where letters `chars` go when thrown about in a heap: the right way up, and not on top of each other. */
export function scatteredPlaces(chars, zone, random = Math.random) {
  const spread = Math.sqrt(Math.max(chars.length, 1) / SCATTER.count);
  // Beside the board, a heap the size of the design's; under it, as much of the table as there is.
  const rx = Math.max(60, Math.min(zone.beside ? SCATTER.rx * spread : Infinity, zone.w / 2 - 40));
  const ry = Math.max(60, Math.min(zone.beside ? SCATTER.ry * spread : Infinity, zone.h / 2 - 50));
  const cx = zone.x + (zone.beside ? Math.min(SCATTER.x, zone.w / 2) : zone.w / 2);
  const cy = zone.y + (zone.beside ? Math.min(SCATTER.y, zone.h / 2) : zone.h / 2);
  const middles = [];
  return chars.map((ch) => {
    let best = null;
    let bestRoom = -1;
    for (let attempt = 0; attempt < 40 && bestRoom < SCATTER.room; attempt += 1) {
      const angle = random() * 2 * Math.PI;
      const reach = Math.sqrt(random());
      const at = { x: cx + Math.cos(angle) * reach * rx, y: cy + Math.sin(angle) * reach * ry };
      const room = Math.min(Infinity, ...middles.map((m) => Math.hypot(m.x - at.x, m.y - at.y)));
      if (room > bestRoom) {
        best = at;
        bestRoom = room;
      }
    }
    middles.push(best);
    return { x: best.x - glyphWidth(ch) / 2, y: best.y, flip: false };
  });
}

/**
 * Where the letters `others` on the table go when the letters `fixed` are put
 * down among them: each one that `fixed` would cover moves to the nearest
 * place in `area` where it covers no other letter. The rest stay where they
 * are, also on top of each other. Places are `{ ch, x, y }`, x at the left
 * edge and y in the middle, in felt units; `area` is how far the letters may
 * go, as { left, top, right, bottom }. With `spill`, a letter that finds no
 * room there may go further down.
 */
export function madeRoom(fixed, others, area, { spill = false } = {}) {
  const box = letterBox;
  // Each line of the letters put down is kept clear, all the way across, with room above and below.
  const lines = [];
  for (const letter of [...fixed].sort((a, b) => a.y - b.y)) {
    const line = lines.at(-1);
    if (line && letter.y - line.y < ROOM.sameLine) line.letters.push(letter);
    else lines.push({ y: letter.y, letters: [letter] });
  }
  const covered = lines.map(({ letters }) => {
    const boxes = letters.map(box);
    return {
      left: -Infinity,
      right: Infinity,
      top: Math.min(...boxes.map((b) => b.top)) - ROOM.clear,
      bottom: Math.max(...boxes.map((b) => b.bottom)) + ROOM.clear,
    };
  });
  const places = others.map(({ ch, x, y }) => ({ ch, x, y }));
  const moving = places.filter((place) => !isFree(place, covered));
  const staying = places.filter((place) => !moving.includes(place));
  const taken = [...covered, ...staying.map(box)];
  for (const place of moving) {
    let found = nearestFree(place, taken, area);
    if (!found && spill) found = nearestFree({ ...place, y: Math.max(place.y, area.bottom - 30) }, taken, { ...area, bottom: Infinity }, ROOM.reach * 3);
    // No room anywhere: it stays where it is, under the letters put down.
    if (found) Object.assign(place, { x: found.x, y: found.y });
    taken.push(box(place));
  }
  return places.map(({ x, y }) => ({ x, y }));
}

/**
 * The letters `places` (`{ ch, x, y }`), moved into `area` and apart: one
 * that lies on another one before it goes to the nearest free place. With
 * `spill`, one that finds no room may go further down. For the table after
 * the window has changed size.
 */
export function spreadOut(places, area, { spill = false } = {}) {
  const taken = [];
  return places.map(({ ch, x, y }) => {
    const w = glyphWidth(ch);
    const at = { ch, x: clamp(x, area.left, area.right - w), y: clamp(y, area.top + 30, area.bottom - 30) };
    let found = isFree(at, taken) ? at : nearestFree(at, taken, area);
    if (!found && spill) found = nearestFree({ ...at, y: area.bottom - 30 }, taken, { ...area, bottom: Infinity }, ROOM.reach * 3);
    found ??= at;
    taken.push(letterBox(found));
    return { x: found.x, y: found.y };
  });
}

/** The room a letter on the table takes, with a little to spare around it. */
const letterBox = ({ ch, x, y }) => ({ left: x - ROOM.gap, right: x + glyphWidth(ch) + ROOM.gap, top: y - 30, bottom: y + 30 });

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Whether a letter at `place` is clear of all the room `taken`. */
const isFree = (place, taken) => {
  const at = letterBox(place);
  return !taken.some((other) => overlaps(at, other));
};

/** The nearest place to `place`, inside `area`, that is clear of `taken`; or null. */
function nearestFree(place, taken, area, reach = ROOM.reach) {
  const w = glyphWidth(place.ch);
  if (Number.isFinite(area.bottom)) reach = Math.min(reach, Math.hypot(area.right - area.left, area.bottom - area.top));
  const fits = ({ x, y }) => x >= area.left && x + w <= area.right && y - 30 >= area.top && y + 30 <= area.bottom;
  for (let r = ROOM.step; r <= reach; r += ROOM.step) {
    const count = Math.max(8, Math.ceil((2 * Math.PI * r) / ROOM.step));
    for (let k = 0; k < count; k += 1) {
      const angle = (2 * Math.PI * k) / count;
      const at = { ch: place.ch, x: place.x + r * Math.cos(angle), y: place.y + r * Math.sin(angle) };
      if (fits(at) && isFree(at, taken)) return at;
    }
  }
  return null;
}

/** A deterministic stand-in for Math.random, so a board's leftovers lie the same way every time. */
export function seededRandom(seed) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

/** The letter a key press asks for. Shift turns a letter or a digit upside down. */
function glyphForEvent(event) {
  const typed = glyphForKey(event.key);
  if (typed) return { ch: typed.ch, flip: typed.flip !== (event.shiftKey && /^\p{L}$/u.test(event.key)) };
  // Shift turns a digit key into a symbol, so read the digit off the key itself.
  const digit = event.shiftKey ? /^Digit(\d)$/.exec(event.code) : null;
  return digit ? { ch: digit[1], flip: true } : null;
}
