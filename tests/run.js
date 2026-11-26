// Tests for the site, run in the browser by /tests.html.
//
// First the rules and the storage, straight on the modules. Then the page
// itself, loaded in a frame and worked with scripted key presses and pointers.
//
// `?app=<page>` tests another page than index.html, and `?only=<text>` runs
// only the tests with that text in their name.

import { blockerAt, freeXForward, freeXNearest, layoutText, messageText, putAside, readLines, typingSlot } from "../js/board.js";
import { MAX_TILES, cleanAuthor, decodeBoard, encodeBoard } from "../js/codec.js";
import { STORAGE_KEY } from "../js/config.js";
import { Editor, Pool } from "../js/editor.js";
import {
  ALPHABET,
  BOARD_W,
  FELT_W,
  GROOVE,
  LINE_STEP,
  MARGIN_X,
  MIN_GAP,
  ROW_MAX,
  ROW_MIN,
  WORD_GAP,
  gapAfter,
  glyphForKey,
  glyphWidth,
  sortKey,
} from "../js/glyphs.js";
import { Library, ORIGINAL } from "../js/library.js";
import { readLink, shareUrl } from "../js/share.js";
import { galleryApi } from "../js/api.js";
import { handle } from "../worker/src/app.js";
import { madeRoom, scatteredPlaces, seededRandom, sortedPlaces, spreadOut } from "../js/workspace.js";

const params = new URLSearchParams(location.search);
const tests = [];
const test = (name, run) => tests.push({ name, run });

function assert(condition, message = "assertion failed") {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message = "values differ") {
  const [a, e] = [JSON.stringify(actual), JSON.stringify(expected)];
  if (a !== e) throw new Error(`${message}: got ${a}, expected ${e}`);
}

function throws(run, message = "expected an error") {
  try {
    run();
  } catch {
    return;
  }
  throw new Error(message);
}

/** Let the page get on with its work. Not a timer: browsers slow those down in pages nobody is looking at. */
function tick() {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = resolve;
    channel.port2.postMessage(null);
  });
}

async function until(condition, what = "condition") {
  // Generous: a headless browser can hold the page's timers back for seconds (a tap waits 350 ms for a second one).
  const end = performance.now() + 10000;
  while (!condition()) {
    if (performance.now() > end) throw new Error(`timed out waiting for ${what}`);
    await tick();
  }
}

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

const tile = (ch, x, row, flip = false, loose = false) => ({ ch, x, row, flip, loose });
const withIds = (tiles) => tiles.map((t, i) => ({ ...t, id: `x${i}` }));

/** Where the letters of a word typed from `x` land, each the typing gap after the one before. */
function spaced(word, x = MARGIN_X) {
  const letters = [...word];
  return letters.map((ch, i) => (i === 0 ? x : (x += glyphWidth(letters[i - 1]) + gapAfter(letters[i - 1]))));
}

/** Where the cursor is after a letter at `x`. */
const after = (ch, x) => x + glyphWidth(ch) + gapAfter(ch);

/** True if no two tiles are closer than the board allows. */
function nothingOverlaps(tiles) {
  const all = withIds(tiles);
  return all.every((t) => blockerAt(all, t.ch, t.x, t.row, t.id) === null);
}

/** A supply that never runs out, for trying the editor out. */
const endless = { find: (ch) => ({ ch, src: null, flip: false }), take() {}, putBack() {} };

/** A share code in the first version of the format (23 bits a tile, rows 2 to 30), as the first site wrote them. */
function encodeVersion1(tiles) {
  const bytes = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, tiles.length];
  let bits = "";
  for (const t of tiles) {
    const letter = t.ch === "<" ? 42 : ALPHABET.indexOf(t.ch);
    bits += [letter.toString(2).padStart(6, "0"), t.flip ? "1" : "0", t.loose ? "1" : "0", t.x.toString(2).padStart(10, "0"), t.row.toString(2).padStart(5, "0")].join("");
  }
  for (let i = 0; i < bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8).padEnd(8, "0"), 2));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const MARIANNE = "LEBBE SALLE FINDER 9 BASUNER HOS WWW,NIZZEDART,DE TIL 996 KR_ -,- * →DJ C←";

// --- Letters -------------------------------------------------------------------

test("keys: letters are upper-cased, unknown keys are ignored", () => {
  equal(glyphForKey("a"), { ch: "A", flip: false });
  equal(glyphForKey("æ"), { ch: "Æ", flip: false });
  equal(glyphForKey("7"), { ch: "7", flip: false });
  equal(glyphForKey("-"), { ch: "-", flip: false });
  equal(glyphForKey("_"), { ch: "_", flip: false });
  equal(glyphForKey(","), { ch: ",", flip: false });
  equal(glyphForKey("!"), null);
  equal(glyphForKey("ß"), null, "ß upper-cases to two letters");
  equal(glyphForKey("Enter"), null);
  equal(glyphForKey(""), null);
});

test("keys: the arrow points the way it is typed, and nothing else is made by turning a letter around", () => {
  equal(glyphForKey(">"), { ch: ">", flip: false });
  equal(glyphForKey("<"), { ch: ">", flip: true });
  equal(glyphForKey("."), null);
});

// --- Share codes -----------------------------------------------------------------

// The same board and codes as in tests/test_add_board.py.
const GOLDEN = {
  tiles: [tile("A", 16, 2), tile("M", 52, 2, true), tile("'", 100, 42, false, true), tile(">", 480, 5, true, true)],
  author: "Æg & Ål",
  createdAt: 29333333 * 60000,
  parentId: "0123456789ab",
};
const GOLDEN_CODE = "AgG_l1UBI0VniasJw4ZnICYgw4VsBAAEAjINAqUZKqt4BQ";
const VERSION_1_CODE = "AQG_l1UBI0VniasJw4ZnICYgw4VsBAAEBGQaCpRk9VvAUA";

test("codec: encodes the golden board to the same code as the Python script expects", () => {
  equal(encodeBoard(GOLDEN), GOLDEN_CODE);
});

test("codec: a board survives a round trip", () => {
  const board = decodeBoard(GOLDEN_CODE);
  equal(board.tiles, GOLDEN.tiles);
  equal(board.author, GOLDEN.author);
  equal(board.createdAt, GOLDEN.createdAt);
  equal(board.parentId, GOLDEN.parentId);
  equal(board.code, GOLDEN_CODE);
  assert(/^[0-9a-f]{12}$/.test(board.id), `id looks wrong: ${board.id}`);
  equal(decodeBoard(GOLDEN_CODE).id, board.id, "the id is stable");
});

test("codec: every letter at the edges of the board survives a round trip", () => {
  const tiles = [...ALPHABET].flatMap((ch, i) => [
    tile(ch, 0, ROW_MIN, i % 2 === 0, i % 3 === 0),
    tile(ch, BOARD_W - glyphWidth(ch), ROW_MAX, i % 2 === 1, false),
  ]);
  equal(decodeBoard(encodeBoard({ tiles, createdAt: 0 })).tiles, tiles);
});

test("codec: a board of the first version is moved onto this board", () => {
  const board = decodeBoard(VERSION_1_CODE);
  equal([board.author, board.parentId, board.code], [GOLDEN.author, GOLDEN.parentId, VERSION_1_CODE]);
  equal(board.tiles, [tile("A", 18, 2), tile("M", 58, 2, true), tile("'", 112, ROW_MAX, false, true), tile(">", BOARD_W - glyphWidth(">"), 6, false, true)]);
});

test("codec: lines of the first version that would run together or off the board are spaced and squeezed", () => {
  const old = [];
  for (let i = 0; i < 12; i += 1) old.push(tile("W", 16 + i * 41, 5));
  old.push(tile("I", 30, 6), tile("<", 400, 20));
  const board = decodeBoard(encodeVersion1(old));
  const onBoard = board.tiles.filter((t) => !t.loose);
  assert(nothingOverlaps(onBoard), "nothing on top of anything");
  assert(
    onBoard.every((t) => t.x >= 0 && t.x + glyphWidth(t.ch) <= BOARD_W),
    "all on the board",
  );
  equal(readLines(board.tiles), ["WIWWWWWWWWWWW", "←"]);
});

test("codec: no parent, no author and an empty board are fine", () => {
  const board = decodeBoard(encodeBoard({ tiles: [], createdAt: 0 }));
  equal([board.tiles, board.author, board.parentId, board.createdAt], [[], "", null, 0]);
});

test("codec: different boards get different ids", () => {
  const a = decodeBoard(encodeBoard({ tiles: [tile("A", 16, 2)], createdAt: 0 }));
  const b = decodeBoard(encodeBoard({ tiles: [tile("A", 17, 2)], createdAt: 0 }));
  assert(a.id !== b.id);
});

test("codec: names are tidied and cut to length", () => {
  equal(cleanAuthor("  Ann \n\t Bo  "), "Ann Bo");
  equal([...cleanAuthor("x".repeat(100))].length, 40);
  equal(cleanAuthor("🙂".repeat(50)), "🙂".repeat(40), "cut between characters, not inside one");
  equal(cleanAuthor(null), "");
  equal(decodeBoard(encodeBoard({ tiles: [], author: "🙂 Åse", createdAt: 0 })).author, "🙂 Åse");
});

test("codec: rejects what is not a board", () => {
  const valid = encodeBoard({ tiles: [tile("A", 16, 2)], createdAt: 0 });
  throws(() => decodeBoard(""), "empty");
  throws(() => decodeBoard(null), "not a string");
  throws(() => decodeBoard("hello world!"), "not base64url");
  throws(() => decodeBoard(valid.slice(0, -3)), "cut short");
  throws(() => decodeBoard(`${valid}AAAA`), "too long");
  throws(() => decodeBoard(`Aw${valid.slice(2)}`), "another version");
  throws(() => decodeBoard(encodeBoard({ tiles: [tile("A", 16, 1)], createdAt: 0 })), "row above the board");
  throws(() => decodeBoard(encodeBoard({ tiles: [tile("A", 16, ROW_MAX + 1)], createdAt: 0 })), "row below the board");
});

test("codec: refuses to encode letters the board does not have, or too many", () => {
  throws(() => encodeBoard({ tiles: [tile("!", 16, 2)] }));
  throws(() => encodeBoard({ tiles: [tile("", 16, 2)] }));
  throws(() => encodeBoard({ tiles: Array(MAX_TILES + 1).fill(tile("A", 0, 2)) }));
});

test("codec: a letter hanging over the edge is pulled back onto the board", () => {
  const code = encodeBoard({ tiles: [tile("W", BOARD_W - 1, 2)], createdAt: 0 });
  equal(decodeBoard(code).tiles[0].x, BOARD_W - glyphWidth("W"));
});

// --- Rules of the board ------------------------------------------------------------

test("board: letters block each other on the same line only, and may stand close", () => {
  const tiles = withIds([tile("A", 100, 5)]);
  const edge = 100 + glyphWidth("A") + MIN_GAP;
  assert(blockerAt(tiles, "B", 100, 5), "same place");
  assert(blockerAt(tiles, "B", edge - 1, 5), "touching");
  assert(!blockerAt(tiles, "B", edge, 5), "as close as can be");
  assert(blockerAt(tiles, "B", 100, 5 + LINE_STEP - 1), "overlapping line");
  assert(!blockerAt(tiles, "B", 100, 5 + LINE_STEP), "next line");
  assert(!blockerAt(tiles, "B", 100, 5, "x0"), "a tile does not block itself");
});

test("board: finds the next free place on a line, a typing gap after what is in the way", () => {
  const [a, b, c] = spaced("ABC", 100);
  const tiles = [tile("A", a, 5), tile("B", b, 5)];
  equal(freeXForward(tiles, "C", 0, 5), 0);
  equal(freeXForward(tiles, "C", 110, 5), c);
  equal(freeXForward(tiles, "C", 570, 5), null, "past the edge");
  equal(freeXForward([tile("A", BOARD_W - 40, 5)], "C", BOARD_W - 60, 5), null, "no room before the edge");
});

test("board: finds the nearest free place on a line", () => {
  const tiles = [tile("A", 100, 5)];
  equal(freeXNearest(tiles, "B", 300, 5), 300);
  equal(freeXNearest(tiles, "B", 90, 5), 100 - MIN_GAP - glyphWidth("B"), "nearer to the left");
  equal(freeXNearest(tiles, "B", 120, 5), 100 + glyphWidth("A") + MIN_GAP, "nearer to the right");
  equal(freeXNearest(tiles, "B", -50, 5), 0, "kept on the board");
  equal(freeXNearest(tiles, "B", 9999, 5), BOARD_W - glyphWidth("B"), "kept on the board");
  const full = spaced("W".repeat(20), 0).map((x) => tile("W", x, 5));
  equal(freeXNearest(full, "B", 200, 5), null, "a full line");
});

test("board: typing wraps to the next line, and from the last line to the top", () => {
  const full = Array.from({ length: 12 }, (_, i) => tile("W", i * 48, 5));
  equal(typingSlot(full, "B", { x: 200, row: 5 }), { x: MARGIN_X, row: 5 + LINE_STEP });
  equal(typingSlot([], "B", { x: BOARD_W, row: ROW_MAX }), { x: MARGIN_X, row: ROW_MIN });
});

test("board: text is laid out and read back", () => {
  const tiles = layoutText([
    { row: 2, text: "HEJ MED" },
    { row: 5, text: "DIG" },
  ]);
  equal(tiles.length, 9);
  equal(
    tiles.slice(0, 3).map((t) => t.x),
    spaced("HEJ"),
  );
  equal(tiles[3].x, after("J", spaced("HEJ")[2]) + WORD_GAP, "a space after HEJ");
  equal(readLines(tiles), ["HEJ MED", "DIG"]);
  assert(nothingOverlaps(tiles));
});

test("board: upside-down letters read as what they look like", () => {
  const tiles = [tile("M", 16, 2, true), tile("6", 70, 2, true), tile(">", 130, 2, true), tile(">", 220, 2), tile("A", 310, 2, true), tile(",", 380, 2, true)];
  equal(readLines(tiles), ["W9 ← → A '"]);
});

test("board: the message leaves out the pile of unused letters", () => {
  equal(messageText([tile("H", 16, 2), tile("I", 58, 2), tile("X", 300, 25, false, true)]), "HI");
  equal(messageText([tile("X", 300, 25, false, true)]), "X", "unless the pile is all there is");
});

test("board: the original is Marianne's board, as in the design", () => {
  equal([ORIGINAL.tiles.length, ORIGINAL.author, ORIGINAL.parentId], [61, "Marianne", null]);
  equal(messageText(ORIGINAL.tiles), MARIANNE);
  assert(nothingOverlaps(ORIGINAL.tiles), "nothing on top of anything");
  assert(
    ORIGINAL.tiles.every((t) => t.x >= 0 && t.x + glyphWidth(t.ch) <= BOARD_W && !t.loose),
    "all on the board",
  );
});

test("leftovers: put aside, loose, all of them, the right way up, in some order", () => {
  const leftovers = layoutText([{ row: 2, text: "ABCDEFGHIJW" }]);
  for (let seed = 1; seed <= 20; seed += 1) {
    const aside = putAside(leftovers, seededRandom(seed));
    equal(aside.map((t) => t.ch).sort().join(""), "ABCDEFGHIJW");
    assert(aside.every((t) => t.loose && t.row === ROW_MAX), "a valid place");
    assert(decodeBoard(encodeBoard({ tiles: aside, createdAt: 0 })).tiles.length === aside.length, "can be saved");
  }
  assert(putAside(leftovers, seededRandom(3)).every((t) => !t.flip), "none upside down");
  const orders = new Set([1, 2, 3, 4, 5].map((seed) => putAside(leftovers, seededRandom(seed)).map((t) => t.ch).join("")));
  assert(orders.size > 1, "shuffled");
});

// --- The table ---------------------------------------------------------------------

const ZONE = { x: 740, y: 16, w: 740, h: 1000, beside: true };

test("table: sorter a-z lays the letters out in rows, letters before digits before marks", () => {
  const chars = [..."Z9*A-B>,_1"];
  const places = sortedPlaces(chars, ZONE);
  const order = chars.map((ch, i) => ({ ch, ...places[i] })).sort((a, b) => a.y - b.y || a.x - b.x);
  equal(order.map((p) => p.ch).join(""), "ABZ19-_,>*");
  assert(places.every((p) => !p.flip && p.x >= ZONE.x), "the right way up, on the table");
  const many = sortedPlaces([...ORIGINAL.tiles.map((t) => t.ch)], ZONE);
  const rows = new Set(many.map((p) => p.y));
  assert(rows.size > 2 && many.every((p, i) => p.x + glyphWidth(ORIGINAL.tiles[i].ch) <= ZONE.x + 40 + 572 + 1), "wrapped into rows");
  equal(sortKey("Å") < sortKey("0") && sortKey("9") < sortKey("-") && sortKey(">") < sortKey("*"), true);
});

test("table: the dice throws the letters in a heap, apart, the right way up, and the same way for the same seed", () => {
  const chars = ORIGINAL.tiles.map((t) => t.ch);
  const places = scatteredPlaces(chars, ZONE, seededRandom(7));
  equal(places, scatteredPlaces(chars, ZONE, seededRandom(7)));
  assert(places.every((p) => !p.flip && p.x > ZONE.x && p.y > ZONE.y && p.y < ZONE.y + ZONE.h), "on the table");
  const middles = places.map((p, i) => ({ x: p.x + glyphWidth(chars[i]) / 2, y: p.y }));
  const closest = Math.min(...middles.flatMap((a, i) => middles.slice(i + 1).map((b) => Math.hypot(a.x - b.x, a.y - b.y))));
  assert(closest > 25, `not on top of each other (closest ${closest.toFixed(0)})`);
});

test("table: letters put down on the table push away the ones they would cover, and leave the rest be", () => {
  const word = [{ ch: "N", x: 800, y: 100 }, { ch: "E", x: 850, y: 100 }, { ch: "J", x: 990, y: 101 }];
  const others = [
    { ch: "A", x: 805, y: 105 }, // under the N
    { ch: "B", x: 920, y: 90 }, // between the words
    { ch: "C", x: 1100, y: 500 }, // far off
    { ch: "D", x: 1102, y: 502 }, // on top of the C, and stays there
  ];
  const area = { left: 740, top: 16, right: 1480, bottom: 1016 };
  const places = madeRoom(word, others, area);
  const box = (ch, p) => ({ l: p.x, r: p.x + glyphWidth(ch), t: p.y - 30, b: p.y + 30 });
  const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const boxes = places.map((p, i) => box(others[i].ch, p));
  for (const i of [0, 1]) {
    assert(!word.some((w) => hit(boxes[i], box(w.ch, w))), `${others[i].ch} is out from under the words`);
    assert(boxes[i].b <= 100 - 30 - 25 || boxes[i].t >= 101 + 30 + 25, `${others[i].ch} is off the line, all the way across`);
    assert(!boxes.some((other, j) => j !== i && hit(boxes[i], other)), `${others[i].ch} is not put on another letter`);
    assert(Math.hypot(places[i].x - others[i].x, places[i].y - others[i].y) < 200, `${others[i].ch} moved only a little`);
    const clearOf = (a, b) => a.l >= b.r + 25 || b.l >= a.r + 25 || a.t >= b.b + 25 || b.t >= a.b + 25;
    assert(word.every((w) => clearOf(boxes[i], box(w.ch, w))), `${others[i].ch} leaves room around the word`);
    assert(places[i].x >= area.left && places[i].y - 30 >= area.top, "still on the table");
  }
  equal(places.slice(2), [{ x: 1100, y: 500 }, { x: 1102, y: 502 }], "the others stay, also on top of each other");
});

test("table: letters moved to a table of another size go inside it, and apart", () => {
  const area = { left: 0, top: 0, right: 300, bottom: 200 };
  const places = spreadOut(
    [
      { ch: "A", x: 50, y: 50 },
      { ch: "B", x: 52, y: 52 }, // on the A
      { ch: "C", x: 900, y: 900 }, // off the table
    ],
    area,
  );
  const boxes = places.map((p, i) => ({ l: p.x, r: p.x + glyphWidth("ABC"[i]), t: p.y - 30, b: p.y + 30 }));
  equal(places[0], { x: 50, y: 50 }, "the first stays");
  assert(boxes[1].l >= boxes[0].r || boxes[1].r <= boxes[0].l || boxes[1].t >= boxes[0].b || boxes[1].b <= boxes[0].t, "the B off the A");
  assert(boxes.every((b) => b.l >= 0 && b.r <= 300 && b.t >= 0 && b.b <= 200), "all on the table");
});

// --- Editing -------------------------------------------------------------------------

function newEditor() {
  const pool = new Pool(ORIGINAL.tiles);
  return { pool, editor: new Editor(pool) };
}

const text = (editor) => readLines(editor.tiles).join("/");

test("editor: typing takes letters from the previous message", () => {
  const { pool, editor } = newEditor();
  equal([editor.type("N"), editor.type("E"), editor.type("J")], ["ok", "ok", "ok"]);
  const [n, e, j] = spaced("NEJ");
  equal(
    editor.tiles.map((t) => [t.ch, t.x, t.row]),
    [
      ["N", n, 2],
      ["E", e, 2],
      ["J", j, 2],
    ],
  );
  equal(pool.leftovers.length, 58);
  equal(editor.cursor, { x: after("J", j), row: 2 });
  equal(editor.type("J"), "missing", "there is only one J");
  equal(editor.type("Q"), "missing");
});

test("editor: letters are taken in reading order", () => {
  const { pool, editor } = newEditor();
  editor.type("E");
  equal(
    pool.tiles.findIndex((t) => t.used),
    1,
    "the first E is the second letter of LEBBE",
  );
});

test("editor: when a letter has run out, no other letter is turned around to stand in for it", () => {
  const { editor } = newEditor();
  equal([editor.type("W"), editor.type("W")], ["ok", "missing"], "one W, and the two M stay on the table");
  equal(editor.type("6"), "ok");
  equal(editor.type("6"), "missing", "the 9s stay on the table");
  equal(
    editor.tiles.map((t) => [t.ch, t.flip]),
    [
      ["W", false],
      ["6", false],
    ],
  );
});

test("editor: space, new line and backspace", () => {
  const { pool, editor } = newEditor();
  editor.type("E");
  editor.space();
  editor.type("L");
  editor.newLine();
  editor.type("I");
  equal(text(editor), "E L/I");
  equal(editor.cursor.row, 2 + LINE_STEP);

  editor.backspace();
  equal(text(editor), "E L", "the I is gone");
  editor.backspace();
  equal(editor.cursor, { x: after("L", after("E", MARGIN_X) + WORD_GAP), row: 2 }, "back on the first line");
  editor.backspace();
  equal(text(editor), "E", "the L is gone");
  editor.backspace();
  editor.backspace();
  equal([editor.tiles.length, editor.cursor, pool.leftovers.length], [0, { x: MARGIN_X, row: 2 }, 61]);
  editor.backspace();
  equal(editor.tiles.length, 0, "nothing more to take away");
});

test("editor: after the cursor is moved, backspace takes the letter before it", () => {
  const { editor } = newEditor();
  for (const ch of "SALLE") editor.type(ch);
  editor.cursorAfter(editor.tiles[1].id);
  editor.backspace();
  equal(text(editor), "S LLE");
  editor.type("A");
  equal(text(editor), "SALLE", "typed back into the hole");

  editor.setCursor(16, 2 + LINE_STEP);
  editor.backspace();
  equal(text(editor), "SALL", "from an empty line it takes the end of the line above");
});

test("editor: a line that is full continues on the next", () => {
  const editor = new Editor(endless);
  const perLine = spaced("A".repeat(30)).filter((x) => x + glyphWidth("A") <= BOARD_W).length;
  for (let i = 0; i <= perLine; i += 1) editor.type("A");
  equal(editor.tiles.filter((t) => t.row === 2).length, perLine);
  equal([editor.tiles[perLine].x, editor.tiles[perLine].row], [MARGIN_X, 5]);
});

test("editor: reports a full board", () => {
  const editor = new Editor(endless);
  let result = "ok";
  let typed = 0;
  while (result === "ok" && typed < 1000) {
    result = editor.type("W");
    typed += 1;
  }
  equal(result, "full");
  assert(nothingOverlaps(editor.tiles));
});

test("editor: letters can be dropped, moved, turned and taken off", () => {
  const { pool, editor } = newEditor();
  editor.type("A");
  equal(editor.drop(pool.find("B"), MARGIN_X + 4, 2), "ok");
  const [a, b] = editor.tiles;
  equal([b.x, b.row], [MARGIN_X + glyphWidth("A") + MIN_GAP, 2], "dropped next to the A, not on it");

  editor.moveTo(b.id, 200, 9.4);
  equal([b.x, b.row], [200, 9]);
  editor.moveTo(a.id, 16, 500);
  equal(a.row, ROW_MAX, "kept on the board");

  editor.flip(a.id);
  equal(a.flip, true);

  editor.remove(b.id);
  equal([editor.tiles.length, pool.leftovers.length], [1, 60]);
  editor.removeBySource(a.src);
  equal([editor.tiles.length, pool.leftovers.length], [0, 61]);
});

test("editor: a letter taken off the board remembers where it was, until it is laid on the table", () => {
  const { pool, editor } = newEditor();
  editor.type("A");
  const [a] = editor.tiles;
  editor.flip(a.id);
  editor.remove(a.id);
  const back = pool.tile(a.src);
  equal([back.used, back.x, back.row, back.flip, back.table], [false, a.x, a.row, true, null]);
  pool.lay(a.src, { x: 900, y: 300, flip: true });
  equal(pool.tile(a.src).table, { x: 900, y: 300, flip: true });
  editor.drop(pool.piece(a.src), 100, 9);
  pool.lay(a.src, { x: 1, y: 1 });
  equal(pool.tile(a.src).table, null, "a letter on the board is not on the table");
});

test("editor: clear gives every letter back", () => {
  const { pool, editor } = newEditor();
  for (const ch of "LEBBE") editor.type(ch);
  editor.clear();
  equal([editor.tiles.length, pool.leftovers.length, editor.cursor], [0, 61, { x: MARGIN_X, row: 2 }]);
});

test("editor: an unfinished message can be put back", () => {
  const first = newEditor();
  for (const ch of "NEJ") first.editor.type(ch);
  first.editor.flip(first.editor.tiles[1].id);
  const draft = first.editor.tiles.map(({ src, x, row, flip }) => ({ src, x, row, flip }));

  const second = newEditor();
  second.editor.restore([...draft, { src: "s999", x: 0, row: 2, flip: false }, { src: draft[0].src, x: 300, row: 2, flip: false }]);
  equal(text(second.editor), "NEJ", "unknown and already used letters are skipped");
  equal(second.editor.tiles[1].flip, true);
  equal(second.pool.leftovers.length, 58);
});

// --- Saved boards --------------------------------------------------------------------

const someBoard = (ch = "A", parentId = null) => decodeBoard(encodeBoard({ tiles: [tile(ch, 16, 2)], author: "Ann", createdAt: 60000, parentId }));

test("library: starts with the original", () => {
  const library = new Library(fakeStorage());
  equal([library.saved.length, library.source.id], [0, ORIGINAL.id]);
  equal(library.titleOf(ORIGINAL), MARIANNE);
  equal(library.find(ORIGINAL.id), ORIGINAL);
});

test("library: boards are kept once, and remembered", () => {
  const storage = fakeStorage();
  const library = new Library(storage);
  const board = someBoard();
  const kept = library.keep(board, "mine");
  equal(library.keep(board, "link"), kept, "keeping it again changes nothing");
  equal(library.keep(ORIGINAL, "link"), ORIGINAL, "the original is never saved");
  library.keep(someBoard("B"), "link");
  equal(
    library.saved.map((b) => b.origin),
    ["link", "mine"],
    "newest first",
  );

  const again = new Library(storage);
  equal(
    again.saved.map((b) => [b.id, b.origin]),
    library.saved.map((b) => [b.id, b.origin]),
  );
  equal(again.titleOf(again.find(board.id)), "A");
});

test("library: a forgotten board can be put back where it was", () => {
  const storage = fakeStorage();
  const library = new Library(storage);
  const ids = ["A", "B", "C"].map((ch) => library.keep(someBoard(ch), "mine").id).reverse();
  const putBack = library.forget(ids[1]);
  equal(
    library.saved.map((b) => b.id),
    [ids[0], ids[2]],
  );
  equal(new Library(storage).saved.length, 2);
  putBack();
  equal(
    library.saved.map((b) => b.id),
    ids,
  );
  equal(new Library(storage).saved.length, 3);
});

test("library: remembers the name, but not the board in play, nor where its letters lie", () => {
  const storage = fakeStorage();
  const library = new Library(storage);
  library.source = someBoard();
  library.author = "Bo";
  library.save();
  const stored = JSON.parse(storage.getItem(STORAGE_KEY));
  assert(!("draft" in stored) && !("source" in stored), "neither is saved");

  const again = new Library(storage);
  equal([again.source.id, again.author], [ORIGINAL.id, "Bo"]);
});

test("library: survives broken storage", () => {
  equal(new Library(fakeStorage({ [STORAGE_KEY]: "{not json" })).saved.length, 0);
  const odd = { boards: [{ code: "nope" }, null, { code: someBoard().code, origin: "weird" }], source: 5, draft: "x", draftVersion: 2 };
  const library = new Library(fakeStorage({ [STORAGE_KEY]: JSON.stringify(odd) }));
  equal([library.saved.length, library.saved[0]?.origin, library.source.id], [1, "mine", ORIGINAL.id]);
});

test("library: reads the gallery, newest first, skipping what it cannot read", () => {
  const library = new Library(fakeStorage());
  const [a, b] = [someBoard("A"), someBoard("B")];
  library.setGallery({ boards: [{ code: a.code }, { code: "garbage" }, {}, { code: b.code }, { code: a.code }] });
  equal(
    library.gallery.map((board) => board.id),
    [b.id, a.id],
  );
  equal(library.find(b.id).id, b.id);
  library.setGallery(null);
  equal(library.gallery, []);
});

test("library: the gallery lists its boards and this browser's, newest first, each once, and forgets the copies kept here", () => {
  const storage = fakeStorage();
  const library = new Library(storage);
  const board = (text, createdAt) => decodeBoard(encodeBoard({ tiles: layoutText([{ row: 5, text }]), author: "Bo", createdAt }));
  const [old, shared, mine] = [board("A", 60000), board("B", 120000), board("C", 180000)];
  library.keep(old, "mine");
  library.keep(shared, "link");
  library.keep(mine, "mine");
  library.setGallery({ boards: [{ code: ORIGINAL.code }, { code: shared.code }] });

  equal(
    library.listed.map((b) => [messageText(b.tiles), b.origin ?? "gallery"]),
    [
      ["C", "mine"],
      ["B", "gallery"],
      ["A", "mine"],
    ],
  );
  equal(new Library(storage).saved.length, 2, "the copy of the gallery's board is gone from the storage");
});

test("library: carries over boards saved by the first version of the site", () => {
  const snapshot = (tiles, boardWidth = 420) => ({ boardWidth, boardHeight: 520, tiles });
  const old = {
    history: [
      {
        id: "msg_2",
        parentId: "msg_1",
        writerName: "Bo",
        title: "HI",
        createdAt: "2026-04-02T10:00:00.000Z",
        snapshot: snapshot([
          { token: "H", x: 16, y: 16.5, rotation: 0 },
          { token: "I", x: 58, y: 16.5, rotation: 180 },
        ]),
      },
      {
        id: "msg_1",
        parentId: "original-root",
        writerName: "Ann",
        title: "PIL",
        createdAt: "2026-04-01T10:00:00.000Z",
        snapshot: snapshot(
          [
            { token: ">", x: 580, y: 576.5, rotation: 0 },
            { token: "<", x: 0, y: 76.5, rotation: 180 },
            { token: "?", x: 0, y: 0 },
          ],
          1040,
        ),
      },
      { id: "original-root", parentId: null, snapshot: snapshot([]) },
    ],
    activeMode: "history",
    activeSourceId: "msg_2",
    lastWriterName: "Bo",
  };
  const storage = fakeStorage({ "letterboard.v6": JSON.stringify(old) });
  const library = new Library(storage);
  assert(!storage.data.has("letterboard.v6") && storage.data.has(STORAGE_KEY), "the old storage is cleared once carried over");

  equal(
    library.saved.map((b) => [library.titleOf(b), b.author, b.origin]),
    [
      ["HI", "Bo", "mine"],
      ["PIL", "Ann", "mine"],
    ],
  );
  const [child, parent] = library.saved;
  equal([child.parentId, parent.parentId], [parent.id, ORIGINAL.id]);
  equal(child.tiles, [tile("H", 16, 2), tile("I", 58, 2, true)]);
  equal(parent.tiles, [tile(">", 323, 30), tile(">", 0, 5)], "arrows become one piece; wide boards are squeezed");
  equal(child.createdAt, Date.parse("2026-04-02T10:00:00.000Z"));
  equal([library.source.id, library.author], [ORIGINAL.id, "Bo"], "the name is carried over; the site opens on the original");
});

test("library: a board that goes into the gallery is listed there, once, and no longer kept here", () => {
  const storage = fakeStorage();
  const library = new Library(storage);
  const mine = library.keep(someBoard("A"), "mine");
  library.keep(someBoard("B"), "link");
  library.source = mine;
  equal(library.unsent.map((b) => b.id), [mine.id], "only the boards saved here wait to go into the gallery");

  const shared = library.addToGallery(mine, "abc2345");
  equal([shared.shortId, shared.origin, library.source], ["abc2345", undefined, shared]);
  equal(library.addToGallery(mine, "zzz9999"), shared, "only once");
  equal([library.listed.length, library.unsent.length, new Library(storage).saved.length], [2, 0, 1]);

  library.setGallery({ boards: [{ code: mine.code, id: "abc2345" }] });
  equal(library.gallery[0].shortId, "abc2345", "the gallery's boards have their short ids");
});

test("share: a board in the gallery has a short link, any other its whole code", () => {
  const board = someBoard();
  assert(shareUrl(board).endsWith(`#b=${board.code}`));
  assert(shareUrl({ ...board, shortId: "k3x9q2m" }).endsWith("#k3x9q2m"));
  equal(readLink(`#b=${board.code}`), { code: board.code });
  equal(readLink("#k3x9q2m"), { shortId: "k3x9q2m" });
  equal([readLink(""), readLink("#"), readLink("#Not-A-Board")], [null, null, null]);
});

test("api: asks the gallery's server, and none is asked without an address", async () => {
  equal(galleryApi(""), null);
  const asked = [];
  const answers = {
    "GET /boards?limit=500": { boards: [{ id: "new", code: "B" }, { id: "old", code: "A" }], next: null },
    "GET /boards/k3x9q2m": { id: "k3x9q2m", code: "C" },
    "POST /boards": { id: "made" },
  };
  const api = galleryApi("https://api.example", async (url, init = {}) => {
    const key = `${init.method ?? "GET"} ${url.replace("https://api.example", "")}`;
    asked.push([key, init.body]);
    return new Response(JSON.stringify(answers[key] ?? {}), { status: answers[key] ? 200 : 404 });
  });
  equal(await api.list(), { boards: [{ id: "old", code: "A" }, { id: "new", code: "B" }] }, "oldest first, as the library takes it");
  equal(await api.get("k3x9q2m"), "C");
  equal(await api.save("D"), "made");
  equal(asked.at(-1), ["POST /boards", JSON.stringify({ code: "D" })]);
  let failed = false;
  await api.get("nothere").catch(() => (failed = true));
  assert(failed, "an error answer is an error");
});

// --- The gallery's server (worker/) ---------------------------------------------------

/** The boards in memory, as the worker's store keeps them in the database. */
function memoryStore() {
  const rows = [];
  return {
    rows,
    findByCode: async (code) => rows.find((row) => row.code === code) ?? null,
    get: async (id) => rows.find((row) => row.id === id && !row.hidden) ?? null,
    list: async ({ limit, before }) =>
      rows
        .filter((row) => !row.hidden && row.addedAt < before)
        .sort((a, b) => b.addedAt - a.addedAt)
        .slice(0, limit)
        .map(({ id, code, addedAt }) => ({ id, code, addedAt })),
    countSince: async (sender, since) => rows.filter((row) => row.sender === sender && row.addedAt >= since).length,
    insert: async (row) => {
      if (rows.some((other) => other.id === row.id || other.code === row.code)) return false;
      rows.push({ ...row, hidden: false });
      return true;
    },
  };
}

function server(options = {}) {
  const store = memoryStore();
  let ids = 0;
  let now = 1_000_000;
  const ask = async (method, path, { body, origin = "https://www.nizzedart.de", ip = "1.2.3.4" } = {}) => {
    // As the worker gets it. A browser will not let a page make a Request with its own Origin header.
    const request = { method, url: `https://api.example${path}`, headers: new Headers({ Origin: origin, "CF-Connecting-IP": ip }), text: async () => body ?? "" };
    now += 1000;
    const response = await handle(request, { store, origins: ["https://www.nizzedart.de"], now, randomId: () => `id${(ids += 1)}aaaa`, ...options });
    return { status: response.status, body: response.status === 204 ? null : await response.json(), headers: response.headers };
  };
  return { store, ask };
}

const boardWith = (text) => encodeBoard({ tiles: layoutText([{ row: 5, text }]), author: "Bo" });

test("worker: a board goes into the gallery and gets a short id, the same one if it comes again", async () => {
  const { ask } = server();
  const code = boardWith("HEJ");
  const first = await ask("POST", "/boards", { body: JSON.stringify({ code }) });
  equal([first.status, first.body], [201, { id: "id1aaaa" }]);
  const again = await ask("POST", "/boards", { body: JSON.stringify({ code }), ip: "5.6.7.8" });
  equal([again.status, again.body], [200, { id: "id1aaaa" }]);
  equal((await ask("GET", "/boards/id1aaaa")).body, { id: "id1aaaa", code });
  equal((await ask("GET", "/boards/nothere")).status, 404);
});

test("worker: refuses what is not a board, and an empty one", async () => {
  const { ask, store } = server();
  for (const body of ["not json", JSON.stringify({}), JSON.stringify({ code: "AAAAAAAAAAAAAAAA" }), JSON.stringify({ code: 42 })]) {
    equal((await ask("POST", "/boards", { body })).status, 400, body);
  }
  const empty = encodeBoard({ tiles: [tile("A", 0, ROW_MAX, false, true)], author: "Bo" });
  equal((await ask("POST", "/boards", { body: JSON.stringify({ code: empty }) })).status, 400, "only loose letters");
  equal((await ask("POST", "/boards", { body: "x".repeat(5000) })).status, 413);
  equal(store.rows.length, 0);
});

test("worker: lists the gallery newest first, a page at a time, without the hidden boards", async () => {
  const { ask, store } = server();
  for (const text of ["A", "B", "C", "D"]) await ask("POST", "/boards", { body: JSON.stringify({ code: boardWith(text) }) });
  store.rows[1].hidden = true;
  const page = await ask("GET", "/boards?limit=2");
  equal(page.body.boards.map((b) => b.id), ["id4aaaa", "id3aaaa"]);
  const rest = await ask("GET", `/boards?limit=2&before=${page.body.next}`);
  equal([rest.body.boards.map((b) => b.id), rest.body.next], [["id1aaaa"], null]);
  equal((await ask("GET", "/boards/id2aaaa")).status, 404, "a hidden board's link no longer works");
});

test("worker: one sender can only add so many boards an hour", async () => {
  const { ask } = server({ savesPerHour: 2 });
  const save = (text, ip) => ask("POST", "/boards", { body: JSON.stringify({ code: boardWith(text) }), ip });
  equal([(await save("A")).status, (await save("B")).status, (await save("C")).status], [201, 201, 429]);
  equal((await save("C", "9.9.9.9")).status, 201, "another sender can");
});

test("worker: only the site may call it from a browser", async () => {
  const { ask } = server();
  equal((await ask("GET", "/boards")).headers.get("Access-Control-Allow-Origin"), "https://www.nizzedart.de");
  equal((await ask("GET", "/boards", { origin: "https://elsewhere.example" })).headers.get("Access-Control-Allow-Origin"), null);
  const preflight = await ask("OPTIONS", "/boards");
  equal([preflight.status, preflight.headers.get("Access-Control-Allow-Methods")], [204, "GET, POST, OPTIONS"]);
  equal((await ask("DELETE", "/boards/id1aaaa")).status, 404);
});

// --- The page itself -------------------------------------------------------------------

const frame = document.querySelector("#app");
const appPage = params.get("app") ?? "index.html";
let loads = 0;

const win = () => frame.contentWindow;
const $ = (selector) => frame.contentDocument.querySelector(selector);
const $$ = (selector) => [...frame.contentDocument.querySelectorAll(selector)];

function navigate(url) {
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  frame.src = url;
  return loaded;
}

/** Load the page afresh. `storage` is what the browser remembers from before. */
async function openApp({ hash = "", storage = null } = {}) {
  // Leave the previous page first: it saves its state on the way out.
  await navigate("about:blank");
  localStorage.removeItem(STORAGE_KEY);
  if (storage) localStorage.setItem(STORAGE_KEY, storage);
  loads += 1;
  await navigate(`${appPage}?load=${loads}${hash}`);
  await until(() => $("#felt .piece") && $("#galleryList .card"), "the page to start");
}

function press(key, options = {}) {
  // Keys go to whatever has the focus. A dialog that closed a moment ago has not let go of it yet.
  const active = frame.contentDocument.activeElement;
  const target = !active || active.closest("dialog:not([open])") ? frame.contentDocument.body : active;
  target.dispatchEvent(new (win().KeyboardEvent)("keydown", { key, bubbles: true, cancelable: true, ...options }));
}

function typeText(textToType) {
  for (const key of textToType) press(key === "\n" ? "Enter" : key);
}

const centre = (node) => {
  const rect = node.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};

function pointer(type, target, { x, y }, pointerType = "mouse") {
  const options = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType, button: 0, isPrimary: true };
  target.dispatchEvent(new (win().PointerEvent)(type, options));
}

function tap(node, pointerType = "mouse") {
  const at = centre(node);
  pointer("pointerdown", node, at, pointerType);
  pointer("pointerup", node, at, pointerType);
}

/** Drag a letter by (dx, dy) pixels, in a few steps. */
function drag(node, dx, dy, pointerType = "mouse") {
  const felt = $("#felt");
  const from = centre(node);
  pointer("pointerdown", node, from, pointerType);
  for (const part of [0.25, 0.5, 0.75, 1]) pointer("pointermove", felt, { x: from.x + dx * part, y: from.y + dy * part }, pointerType);
  pointer("pointerup", felt, { x: from.x + dx, y: from.y + dy }, pointerType);
}

/** Drag a letter so that its middle ends up at a point on the page. */
function dragTo(node, to, pointerType = "mouse") {
  const from = centre(node);
  drag(node, to.x - from.x, to.y - from.y, pointerType);
}

/** How many pixels one board unit is, as the page is shown. */
const pixelsPerUnit = () => $("#felt").getBoundingClientRect().width / FELT_W;

const onBoard = () => $$("#felt .pieces .piece.on-board");
const onTable = () => $$("#felt .pieces .piece.on-table");
const boardText = () => $("#felt").getAttribute("aria-label").replace(/^Tavlen: /, "");
const turned = (node) => node.style.getPropertyValue("--turn") === "180deg";
const place = (node) => [Number(node.style.getPropertyValue("--x")), Number(node.style.getPropertyValue("--y"))];
const pieceOf = (ch) => onTable().find((node) => node.dataset.ch === ch);
/** The cards in the gallery of boards kept only in this browser: those can be deleted. */
const localCards = () => $$("#galleryList .card").filter((card) => [...card.querySelectorAll("button")].some((button) => button.textContent === "slet"));

async function saveAs(name) {
  $("#saveButton").click();
  await until(() => $("#authorDialog").open, "the name dialog");
  $("#authorInput").value = name;
  $("#authorDialog button[value=save]").click();
  await until(() => $("#shareDialog").open, "the share dialog");
  return new URL($("#shareLink").value).hash.slice(3);
}

test("page: shows Marianne's board, made by her", async () => {
  await openApp();
  equal([onBoard().length, onTable().length], [61, 0]);
  equal(boardText(), MARIANNE);
  equal($("#byline").textContent, "lavet af Marianne");
  assert(!$("#felt .cursor"), "no cursor until there is typing");
  assert($("#menu").hidden, "the menu is shut");
  // Each letter hangs by its middle in a groove.
  assert(onBoard().every((node) => place(node)[1] % GROOVE === 0));
});

test("page: the arrow takes every letter off the board, onto the table beside it, as they were", async () => {
  await openApp();
  const [l, e] = onBoard();
  const before = [place(l), place(e)];
  $("#removeButton").click();
  equal([onBoard().length, onTable().length], [0, 61]);
  equal(boardText(), "tom");
  const [l2, e2] = [l, e].map(place);
  assert(l2[0] > FELT_W && e2[0] > FELT_W, "beside the board");
  const gap = (a, b) => b[0] - a[0];
  assert(Math.abs(gap(l2, e2) - gap(...before)) < 10, "still next to each other");
  $("#removeButton").click();
  assert($("#toast").textContent.includes("allerede tom"));
});

test("page: letters taken off the board keep their words, and the letters on the table make room for them", async () => {
  await openApp();
  $("#removeButton").click();
  $("#scatterButton").click();
  typeText("nej");
  const word = onBoard();
  const before = word.map(place);
  const others = onTable();
  const lying = others.map(place);

  $("#removeButton").click();
  const after = word.map(place);
  assert(word.every((node) => node.classList.contains("on-table")), "the word is on the table");
  assert(Math.abs(after[1][0] - after[0][0] - (before[1][0] - before[0][0])) < 10 && Math.abs(after[1][1] - after[0][1]) < 10, "and still reads as it did");
  const box = (node) => {
    const [x, y] = place(node);
    return { l: x, r: x + Number(node.style.getPropertyValue("--w")), t: y - 30, b: y + 30 };
  };
  const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  assert(!others.some((node) => word.some((letter) => hit(box(node), box(letter)))), "nothing lies on top of it");

  press("z", { ctrlKey: true });
  equal(others.map(place), lying, "undo puts the others back");
});

test("page: the dice throws the letters about on the table, and sorter a-z lays them out in order", async () => {
  await openApp();
  $("#removeButton").click();
  const before = onTable().map(place);
  $("#scatterButton").click();
  const after = onTable().map(place);
  assert(after.some((p, i) => p[0] !== before[i][0] || p[1] !== before[i][1]), "they moved");
  assert(onTable().every((node) => !turned(node)), "the right way up");

  $("#sortButton").click();
  const read = onTable()
    .map((node) => ({ ch: node.dataset.ch, at: place(node) }))
    .sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0])
    .map((p) => p.ch)
    .join("");
  const expected = ORIGINAL.tiles
    .map((t) => t.ch)
    .sort((a, b) => sortKey(a) - sortKey(b))
    .join("");
  equal(read, expected);
  assert(onTable().every((node) => !turned(node)), "the right way up, the arrows pointing right");
});

test("page: vis original shows the previous message on the board for as long as it is held", async () => {
  await openApp();
  $("#removeButton").click();
  const button = $("#originalButton");
  const shown = () => [button.classList.contains("is-held"), onBoard().length, onTable().length];

  pointer("pointerdown", button, centre(button));
  equal(shown(), [true, 61, 0], "held down: the letters of the message go back up on the board");
  pointer("pointerup", button, centre(button));
  equal(shown(), [false, 0, 61], "let go: and back down on the table");

  button.click();
  equal(shown(), [false, 0, 61], "a click is no toggle");

  const key = (type) => button.dispatchEvent(new (win().KeyboardEvent)(type, { key: " ", bubbles: true, cancelable: true }));
  key("keydown");
  equal(shown(), [true, 61, 0], "held with the space bar");
  key("keyup");
  equal(shown(), [false, 0, 61]);
  equal(onBoard().length, 0, "the space was not typed on the board");
});

test("page: vis original puts the letters put up from the table back on it while held, and the message where it was", async () => {
  const sent = encodeBoard({ tiles: [...layoutText([{ row: 5, text: "HEJ" }]), tile("X", 0, ROW_MAX, false, true)], author: "Bo" });
  await openApp({ hash: `#b=${sent}` });
  const x = pieceOf("X");
  const xOnTable = place(x);
  const h = onBoard().find((node) => node.dataset.ch === "H");
  const hOnBoard = place(h);
  drag(h, 0, 9 * GROOVE * pixelsPerUnit());
  typeText("x");
  assert(x.classList.contains("on-board"));
  const before = [boardText(), place(x), place(h)];

  const button = $("#originalButton");
  pointer("pointerdown", button, centre(button));
  assert(x.classList.contains("on-table") && !x.classList.contains("is-away"), "the X lies on the table again");
  equal(place(x), xOnTable, "where it lay");
  equal(place(h), hOnBoard, "the H is back in its place in the message");
  pointer("pointerup", button, centre(button));
  assert(x.classList.contains("on-board"), "and up on the board again, let go");
  equal([boardText(), place(x), place(h)], before, "everything as it was");
});

test("page: letters can be dragged from the table onto the board, into a groove, and off again", async () => {
  await openApp();
  $("#removeButton").click();
  const j = pieceOf("J");
  dragTo(j, centre($("#felt")));
  equal([onBoard().length, boardText()], [1, "J"]);
  assert(j.classList.contains("on-board") && !j.classList.contains("is-lifted"));
  equal(place(j)[1] % GROOVE, 0, "in a groove");

  const zone = $("#tableZone").getBoundingClientRect();
  dragTo(j, { x: zone.left + 60, y: zone.bottom - 60 });
  equal([onBoard().length, onTable().length], [0, 61]);
  const scale = pixelsPerUnit();
  const felt = $("#felt").getBoundingClientRect();
  const middle = { x: felt.left + (place(j)[0] + Number(j.style.getPropertyValue("--w")) / 2) * scale, y: felt.top + place(j)[1] * scale };
  assert(Math.abs(middle.x - (zone.left + 60)) < 3 && Math.abs(middle.y - (zone.bottom - 60)) < 3, "lying where it was let go");
});

test("page: letters on the board can be moved, turned with a tap, and taken off with a double tap", async () => {
  await openApp();
  const [l, e] = onBoard();
  const [x, y] = place(l);
  drag(l, 0, 9 * GROOVE * pixelsPerUnit());
  equal(place(l), [x, y + 9 * GROOVE], "moved down nine grooves");
  equal(onBoard().length, 61);
  tap(l);
  assert(turned(l), "a tap turns it, at once");
  tap(e);
  tap(e);
  assert(e.classList.contains("on-table") && !turned(e), "a double tap takes it off, the right way up");
  press("z", { ctrlKey: true });
  assert(e.classList.contains("on-board") && !turned(e), "and it is undone in one go");
});

test("page: a letter tapped on the table goes up at once, and is a letter on the board from then on", async () => {
  await openApp();
  $("#removeButton").click();
  const letter = pieceOf("J");
  tap(letter);
  assert(letter.classList.contains("on-board"), "up at once");
  tap(letter);
  assert(letter.classList.contains("on-board") && turned(letter), "the next tap turns it: the first was no tap on the board");
  tap(letter);
  assert(letter.classList.contains("on-table") && !turned(letter), "and a second takes it off");
});

test("page: a double tap takes a letter off the board, and a tap puts one on the table up at the cursor", async () => {
  await openApp();
  const l = onBoard()[0];
  const onBoardAt = place(l);
  tap(l);
  tap(l);
  equal(onBoard().length, 60, "off at once");
  assert(l.classList.contains("on-table"));
  const felt = $("#felt").getBoundingClientRect();
  const at = { x: felt.left + 300 * pixelsPerUnit(), y: felt.top + 600 * pixelsPerUnit() };
  pointer("pointerdown", $("#felt"), at);
  pointer("pointerup", $("#felt"), at);
  tap(l);
  assert(l.classList.contains("on-board"), "up at once");
  equal(place(l)[1], 30 * GROOVE, "at the cursor, not back where it was");
  assert(place(l)[1] !== onBoardAt[1]);

  // A letter typed from the table goes back to its place on the table.
  $("#removeButton").click();
  const e = pieceOf("E");
  const onTableAt = place(e);
  typeText("e");
  assert(e.classList.contains("on-board"));
  tap(e);
  tap(e);
  assert(e.classList.contains("on-table"), "off with a double tap");
  equal(place(e), onTableAt, "back in its place on the table");
});

test("page: a tap puts a letter that was never on the board up at the cursor", async () => {
  const sent = encodeBoard({ tiles: [...layoutText([{ row: 5, text: "HEJ" }]), tile("X", 0, ROW_MAX, false, true)], author: "Bo" });
  await openApp({ hash: `#b=${sent}` });
  const felt = $("#felt").getBoundingClientRect();
  const scale = pixelsPerUnit();
  const at = { x: felt.left + 300 * scale, y: felt.top + 600 * scale };
  pointer("pointerdown", $("#felt"), at);
  pointer("pointerup", $("#felt"), at);
  tap(pieceOf("X"));
  await until(() => onBoard().length === 4, "the letter to go up");
  equal(place(onBoard().find((node) => node.dataset.ch === "X"))[1], 30 * GROOVE, "at the cursor");
});

test("page: Ctrl+Z takes back what was done, and Ctrl+Shift+Z or Ctrl+Y does it again", async () => {
  await openApp();
  // Where every letter is, in the order of the letters (what was moved last lies on top, so the order on the page changes).
  const where = () =>
    $$("#felt .pieces .piece")
      .map((node) => [node.dataset.id, node.dataset.ch, node.classList.contains("on-board"), ...place(node)])
      .sort((a, b) => a[0].localeCompare(b[0]));
  const start = where();
  const undo = (options = {}) => press("z", { ctrlKey: true, ...options });

  $("#removeButton").click();
  const off = where();
  undo();
  equal(where(), start, "the letters are back on the board");
  press("Z", { ctrlKey: true, shiftKey: true });
  equal(where(), off, "and off it again");
  undo({ ctrlKey: false, metaKey: true });
  equal(where(), start, "Cmd+Z on a Mac");
  press("y", { ctrlKey: true });
  equal(where(), off, "Ctrl+Y");

  typeText("nej ");
  typeText("du");
  equal(boardText(), "NEJ DU");
  undo();
  equal(where(), off, "a run of typing is taken back in one go");
  press("y", { ctrlKey: true });
  equal(boardText(), "NEJ DU");

  $("#sortButton").click();
  const sorted = where();
  $("#scatterButton").click();
  undo();
  equal(where(), sorted, "the dice is taken back");

  const n = onBoard().find((node) => node.dataset.ch === "N");
  const before = where();
  drag(n, 0, 9 * GROOVE * pixelsPerUnit());
  assert(JSON.stringify(where()) !== JSON.stringify(before), "moved");
  undo();
  equal(where(), before, "a drag is taken back");
  equal(boardText(), "NEJ DU", "and nothing was typed by Ctrl+Z");

  for (let i = 0; i < 10; i += 1) undo();
  equal(where(), start, "all the way back to the start");
  undo();
  equal(where(), start, "and no further");
});

test("page: the space, new line and delete buttons (for a phone) type at the cursor", async () => {
  await openApp();
  $("#removeButton").click();
  typeText("nejs");
  $("#backspaceButton").click();
  equal(boardText(), "NEJ", "slet takes back the last letter");
  $("#spaceButton").click();
  typeText("da");
  $("#newLineButton").click();
  typeText("ok");
  equal(boardText(), "NEJ DA OK");
  equal(new Set(onBoard().map((node) => place(node)[1])).size, 2, "on two lines");
  assert($("#felt .cursor"), "the cursor shows where the next letter goes");
});

/** Run `steps` with the page in a phone-sized window, and put the window back after. */
async function asPhone(steps) {
  frame.style.width = "400px";
  frame.style.height = "800px";
  try {
    await until(() => win().innerWidth === 400 && win().matchMedia("(max-aspect-ratio: 1/1)").matches, "a phone-sized window");
    // A headless browser may be slow to tell the page its window changed size.
    win().dispatchEvent(new (win().Event)("resize"));
    await steps();
  } finally {
    frame.style.width = "";
    frame.style.height = "";
    await until(() => win().innerWidth > 1000, "the window back to its size");
    win().dispatchEvent(new (win().Event)("resize"));
  }
}

/** Whether every letter on the table lies inside the table. */
function allOnTable() {
  const zone = $("#tableZone").getBoundingClientRect();
  return onTable().every((node) => {
    const rect = node.getBoundingClientRect();
    return rect.left >= zone.left - 1 && rect.right <= zone.right + 1 && rect.top >= zone.top - 1;
  });
}

test("page: when the window changes size, letters sorted on the table are sorted again on the new table", async () => {
  await openApp();
  $("#removeButton").click();
  $("#sortButton").click();
  const order = () => onTable()
      .map((node) => [node.dataset.ch, ...place(node)])
      .sort((a, b) => a[2] - b[2] || a[1] - b[1])
      .map(([ch]) => ch)
      .join("");
  const sorted = order();
  await asPhone(async () => {
    await until(() => allOnTable(), "the letters on the table under the board");
    equal(order(), sorted, "in rows, in order");
  });
  await until(() => allOnTable(), "the letters on the table beside the board again");
  equal(order(), sorted);
});

test("page: when the window changes size, letters lying about on the table stay on it, apart", async () => {
  await openApp();
  $("#removeButton").click();
  $("#scatterButton").click();
  await asPhone(async () => {
    await until(() => allOnTable(), "the letters on the table under the board");
    const boxes = onTable().map((node) => node.getBoundingClientRect());
    const onTop = boxes.filter((a, i) => boxes.some((b, j) => j > i && Math.abs(a.left - b.left) < 3 && Math.abs(a.top - b.top) < 3));
    equal(onTop.length, 0, "none right on top of another");
  });
});

test("page: vend (for a phone) puts letters tapped up from the table upside down, until it is pressed again", async () => {
  await openApp();
  $("#removeButton").click();
  const button = $("#turnButton");
  button.click();
  equal(button.getAttribute("aria-pressed"), "true");
  const [a, b] = [pieceOf("A"), pieceOf("B")];
  tap(a);
  tap(b);
  assert(turned(a) && turned(b), "both upside down");
  button.click();
  equal(button.getAttribute("aria-pressed"), "false");
  const c = pieceOf("C");
  tap(c);
  assert(c.classList.contains("on-board") && !turned(c), "the right way up again");
});

test("page: on a phone, a letter tapped on the table goes to the cursor, also one that was on the board", async () => {
  await openApp();
  frame.style.width = "400px";
  frame.style.height = "800px";
  try {
    await until(() => win().innerWidth === 400 && win().matchMedia("(max-aspect-ratio: 1/1)").matches, "a phone-sized window");
    $("#removeButton").click();
    // Pressing the board puts the cursor there.
    const felt = $("#felt").getBoundingClientRect();
    const at = { x: felt.left + 100 * pixelsPerUnit(), y: felt.top + 400 * pixelsPerUnit() };
    pointer("pointerdown", $("#felt"), at, "touch");
    pointer("pointerup", $("#felt"), at, "touch");
    for (const ch of ["H", "E", "J"]) {
      const letter = pieceOf(ch);
      tap(letter, "touch");
      await until(() => letter.classList.contains("on-board"), `${ch} to go up`);
      if (ch === "E") {
        // HE, then a space.
        $("#spaceButton").click();
      }
    }
    equal(boardText(), "HE J");
    assert($("#felt .cursor"), "the cursor shows");
    assert(onBoard().every((node) => place(node)[1] === 20 * GROOVE), "where the board was pressed");
  } finally {
    frame.style.width = "";
    frame.style.height = "";
    await until(() => win().innerWidth > 1000, "the window back to its size");
  }
});

test("page: typing takes letters from the table, and Shift turns them upside down", async () => {
  await openApp();
  typeText("n");
  assert($("#toast").textContent.includes("ikke flere N"), "all the letters are still on the board");
  $("#removeButton").click();
  typeText("nej ");
  press("m", { shiftKey: true });
  equal(boardText(), "NEJ W");
  assert($("#felt .cursor"), "the cursor shows");
  assert(turned(onBoard().find((node) => node.dataset.ch === "M")));
  press("Backspace");
  equal(boardText(), "NEJ");
  typeText("q");
  assert($("#toast").textContent.includes("ikke flere Q"));
});

test("page: keys with Ctrl or in a text field are left alone", async () => {
  await openApp();
  $("#removeButton").click();
  press("a", { ctrlKey: true });
  equal(onBoard().length, 0);
  $("#authorInput").dispatchEvent(new (win().KeyboardEvent)("keydown", { key: "a", bubbles: true, cancelable: true }));
  equal(onBoard().length, 0);
});

test("page: an empty board is not saved", async () => {
  await openApp();
  $("#removeButton").click();
  $("#saveButton").click();
  assert(!$("#authorDialog").open && $("#toast").textContent.includes("bogstaver op"));
});

test("page: saving twice at once saves once", async () => {
  await openApp();
  $("#saveButton").click();
  $("#saveButton").click();
  $("#authorInput").value = "Ann";
  $("#authorDialog button[value=save]").click();
  await until(() => $("#shareDialog").open, "the share dialog");
  equal(localCards().length, 1);
});

test("page: saving asks for a name, and the message becomes the next board", async () => {
  await openApp();
  $("#removeButton").click();
  typeText("nej");
  $("#saveButton").click();
  await until(() => $("#authorDialog").open, "the name dialog");
  $("#authorCancelButton").click();
  assert(!$("#authorDialog").open && boardText() === "NEJ", "cancelling keeps the message");
  // The page hears that the dialog closed a moment after it does: until then, "gem og del" waits for the name.
  await until(() => {
    if (!$("#authorDialog").open) $("#saveButton").click();
    return $("#authorDialog").open;
  }, "the name dialog again");

  const code = await saveAs("  Ann  ");
  const board = decodeBoard(code);
  equal([board.author, board.parentId, board.tiles.length, messageText(board.tiles)], ["Ann", ORIGINAL.id, 61, "NEJ"]);
  equal(board.tiles.filter((t) => t.loose).length, 58, "the unused letters are put aside");
  assert(Math.abs(board.createdAt - Date.now()) < 120000, "saved now");

  equal($("#shareHeading").textContent, "gemt! send den videre");
  assert($("#shareLink").value.endsWith(`#b=${code}`), "without the gallery's server, the long link");
  assert($("#uploadNote").hidden, "and no word of uploading, with no server to upload to");
  $("#shareDialog").close();

  equal([onBoard().length, onTable().length, boardText()], [3, 58, "NEJ"], "the new board is in play");
  equal($("#byline").textContent, "lavet af Ann");
  const card = localCards()[0];
  equal([localCards().length, card.querySelector(".card-title").textContent], [1, "NEJ"]);
  assert(card.classList.contains("is-active") && card.textContent.includes("ikke uploadet"));
  assert(!/Bygget på|Ny start|begyndte/.test($("#menu").textContent), "no lines about where a board came from");
});

test("page: a reload opens on the original board, and remembers the boards saved", async () => {
  await openApp();
  await saveAs("Ann");
  $("#shareDialog").close();
  $("#removeButton").click();
  typeText("nej");
  win().dispatchEvent(new (win().Event)("pagehide"));
  const stored = localStorage.getItem(STORAGE_KEY);

  await openApp({ storage: stored });
  equal([onBoard().length, onTable().length, boardText()], [61, 0, MARIANNE], "the original, as it is");
  equal($("#byline").textContent, "lavet af Marianne");
  equal(localCards().length, 1);
});

test("page: a share link opens the board, ready to build on", async () => {
  const sent = encodeBoard({ tiles: layoutText([{ row: 5, text: "HEJ DU" }]), author: "Bo", parentId: ORIGINAL.id });
  await openApp({ hash: `#b=${sent}` });
  equal([onBoard().length, boardText()], [5, "HEJ DU"]);
  equal($("#byline").textContent, "lavet af Bo");
  equal(win().location.hash, "", "the code is taken out of the address");
  assert($("#toast").textContent.includes("Bo"));
  const card = localCards()[0];
  assert(card.textContent.includes("ikke uploadet") && card.classList.contains("is-active"));
});

test("page: a share link from the first version of the site still opens", async () => {
  await openApp({ hash: `#b=${VERSION_1_CODE}` });
  equal([onBoard().length, onTable().length], [2, 2]);
  equal(boardText(), "AW");
});

test("page: a broken share link is refused politely", async () => {
  await openApp({ hash: "#b=AAAAAAAAAAAAAAAAAAAA" });
  equal(onBoard().length, 61, "still the original");
  assert($("#toast").textContent.includes("virker desværre ikke"));
});

test("page: the menu opens on the original boards, then the gallery, and shuts", async () => {
  await openApp();
  $("#menuButton").click();
  assert(!$("#menu").hidden && $("#originalsSection").open && $("#gallerySection").open);
  assert($("#originalsSection").compareDocumentPosition($("#gallerySection")) & Node.DOCUMENT_POSITION_FOLLOWING, "the originals first");
  equal($("#menuButton").getAttribute("aria-expanded"), "true");
  equal($$("#originalsList .card").length, 1, "the original, in a list of its own");
  assert(!$$("#galleryList .card-title").some((title) => title.textContent === MARIANNE), "and not in the gallery");
  press("Escape");
  assert($("#menu").hidden);
  $("#menuButton").click();
  $("#menuBackdrop").click();
  assert($("#menu").hidden);
});

test("page: another board can be built on, and what was done can be had back", async () => {
  await openApp();
  $("#removeButton").click();
  typeText("nej");
  await saveAs("Ann");
  $("#shareDialog").close();
  typeText("e");

  $("#menuButton").click();
  const original = $("#originalsList .card");
  original.querySelector(".card-actions button").click();
  assert($("#menu").hidden, "the menu shuts");
  equal([$("#byline").textContent, onBoard().length], ["lavet af Marianne", 61]);
  $("#toast .toast-action").click();
  equal([$("#byline").textContent, boardText()], ["lavet af Ann", "NEJE"]);
});

test("page: a saved board can be deleted, and undeleted", async () => {
  await openApp();
  await saveAs("Ann");
  $("#shareDialog").close();
  $("#menuButton").click();
  const forget = [...localCards()[0].querySelectorAll("button")].find((button) => button.textContent === "slet");
  forget.click();
  equal(localCards().length, 0);
  $("#toast .toast-action").click();
  equal(localCards().length, 1);
});

// --- Runner ------------------------------------------------------------------------------

const summary = document.querySelector("#summary");
const results = document.querySelector("#results");
const only = params.get("only");
let failed = 0;
let passed = 0;

for (const { name, run } of tests) {
  if (only && !name.includes(only)) continue;
  summary.textContent = `Running: ${name}`;
  try {
    await run();
    passed += 1;
  } catch (error) {
    failed += 1;
    const line = document.createElement("div");
    line.className = "fail";
    line.textContent = `✗ ${name}\n    ${error.message}`;
    results.append(line);
  }
}

summary.textContent = failed ? `${failed} failed, ${passed} passed` : `All ${passed} tests passed`;
summary.className = failed ? "fail" : "pass";
document.title = failed ? "FAIL" : "PASS";
