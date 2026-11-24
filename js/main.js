// Puts the page together: the board in play, the menu with the gallery and
// the saved boards, and the dialogs for passing a board on.

import { renderCards } from "./cards.js";
import { decodeBoard, encodeBoard } from "./codec.js";
import { GALLERY_URL } from "./config.js";
import { askAuthor, showShareDialog } from "./dialogs.js";
import { Library, ORIGINAL } from "./library.js";
import { takeLinkedCode } from "./share.js";
import { $, toast } from "./ui.js";
import { Workspace } from "./workspace.js";

const GALLERY_PAGE = 12;

/** The design is drawn for a window this size, in pixels. */
const DESIGN = { width: 1280, height: 730, frame: 368, board: 517 };
/** On a narrow screen, standing up, the table goes under the board (keep in step with styles.css). */
const NARROW = window.matchMedia("(max-aspect-ratio: 1/1) and (max-width: 999.98px)");
/** In pixels: the header above the board, the two rows of buttons under it, the least room for the table, the margin. */
const NARROW_LAYOUT = { above: 58, below: 92, table: 150, gutter: 12 };

const library = new Library(browserStorage());
const workspace = new Workspace({
  stage: $("#stage"),
  felt: $("#felt"),
  zone: $("#tableZone"),
  onChange: onWorkspaceChange,
  notify: toast,
});

let galleryShown = GALLERY_PAGE;
let isSaving = false;
/** The window size the board on a narrow screen was last fitted to. */
let narrowSize = null;

fitToWindow();
bindControls();
useBoard(library.source);
openLinkedBoard();
loadGallery();
// The letters are measured in the board font: lay them out again once it is there.
document.fonts?.ready.then(() => workspace.relayout());

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    // Storage is blocked: the page works, but remembers nothing.
    return { getItem: () => null, setItem() {} };
  }
}

/**
 * Scale the page to the window: as in the design on a wide screen. On a narrow
 * one, as wide as it goes, but no taller than leaves room under the board for
 * its buttons and the table, so the whole of it fits on the screen.
 */
function fitToWindow() {
  const { innerWidth: width, innerHeight: height } = window;
  if (!NARROW.matches) narrowSize = null;
  const fitted = NARROW.matches ? narrowScale(width, height) : Math.max(Math.min(width / DESIGN.width, height / DESIGN.height), 0.3);
  if (fitted === null) return;
  document.documentElement.style.setProperty("--s", fitted.toFixed(4));
}

function narrowScale(width, height) {
  // A phone's toolbars come and go as the page scrolls, and the keyboard takes
  // half the screen: the board keeps its size through that, and only changes
  // when the phone is turned, or the window is made a quite different size.
  if (narrowSize && narrowSize.width === width && Math.abs(narrowSize.height - height) < 160) return null;
  narrowSize = { width, height };
  const table = Math.max(NARROW_LAYOUT.table, height * 0.22);
  const tall = (height - NARROW_LAYOUT.above - NARROW_LAYOUT.below - table) / DESIGN.board;
  return Math.max(Math.min((width - 2 * NARROW_LAYOUT.gutter) / DESIGN.frame, tall, 1.4), 0.6);
}

// --- The board in play -------------------------------------------------------

/**
 * Put a board's letters in play, as the board was left. `draft` is how they
 * lay before, to have that back. Where they lie is not kept: a reload starts
 * the board afresh.
 */
function useBoard(board, draft = []) {
  library.source = board;
  workspace.setSource(board.tiles, draft, parseInt(board.id.slice(0, 8), 16));
  library.save();
  $("#byline").textContent = board.author ? `lavet af ${board.author}` : "";
  renderLists();
}

/** Like `useBoard`, for when the user picks another board: what they were doing can be had back. */
function switchTo(board) {
  const previous = workspace.isTouched ? { board: library.source, draft: workspace.draft } : null;
  closeMenu();
  useBoard(board);
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (previous) toast("Din kladde er lagt til side.", { label: "Fortryd", run: () => useBoard(previous.board, previous.draft) });
}

function onWorkspaceChange() {
  $("#originalButton").classList.toggle("is-held", workspace.showingOriginal);
}

/** Save what is on the board as a new board, and offer to pass it on. */
async function saveBoard() {
  if (isSaving) return;
  const tiles = workspace.result();
  if (!tiles) {
    toast("Sæt nogle bogstaver op på tavlen først.");
    return;
  }

  isSaving = true;
  const author = await askAuthor(library.author).finally(() => {
    isSaving = false;
  });
  if (author === null) return;

  const board = library.keep(decodeBoard(encodeBoard({ tiles, author, parentId: library.source.id })), "mine");
  library.author = author;
  useBoard(board);
  share(board, "gemt! send den videre");
}

function share(board, heading = "del tavlen") {
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
    toast("Linket virker desværre ikke.");
    return false;
  }
  board = library.keep(board, "link");
  switchTo(board);
  toast(board.author ? `${board.author} har sendt dig en tavle. Byg videre på den!` : "Du har fået en tavle. Byg videre på den!");
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

// --- The menu ------------------------------------------------------------------

function openMenu() {
  $("#menu").hidden = false;
  $("#menuBackdrop").hidden = false;
  $("#menuButton").setAttribute("aria-expanded", "true");
  $("#menuCloseButton").focus();
}

function closeMenu() {
  if ($("#menu").hidden) return;
  $("#menu").hidden = true;
  $("#menuBackdrop").hidden = true;
  $("#menuButton").setAttribute("aria-expanded", "false");
}

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
  $("#removeButton").addEventListener("click", () => workspace.removeAll());
  $("#scatterButton").addEventListener("click", () => workspace.scatter());
  $("#sortButton").addEventListener("click", () => workspace.sortTable());
  holdToShowOriginal($("#originalButton"));
  $("#authorCancelButton").addEventListener("click", () => $("#authorDialog").close());
  $("#menuButton").addEventListener("click", () => ($("#menu").hidden ? openMenu() : closeMenu()));
  $("#menuCloseButton").addEventListener("click", closeMenu);
  $("#menuBackdrop").addEventListener("click", closeMenu);
  $("#galleryMoreButton").addEventListener("click", () => {
    galleryShown += GALLERY_PAGE;
    renderLists();
  });

  // A pressed button gives the keyboard back to the board, so that a space typed
  // afterwards is a space, and not another press of the button.
  $("#stage").addEventListener("click", (event) => event.target.closest(".play button")?.blur());

  document.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", () => {
    fitToWindow();
    workspace.relayout();
  });
  window.addEventListener("hashchange", openLinkedBoard);
  // A phone may throw the page away while it is in the background.
  window.addEventListener("pagehide", () => library.save());
}

/** "vis original" shows the previous message for as long as it is held down, by pointer or key. */
function holdToShowOriginal(button) {
  const show = (on) => workspace.showOriginal(on);
  button.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      // Only real pointers can be captured; scripted ones (in tests) cannot.
    }
    show(true);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture", "blur"]) button.addEventListener(type, () => show(false));
  button.addEventListener("keydown", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    show(true);
  });
  button.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "Enter") show(false);
  });
  // A long press on a touch screen would otherwise bring up a menu.
  button.addEventListener("contextmenu", (event) => event.preventDefault());
}

function onKeyDown(event) {
  if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
  if (!$("#menu").hidden) {
    if (event.key === "Escape") closeMenu();
    return;
  }
  const target = event.target;
  if (target instanceof HTMLElement) {
    if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
    // Space and Enter belong to the button or link that has the focus.
    if ((event.key === " " || event.key === "Enter") && target.closest("button, a, summary")) return;
  }
  if (workspace.handleKey(event)) event.preventDefault();
}
