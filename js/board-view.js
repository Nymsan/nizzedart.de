// Draws a board into the page and reports what the pointer does to its letters.
// Letters on the board hang in its grooves; loose letters lie on the table in
// front of it, outside the frame.
//
// The view knows nothing about the rules of the board: it renders the tiles it
// is given and turns presses into taps, double taps and drags. All sizes are
// set in board units through CSS variables, so the same markup works for the
// big boards and for the small previews.

import { BOARD_H, BOARD_W, glyphText, glyphWidth } from "./glyphs.js";

/** The strip of felt on either side of a board that letters are not put on (see .board-field). */
const EDGE = 20;

/** The table, in board units: margins, space between letters and rows, and how high a row arches. */
const TABLE = { side: 28, gap: 12, top: 44, line: 62, rise: 16 };

const TAP_SLOP = 5; // pixels a press may wander and still count as a tap
export const DOUBLE_TAP_MS = 350;

export class BoardView {
  #field;
  #table;
  #nodes = new Map();
  #cursor = null;
  #width;

  /**
   * @param {HTMLElement} root
   * @param {object} [gestures] Callbacks `tap(id)`, `doubleTap(id)`, `boardTap(event)`,
   *   `canDrag(id, event)`, `drag(id, event, dx, dy)`, `drop(id, event)` and `cancel(id)`.
   *   Without them the board is a static picture.
   * @param {object} [frame] `width` and `height` in board units, to show just the top left of a board.
   */
  constructor(root, gestures = null, { width = BOARD_W, height = BOARD_H } = {}) {
    this.root = root;
    this.#width = width;
    root.classList.add("board-view");
    if (width !== BOARD_W || height !== BOARD_H) {
      root.style.setProperty("--frame-w", width);
      root.style.setProperty("--face-ratio", `${width + 2 * EDGE} / ${height}`);
    }
    const frame = element("div", "board");
    const face = element("div", "board-face");
    this.#field = element("div", "board-field");
    this.#table = element("div", "board-table");
    face.append(this.#field);
    frame.append(face);
    root.replaceChildren(frame, this.#table);
    if (gestures) {
      watchGestures(this.#field, gestures);
      watchGestures(this.#table, gestures);
    }
  }

  /** Tiles are matched to their elements by `id`, so a letter keeps its element while it moves. */
  render(tiles, { cursor = null, label = null } = {}) {
    const seen = new Set();
    const onTable = [];
    tiles.forEach((tile, index) => {
      const id = String(tile.id ?? index);
      seen.add(id);
      let node = this.#nodes.get(id);
      if (!node) {
        node = element("div", "tile");
        node.dataset.id = id;
        node.append(element("span", "glyph"));
        this.#nodes.set(id, node);
      }
      const place = tile.loose ? this.#table : this.#field;
      if (node.parentNode !== place) place.append(node);
      paintTile(node, tile);
      if (tile.loose) onTable.push({ node, tile });
    });
    this.#table.hidden = onTable.length === 0;
    if (onTable.length > 0) this.#layOutTable(onTable);
    for (const [id, node] of this.#nodes) {
      if (seen.has(id)) continue;
      node.remove();
      this.#nodes.delete(id);
    }

    if (cursor && !this.#cursor) {
      this.#cursor = element("div", "cursor");
      this.#field.append(this.#cursor);
    } else if (!cursor && this.#cursor) {
      this.#cursor.remove();
      this.#cursor = null;
    }
    if (cursor) {
      this.#cursor.style.setProperty("--x", Math.min(cursor.x, this.#width - 4));
      this.#cursor.style.setProperty("--row", cursor.row);
    }

    if (label !== null) {
      this.root.setAttribute("role", "img");
      this.root.setAttribute("aria-label", label);
    }
  }

  /**
   * Loose letters lie on the table in rows that each curve in a gentle arch,
   * every letter the right way up and turned to follow the curve.
   */
  #layOutTable(items) {
    const room = this.#width + 2 * EDGE - 2 * TABLE.side;
    const rows = [[]];
    let used = 0;
    for (const item of items) {
      const width = glyphWidth(item.tile.ch);
      if (used > 0 && used + width > room) {
        rows.push([]);
        used = 0;
      }
      rows.at(-1).push({ ...item, width });
      used += width + TABLE.gap;
    }

    rows.forEach((row, index) => {
      const length = row.reduce((sum, { width }) => sum + width, 0) + TABLE.gap * (row.length - 1);
      const rise = TABLE.rise * Math.min(1, length / room); // short rows curve less
      let x = (this.#width + 2 * EDGE - length) / 2;
      for (const { node, width } of row) {
        const t = length > 0 ? (x + width / 2 - (this.#width + 2 * EDGE - length) / 2) / length : 0.5;
        const y = TABLE.top + index * TABLE.line - 4 * rise * t * (1 - t);
        const slope = (-4 * rise * (1 - 2 * t)) / length;
        node.style.setProperty("--x", x);
        node.style.setProperty("--y", y);
        node.style.setProperty("--turn", `${(Math.atan(slope) * 180) / Math.PI}deg`);
        x += width + TABLE.gap;
      }
    });
    this.#table.style.setProperty("--table-h", TABLE.top * 2 + (rows.length - 1) * TABLE.line);
  }

  /** How many board units one screen pixel is. */
  get unitsPerPixel() {
    return this.#width / this.#field.getBoundingClientRect().width;
  }

  /** A pointer position in board units, and how far outside the board it is (0 when inside). */
  pointAt({ clientX, clientY }) {
    const rect = this.#field.getBoundingClientRect();
    const scale = this.#width / rect.width;
    const outside = Math.max(rect.left - clientX, clientX - rect.right, rect.top - clientY, clientY - rect.bottom, 0);
    return { x: (clientX - rect.left) * scale, y: (clientY - rect.top) * scale, outside: outside * scale };
  }

  /** Carry a letter `dx, dy` screen pixels away from its place, above everything else. (0, 0) puts it down. */
  lift(id, dx, dy) {
    const node = this.#nodes.get(String(id));
    if (!node) return;
    const lifted = dx !== 0 || dy !== 0;
    node.style.translate = lifted ? `${dx}px ${dy}px` : "";
    node.classList.toggle("is-lifted", lifted);
    this.root.classList.toggle("has-lifted", lifted);
  }
}

function element(tag, className) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function paintTile(node, tile) {
  const glyph = node.firstChild;
  const text = glyphText(tile.ch);
  if (glyph.textContent !== text) glyph.textContent = text;
  node.dataset.ch = tile.ch;
  node.style.setProperty("--x", tile.x);
  node.style.setProperty("--row", tile.row);
  node.style.setProperty("--w", glyphWidth(tile.ch));
  // On the table, where a letter lies and how it is turned is up to #layOutTable.
  if (!tile.loose) node.style.setProperty("--turn", tile.flip ? "180deg" : "0deg");
  node.classList.toggle("is-used", Boolean(tile.used));
}

function watchGestures(field, handlers) {
  let press = null;
  let lastTap = { id: null, time: 0 };

  field.addEventListener("pointerdown", (event) => {
    if (press?.dragging || (event.pointerType === "mouse" && event.button !== 0)) return;
    const id = event.target.closest(".tile")?.dataset.id ?? null;
    press = { pointerId: event.pointerId, id, startX: event.clientX, startY: event.clientY, dragging: false };
    // Keep the keyboard focus where it is, and do not start selecting text.
    if (id !== null) event.preventDefault();
    try {
      field.setPointerCapture(event.pointerId);
    } catch {
      // Only real pointers can be captured; scripted ones (in tests) cannot.
    }
  });

  field.addEventListener("pointermove", (event) => {
    if (!press || event.pointerId !== press.pointerId || press.id === null) return;
    const dx = event.clientX - press.startX;
    const dy = event.clientY - press.startY;
    if (!press.dragging) {
      if (Math.hypot(dx, dy) < TAP_SLOP) return;
      // Too far to be a tap. If the letter cannot be dragged, the press comes to nothing.
      if (handlers.canDrag?.(press.id, event) === false) {
        press = null;
        return;
      }
      press.dragging = true;
    }
    handlers.drag?.(press.id, event, dx, dy);
  });

  field.addEventListener("pointerup", (event) => {
    if (!press || event.pointerId !== press.pointerId) return;
    const { id, dragging } = press;
    press = null;
    if (dragging) {
      handlers.drop?.(id, event);
    } else if (id === null) {
      handlers.boardTap?.(event);
    } else if (lastTap.id === id && event.timeStamp - lastTap.time < DOUBLE_TAP_MS) {
      lastTap = { id: null, time: 0 };
      handlers.doubleTap?.(id, event);
    } else {
      lastTap = { id, time: event.timeStamp };
      handlers.tap?.(id, event);
    }
  });

  field.addEventListener("pointercancel", (event) => {
    if (!press || event.pointerId !== press.pointerId) return;
    if (press.dragging) handlers.cancel?.(press.id);
    press = null;
  });
}
