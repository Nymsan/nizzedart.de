// Getting a board out of this browser: as a link.
//
// A board in the gallery has a short link, www.nizzedart.de/#k3x9q2m, by the
// id the gallery's server gave it. Any other board goes by its whole code,
// www.nizzedart.de/#b=<code>, which works without the server.

const LONG_LINK = /^#b=([A-Za-z0-9_-]+)$/;
const SHORT_LINK = /^#([a-z0-9]{4,16})$/;

/** A link that opens the site with this board on it. */
export function shareUrl(board) {
  const url = new URL(location.href);
  url.search = "";
  url.hash = board.shortId ? board.shortId : `b=${board.code}`;
  return url.href;
}

/** What a link's `#...` points to: `{ code }`, `{ shortId }`, or null for no board. */
export function readLink(hash) {
  const long = LONG_LINK.exec(hash);
  if (long) return { code: long[1] };
  const short = SHORT_LINK.exec(hash);
  return short ? { shortId: short[1] } : null;
}

/** The board the page was opened with a link to, if any. It is taken out of the address. */
export function takeLink() {
  const link = readLink(location.hash);
  if (link) history.replaceState(null, "", location.pathname + location.search);
  return link;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
