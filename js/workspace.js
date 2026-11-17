// The two big boards: the previous message, whose letters are the supply, and
// the new message being written with them. Also the tray of letters under the
// board, and the keyboard.
//
// The previous message can instead be rewritten freely ("rewrite"), which
// starts a new chain of boards with whatever letters one likes.

import { messageText, putAside, rowAt } from "./board.js";
import { BoardView, DOUBLE_TAP_MS } from "./board-view.js";
import { MAX_TILES } from "./codec.js";
import { ENDLESS, Editor, Pool } from "./editor.js";
import { ALPHABET, GROOVE, glyphForKey, glyphText, glyphWidth } from "./glyphs.js";

/** How far outside the board (in board units) a dragged letter must be to be lifted off it. */
const LEAVE_MARGIN = 10;

const TRAY_ACTIONS = [
  ["space", "Mellemrum"],
  ["newline", "Ny linje"],
  ["backspace", "Slet"],
  ["flip", "Vend"],
];

const plain = ({ ch, x, row, flip, loose }) => ({ ch, x, row, flip, loose });

export class Workspace {
  #sourceView;
  #composeView;
  #tray;
  #onChange;
  #notify;
  #pool = new Pool([]);
  #composer = new Editor(this.#pool);
  /** The editor on the previous message while it is being rewritten, otherwise null. */
  #rewrite = null;
  #flipNext = false;

  constructor({ sourceBoard, composeBoard, tray, onChange, notify }) {
    this.#onChange = onChange;
    this.#notify = notify;
    this.#tray = tray;

    const editing = this.#editorGestures(() => this.#rewrite, () => this.#sourceView);
    const picking = this.#pickingGestures();
    const byMode = {};
    for (const name of ["tap", "doubleTap", "boardTap", "canDrag", "drag", "drop", "cancel"]) {
      byMode[name] = (...args) => (this.#rewrite ? editing : picking)[name]?.(...args);
    }
    this.#sourceView = new BoardView(sourceBoard, byMode);
    const composing = this.#editorGestures(() => this.#composer, () => this.#composeView, { tapTakesBack: true });
    this.#composeView = new BoardView(composeBoard, composing);

    // Pressing a key in the tray must not take the keyboard focus away from typing.
    tray.addEventListener("mousedown", (event) => event.preventDefault());
    tray.addEventListener("click", (event) => this.#onTrayClick(event));
  }

  /** Start a new message from the letters in `tiles`. `draft` is an unfinished message to carry on with. */
  setSource(tiles, draft = []) {
    this.#rewrite = null;
    this.#pool = new Pool(tiles);
    this.#composer = new Editor(this.#pool, () => this.#render());
    this.#composer.restore(draft);
    this.#buildTray();
    this.#render();
  }

  get isRewriting() {
    return this.#rewrite !== null;
  }

  get isEmpty() {
    return this.#editor.tiles.length === 0;
  }

  /** The unfinished message, in the form `setSource` takes it back. */
  get draft() {
    return this.#composer.tiles.map(({ src, x, row, flip }) => ({ src, x, row, flip }));
  }

  startRewrite() {
    this.#rewrite = new Editor(ENDLESS, () => this.#render());
    this.#rewrite.load(this.#pool.tiles.map(plain));
    this.#buildTray();
    this.#render();
  }

  cancelRewrite() {
    this.#rewrite = null;
    this.#buildTray();
    this.#render();
  }

  clear() {
    this.#editor.clear();
  }

  /** Put every letter that is left on the new board, in a random order. */
  shuffle(random = Math.random) {
    if (this.#rewrite) return;
    const pieces = this.#pool.leftovers.map((tile) => this.#pool.piece(tile.id));
    if (pieces.length === 0) {
      this.#notify("Alle bogstaverne er allerede brugt");
      return;
    }
    for (let i = pieces.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
    }
    if (this.#composer.placeAll(pieces) === "full") this.#notify("Der var ikke plads til dem alle på tavlen");
  }

  /**
   * The tiles of the finished board, or null if nothing is written. The letters
   * that were not used in a new message are put aside, on the table next to the board.
   */
  result() {
    if (this.isEmpty) return null;
    if (this.#rewrite) return this.#rewrite.tiles.map(plain);
    const message = this.#composer.tiles.map(plain);
    return [...message, ...putAside(this.#pool.leftovers)];
  }

  /** Returns true if the key was meant for the board. */
  handleKey(event) {
    // AltGr, which types @ on many keyboards, is reported as Ctrl+Alt.
    if (event.metaKey || (event.ctrlKey && !event.altKey)) return false;

    const editor = this.#editor;
    switch (event.key) {
      case "ArrowLeft":
        editor.moveCursor(-1, 0);
        return true;
      case "ArrowRight":
        editor.moveCursor(1, 0);
        return true;
      case "ArrowUp":
        editor.moveCursor(0, -1);
        return true;
      case "ArrowDown":
        editor.moveCursor(0, 1);
        return true;
      case "Backspace":
        editor.backspace();
        return true;
      case "Enter":
        editor.newLine();
        return true;
      case " ":
        editor.space();
        return true;
    }

    const glyph = glyphForEvent(event);
    if (!glyph) return false;
    this.#type(glyph.ch, glyph.flip);
    return true;
  }

  get #editor() {
    return this.#rewrite ?? this.#composer;
  }

  #type(ch, flip) {
    if (this.#rewrite && this.#rewrite.tiles.length >= MAX_TILES) {
      this.#notify("Der er ikke plads til flere bogstaver på tavlen");
      return;
    }
    const result = this.#editor.type(ch, flip !== this.#flipNext);
    if (result === "missing") {
      this.#notify(`Der er ikke flere ${glyphText(ch)} tilbage`);
      this.#shakeKey(ch);
    }
    this.#reportFull(result);
  }

  #reportFull(result) {
    if (result === "full") this.#notify("Der er ikke plads til flere bogstaver på tavlen");
  }

  #render() {
    const rewrite = this.#rewrite;
    const sourceTiles = rewrite ? rewrite.tiles : this.#pool.tiles;
    this.#sourceView.render(sourceTiles, {
      cursor: rewrite?.cursor,
      label: `Forrige besked: ${messageText(sourceTiles)}`,
    });
    this.#composeView.render(this.#composer.tiles, {
      cursor: rewrite ? null : this.#composer.cursor,
      label: `Ny besked: ${messageText(this.#composer.tiles)}`,
    });
    this.#composeView.root.classList.toggle("is-empty", this.#composer.tiles.length === 0);
    this.#updateTray();
    this.#onChange();
  }

  // --- Pointer -------------------------------------------------------------

  /**
   * A board that is being written on: letters can be moved, turned and taken off.
   * Dragged off the board, a letter leaves its groove and follows the pointer,
   * across the page if need be; let go there, it goes back where it came from.
   * With `tapTakesBack`, a tap on a letter does that too, and the cursor is moved
   * by tapping the board between the letters.
   */
  #editorGestures(getEditor, getView, { tapTakesBack = false } = {}) {
    let from = null; // where the letter was when the drag began, in board units
    let carried = false; // off the board, following the pointer
    let pendingTap = 0;
    const release = (id) => {
      getView().lift(id, 0, 0);
      from = null;
      carried = false;
    };
    return {
      tap: (id) => {
        const editor = getEditor();
        if (!tapTakesBack) return editor.cursorAfter(id);
        // Wait a moment: a second tap turns the letter instead.
        clearTimeout(pendingTap);
        pendingTap = setTimeout(() => editor.tile(id) && editor.remove(id), DOUBLE_TAP_MS);
      },
      doubleTap: (id) => {
        clearTimeout(pendingTap);
        getEditor().flip(id);
      },
      boardTap: (event) => {
        const point = getView().pointAt(event);
        getEditor().setCursor(point.x, rowAt(point.y));
      },
      drag: (id, event, dx, dy) => {
        const editor = getEditor();
        const tile = editor.tile(id);
        if (!tile) return;
        const view = getView();
        const point = view.pointAt(event);
        from ??= { x: tile.x, row: tile.row, loose: tile.loose };
        const wasCarried = carried;
        carried = point.outside > LEAVE_MARGIN;
        if (carried) {
          // Back to where the drag began, and from there it moves with the pointer.
          if (!wasCarried && !from.loose) editor.moveTo(id, from.x, from.row);
          view.lift(id, dx, dy);
          return;
        }
        if (wasCarried) view.lift(id, 0, 0);
        if (from.loose) {
          // A letter picked up from the table goes on the board under the pointer.
          editor.moveTo(id, point.x - glyphWidth(tile.ch) / 2, rowAt(point.y));
          return;
        }
        const scale = view.unitsPerPixel;
        editor.moveTo(id, from.x + dx * scale, rowAt(from.row * GROOVE + dy * scale));
      },
      drop: (id) => {
        // Let go off the board, a letter from the board goes back; one from the table stays there.
        const takeOff = carried && !from?.loose;
        release(id);
        if (takeOff) getEditor().remove(id);
      },
      cancel: release,
    };
  }

  /** The previous message while its letters are being picked for the new one. */
  #pickingGestures() {
    return {
      // Tap a letter to use it at the cursor; tap a used letter to take it back.
      tap: (id) => {
        const piece = this.#pool.piece(id);
        if (piece) this.#reportFull(this.#composer.place(piece, this.#flipNext));
        else this.#composer.removeBySource(id);
      },
      // On a touch screen, dragging on this board scrolls the page instead.
      canDrag: (id, event) => event.pointerType === "mouse" && this.#pool.piece(id) !== null,
      drag: (id, event, dx, dy) => this.#sourceView.lift(id, dx, dy),
      drop: (id, event) => {
        this.#sourceView.lift(id, 0, 0);
        const piece = this.#pool.piece(id);
        const point = this.#composeView.pointAt(event);
        if (!piece || point.outside > 0) return;
        this.#reportFull(this.#composer.drop(piece, point.x - glyphWidth(piece.ch) / 2, rowAt(point.y), this.#flipNext));
      },
      cancel: (id) => this.#sourceView.lift(id, 0, 0),
    };
  }

  // --- Tray ----------------------------------------------------------------

  /** One key per letter in the supply, plus the keys a touch screen has no other way to press. */
  #buildTray() {
    const letters = this.#rewrite ? [...ALPHABET] : [...ALPHABET].filter((ch) => this.#pool.tiles.some((tile) => tile.ch === ch));

    const letterRow = document.createElement("div");
    letterRow.className = "tray-letters";
    for (const ch of letters) {
      const key = trayKey(glyphText(ch));
      key.dataset.ch = ch;
      if (!this.#rewrite) key.append(Object.assign(document.createElement("span"), { className: "key-count" }));
      letterRow.append(key);
    }

    const actionRow = document.createElement("div");
    actionRow.className = "tray-actions";
    for (const [action, label] of TRAY_ACTIONS) {
      const key = trayKey(label);
      key.dataset.action = action;
      actionRow.append(key);
    }

    this.#tray.replaceChildren(letterRow, actionRow);
    (this.#rewrite ? this.#sourceView : this.#composeView).root.after(this.#tray);
  }

  #updateTray() {
    if (!this.#rewrite) {
      const left = new Map();
      for (const { ch } of this.#pool.leftovers) left.set(ch, (left.get(ch) ?? 0) + 1);
      for (const key of this.#tray.querySelectorAll("[data-ch]")) {
        const count = left.get(key.dataset.ch) ?? 0;
        key.lastChild.textContent = count;
        key.classList.toggle("is-out", count === 0);
        key.setAttribute("aria-label", `${key.dataset.ch === "<" ? "pil" : key.dataset.ch}, ${count} tilbage`);
      }
    }
    this.#tray.querySelector('[data-action="flip"]')?.setAttribute("aria-pressed", String(this.#flipNext));
  }

  #onTrayClick(event) {
    const key = event.target.closest("button");
    if (!key) return;
    if (key.dataset.ch) return this.#type(key.dataset.ch, false);
    switch (key.dataset.action) {
      case "space":
        return this.#editor.space();
      case "newline":
        return this.#editor.newLine();
      case "backspace":
        return this.#editor.backspace();
      case "flip":
        this.#flipNext = !this.#flipNext;
        return this.#updateTray();
    }
  }

  #shakeKey(ch) {
    const key = this.#tray.querySelector(`[data-ch="${CSS.escape(ch)}"]`);
    if (!key) return;
    key.classList.remove("is-shaking");
    void key.offsetWidth; // restart the animation if it is already running
    key.classList.add("is-shaking");
  }
}

function trayKey(text) {
  const key = document.createElement("button");
  key.type = "button";
  key.className = "key";
  key.append(Object.assign(document.createElement("span"), { className: "key-label", textContent: text }));
  return key;
}

/** The letter a key press asks for. Shift turns a letter or a digit upside down. */
function glyphForEvent(event) {
  const typed = glyphForKey(event.key);
  if (typed) return { ch: typed.ch, flip: typed.flip !== (event.shiftKey && /^\p{L}$/u.test(event.key)) };
  // Shift turns a digit key into a symbol, so read the digit off the key itself.
  const digit = event.shiftKey ? /^Digit(\d)$/.exec(event.code) : null;
  return digit ? { ch: digit[1], flip: true } : null;
}
