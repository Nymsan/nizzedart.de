// The lists of boards under the workspace: one card per board.

import { BoardView } from "./board-view.js";
import { formatDate, h } from "./ui.js";

/**
 * @param {HTMLElement} container
 * @param {object[]} boards
 * @param {object} options `library`, `activeId`, and what the buttons do:
 *   `onUse(board)`, `onShare(board)` and, for boards that can be removed, `onForget(board)`.
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
  if (board.origin === "link") facts.push("fået sendt");
  const isActive = board.id === activeId;

  const text = h(
    "div",
    { className: "card-text" },
    h("h3", { className: "card-title", textContent: title, title }),
    h("p", { className: "card-meta", textContent: facts.join(" · ") }),
    h("p", { className: "card-meta", textContent: lineage(board, library) }),
  );
  if (isActive) text.prepend(h("span", { className: "card-badge", textContent: "På tavlen nu" }));

  const button = (label, run, primary = false) =>
    h("button", { type: "button", className: `btn btn-small${primary ? " btn-primary" : ""}`, textContent: label, onclick: () => run(board) });
  const actions = h("div", { className: "card-actions" }, button("Byg videre", onUse, !isActive), button("Del", onShare));
  if (onForget) actions.append(button("Slet", onForget));

  const node = h("article", { className: "card" }, preview, text, actions);
  node.classList.toggle("is-active", isActive);

  return node;
}

/** Where a board's letters came from. */
function lineage(board, library) {
  if (board.parentId === null) return board.createdAt > 0 ? "Ny start" : "Her begyndte det hele";
  const parent = library.find(board.parentId);
  return parent ? `Bygget på: ${library.titleOf(parent)}` : "";
}
