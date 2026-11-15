// Getting a board out of this browser: as a link, and into the shared gallery.

import { GITHUB_REPO } from "./config.js";

const LINK_PATTERN = /^#b=([A-Za-z0-9_-]+)$/;

/** A link that opens the site with this board on it. */
export function shareUrl(board) {
  const url = new URL(location.href);
  url.search = "";
  url.hash = `b=${board.code}`;
  return url.href;
}

/** The board code in the address the page was opened with, if any. It is removed from the address. */
export function takeLinkedCode() {
  const match = LINK_PATTERN.exec(location.hash);
  if (!match) return null;
  history.replaceState(null, "", location.pathname + location.search);
  return match[1];
}

/**
 * The gallery is a file in the GitHub repository. A board gets into it by
 * opening an issue with the board's code in it; a workflow does the rest. This
 * is the address of that issue, filled in and ready to submit.
 */
export function gallerySubmitUrl(board, title) {
  if (!GITHUB_REPO) return null;
  const body = [
    `Besked: ${title}`,
    board.author ? `Af: ${board.author}` : "",
    "",
    "Tryk på den grønne knap herunder, så kommer tavlen med i galleriet om et par minutter.",
    "Lad linjen herunder stå, som den er.",
    "",
    `board:${board.code}`,
  ].join("\n");
  const url = new URL(`https://github.com/${GITHUB_REPO}/issues/new`);
  url.searchParams.set("title", `Tavle: ${title}`.slice(0, 120));
  url.searchParams.set("body", body);
  return url.href;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
