// The boards this browser knows about: the original one, the ones saved or
// opened here (kept in localStorage), and the shared gallery.
//
// A board is `{ id, code, tiles, author, createdAt, parentId }` as decoded from
// its share code, and `shortId` once it is in the shared gallery (its short
// link). Saved boards are stored as their codes.

import { messageText } from "./board.js";
import { decodeBoard, encodeBoard } from "./codec.js";
import { STORAGE_KEY } from "./config.js";
import { forgetLegacyBoards, importLegacyBoards } from "./legacy.js";

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
  /** Boards saved ("mine") or opened from a link ("link") in this browser and not in the gallery, newest first. */
  saved = [];
  /** Boards in the shared gallery, newest first. */
  gallery = [];
  /** The name last used when saving. */
  author = "";
  /** The board whose letters are in play. Not remembered: the site opens on the original. */
  source = ORIGINAL;
  #storage;

  constructor(storage) {
    this.#storage = storage;
    this.#load();
    // What the first version of the site left behind goes, once it is carried over.
    if (this.#stored() === null && this.saved.length > 0) this.save();
    if (this.#stored() !== null) forgetLegacyBoards(storage);
  }

  /**
   * The boards to list in the gallery, newest first: the shared gallery, and
   * the boards only this browser knows about. Never the original, which has a
   * list of its own.
   */
  get listed() {
    return [...this.saved, ...this.gallery]
      .filter((board) => board.id !== ORIGINAL.id)
      .sort((a, b) => b.createdAt - a.createdAt);
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

  /**
   * Take in the gallery: `{ boards: [{ code, id }] }`, oldest first, `id` being
   * the short id of its link, if it has one. Unreadable boards are skipped. A
   * board kept in this browser that is in the gallery now is kept there only,
   * so it is not listed twice.
   */
  setGallery(data) {
    const boards = new Map();
    for (const record of Array.isArray(data?.boards) ? data.boards : []) {
      try {
        const board = decodeBoard(record.code);
        if (typeof record.id === "string") board.shortId = record.id;
        boards.set(board.id, board.id === ORIGINAL.id ? ORIGINAL : board);
      } catch {
        // Not a board this version can read.
      }
    }
    this.gallery = [...boards.values()].reverse();

    const local = this.saved.filter((board) => !boards.has(board.id));
    if (local.length < this.saved.length) {
      this.saved = local;
      this.save();
    }
  }

  /**
   * A board is in the shared gallery now, with the short id `shortId`: it is
   * listed there, and no longer kept in this browser. Returns the board as listed.
   */
  addToGallery(board, shortId) {
    let shared = this.gallery.find((known) => known.id === board.id);
    if (!shared) {
      const { origin, ...rest } = board;
      shared = { ...rest, shortId };
      this.gallery.unshift(shared);
    }
    shared.shortId ??= shortId;
    this.saved = this.saved.filter((known) => known.id !== board.id);
    if (this.source.id === board.id) this.source = shared;
    this.save();
    return shared;
  }

  /** The boards saved in this browser that are not in the shared gallery yet, oldest first. */
  get unsent() {
    return this.saved.filter((board) => board.origin === "mine").reverse();
  }

  save() {
    const state = {
      boards: this.saved.map(({ code, origin, title }) => ({ code, origin, title })),
      author: this.author,
    };
    try {
      this.#storage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage is full or switched off: the page still works, it just forgets.
    }
  }

  #stored() {
    try {
      return this.#storage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  #load() {
    let state = null;
    try {
      state = JSON.parse(this.#stored());
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
  }
}
