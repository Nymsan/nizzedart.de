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
import { DOUBLE_TAP_MS, element, onBoard, paintPiece, pieceElement, watchPresses } from "./board-view.js";
import { Editor, Pool } from "./editor.js";
import { BOARD_H, EDGE, FELT_W, GROOVE, glyphForKey, glyphText, glyphWidth, sortKey } from "./glyphs.js";

/** How the letters are laid out on the table, in felt units from the corner of `.table-zone`. Taken from the design. */
const SORTED = { left: 40, top: 96, topNarrow: 50, width: 572, gap: 17.5, line: 69 };
const SCATTER = { x: 321, y: 442, rx: 251, ry: 341, count: 61, room: 62 };
const MARGIN = 12; // how close to the edge of the page a letter may lie

const plain = ({ ch, x, row, flip, loose }) => ({ ch, x, row, flip, loose });

export class Workspace {
  #stage;
  #felt;
  #layer;
  #original;
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
  #pendingTap = 0;
  #seed = 1;
  /** Whether anything has been done with the letters since they were put in play. */
  #touched = false;

  constructor({ stage, felt, zone, onChange, notify }) {
    this.#stage = stage;
    this.#felt = felt;
    this.#zoneNode = zone;
    this.#onChange = onChange;
    this.#notify = notify;
    this.#original = element("div", "original");
    this.#layer = element("div", "pieces");
    felt.append(this.#original, this.#layer);
    watchPresses(felt, this.#gestures());
  }

  /**
   * Put the letters of `tiles` in play. `draft` is how they were left last
   * time, as `draft` gave it. `seed` makes the leftovers lie the same way
   * every time the same board is put in play.
   */
  setSource(tiles, draft = [], seed = 1) {
    clearTimeout(this.#pendingTap);
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
    this.#touched = false;
    this.#render({ touched: false });
  }

  get isEmpty() {
    return this.#composer.tiles.length === 0;
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
    this.#composer.clear();
  }

  /** Throw the letters on the table about in a heap. */
  scatter(random = Math.random) {
    const loose = this.#pool.leftovers;
    if (loose.length === 0) return this.#notify("Der ligger ingen bogstaver på bordet");
    this.#scatterOnTable(loose, random);
    this.#render();
  }

  /** Lay the letters on the table out in rows, in the order of the alphabet. */
  sortTable() {
    const loose = this.#pool.leftovers;
    if (loose.length === 0) return this.#notify("Der ligger ingen bogstaver på bordet");
    const places = sortedPlaces(
      loose.map((tile) => tile.ch),
      this.#zone(),
    );
    loose.forEach((tile, i) => this.#pool.lay(tile.id, places[i]));
    this.#render();
  }

  /** Show the previous message on the board instead of what is on it now, or go back. */
  toggleOriginal(show = !this.#showingOriginal) {
    this.#showingOriginal = show;
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
    this.#render({ touched: false });
  }

  /** Returns true if the key was meant for the board. */
  handleKey(event) {
    // AltGr, which types @ on many keyboards, is reported as Ctrl+Alt.
    if (event.metaKey || (event.ctrlKey && !event.altKey)) return false;

    const editor = this.#composer;
    const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const run = (action) => {
      this.#endOriginal();
      this.#cursorShown = true;
      action();
      this.#render();
      return true;
    };
    if (steps[event.key]) return run(() => editor.moveCursor(...steps[event.key]));
    if (event.key === "Backspace") return run(() => editor.backspace());
    if (event.key === "Enter") return run(() => editor.newLine());
    if (event.key === " ") return run(() => editor.space());

    const glyph = glyphForEvent(event);
    if (!glyph) return false;
    return run(() => this.#type(glyph.ch, glyph.flip));
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
    if (this.#showingOriginal) this.toggleOriginal(false);
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
   * tipped out there.
   */
  #layStrays() {
    const strays = this.#pool.leftovers.filter((tile) => !tile.table);
    if (strays.length === 0) return;
    const zone = this.#zone();
    const fit = Math.min(1, zone.w / FELT_W, zone.h / BOARD_H);
    const random = seededRandom(this.#seed + strays.length);
    const jitter = () => (random() - 0.5) * 8;
    for (const tile of strays) {
      const at = onBoard(tile);
      this.#pool.lay(tile.id, { x: zone.x + at.x * fit + jitter(), y: zone.y + at.y * fit + jitter(), flip: tile.flip });
    }
  }

  // --- Drawing ---------------------------------------------------------------

  /**
   * Every piece there is now: `{ key, tile, ch, flip, place, kind }`, kind
   * "board" or "table". A letter keeps its key wherever it goes.
   */
  #pieces() {
    const pieces = this.#composer.tiles.map((tile) => ({ key: tile.src, tile, ch: tile.ch, flip: tile.flip, place: onBoard(tile), kind: "board" }));
    for (const tile of this.#pool.leftovers) {
      if (tile.table) pieces.push({ key: tile.id, tile, ch: tile.ch, flip: tile.table.flip, place: tile.table, kind: "table" });
    }
    return pieces;
  }

  #find(key) {
    return this.#pieces().find((piece) => piece.key === key) ?? null;
  }

  #render({ touched = true } = {}) {
    if (touched) this.#touched = true;
    this.#layStrays();
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
      node.classList.toggle("is-lifted", dragged);
    }
    for (const [key, node] of this.#nodes) {
      if (seen.has(key)) continue;
      node.remove();
      this.#nodes.delete(key);
    }

    this.#stage.classList.toggle("is-showing-original", this.#showingOriginal);
    this.#original.replaceChildren(
      ...(this.#showingOriginal ? this.#source.filter((tile) => !tile.loose) : []).map((tile) => {
        const node = pieceElement();
        paintPiece(node, tile.ch, tile.flip, onBoard(tile));
        return node;
      }),
    );

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
      canDrag: (key) => !(this.#showingOriginal && this.#find(key)?.kind === "board"),
      tap: (key) => {
        const piece = this.#find(key);
        if (!piece || (piece.kind === "board" && this.#showingOriginal)) return;
        // Wait a moment: a second tap turns the letter instead. Then a letter
        // on the board goes onto the table, and one on the table up at the cursor.
        clearTimeout(this.#pendingTap);
        this.#pendingTap = setTimeout(() => {
          const now = this.#find(key);
          if (!now || now.kind !== piece.kind) return;
          if (now.kind === "board") editor().remove(now.tile.id);
          else this.#reportFull(this.#composer.place(this.#pool.piece(key), now.flip));
        }, DOUBLE_TAP_MS);
      },
      doubleTap: (key) => {
        clearTimeout(this.#pendingTap);
        const piece = this.#find(key);
        if (!piece || (piece.kind === "board" && this.#showingOriginal)) return;
        if (piece.kind === "board") editor().flip(piece.tile.id);
        if (piece.kind === "table") {
          this.#pool.lay(key, { ...piece.tile.table, flip: !piece.flip });
          this.#render();
        }
      },
      boardTap: (event) => {
        if (this.#showingOriginal) return;
        const point = this.#pointAt(event);
        this.#cursorShown = true;
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
        const node = this.#nodes.get(key);
        // What was moved last lies on top.
        node?.parentNode?.append(node);
        if (piece.kind === "board") {
          if (target.onBoard) {
            editor().moveTo(piece.tile.id, target.x, target.row);
          } else {
            // Off the board: onto the table, where it was let go.
            editor().remove(piece.tile.id);
            this.#pool.lay(piece.tile.src, { x: target.x, y: target.y, flip: piece.flip });
          }
          this.#render();
        } else if (target.onBoard) {
          this.#reportFull(this.#composer.drop(this.#pool.piece(key), target.x, target.row, piece.flip));
          this.#render();
        } else {
          this.#pool.lay(key, { x: target.x, y: target.y, flip: piece.flip });
          this.#render();
        }
      },
      cancel: () => {
        this.#drag = null;
        this.#render({ touched: false });
      },
    };
  }
}

/** Where letters `chars` go when laid out in rows by "sorter a-z", in the order they are given in. */
export function sortedPlaces(chars, zone) {
  const order = chars.map((_, i) => i).sort((a, b) => sortKey(chars[a]) - sortKey(chars[b]) || a - b);
  const left = zone.x + SORTED.left;
  const width = Math.max(200, Math.min(SORTED.width, zone.w - 2 * SORTED.left));
  let x = left;
  let y = zone.y + (zone.beside ? SORTED.top : SORTED.topNarrow);
  const places = [];
  for (const i of order) {
    const w = glyphWidth(chars[i]);
    if (x > left && x + w > left + width) {
      x = left;
      y += SORTED.line;
    }
    places[i] = { x, y, flip: false };
    x += w + SORTED.gap;
  }
  return places;
}

/** Where letters `chars` go when thrown about in a heap: the right way up, and not on top of each other. */
export function scatteredPlaces(chars, zone, random = Math.random) {
  const spread = Math.sqrt(Math.max(chars.length, 1) / SCATTER.count);
  const rx = Math.max(60, Math.min(SCATTER.rx * spread, zone.w / 2 - 40));
  const ry = Math.max(60, Math.min(SCATTER.ry * spread, zone.h / 2 - 50));
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
