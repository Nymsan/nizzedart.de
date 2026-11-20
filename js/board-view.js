// Drawing boards and their letters.
//
// A letter is a "piece": an element placed in felt units (see .felt in
// styles.css), with its left edge at --x and its middle at --y. The same
// pieces are used for the big board in play (js/workspace.js) and for the
// small pictures of boards in the menu and the dialogs, drawn here by
// BoardView. All sizes are set in board units through CSS variables, so the
// same markup works at every size.

import { EDGE, FELT_W, GROOVE, glyphPlacement, glyphText, glyphWidth } from "./glyphs.js";

/** The table under a small picture of a board, in board units: margins, space between letters and rows, and how high a row arches. */
const TABLE = { side: 28, gap: 14, top: 50, line: 70, rise: 18 };

/**
 * The arrow piece, as drawn in the design (27 by 14 pixels there): it points
 * right, and left when turned upside down.
 */
const ARROW = {
  viewBox: "0 0 26.97 13.97",
  path:
    "M26.84 7.69C26.84 7.69 26.86 7.5 26.89 7.42C26.89 7.31 26.97 7.23 26.97 7.09C26.97 7.09 26.97 7.07 26.97 7.04C26.97 7.04" +
    " 26.97 7.01 26.97 6.99L26.97 6.96L26.97 6.93C26.97 6.8 26.92 6.69 26.89 6.58C26.89 6.5 26.89 6.42 26.84 6.34C26.84 6.34 " +
    "26.84 6.31 26.84 6.28C26.76 6.07 26.63 5.9 26.47 5.74C26.47 5.74 26.41 5.66 26.39 5.63L21.01 0.49C20.64 0.14 20.19 0 19." +
    "66 0C19.13 0 18.7 0.22 18.36 0.6C17.99 1 17.83 1.46 17.86 1.98C17.86 2.49 18.09 2.95 18.46 3.3L20.35 5.09L1.85 5.09C1.32" +
    " 5.09 0.87 5.28 0.53 5.63C0.16 6.01 0 6.44 0 6.96C0 7.47 0.18 7.96 0.53 8.31C0.9 8.69 1.32 8.85 1.85 8.85L20.35 8.85L18." +
    "44 10.64C18.07 10.99 17.88 11.43 17.86 11.97C17.86 12.51 18.01 12.94 18.36 13.32C18.7 13.7 19.13 13.92 19.66 13.95C20.19" +
    " 13.97 20.61 13.81 20.98 13.46L26.36 8.37C26.36 8.37 26.39 8.31 26.41 8.31C26.41 8.31 26.41 8.29 26.44 8.26C26.44 8.26 2" +
    "6.47 8.21 26.49 8.18C26.6 8.04 26.71 7.91 26.78 7.74C26.78 7.74 26.78 7.69 26.81 7.66L26.84 7.69Z",
};

/** Where a tile on the board lies, in felt units. */
export const onBoard = (tile) => ({ x: EDGE + tile.x, y: tile.row * GROOVE });

export function element(tag, className) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export function pieceElement(id) {
  const node = element("div", "piece");
  if (id !== undefined) node.dataset.id = id;
  node.append(element("span", "glyph"));
  return node;
}

/** Show letter `ch` on a piece, turned upside down if `flip`, at `place` (felt units). */
export function paintPiece(node, ch, flip, place) {
  if (node.dataset.ch !== ch) {
    node.dataset.ch = ch;
    const glyph = node.firstChild;
    if (ch === ">") {
      glyph.innerHTML = `<svg viewBox="${ARROW.viewBox}" aria-hidden="true"><path d="${ARROW.path}"/></svg>`;
    } else {
      glyph.textContent = glyphText(ch);
    }
    const [dx, dy] = glyphPlacement(ch);
    node.style.setProperty("--w", glyphWidth(ch));
    glyph.style.setProperty("--dx", dx);
    glyph.style.setProperty("--dy", dy);
  }
  node.style.setProperty("--x", place.x);
  node.style.setProperty("--y", place.y);
  node.style.setProperty("--turn", flip ? "180deg" : "0deg");
}

/** A board in a frame, as a picture. Its loose letters lie on the table under it. */
export class BoardView {
  #felt;
  #table;

  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    root.classList.add("board-view");
    const frame = element("div", "frame");
    this.#felt = element("div", "felt");
    this.#table = element("div", "board-table");
    frame.append(this.#felt);
    root.replaceChildren(frame, this.#table);
  }

  render(tiles, { label = null } = {}) {
    const onTable = [];
    const pieces = [];
    for (const tile of tiles) {
      const node = pieceElement();
      if (tile.loose) {
        onTable.push({ node, tile });
      } else {
        paintPiece(node, tile.ch, tile.flip, onBoard(tile));
        pieces.push(node);
      }
    }
    this.#felt.replaceChildren(...pieces);
    this.#table.replaceChildren(...onTable.map(({ node }) => node));
    this.#table.hidden = onTable.length === 0;
    if (onTable.length > 0) this.#layOutTable(onTable);
    if (label !== null) {
      this.root.setAttribute("role", "img");
      this.root.setAttribute("aria-label", label);
    }
  }

  /** Loose letters lie on the table in rows that each curve in a gentle arch, the right way up. */
  #layOutTable(items) {
    const across = FELT_W;
    const room = across - 2 * TABLE.side;
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
      const start = (across - length) / 2;
      let x = start;
      for (const { node, tile, width } of row) {
        const t = length > 0 ? (x + width / 2 - start) / length : 0.5;
        paintPiece(node, tile.ch, false, { x, y: TABLE.top + index * TABLE.line - 4 * rise * t * (1 - t) });
        x += width + TABLE.gap;
      }
    });
    this.#table.style.setProperty("--table-h", TABLE.top * 2 + (rows.length - 1) * TABLE.line);
  }
}

export const DOUBLE_TAP_MS = 350;
const TAP_SLOP = 5; // pixels a press may wander and still count as a tap

/**
 * Turn presses on the pieces and the empty board under `root` into taps,
 * double taps and drags. `handlers`: `tap(id, event)`, `doubleTap(id, event)`,
 * `boardTap(event)` (a press on `root` itself, not on a piece), `canDrag(id)`,
 * `drag(id, event, start)`, `drop(id, event)` and `cancel(id)`. `start` is the
 * pointer event the press began with.
 */
export function watchPresses(root, handlers) {
  let press = null;
  let lastTap = { id: null, time: 0 };

  root.addEventListener("pointerdown", (event) => {
    if (press?.dragging || (event.pointerType === "mouse" && event.button !== 0)) return;
    const id = event.target.closest(".piece[data-id]")?.dataset.id ?? null;
    if (id === null && !event.target.closest("[data-board-tap]")) return;
    press = { pointerId: event.pointerId, id, start: event, dragging: false };
    // Keep the keyboard focus where it is, and do not start selecting text.
    if (id !== null) event.preventDefault();
    try {
      root.setPointerCapture(event.pointerId);
    } catch {
      // Only real pointers can be captured; scripted ones (in tests) cannot.
    }
  });

  root.addEventListener("pointermove", (event) => {
    if (!press || event.pointerId !== press.pointerId || press.id === null) return;
    if (!press.dragging) {
      const moved = Math.hypot(event.clientX - press.start.clientX, event.clientY - press.start.clientY);
      if (moved < TAP_SLOP) return;
      if (handlers.canDrag?.(press.id) === false) {
        press = null;
        return;
      }
      press.dragging = true;
    }
    handlers.drag?.(press.id, event, press.start);
  });

  root.addEventListener("pointerup", (event) => {
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

  root.addEventListener("pointercancel", (event) => {
    if (!press || event.pointerId !== press.pointerId) return;
    if (press.dragging) handlers.cancel?.(press.id);
    press = null;
  });
}
