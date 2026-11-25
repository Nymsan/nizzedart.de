// The two dialogs: who wrote the message, and how to pass a board on.

import { BoardView } from "./board-view.js";
import { cleanAuthor } from "./codec.js";
import { copyText, shareUrl } from "./share.js";
import { $ } from "./ui.js";

/** Ask who is writing. Resolves to the name, or null if the dialog was dismissed. */
export function askAuthor(suggestion) {
  const dialog = $("#authorDialog");
  const input = $("#authorInput");
  input.value = suggestion;
  dialog.returnValue = "";
  dialog.showModal();
  input.select();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "save" ? cleanAuthor(input.value) : null), {
      once: true,
    });
  });
}

/**
 * Show a board with its link and the ways to pass it on.
 * @param {object} board
 * @param {object} options `title` of the board, `heading` of the dialog, and
 *   `notUploaded`: whether to say it did not get into the gallery.
 */
export function showShareDialog(board, { title, heading, notUploaded = false }) {
  const url = shareUrl(board);

  $("#shareHeading").textContent = heading;
  $("#shareTitle").textContent = board.author ? `${title} — af ${board.author}` : title;
  new BoardView($("#sharePreview")).render(board.tiles, { label: title });
  $("#shareLink").value = url;
  $("#copyButton").textContent = "kopiér link";
  $("#nativeShareButton").hidden = typeof navigator.share !== "function";
  $("#uploadNote").hidden = !notUploaded;

  $("#copyButton").onclick = async () => {
    const copied = await copyText(url);
    // Without clipboard access, leave the link selected so it can be copied by hand.
    if (!copied) $("#shareLink").select();
    $("#copyButton").textContent = copied ? "kopieret!" : "markeret – kopiér selv";
  };
  $("#nativeShareButton").onclick = () => {
    navigator.share({ title: "nizzedart.de", text: title, url }).catch(() => {
      // The share sheet was dismissed.
    });
  };

  $("#shareDialog").showModal();
}
