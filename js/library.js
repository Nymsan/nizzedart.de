// The boards this browser knows about: the original one, the ones saved or
// opened here (kept in localStorage), and the shared gallery.
//
// A board is `{ id, code, tiles, author, createdAt, parentId }` as decoded from
// its share code. Saved boards are stored as their codes.

import { messageText } from "./board.js";
import { decodeBoard, encodeBoard } from "./codec.js";
import { STORAGE_KEY } from "./config.js";
import { importLegacyBoards } from "./legacy.js";

const MAX_SAVED = 200;

/**
 * Marianne's board, as the design has it (design_v2.pdf), line by line: the
 * row, and each letter with how far across it is, and whether it is upside down.
 */
const MARIANNE = [
  [3, [["L", 20], ["E", 56], ["B", 89], ["B", 130], ["E", 172], ["S", 234], ["A", 273], ["L", 316], ["L", 354], ["E", 387]]],
  [8, [["F", 54], ["I", 87], ["N", 108], ["D", 149], ["E", 189], ["R", 222], ["9", 295]]],
  [12, [["B", 69], ["A", 110], ["S", 153], ["U", 196], ["N", 237], ["E", 277], ["R", 316], ["H", 430], ["O", 472], ["S", 519]]],
  [
    16,
    [
      ["W", 7], ["M", 61, true], ["M", 110, true], [",", 157], ["N", 181], ["I", 217], ["Z", 234], ["Z", 273],
      ["E", 309], ["D", 342], ["A", 375], ["R", 414], ["T", 449], [",", 482], ["D", 504], ["E", 545],
    ],
  ],
  [21, [["T", 67], ["I", 104], ["L", 125], ["9", 204], ["9", 243], ["6", 284], ["K", 357], ["R", 397], ["_", 436]]],
  [34, [["-", 400], [",", 427], ["-", 447]]],
  [38, [["*", 421]]],
  [42, [[">", 27], ["D", 99], ["J", 138], ["C", 198], [">", 247, true]]],
];

/** The board everything starts from. */
export const ORIGINAL = Object.freeze(
  decodeBoard(
    encodeBoard({
      tiles: MARIANNE.flatMap(([row, letters]) => letters.map(([ch, x, flip = false]) => ({ ch, x, row, flip, loose: false }))),
      author: "Marianne",
      createdAt: 0,
    }),
  ),
);

export class Library {
  /** Boards saved ("mine") or opened from a link ("link") in this browser, newest first. */
  saved = [];
  /** Boards in the shared gallery, newest first. */
  gallery = [];
  /** The name last used when saving. */
  author = "";
  /** The board whose letters are in play. */
  source = ORIGINAL;
  #storage;

  constructor(storage) {
    this.#storage = storage;
    this.#load();
  }

  find(id) {
    if (id === ORIGINAL.id) return ORIGINAL;
    return this.saved.find((board) => board.id === id) ?? this.gallery.find((board) => board.id === id) ?? null;
  }

  titleOf(board) {
    return board.title ?? (messageText(board.tiles) || "Tom tavle");
  }

  /** Remember a board in this browser, unless it is already known. Returns the known board. */
  keep(board, origin) {
    const known = this.find(board.id);
    if (known) return known;
    const kept = { ...board, origin };
    this.saved.unshift(kept);
    this.saved.length = Math.min(this.saved.length, MAX_SAVED);
    this.save();
    return kept;
  }

  /** Forget a saved board. Returns a function that puts it back. */
  forget(id) {
    const index = this.saved.findIndex((board) => board.id === id);
    if (index < 0) return () => {};
    const [board] = this.saved.splice(index, 1);
    this.save();
    return () => {
      this.saved.splice(Math.min(index, this.saved.length), 0, board);
      this.save();
    };
  }

  /** Take in the gallery file: `{ boards: [{ code }] }`, oldest first. Unreadable boards are skipped. */
  setGallery(data) {
    const boards = new Map();
    for (const record of Array.isArray(data?.boards) ? data.boards : []) {
      try {
        const board = decodeBoard(record.code);
        boards.set(board.id, board.id === ORIGINAL.id ? ORIGINAL : board);
      } catch {
        // Not a board this version can read.
      }
    }
    this.gallery = [...boards.values()].reverse();
  }

  save() {
    const state = {
      boards: this.saved.map(({ code, origin, title }) => ({ code, origin, title })),
      source: this.source.code,
      author: this.author,
    };
    try {
      this.#storage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage is full or switched off: the page still works, it just forgets.
    }
  }

  #load() {
    let state = null;
    try {
      state = JSON.parse(this.#storage.getItem(STORAGE_KEY));
    } catch {
      // Unreadable storage is treated as empty.
    }
    if (!state) {
      state = importLegacyBoards(this.#storage, ORIGINAL.id);
      if (!state) return;
    }

    for (const record of Array.isArray(state.boards) ? state.boards : []) {
      try {
        const board = decodeBoard(record.code);
        if (this.find(board.id)) continue;
        const origin = record.origin === "link" ? "link" : "mine";
        const title = typeof record.title === "string" ? record.title : undefined;
        this.saved.push({ ...board, origin, title });
      } catch {
        // Skip boards this version cannot read.
      }
    }

    this.author = typeof state.author === "string" ? state.author : "";
    try {
      const source = decodeBoard(state.source);
      this.source = this.find(source.id) ?? source;
    } catch {
      // No usable source: start from the original.
    }
  }
}
