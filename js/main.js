// Puts the page together: the workspace, the saved boards and the gallery.

import { renderCards } from "./cards.js";
import { decodeBoard, encodeBoard } from "./codec.js";
import { GALLERY_URL } from "./config.js";
import { askAuthor, showShareDialog } from "./dialogs.js";
import { Library, ORIGINAL } from "./library.js";
import { watchBoardFont } from "./metrics.js";
import { takeLinkedCode } from "./share.js";
import { $, formatDate, toast } from "./ui.js";
import { Workspace } from "./workspace.js";

const GALLERY_PAGE = 12;

const library = new Library(browserStorage());
const workspace = new Workspace({
  sourceBoard: $("#sourceBoard"),
  composeBoard: $("#composeBoard"),
  tray: $("#tray"),
  onChange: onWorkspaceChange,
  notify: toast,
});

let galleryShown = GALLERY_PAGE;
let saveTimer = 0;
let isSaving = false;

watchBoardFont();
bindControls();
useBoard(library.source, library.draft);
openLinkedBoard();
loadGallery();

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    // Storage is blocked: the page works, but remembers nothing.
    return { getItem: () => null, setItem() {} };
  }
}

// --- The board in play -------------------------------------------------------

/** Put a board on the left, ready to be turned into a new message. */
function useBoard(board, draft = []) {
  library.source = board;
  workspace.setSource(board.tiles, draft);
  library.save();
  renderSourceInfo();
  renderLists();
}

/** Like `useBoard`, for when the user picks another board: an unfinished message can be had back. */
function switchTo(board) {
  const previous = { board: library.source, draft: workspace.draft };
  if (workspace.isRewriting) workspace.cancelRewrite();
  useBoard(board);
  $("#workspace").scrollIntoView({ behavior: "smooth", block: "start" });
  if (previous.draft.length > 0) {
    toast("Din kladde blev lagt væk.", { label: "Fortryd", run: () => useBoard(previous.board, previous.draft) });
  }
}

function onWorkspaceChange() {
  const rewriting = workspace.isRewriting;
  $("#composePanel").inert = rewriting;
  $("#sourcePanel").classList.toggle("is-rewriting", rewriting);
  $("#rewriteButton").hidden = rewriting;
  $("#rewriteCancelButton").hidden = !rewriting;
  $("#rewriteSaveButton").hidden = !rewriting;
  if (rewriting) return;

  // Remember the unfinished message, but not on every step of a drag.
  library.draft = workspace.draft;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => library.save(), 300);
}

function renderSourceInfo() {
  const board = library.source;
  const facts = [board.author && `Af ${board.author}`, board.createdAt > 0 && formatDate(board.createdAt)].filter(Boolean);
  $("#sourceByline").textContent = facts.join(" · ");
}

/** Save what is on the board as a new board, and offer to pass it on. */
async function saveBoard() {
  if (isSaving) return;
  const tiles = workspace.result();
  if (!tiles) {
    toast("Skriv en besked på tavlen først.");
    return;
  }
  // A rewritten board starts a new chain; a new message descends from the one it was made of.
  const parentId = workspace.isRewriting ? null : library.source.id;

  isSaving = true;
  const author = await askAuthor(library.author).finally(() => {
    isSaving = false;
  });
  if (author === null) return;

  const board = library.keep(decodeBoard(encodeBoard({ tiles, author, parentId })), "mine");
  library.author = author;
  useBoard(board);
  share(board, "Gemt! Send tavlen videre");
}

function share(board, heading = "Del tavlen") {
  showShareDialog(board, {
    title: library.titleOf(board),
    heading,
    canSubmit: board.id !== ORIGINAL.id && !library.gallery.some((shared) => shared.id === board.id),
  });
}

// --- Boards from elsewhere -----------------------------------------------------

/** If the page was opened through a share link, put that board in play. */
function openLinkedBoard() {
  const code = takeLinkedCode();
  if (code === null) return false;
  let board;
  try {
    board = decodeBoard(code);
  } catch {
    toast("Linket kunne ikke læses.");
    return false;
  }
  board = library.keep(board, "link");
  switchTo(board);
  toast(board.author ? `Du har fået en tavle af ${board.author}. Byg videre på den!` : "Du har fået en tavle. Byg videre på den!");
  return true;
}

async function loadGallery() {
  try {
    const response = await fetch(GALLERY_URL, { cache: "no-cache" });
    if (!response.ok) throw new Error(response.statusText);
    library.setGallery(await response.json());
  } catch {
    // Offline, or no gallery yet: everything else still works.
  }
  renderLists();
}

// --- Lists ---------------------------------------------------------------------

function renderLists() {
  const options = { library, activeId: library.source.id, onUse: switchTo, onShare: (board) => share(board) };

  // The original always closes the gallery, also when the gallery could not be fetched.
  const gallery = [...library.gallery.filter((board) => board.id !== ORIGINAL.id), ORIGINAL];
  renderCards($("#galleryList"), gallery.slice(0, galleryShown), options);
  $("#galleryMoreButton").hidden = gallery.length <= galleryShown;
  $("#galleryEmpty").hidden = gallery.length > 1;

  renderCards($("#savedList"), library.saved, { ...options, onForget: forget });
  $("#savedSection").hidden = library.saved.length === 0;
}

function forget(board) {
  const putBack = library.forget(board.id);
  renderLists();
  toast("Tavlen er slettet.", {
    label: "Fortryd",
    run: () => {
      putBack();
      renderLists();
    },
  });
}

// --- Controls --------------------------------------------------------------------

function bindControls() {
  $("#saveButton").addEventListener("click", saveBoard);
  $("#clearButton").addEventListener("click", () => workspace.clear());
  $("#rewriteButton").addEventListener("click", () => workspace.startRewrite());
  $("#rewriteCancelButton").addEventListener("click", () => workspace.cancelRewrite());
  $("#rewriteSaveButton").addEventListener("click", saveBoard);
  $("#authorCancelButton").addEventListener("click", () => $("#authorDialog").close());
  $("#galleryMoreButton").addEventListener("click", () => {
    galleryShown += GALLERY_PAGE;
    renderLists();
  });

  // A pressed button gives the keyboard back to the board, so that a space typed
  // afterwards is a space, and not another press of the button.
  $("#workspace").addEventListener("click", (event) => event.target.closest(".panel-actions button")?.blur());

  document.addEventListener("keydown", onKeyDown);
  window.addEventListener("hashchange", openLinkedBoard);
  // A phone may throw the page away while it is in the background.
  window.addEventListener("pagehide", () => library.save());
}

function onKeyDown(event) {
  if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
  const target = event.target;
  if (target instanceof HTMLElement) {
    if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
    // Space and Enter belong to the button or link that has the focus.
    if ((event.key === " " || event.key === "Enter") && target.closest("button, a, summary")) return;
  }
  if (workspace.handleKey(event)) event.preventDefault();
}
