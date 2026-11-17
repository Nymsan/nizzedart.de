// The boards this browser knows about: the original one, the ones saved or
// opened here (kept in localStorage), and the shared gallery.
//
// A board is `{ id, code, tiles, author, createdAt, parentId }` as decoded from
// its share code. Saved boards are stored as their codes.

import { layoutText, messageText } from "./board.js";
import { decodeBoard, encodeBoard } from "./codec.js";
import { STORAGE_KEY } from "./config.js";
import { importLegacyBoards } from "./legacy.js";

const MAX_SAVED = 200;

/** The message everything started from. */
export const ORIGINAL = Object.freeze({
  ...decodeBoard(
    encodeBoard({
      tiles: layoutText([
        { row: 2, text: "LEBBE SALLE" },
        { row: 7, text: "SIGER NEJ TIL" },
        { row: 12, text: "EL I MARTS" },
        { row: 20, text: "DR ANDREAZZ*" },
        { row: 23, text: "DEN ED <" },
        { row: 26, text: "699     @ <" },
      ]),
      author: "LEBBE SALLE",
      createdAt: 0,
    }),
  ),
  title: "LEBBE SALLE SIGER NEJ TIL EL I MARTS",
});

export class Library {
  /** Boards saved ("mine") or opened from a link ("link") in this browser, newest first. */
  saved = [];
  /** Boards in the shared gallery, newest first. */
  gallery = [];
  /** The name last used when saving. */
  author = "";
  /** The board whose letters are in play, and the unfinished message written with them. */
  source = ORIGINAL;
  draft = [];
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
      draft: this.draft,
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
      this.draft = Array.isArray(state.draft) ? state.draft.filter((item) => item && typeof item === "object") : [];
    } catch {
      // No usable source: start from the original.
    }
  }
}
