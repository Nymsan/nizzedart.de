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

  const preview = h("div");
  new BoardView(preview).render(board.tiles, { label: title });

  const facts = [board.author && `Af ${board.author}`, board.createdAt > 0 && formatDate(board.createdAt)].filter(Boolean);
  if (board.origin === "link") facts.push("modtaget");

  const node = h(
    "article",
    { className: "card" },
    preview,
    h("h3", { className: "card-title", textContent: title, title }),
    h("p", { className: "card-meta", textContent: facts.join(" · ") }),
    h("p", { className: "card-meta", textContent: lineage(board, library) }),
  );
  node.classList.toggle("is-active", board.id === activeId);

  const button = (label, run) => h("button", { type: "button", className: "btn btn-small", textContent: label, onclick: () => run(board) });
  const actions = h("div", { className: "card-actions" }, button("Byg videre", onUse), button("Del", onShare));
  if (onForget) actions.append(button("Slet", onForget));
  node.append(actions);

  return node;
}

/** Where a board's letters came from. */
function lineage(board, library) {
  if (board.parentId === null) return board.createdAt > 0 ? "Ny start" : "Her begyndte det";
  const parent = library.find(board.parentId);
  return parent ? `Fra: ${library.titleOf(parent)}` : "";
}
