// Carries over the boards saved by the first version of the site, which kept
// them in localStorage under "letterboard.vN" with positions in screen pixels.
// Once nobody has such data any more, this file and its one call can go.

import { clamp, clampRow } from "./board.js";
import { MAX_TILES, decodeBoard, encodeBoard } from "./codec.js";
import { ALPHABET, BOARD_W, GROOVE, glyphWidth } from "./glyphs.js";

const LEGACY_KEYS = ["letterboard.v6", "letterboard.v5", "letterboard.v4", "letterboard.v3", "letterboard.v2", "letterboard.v1"];
const LEGACY_ORIGINAL_ID = "original-root";
const LEGACY_TILE_HEIGHT = 47;

/** The old boards as the state `Library` stores, or null if there are none. */
export function importLegacyBoards(storage, originalId) {
  try {
    const old = LEGACY_KEYS.map((key) => JSON.parse(storage.getItem(key))).find((state) => Array.isArray(state?.history));
    if (!old) return null;

    const items = new Map();
    for (const item of old.history) {
      if (item && typeof item.id === "string" && item.id !== LEGACY_ORIGINAL_ID) items.set(item.id, item);
    }

    // A board's code holds the id of its parent, so parents are converted first.
    const converted = new Map();
    const convert = (item) => {
      if (converted.has(item.id)) return converted.get(item.id);
      converted.set(item.id, null); // guards against a loop of parents
      const parent = items.has(item.parentId) ? convert(items.get(item.parentId)) : null;
      const parentId = item.parentId === LEGACY_ORIGINAL_ID ? originalId : (parent?.id ?? null);
      const code = encodeBoard({
        tiles: convertTiles(item.snapshot),
        author: item.writerName,
        createdAt: Date.parse(item.createdAt) || 0,
        parentId,
      });
      const board = { id: decodeBoard(code).id, code, origin: "mine", title: typeof item.title === "string" ? item.title : undefined };
      converted.set(item.id, board);
      return board;
    };

    const boards = [...items.values()].map(convert);
    const source = converted.get(old.activeSourceId);
    return {
      boards,
      source: source?.code,
      author: typeof old.lastWriterName === "string" ? old.lastWriterName : "",
    };
  } catch {
    return null;
  }
}

function convertTiles(snapshot) {
  const tiles = Array.isArray(snapshot?.tiles) ? snapshot.tiles : [];
  // Old boards were as wide as the window. Squeeze the wide ones onto the board.
  const scale = snapshot?.boardWidth > BOARD_W ? BOARD_W / snapshot.boardWidth : 1;
  return tiles
    .flatMap(({ token, x, y, rotation }) => {
      let ch = token;
      let flip = rotation === 180;
      if (ch === ">") {
        ch = "<";
        flip = !flip;
      }
      if (typeof ch !== "string" || ch.length !== 1 || !ALPHABET.includes(ch)) return [];
      if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
      return [
        {
          ch,
          x: clamp(Math.round(x * scale), 0, BOARD_W - glyphWidth(ch)),
          row: clampRow((y + LEGACY_TILE_HEIGHT / 2) / GROOVE),
          flip,
          loose: false,
        },
      ];
    })
    .slice(0, MAX_TILES);
}
