// The pictures in "Sådan gør du": little pieces of board that show each step.

import { layoutText, tileRight } from "./board.js";
import { BoardView } from "./board-view.js";
import { MARGIN_X, ROW_MAX } from "./glyphs.js";
import { h } from "./ui.js";

const STRIP = 80; // board units: one line of letters
const LETTER = 56; // board units: room for one letter, the widest being M

/** Fill every `[data-example]` under `root` with its picture. */
export function renderHelp(root) {
  for (const node of root.querySelectorAll("[data-example]")) {
    const draw = EXAMPLES[node.dataset.example];
    if (draw) node.replaceChildren(...draw());
  }
}

const EXAMPLES = {
  // The letters of the previous message make the new one.
  pick() {
    const source = layoutText([{ row: 2, text: "SIGER NEJ TIL" }]);
    for (const index of [1, 2, 3, 4, 8]) source[index].used = true;
    return [strip(source), arrow("→"), strip(layoutText([{ row: 2, text: "TIGER" }]))];
  },

  // Upside down, M is W and 6 is 9.
  turn() {
    return [letter("M"), arrow("↻"), letter("M", true), h("span", { className: "help-gap" }), letter("6"), arrow("↻"), letter("6", true)];
  },

  // What was not used is put aside, on the table in front of the board.
  aside() {
    const message = layoutText([{ row: 2, text: "TIGER" }]);
    const aside = [..."SNEJIL"].map((ch, i) => ({ ch, x: 40 + i * 77, row: ROW_MAX, flip: false, loose: true }));
    const node = picture([...message, ...aside], 280, STRIP, "TIGER, med resten af bogstaverne lagt til side");
    node.classList.add("is-wide");
    return [node];
  },
};

/** One line of letters, as wide as it needs to be. */
function strip(tiles) {
  const width = Math.max(...tiles.map(tileRight)) + MARGIN_X;
  const node = picture(tiles, width, STRIP);
  node.classList.add("is-wide");
  node.style.flexGrow = width; // so every strip in a row is drawn at the same scale
  return node;
}

function letter(ch, flip = false) {
  const tile = { ch, x: 0, row: 2, flip, loose: false };
  tile.x = Math.round((LETTER - tileRight(tile)) / 2);
  const node = picture([tile], LETTER, STRIP);
  node.classList.add("is-letter");
  return node;
}

function picture(tiles, width, height, label = null) {
  const node = h("div");
  new BoardView(node, null, { width, height }).render(tiles, { label });
  if (!label) node.setAttribute("aria-hidden", "true");
  return node;
}

function arrow(text) {
  const node = h("span", { className: "help-turn", textContent: text });
  node.setAttribute("aria-hidden", "true");
  return node;
}
