// Tests for the site, run in the browser by /tests.html.
//
// First the rules and the storage, straight on the modules. Then the page
// itself, loaded in a frame and worked with scripted key presses and pointers.
//
// `?app=<page>` tests another page than index.html, and `?only=<text>` runs
// only the tests with that text in their name.

import { blockerAt, freeXForward, freeXNearest, layoutText, messageText, readLines, scatterLeftovers, typingSlot } from "../js/board.js";
import { MAX_TILES, cleanAuthor, decodeBoard, encodeBoard } from "../js/codec.js";
import { STORAGE_KEY } from "../js/config.js";
import { ENDLESS, Editor, Pool } from "../js/editor.js";
import { ALPHABET, BOARD_W, LINE_STEP, MARGIN_X, ROW_MAX, ROW_MIN, WORD_GAP, glyphForKey, glyphWidth } from "../js/glyphs.js";
import { Library, ORIGINAL } from "../js/library.js";
import { gallerySubmitUrl } from "../js/share.js";

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

async function sleep(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) await tick();
}

async function until(condition, what = "condition") {
  const end = performance.now() + 3000;
  while (!condition()) {
    if (performance.now() > end) throw new Error(`timed out waiting for ${what}`);
    await tick();
  }
}

/** A deterministic stand-in for Math.random. */
function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) };
}

const tile = (ch, x, row, flip = false, loose = false) => ({ ch, x, row, flip, loose });
const withIds = (tiles) => tiles.map((t, i) => ({ ...t, id: `x${i}` }));

/** True if no two tiles are closer than the board allows. */
function nothingOverlaps(tiles) {
  const all = withIds(tiles);
  return all.every((t) => blockerAt(all, t.ch, t.x, t.row, t.id) === null);
}

// --- Letters -------------------------------------------------------------------

test("keys: letters are upper-cased, unknown keys are ignored", () => {
  equal(glyphForKey("a"), { ch: "A", flip: false });
  equal(glyphForKey("æ"), { ch: "Æ", flip: false });
  equal(glyphForKey("7"), { ch: "7", flip: false });
  equal(glyphForKey("!"), null);
  equal(glyphForKey("ß"), null, "ß upper-cases to two letters");
  equal(glyphForKey("Enter"), null);
  equal(glyphForKey(""), null);
});

test("keys: > . and , are other letters turned upside down", () => {
  equal(glyphForKey(">"), { ch: "<", flip: true });
  equal(glyphForKey("."), { ch: "'", flip: true });
  equal(glyphForKey(","), { ch: "'", flip: true });
});

// --- Share codes -----------------------------------------------------------------

// The same board and code as in tests/test_add_board.py.
const GOLDEN = {
  tiles: [tile("A", 16, 2), tile("M", 52, 2, true), tile("'", 100, 30, false, true), tile("<", 486, 5, true, true)],
  author: "Æg & Ål",
  createdAt: 29333333 * 60000,
  parentId: "0123456789ab",
};
const GOLDEN_CODE = "AQG_l1UBI0VniasJw4ZnICYgw4VsBAAEBGQaCpRk9VvMUA";

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
  throws(() => decodeBoard(`Ag${valid.slice(2)}`), "another version");
  throws(() => decodeBoard(encodeBoard({ tiles: [tile("A", 16, 1)], createdAt: 0 })), "row above the board");
  throws(() => decodeBoard(encodeBoard({ tiles: [tile("A", 16, 31)], createdAt: 0 })), "row below the board");
});

test("codec: refuses to encode letters the board does not have, or too many", () => {
  throws(() => encodeBoard({ tiles: [tile("!", 16, 2)] }));
  throws(() => encodeBoard({ tiles: [tile("", 16, 2)] }));
  throws(() => encodeBoard({ tiles: Array(MAX_TILES + 1).fill(tile("A", 0, 2)) }));
});

test("codec: a letter hanging over the edge is pulled back onto the board", () => {
  const code = encodeBoard({ tiles: [tile("W", 519, 2)], createdAt: 0 });
  equal(decodeBoard(code).tiles[0].x, BOARD_W - glyphWidth("W"));
});

// --- Rules of the board ------------------------------------------------------------

test("board: letters block each other on the same line only", () => {
  const tiles = withIds([tile("A", 100, 5)]);
  assert(blockerAt(tiles, "B", 100, 5), "same place");
  assert(blockerAt(tiles, "B", 135, 5), "closer than the gap");
  assert(!blockerAt(tiles, "B", 136, 5), "exactly the gap away");
  assert(blockerAt(tiles, "B", 100, 5 + LINE_STEP - 1), "overlapping line");
  assert(!blockerAt(tiles, "B", 100, 5 + LINE_STEP), "next line");
  assert(!blockerAt(tiles, "B", 100, 5, "x0"), "a tile does not block itself");
});

test("board: small marks may sit close", () => {
  const tiles = [tile("A", 100, 5)];
  assert(!blockerAt(tiles, "*", 131, 5));
  assert(blockerAt(tiles, "*", 130, 5));
});

test("board: finds the next free place on a line", () => {
  const tiles = [tile("A", 100, 5), tile("B", 136, 5)];
  equal(freeXForward(tiles, "C", 0, 5), 0);
  equal(freeXForward(tiles, "C", 80, 5), 172);
  equal(freeXForward(tiles, "C", 500, 5), null, "past the edge");
  equal(freeXForward([tile("A", BOARD_W - 40, 5)], "C", BOARD_W - 60, 5), null, "no room before the edge");
});

test("board: finds the nearest free place on a line", () => {
  const tiles = [tile("A", 100, 5)];
  equal(freeXNearest(tiles, "B", 300, 5), 300);
  equal(freeXNearest(tiles, "B", 90, 5), 64, "nearer to the left");
  equal(freeXNearest(tiles, "B", 120, 5), 136, "nearer to the right");
  equal(freeXNearest(tiles, "B", -50, 5), 0, "kept on the board");
  equal(freeXNearest(tiles, "B", 9999, 5), BOARD_W - 30, "kept on the board");
  equal(freeXNearest([tile("A", 10, 5)], "B", 12, 5), 46, "no room to the left");
  const full = Array.from({ length: 15 }, (_, i) => tile("A", i * 36, 5));
  equal(freeXNearest(full, "B", 200, 5), null, "a full line");
});

test("board: typing wraps to the next line, and from the last line to the top", () => {
  const full = Array.from({ length: 15 }, (_, i) => tile("A", i * 36, 5));
  equal(typingSlot(full, "B", { x: 200, row: 5 }), { x: MARGIN_X, row: 5 + LINE_STEP });
  equal(typingSlot([], "B", { x: BOARD_W, row: ROW_MAX }), { x: MARGIN_X, row: ROW_MIN });
});

test("board: text is laid out and read back", () => {
  const tiles = layoutText([
    { row: 2, text: "HEJ MED" },
    { row: 5, text: "DIG" },
  ]);
  equal(tiles.length, 9);
  equal([tiles[0].x, tiles[1].x, tiles[3].x], [MARGIN_X, MARGIN_X + 36, MARGIN_X + 3 * 36 + WORD_GAP]);
  equal(readLines(tiles), ["HEJ MED", "DIG"]);
  assert(nothingOverlaps(tiles));
});

test("board: upside-down letters read as what they look like", () => {
  equal(readLines([tile("M", 16, 2, true), tile("6", 58, 2, true), tile("<", 120, 2, true), tile("<", 180, 2), tile("A", 240, 2, true)]), ["W9 → ← A"]);
});

test("board: the message leaves out the pile of unused letters", () => {
  equal(messageText([tile("H", 16, 2), tile("I", 52, 2), tile("X", 300, 25, false, true)]), "HI");
  equal(messageText([tile("X", 300, 25, false, true)]), "X", "unless the pile is all there is");
});

test("board: the original reads as it should", () => {
  equal(ORIGINAL.tiles.length, 51);
  equal(messageText(ORIGINAL.tiles), "LEBBE SALLE SIGER NEJ TIL EL I MARTS DR ANDREAZZ* DEN ED ← 699 @ ←");
  assert(nothingOverlaps(ORIGINAL.tiles));
});

test("scatter: a few leftovers land in a pile at the bottom", () => {
  const message = layoutText([{ row: 2, text: "HEJ" }]);
  const leftovers = layoutText([{ row: 2, text: "ABCDEFGHIJ" }]);
  for (let seed = 1; seed <= 20; seed += 1) {
    const pile = scatterLeftovers(message, leftovers, seededRandom(seed));
    equal(pile.map((t) => t.ch).sort().join(""), "ABCDEFGHIJ");
    assert(pile.every((t) => t.loose && t.row >= 21 && t.row <= ROW_MAX), "in the pile area");
    assert(nothingOverlaps([...message, ...pile]), `overlap with seed ${seed}`);
  }
});

test("scatter: many leftovers creep up towards the message, without overlapping", () => {
  const message = ORIGINAL.tiles.slice(0, 3).map((t, i) => tile(t.ch, 16 + i * 36, 2));
  const leftovers = ORIGINAL.tiles.slice(3);
  for (let seed = 1; seed <= 20; seed += 1) {
    const pile = scatterLeftovers(message, leftovers, seededRandom(seed));
    equal(pile.length, leftovers.length);
    assert(pile.every((t) => t.row >= 2 + LINE_STEP), "below the message");
    assert(nothingOverlaps([...message, ...pile]), `overlap with seed ${seed}`);
  }
});

test("scatter: a message that fills the board still gets its leftovers", () => {
  const rows = [2, 5, 8, 11, 14, 17, 20, 23, 26, 29];
  const message = layoutText(rows.map((row) => ({ row, text: "AAAAAAAAAAAAA" })));
  const pile = scatterLeftovers(message, layoutText([{ row: 2, text: "WWWW" }]), seededRandom(1));
  equal(pile.length, 4);
  assert(pile.every((t) => t.x >= 0 && t.x <= BOARD_W - glyphWidth("W") && t.row >= ROW_MIN && t.row <= ROW_MAX));
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
  equal(editor.tiles.map((t) => [t.ch, t.x, t.row]), [["N", 16, 2], ["E", 52, 2], ["J", 88, 2]]);
  equal(pool.leftovers.length, 48);
  equal(editor.cursor, { x: 124, row: 2 });
  equal(editor.type("J"), "missing", "there is only one J");
  equal(editor.type("Q"), "missing");
});

test("editor: letters are taken in reading order", () => {
  const { pool, editor } = newEditor();
  editor.type("E");
  equal(pool.tiles.findIndex((t) => t.used), 1, "the first E is the second letter of LEBBE");
});

test("editor: when a letter has run out, its upside-down twin stands in", () => {
  const { editor } = newEditor();
  equal(editor.type("W"), "ok");
  equal([editor.tiles[0].ch, editor.tiles[0].flip], ["M", true]);
  equal(editor.type("W"), "missing", "there is only one M");
  equal(editor.type("9", true), "ok", "a 9 turned around");
  equal([editor.tiles[1].ch, editor.tiles[1].flip], ["9", true]);
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
  equal(editor.cursor, { x: 16 + 30 + 6 + WORD_GAP + 25 + 6, row: 2 }, "back on the first line");
  editor.backspace();
  equal(text(editor), "E", "the L is gone");
  editor.backspace();
  editor.backspace();
  equal([editor.tiles.length, editor.cursor, pool.leftovers.length], [0, { x: 16, row: 2 }, 51]);
  editor.backspace();
  equal(editor.tiles.length, 0, "nothing more to take away");
});

test("editor: after the cursor is moved, backspace takes the letter before it", () => {
  const { editor } = newEditor();
  for (const ch of "SALLE") editor.type(ch);
  editor.cursorAfter(editor.tiles[1].id);
  editor.backspace();
  equal(text(editor), "S LLE");
  equal(editor.cursor.x, 52);
  editor.type("A");
  equal(text(editor), "SALLE", "typed back into the hole");

  editor.setCursor(16, 2 + LINE_STEP);
  editor.backspace();
  equal(text(editor), "SALL", "from an empty line it takes the end of the line above");
});

test("editor: typing into text pushes on to the next free place", () => {
  const { editor } = newEditor();
  for (const ch of "SAL") editor.type(ch);
  editor.setCursor(20, 2);
  editor.type("E");
  equal(text(editor), "SALE");
});

test("editor: a line that is full continues on the next", () => {
  const editor = new Editor(ENDLESS);
  for (let i = 0; i < 15; i += 1) editor.type("A");
  equal(editor.tiles.filter((t) => t.row === 2).length, 14);
  equal([editor.tiles[14].x, editor.tiles[14].row], [16, 5]);
});

test("editor: reports a full board", () => {
  const editor = new Editor(ENDLESS);
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
  equal(editor.drop(pool.find("B"), 20, 2), "ok");
  const [a, b] = editor.tiles;
  equal([b.x, b.row], [52, 2], "dropped next to the A, not on it");

  editor.moveTo(b.id, 200, 9.4);
  equal([b.x, b.row], [200, 9]);
  editor.moveTo(b.id, 18, 2);
  equal(b.x, 52, "pushed off the A again");
  editor.moveTo(a.id, 16, 500);
  equal(a.row, ROW_MAX, "kept on the board");

  editor.flip(a.id);
  equal(a.flip, true);

  editor.remove(b.id);
  equal([editor.tiles.length, pool.leftovers.length], [1, 50]);
  editor.removeBySource(a.src);
  equal([editor.tiles.length, pool.leftovers.length], [0, 51]);
});

test("editor: clear gives every letter back", () => {
  const { pool, editor } = newEditor();
  for (const ch of "LEBBE") editor.type(ch);
  editor.clear();
  equal([editor.tiles.length, pool.leftovers.length, editor.cursor], [0, 51, { x: 16, row: 2 }]);
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
  equal(second.pool.leftovers.length, 48);
});

test("editor: an existing board can be loaded and written on", () => {
  const editor = new Editor(ENDLESS);
  editor.load([tile("H", 16, 2), tile("I", 52, 2)]);
  equal(editor.cursor, { x: 78, row: 2 }, "the cursor is after the text");
  editor.type("Q");
  equal(text(editor), "HIQ");
});

// --- Saved boards --------------------------------------------------------------------

const someBoard = (ch = "A", parentId = null) => decodeBoard(encodeBoard({ tiles: [tile(ch, 16, 2)], author: "Ann", createdAt: 60000, parentId }));

test("library: starts with the original", () => {
  const library = new Library(fakeStorage());
  equal([library.saved.length, library.source.id, library.draft], [0, ORIGINAL.id, []]);
  equal(library.titleOf(ORIGINAL), "LEBBE SALLE SIGER NEJ TIL EL I MARTS");
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
  equal(library.saved.map((b) => b.origin), ["link", "mine"], "newest first");

  const again = new Library(storage);
  equal(again.saved.map((b) => [b.id, b.origin]), library.saved.map((b) => [b.id, b.origin]));
  equal(again.titleOf(again.find(board.id)), "A");
});

test("library: a forgotten board can be put back where it was", () => {
  const storage = fakeStorage();
  const library = new Library(storage);
  const ids = ["A", "B", "C"].map((ch) => library.keep(someBoard(ch), "mine").id).reverse();
  const putBack = library.forget(ids[1]);
  equal(library.saved.map((b) => b.id), [ids[0], ids[2]]);
  equal(new Library(storage).saved.length, 2);
  putBack();
  equal(library.saved.map((b) => b.id), ids);
  equal(new Library(storage).saved.length, 3);
});

test("library: remembers the board in play and the unfinished message", () => {
  const storage = fakeStorage();
  const library = new Library(storage);
  const board = someBoard();
  library.source = board; // not kept: it could be a board from the gallery
  library.draft = [{ src: "s0", x: 16, row: 2, flip: false }];
  library.author = "Bo";
  library.save();

  const again = new Library(storage);
  equal([again.source.id, again.draft, again.author], [board.id, library.draft, "Bo"]);
});

test("library: survives broken storage", () => {
  equal(new Library(fakeStorage({ [STORAGE_KEY]: "{not json" })).saved.length, 0);
  const odd = { boards: [{ code: "nope" }, null, { code: someBoard().code, origin: "weird" }], source: 5, draft: "x" };
  const library = new Library(fakeStorage({ [STORAGE_KEY]: JSON.stringify(odd) }));
  equal([library.saved.length, library.saved[0]?.origin, library.source.id, library.draft], [1, "mine", ORIGINAL.id, []]);
});

test("library: reads the gallery, newest first, skipping what it cannot read", () => {
  const library = new Library(fakeStorage());
  const [a, b] = [someBoard("A"), someBoard("B")];
  library.setGallery({ boards: [{ code: a.code }, { code: "garbage" }, {}, { code: b.code }, { code: a.code }] });
  equal(library.gallery.map((board) => board.id), [b.id, a.id]);
  equal(library.find(b.id).id, b.id);
  library.setGallery(null);
  equal(library.gallery, []);
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
        snapshot: snapshot([{ token: "H", x: 16, y: 16.5, rotation: 0 }, { token: "I", x: 52, y: 16.5, rotation: 180 }]),
      },
      {
        id: "msg_1",
        parentId: "original-root",
        writerName: "Ann",
        title: "PIL",
        createdAt: "2026-04-01T10:00:00.000Z",
        snapshot: snapshot([{ token: ">", x: 580, y: 576.5, rotation: 0 }, { token: "<", x: 0, y: 76.5, rotation: 180 }, { token: "?", x: 0, y: 0 }], 1040),
      },
      { id: "original-root", parentId: null, snapshot: snapshot([]) },
    ],
    activeMode: "history",
    activeSourceId: "msg_2",
    lastWriterName: "Bo",
  };
  const library = new Library(fakeStorage({ "letterboard.v6": JSON.stringify(old) }));

  equal(library.saved.map((b) => [library.titleOf(b), b.author, b.origin]), [["HI", "Bo", "mine"], ["PIL", "Ann", "mine"]]);
  const [child, parent] = library.saved;
  equal([child.parentId, parent.parentId], [parent.id, ORIGINAL.id]);
  equal(child.tiles, [tile("H", 16, 2), tile("I", 52, 2, true)]);
  equal(parent.tiles, [tile("<", 290, 30, true), tile("<", 0, 5, true)], "arrows become one piece; wide boards are squeezed");
  equal(child.createdAt, Date.parse("2026-04-02T10:00:00.000Z"));
  equal([library.source.id, library.author], [child.id, "Bo"]);
});

test("share: the gallery link carries the board's code on a line of its own", () => {
  const board = someBoard();
  const url = new URL(gallerySubmitUrl(board, "HEJ & HÅ"));
  equal(url.origin + url.pathname.replace(/^\/[^/]+\/[^/]+/, "/owner/repo"), "https://github.com/owner/repo/issues/new");
  equal(url.searchParams.get("title"), "Tavle: HEJ & HÅ");
  assert(url.searchParams.get("body").split("\n").includes(`board:${board.code}`));
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
  await until(() => $("#sourceBoard .tile") && $("#galleryList .card"), "the page to start");
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
  const field = node.closest(".board-field");
  const from = centre(node);
  pointer("pointerdown", node, from, pointerType);
  for (const part of [0.25, 0.5, 0.75, 1]) pointer("pointermove", field, { x: from.x + dx * part, y: from.y + dy * part }, pointerType);
  pointer("pointerup", field, { x: from.x + dx, y: from.y + dy }, pointerType);
}

const composed = () => $$("#composeBoard .tile");
const composedText = () => composed().map((node) => node.dataset.ch).join("");
const usedCount = () => $$("#sourceBoard .tile.is-used").length;
const trayCount = (ch) => $(`#tray [data-ch="${ch}"] .key-count`).textContent;
const turned = (node) => node.style.getPropertyValue("--turn") === "180deg";
const place = (node) => [Number(node.style.getPropertyValue("--x")), Number(node.style.getPropertyValue("--row"))];

async function saveAs(name, button = "#saveButton") {
  $(button).click();
  await until(() => $("#authorDialog").open, "the name dialog");
  $("#authorInput").value = name;
  $("#authorDialog button[value=save]").click();
  await until(() => $("#shareDialog").open, "the share dialog");
  return new URL($("#shareLink").value).hash.slice(3);
}

test("page: shows the original and an empty board", async () => {
  await openApp();
  equal($$("#sourceBoard .tile").length, 51);
  equal(composed().length, 0);
  assert($("#composeBoard").classList.contains("is-empty"));
  equal($("#sourceByline").textContent, "Af LEBBE SALLE");
  equal($$("#galleryList .card").length, 1, "the original is in the gallery");
  assert($("#savedSection").hidden);
  assert($("#composeBoard .cursor"), "a cursor to type at");
  equal(trayCount("E"), "9");
});

test("page: typing moves letters from the previous message", async () => {
  await openApp();
  typeText("nej til\nel");
  equal(composedText(), "NEJTILEL");
  equal(usedCount(), 8);
  equal(trayCount("E"), "7");
  equal(trayCount("J"), "0");
  assert($('#tray [data-ch="J"]').classList.contains("is-out"));
  equal($("#composeBoard").getAttribute("aria-label"), "Ny besked: NEJ TIL EL");

  press("Backspace");
  press("Backspace");
  press("Backspace");
  equal(composedText(), "NEJTIL");
  equal(usedCount(), 6);

  press("q");
  equal(composedText(), "NEJTIL", "there is no Q");
  assert($("#toast").classList.contains("is-visible"), "and the page says so");
});

test("page: Shift turns a typed letter upside down, and so does the Vend key", async () => {
  await openApp();
  press("M", { shiftKey: true });
  press("a");
  press('"', { shiftKey: true, code: "Digit6" });
  equal(composed().map(turned), [true, false, true]);
  equal(composedText(), "MA6");

  $('#tray [data-action="flip"]').click();
  equal($('#tray [data-action="flip"]').getAttribute("aria-pressed"), "true");
  press("e");
  press("E", { shiftKey: true });
  equal(composed().slice(3).map(turned), [true, false], "Shift undoes Vend");
});

test("page: keys with Ctrl or in a text field are left alone", async () => {
  await openApp();
  press("a", { ctrlKey: true });
  press("a", { metaKey: true });
  equal(composed().length, 0);
  press("@", { ctrlKey: true, altKey: true });
  equal(composedText(), "@", "AltGr is Ctrl+Alt");
});

test("page: the tray types too", async () => {
  await openApp();
  $('#tray [data-ch="S"]').click();
  $('#tray [data-action="space"]').click();
  $('#tray [data-ch="<"]').click();
  $('#tray [data-action="newline"]').click();
  $('#tray [data-ch="A"]').click();
  equal($("#composeBoard").getAttribute("aria-label"), "Ny besked: S ← A");
  $('#tray [data-action="backspace"]').click();
  equal(composedText(), "S<");
});

test("page: tapping a letter uses it, tapping it again takes it back", async () => {
  await openApp();
  const letter = $$("#sourceBoard .tile")[3];
  tap(letter);
  equal(composedText(), letter.dataset.ch);
  assert(letter.classList.contains("is-used"));
  tap(letter);
  equal(composed().length, 1, "a double tap does not take it straight back");
  await sleep(400);
  tap(letter);
  equal([composed().length, usedCount()], [0, 0]);
});

test("page: a letter can be dragged from one board to the other", async () => {
  await openApp();
  const letter = $$("#sourceBoard .tile")[0];
  const from = centre(letter);
  const to = centre($("#composeBoard .board-field"));
  drag(letter, to.x - from.x, to.y - from.y);
  equal(composedText(), "L");
  const [x, row] = place(composed()[0]);
  assert(Math.abs(x - (260 - 12.5)) <= 2 && row === 16, `dropped in the middle, got ${x}, ${row}`);
  assert(!letter.classList.contains("is-lifted") && letter.style.translate === "", "the letter is put down");

  drag($$("#sourceBoard .tile")[1], 5, 60);
  equal(composed().length, 1, "dropped outside the other board, nothing happens");

  drag($$("#sourceBoard .tile")[2], to.x - from.x, to.y - from.y, "touch");
  equal(composed().length, 1, "a finger scrolls instead of dragging");
});

test("page: letters on the new board can be moved, turned and dragged off", async () => {
  await openApp();
  typeText("sal");
  const [s, a] = composed();
  const scale = $("#composeBoard .board-field").getBoundingClientRect().width / 520;

  drag(a, 100 * scale, 60 * scale);
  equal(place(a), [52 + 100, 2 + 3], "moved 100 units right and 3 grooves down");

  drag(a, -136 * scale, -60 * scale);
  equal(place(a), [52, 2], "and back next to the S");
  drag(a, -30 * scale, 0);
  equal(place(a)[1], 2);
  assert(place(a)[0] >= 52 || place(a)[0] + 30 + 6 <= 16, "never on top of the S");

  tap(s);
  tap(s);
  assert(turned(s), "a double tap turns it");

  drag(s, -400, 0);
  equal(composedText(), "AL", "dragged off the board");
  equal(usedCount(), 2);
});

test("page: tapping the board moves the cursor", async () => {
  await openApp();
  const field = $("#composeBoard .board-field");
  const rect = field.getBoundingClientRect();
  const at = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  pointer("pointerdown", field, at);
  pointer("pointerup", field, at);
  press("a");
  const [x, row] = place(composed()[0]);
  assert(Math.abs(x - 260) <= 1 && row === 16, `typed at the cursor, got ${x}, ${row}`);
  press("ArrowDown");
  press("ArrowLeft");
  press("b");
  equal(place(composed()[1])[1], 19);
});

test("page: Ryd empties the board, and hands the keyboard back", async () => {
  await openApp();
  typeText("lebbe");
  $("#clearButton").focus();
  $("#clearButton").click();
  equal([composed().length, usedCount()], [0, 0]);
  typeText("a b");
  equal($("#composeBoard").getAttribute("aria-label"), "Ny besked: A B", "the space is typed, not a press of Ryd");
});

test("page: saving twice at once saves once", async () => {
  await openApp();
  typeText("nej");
  $("#saveButton").click();
  $("#saveButton").click();
  $("#authorInput").value = "Ann";
  $("#authorDialog button[value=save]").click();
  await until(() => $("#shareDialog").open, "the share dialog");
  equal($$("#savedList .card").length, 1);
});

test("page: saving asks for a name, and the message becomes the next board", async () => {
  await openApp();
  $("#saveButton").click();
  assert(!$("#authorDialog").open, "nothing to save yet");

  typeText("nej");
  $("#saveButton").click();
  await until(() => $("#authorDialog").open, "the name dialog");
  $("#authorCancelButton").click();
  assert(!$("#authorDialog").open && composedText() === "NEJ", "cancelling keeps the message");
  await tick();

  const code = await saveAs("  Ann  ");
  const board = decodeBoard(code);
  equal([board.author, board.parentId, board.tiles.length, messageText(board.tiles)], ["Ann", ORIGINAL.id, 51, "NEJ"]);
  equal(board.tiles.filter((t) => t.loose).length, 48, "the unused letters are in the pile");
  assert(nothingOverlaps(board.tiles));
  assert(Math.abs(board.createdAt - Date.now()) < 120000, "saved now");

  equal($("#shareHeading").textContent, "Gemt! Send tavlen videre");
  assert(!$("#submitSection").hidden && $("#submitLink").href.includes(encodeURIComponent(`board:${code}`)), "can be sent to the gallery");
  $("#shareDialog").close();

  equal($$("#sourceBoard .tile").length, 51, "the new board is now the previous message");
  equal(composed().length, 0);
  equal($("#sourceByline").textContent.split(" · ")[0], "Af Ann");
  assert(!$("#savedSection").hidden);
  const card = $("#savedList .card");
  equal([$$("#savedList .card").length, card.querySelector(".card-title").textContent], [1, "NEJ"]);
  assert(card.classList.contains("is-active"));
  assert(card.textContent.includes("Fra: LEBBE SALLE SIGER NEJ TIL EL I MARTS"));

  typeText("j");
  equal(composedText(), "J", "its letters can be used again");
});

test("page: remembers everything after a reload", async () => {
  await openApp();
  typeText("nej");
  await saveAs("Ann");
  $("#shareDialog").close();
  typeText("en");
  win().dispatchEvent(new (win().Event)("pagehide"));
  const stored = localStorage.getItem(STORAGE_KEY);

  await openApp({ storage: stored });
  equal(composedText(), "EN", "the unfinished message");
  equal($$("#savedList .card").length, 1);
  equal($("#sourceByline").textContent.split(" · ")[0], "Af Ann");

  $("#saveButton").click();
  await until(() => $("#authorDialog").open, "the name dialog");
  equal($("#authorInput").value, "Ann", "and the name");
});

test("page: a share link opens the board, ready to build on", async () => {
  const sent = encodeBoard({ tiles: layoutText([{ row: 5, text: "HEJ DU" }]), author: "Bo", parentId: ORIGINAL.id });
  await openApp({ hash: `#b=${sent}` });
  equal($$("#sourceBoard .tile").length, 5);
  equal($("#sourceByline").textContent.split(" · ")[0], "Af Bo");
  equal(win().location.hash, "", "the code is taken out of the address");
  assert($("#toast").textContent.includes("Bo"));
  const card = $("#savedList .card");
  assert(card.textContent.includes("modtaget") && card.classList.contains("is-active"));
  equal($$("#tray [data-ch]").map((key) => key.dataset.ch).join(""), "DEHJU");

  typeText("hud");
  equal(composedText(), "HUD");
});

test("page: a broken share link is refused politely", async () => {
  await openApp({ hash: "#b=AAAAAAAAAAAAAAAAAAAA" });
  equal($$("#sourceBoard .tile").length, 51, "still the original");
  assert($("#toast").textContent.includes("kunne ikke"));
});

test("page: another board can be built on, and the draft can be had back", async () => {
  await openApp();
  typeText("nej");
  await saveAs("Ann");
  $("#shareDialog").close();
  typeText("e");

  const original = $$("#galleryList .card").at(-1);
  original.querySelector(".card-actions button").click();
  equal([$("#sourceByline").textContent, composed().length], ["Af LEBBE SALLE", 0]);
  assert(original.isConnected === false || $$("#galleryList .card").at(-1).classList.contains("is-active"));

  $("#toast .toast-action").click();
  equal([$("#sourceByline").textContent.split(" · ")[0], composedText()], ["Af Ann", "E"]);
});

test("page: a saved board can be deleted, and undeleted", async () => {
  await openApp();
  typeText("nej");
  await saveAs("Ann");
  $("#shareDialog").close();

  const buttons = [...$("#savedList .card").querySelectorAll(".card-actions button")];
  equal(buttons.map((button) => button.textContent), ["Byg videre", "Del", "Slet"]);
  buttons[2].click();
  assert($("#savedSection").hidden);
  equal($$("#sourceBoard .tile").length, 51, "it stays on the board");
  $("#toast .toast-action").click();
  equal($$("#savedList .card").length, 1);

  $$("#galleryList .card .card-actions button")[1].click();
  assert($("#shareDialog").open && $("#submitSection").hidden, "the original can be shared, but is in the gallery already");
});

test("page: the previous message can be rewritten into a new start", async () => {
  await openApp();
  typeText("nej");
  $("#rewriteButton").click();
  assert($("#sourcePanel").classList.contains("is-rewriting") && $("#composePanel").inert);
  assert($("#sourceBoard .cursor") && !$("#composeBoard .cursor"), "the cursor is on the left board");
  equal($$("#tray [data-ch]").length, ALPHABET.length, "every letter is on offer");
  assert($("#sourceBoard").nextElementSibling === $("#tray"), "under the board being written on");
  equal(usedCount(), 0);

  press("q");
  press("q");
  press("Backspace");
  equal($$("#sourceBoard .tile").length, 52);
  drag($$("#sourceBoard .tile")[0], -400, 0);
  equal($$("#sourceBoard .tile").length, 51, "letters can be thrown out");

  $("#rewriteCancelButton").click();
  assert(!$("#sourcePanel").classList.contains("is-rewriting") && !$("#composePanel").inert);
  equal([$$("#sourceBoard .tile").length, composedText(), usedCount()], [51, "NEJ", 3], "cancelling changes nothing");

  $("#rewriteButton").click();
  typeText("qx");
  const code = await saveAs("Cy", "#rewriteSaveButton");
  const board = decodeBoard(code);
  equal([board.parentId, board.tiles.length, board.author], [null, 53, "Cy"]);
  $("#shareDialog").close();
  assert(!$("#sourcePanel").classList.contains("is-rewriting"));
  equal($$("#sourceBoard .tile").length, 53);
  assert($("#savedList .card").textContent.includes("Ny start"));
  typeText("q");
  equal(composedText(), "Q");
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
