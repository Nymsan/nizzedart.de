// A board as a short URL-safe code, so it can live in a link.
//
// Layout (version 2), base64url without padding:
//   1 byte    version
//   4 bytes   time of saving, in minutes since 1970
//   6 bytes   id of the board this one was made from (all zero: none)
//   1 byte    length of the author name, then the name in UTF-8
//   1 byte    number of tiles
//   24 bits per tile: letter (6), upside down (1), loose (1), x (10), row (6)
//
// Version 1 was the same with 5 bits for the row, on the first, smaller board
// with other letters. Its boards are still read, and moved onto this board.
//
// scripts/add_board.py checks the same format before a board enters the gallery.

import { ALPHABET, BOARD_W, LINE_STEP, MIN_GAP, ROW_MAX, ROW_MIN, glyphWidth } from "./glyphs.js";

const VERSION = 2;
const NO_PARENT = "000000000000";
const CODE_PATTERN = /^[A-Za-z0-9_-]{12,1400}$/;
const TILE_BITS = { 1: 23, 2: 24 };
const ROW_BITS = { 1: 5, 2: 6 };

export const MAX_TILES = 200;
export const MAX_AUTHOR_LENGTH = 40;

/** A name as it is stored: single-spaced, no control characters, limited length. */
export function cleanAuthor(name) {
  const tidy = String(name ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...tidy].slice(0, MAX_AUTHOR_LENGTH).join("").trim();
}

export function encodeBoard({ tiles, author = "", createdAt = Date.now(), parentId = null }) {
  if (tiles.length > MAX_TILES) throw new Error("For mange bogstaver på tavlen");

  const minutes = Math.floor(createdAt / 60000);
  const name = new TextEncoder().encode(cleanAuthor(author));
  const bytes = [
    VERSION,
    (minutes >>> 24) & 255,
    (minutes >>> 16) & 255,
    (minutes >>> 8) & 255,
    minutes & 255,
    ...hexToBytes(parentId ?? NO_PARENT),
    name.length,
    ...name,
    tiles.length,
  ];

  const bits = new BitWriter(bytes);
  for (const tile of tiles) {
    const letter = ALPHABET.indexOf(tile.ch);
    if (letter < 0 || tile.ch.length !== 1) throw new Error(`Ukendt bogstav: ${tile.ch}`);
    bits.write(letter, 6);
    bits.write(tile.flip ? 1 : 0, 1);
    bits.write(tile.loose ? 1 : 0, 1);
    bits.write(tile.x, 10);
    bits.write(tile.row, 6);
  }
  bits.flush();

  return toBase64Url(bytes);
}

/** Read a code back into a board. Throws on anything that is not a valid board. */
export function decodeBoard(code) {
  if (typeof code !== "string" || !CODE_PATTERN.test(code)) throw new Error("Ugyldig tavlekode");

  let bytes;
  try {
    bytes = fromBase64Url(code);
  } catch {
    throw new Error("Ugyldig tavlekode");
  }
  const version = bytes[0];
  if (!TILE_BITS[version]) throw new Error("Ukendt version af tavlekoden");

  const nameLength = bytes[11];
  const tilesAt = 12 + nameLength + 1;
  const count = bytes[tilesAt - 1];
  if (count === undefined || count > MAX_TILES || bytes.length !== tilesAt + Math.ceil((count * TILE_BITS[version]) / 8)) {
    throw new Error("Ugyldig tavlekode");
  }

  let author;
  try {
    author = cleanAuthor(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(12, 12 + nameLength)));
  } catch {
    throw new Error("Ugyldig tavlekode");
  }

  const bits = new BitReader(bytes, tilesAt);
  let tiles = [];
  for (let i = 0; i < count; i += 1) {
    const ch = ALPHABET[bits.read(6)];
    const flip = bits.read(1) === 1;
    const loose = bits.read(1) === 1;
    const x = bits.read(10);
    const row = bits.read(ROW_BITS[version]);
    const [rowMin, rowMax] = version === 1 ? [V1.rowMin, V1.rowMax] : [ROW_MIN, ROW_MAX];
    if (ch === undefined || row < rowMin || row > rowMax) throw new Error("Ugyldig tavlekode");
    tiles.push({ ch, x, row, flip, loose });
  }
  tiles = version === 1 ? fromVersion1(tiles) : tiles.map((tile) => ({ ...tile, x: Math.min(tile.x, BOARD_W - glyphWidth(tile.ch)) }));

  const minutes = ((bytes[1] << 24) | (bytes[2] << 16) | (bytes[3] << 8) | bytes[4]) >>> 0;
  const parent = bytesToHex(bytes.subarray(5, 11));

  return {
    id: hashId(code),
    code,
    tiles,
    author,
    createdAt: minutes * 60000,
    parentId: parent === NO_PARENT ? null : parent,
  };
}

/**
 * The first board: 520 units across, rows 2 to 30. Its arrow had the same
 * place in ALPHABET as the arrow now, but pointed left the right way up.
 */
const V1 = { width: 520, rowMin: 2, rowMax: 30, arrow: ">" };
const V1_GAP = 4; // the least space kept between letters moved over from a version 1 board

/**
 * A version 1 board, moved onto this board: stretched to fill it, each line
 * spaced out so its letters do not run into each other, and pulled back from
 * the right edge if need be.
 */
function fromVersion1(tiles) {
  const scaleX = BOARD_W / V1.width;
  const scaleRow = (ROW_MAX - ROW_MIN) / (V1.rowMax - V1.rowMin);
  const moved = tiles.map((tile) => ({
    ...tile,
    flip: tile.ch === V1.arrow ? !tile.flip : tile.flip,
    x: tile.x * scaleX,
    row: Math.round(ROW_MIN + (tile.row - V1.rowMin) * scaleRow),
  }));
  // Letters on rows this close to each other share a line, and are put on its first row.
  const lines = [];
  for (const tile of moved.filter((tile) => !tile.loose).sort((a, b) => a.row - b.row)) {
    const line = lines.at(-1);
    if (line && tile.row - line[0].row < LINE_STEP) line.push(tile);
    else lines.push([tile]);
  }
  for (const line of lines) {
    const { row } = line[0];
    line.sort((a, b) => a.x - b.x);
    for (let i = 1; i < line.length; i += 1) {
      line[i].x = Math.max(line[i].x, line[i - 1].x + glyphWidth(line[i - 1].ch) + V1_GAP);
    }
    const last = line.at(-1);
    const overflow = last.x + glyphWidth(last.ch) - BOARD_W;
    if (overflow > 0) {
      // Move the line left, and if that is not enough, close up the gaps between its letters.
      const shift = Math.min(overflow, line[0].x);
      for (const tile of line) tile.x -= shift;
      const gaps = line.slice(1).map((tile, i) => tile.x - line[i].x - glyphWidth(line[i].ch));
      const letters = line.reduce((sum, tile) => sum + glyphWidth(tile.ch), 0);
      const spare = gaps.reduce((sum, gap) => sum + gap - MIN_GAP, 0);
      const room = BOARD_W - line[0].x - letters - MIN_GAP * gaps.length;
      const keep = spare > 0 ? Math.max(0, Math.min(1, room / spare)) : 0;
      for (let i = 1; i < line.length; i += 1) {
        line[i].x = line[i - 1].x + glyphWidth(line[i - 1].ch) + MIN_GAP + (gaps[i - 1] - MIN_GAP) * keep;
      }
    }
    for (const tile of line) tile.row = row;
  }
  return moved.map((tile) => ({ ...tile, x: Math.max(0, Math.min(Math.round(tile.x), BOARD_W - glyphWidth(tile.ch))) }));
}

/** A board's id is a 48-bit hash (cyrb53) of its code, as 12 hex digits. */
function hashId(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (value, digits) => (value >>> 0).toString(16).padStart(8, "0").slice(-digits);
  return hex(h2, 4) + hex(h1, 8);
}

class BitWriter {
  #bytes;
  #current = 0;
  #filled = 0;

  constructor(bytes) {
    this.#bytes = bytes;
  }

  write(value, width) {
    for (let bit = width - 1; bit >= 0; bit -= 1) {
      this.#current = (this.#current << 1) | ((value >> bit) & 1);
      this.#filled += 1;
      if (this.#filled === 8) this.flush();
    }
  }

  flush() {
    if (this.#filled === 0) return;
    this.#bytes.push(this.#current << (8 - this.#filled));
    this.#current = 0;
    this.#filled = 0;
  }
}

class BitReader {
  #bytes;
  #position;

  constructor(bytes, byteOffset) {
    this.#bytes = bytes;
    this.#position = byteOffset * 8;
  }

  read(width) {
    let value = 0;
    for (let i = 0; i < width; i += 1) {
      const byte = this.#bytes[this.#position >> 3];
      value = (value << 1) | ((byte >> (7 - (this.#position & 7))) & 1);
      this.#position += 1;
    }
    return value;
  }
}

function toBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text) {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

const hexToBytes = (hex) => hex.match(/../g).map((pair) => parseInt(pair, 16));
const bytesToHex = (bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
