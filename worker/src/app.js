// The gallery's server: it keeps the boards, gives each a short id for its
// link, and hands them out again.
//
//   GET  /boards            the gallery, newest first: { boards: [{ id, code, addedAt }], next }
//                           (?limit=, at most 500; ?before=<next> for the page after)
//   GET  /boards/<id>       one board: { id, code }
//   POST /boards  { code }  put a board in the gallery: { id }. The same board again gets the same id.
//
// A board is its share code, as js/codec.js writes it; the site checks it with
// that same file. Where the boards are kept is `store` (src/store.js for the
// Cloudflare database; the tests keep them in memory).

import { decodeBoard } from "../../js/codec.js";

const ID_LETTERS = "abcdefghijkmnpqrstuvwxyz23456789"; // no l, o, 0 or 1: they are easily mistaken
const ID_LENGTH = 7;
const MAX_BODY = 4096;
const MAX_LIST = 500;
const HOUR = 60 * 60 * 1000;

/**
 * Answer one request.
 * @param {Request} request
 * @param {object} options `store`; `origins`, the sites allowed to call (a list);
 *   `savesPerHour` from one sender; `now` and `randomId`, to be replaced in tests.
 */
export async function handle(request, { store, origins, savesPerHour = 20, now = Date.now(), randomId = makeId }) {
  const origin = request.headers.get("Origin");
  const cors = origins.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" }
    : { Vary: "Origin" };
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors } });

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const url = new URL(request.url);
  const one = /^\/boards\/([a-z0-9]{4,16})$/.exec(url.pathname);

  if (request.method === "GET" && url.pathname === "/boards") {
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "", 10) || 100, 1), MAX_LIST);
    const before = Number.parseInt(url.searchParams.get("before") ?? "", 10) || Number.MAX_SAFE_INTEGER;
    const boards = await store.list({ limit, before });
    return reply(200, { boards, next: boards.length === limit ? boards.at(-1).addedAt : null });
  }

  if (request.method === "GET" && one) {
    const board = await store.get(one[1]);
    return board ? reply(200, { id: board.id, code: board.code }) : reply(404, { error: "Den tavle findes ikke" });
  }

  if (request.method === "POST" && url.pathname === "/boards") {
    const text = await request.text();
    if (text.length > MAX_BODY) return reply(413, { error: "For stor" });
    let code;
    try {
      code = JSON.parse(text).code;
    } catch {
      return reply(400, { error: "Ikke en tavle" });
    }
    const board = readBoard(code);
    if (!board) return reply(400, { error: "Ikke en tavle" });

    const known = await store.findByCode(board.code);
    if (known) return reply(200, { id: known.id });

    const sender = await senderOf(request, now);
    if ((await store.countSince(sender, now - HOUR)) >= savesPerHour) return reply(429, { error: "Prøv igen om lidt" });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = randomId();
      if (await store.insert({ id, code: board.code, addedAt: now, sender })) return reply(201, { id });
      // Taken: by another board with that id, or by this board, sent twice at once.
      const same = await store.findByCode(board.code);
      if (same) return reply(200, { id: same.id });
    }
    return reply(500, { error: "Prøv igen" });
  }

  return reply(404, { error: "Ikke her" });
}

/** The board in a code, if it is one with something written on it. */
function readBoard(code) {
  try {
    const board = decodeBoard(code);
    return board.tiles.some((tile) => !tile.loose) ? board : null;
  } catch {
    return null;
  }
}

/**
 * Who sent a board, as far as counting goes: a hash of the address it came
 * from and the day, so the address itself is not kept.
 */
async function senderOf(request, now) {
  const address = request.headers.get("CF-Connecting-IP") ?? "";
  const day = new Date(now).toISOString().slice(0, 10);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${address} ${day}`));
  return [...new Uint8Array(hash).slice(0, 12)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function makeId() {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
  return [...bytes].map((byte) => ID_LETTERS[byte % ID_LETTERS.length]).join("");
}
