// The lists of boards in the menu: one card per board.

import { BoardView } from "./board-view.js";
import { formatDate, h } from "./ui.js";

/**
 * @param {HTMLElement} container
 * @param {object[]} boards
 * @param {object} options `library`, `activeId`, and what the buttons do:
 *   `onUse(board)`, `onShare(board)` and `onForget(board)`, which is offered for
 *   the boards kept only in this browser.
 */
export function renderCards(container, boards, options) {
  container.replaceChildren(...boards.map((board) => card(board, options)));
}

function card(board, { library, activeId, onUse, onShare, onForget }) {
  const title = library.titleOf(board);

  // The picture of the board is the big button: it puts the board in play.
  const picture = h("div");
  new BoardView(picture).render(board.tiles, { label: title });
  const preview = h("button", { type: "button", className: "card-preview", title: "Byg videre på den", onclick: () => onUse(board) }, picture);

  const facts = [board.author && `Af ${board.author}`, board.createdAt > 0 && formatDate(board.createdAt)].filter(Boolean);
  const isActive = board.id === activeId;

  const text = h(
    "div",
    { className: "card-text" },
    h("h3", { className: "card-title", textContent: title, title }),
    h("p", { className: "card-meta", textContent: facts.join(" · ") }),
  );
  // A board only this browser has: it is not in the shared gallery.
  if (board.origin) text.prepend(h("span", { className: "card-badge card-badge-quiet", textContent: "ikke uploadet" }));
  if (isActive) text.prepend(h("span", { className: "card-badge", textContent: "på tavlen nu" }));

  const button = (label, run, solid = false) =>
    h("button", { type: "button", className: `pill pill-text${solid ? " pill-solid" : ""}`, textContent: label, onclick: () => run(board) });
  const actions = h("div", { className: "card-actions" }, button("byg videre", onUse, !isActive), button("del", onShare));
  if (onForget && board.origin) actions.append(button("slet", onForget));

  const node = h("article", { className: "card" }, preview, text, actions);
  node.classList.toggle("is-active", isActive);

  return node;
}
