// Draws a board into the page and reports what the pointer does to its letters.
//
// The view knows nothing about the rules of the board: it renders the tiles it
// is given and turns presses into taps, double taps and drags. All sizes are
// set in board units through CSS variables, so the same markup works for the
// big boards and for the small previews.

import { BOARD_W, glyphText, glyphWidth } from "./glyphs.js";

const TAP_SLOP = 5; // pixels a press may wander and still count as a tap
const DOUBLE_TAP_MS = 350;

export class BoardView {
  #field;
  #nodes = new Map();
  #cursor = null;

  /**
   * @param {HTMLElement} root
   * @param {object} [gestures] Callbacks `tap(id)`, `doubleTap(id)`, `boardTap(event)`,
   *   `canDrag(id, event)`, `drag(id, event, dx, dy)`, `drop(id, event)` and `cancel(id)`.
   *   Without them the board is a static picture.
   */
  constructor(root, gestures = null) {
    this.root = root;
    root.classList.add("board");
    const face = element("div", "board-face");
    this.#field = element("div", "board-field");
    face.append(this.#field);
    root.replaceChildren(face);
    if (gestures) watchGestures(this.#field, gestures);
  }

  /** Tiles are matched to their elements by `id`, so a letter keeps its element while it moves. */
  render(tiles, { cursor = null, label = null } = {}) {
    const seen = new Set();
    tiles.forEach((tile, index) => {
      const id = String(tile.id ?? index);
      seen.add(id);
      let node = this.#nodes.get(id);
      if (!node) {
        node = element("div", "tile");
        node.dataset.id = id;
        node.append(element("span", "glyph"));
        this.#nodes.set(id, node);
        this.#field.append(node);
      }
      paintTile(node, tile);
    });
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
      this.#cursor.style.setProperty("--x", Math.min(cursor.x, BOARD_W - 4));
      this.#cursor.style.setProperty("--row", cursor.row);
    }

    if (label !== null) {
      this.root.setAttribute("role", "img");
      this.root.setAttribute("aria-label", label);
    }
  }

  /** How many board units one screen pixel is. */
  get unitsPerPixel() {
    return BOARD_W / this.#field.getBoundingClientRect().width;
  }

  /** A pointer position in board units, and how far outside the board it is (0 when inside). */
  pointAt({ clientX, clientY }) {
    const rect = this.#field.getBoundingClientRect();
    const scale = BOARD_W / rect.width;
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

  mark(id, className, on) {
    this.#nodes.get(String(id))?.classList.toggle(className, on);
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
  node.style.setProperty("--turn", `${looseTilt(tile) + (tile.flip ? 180 : 0)}deg`);
  node.classList.toggle("is-used", Boolean(tile.used));
}

/** Letters in the pile of leftovers lie a little crooked. The angle follows from where they lie. */
function looseTilt(tile) {
  return tile.loose ? ((tile.x * 7 + tile.row * 13) % 17) - 8 : 0;
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
