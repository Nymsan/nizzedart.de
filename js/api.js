// Talking to the gallery's server (worker/): the boards in the gallery, one
// board by the short id in its link, and putting a board in the gallery.

/**
 * The gallery's server at `base`, or null when there is none (API_URL in
 * js/config.js is empty): then the gallery is read from data/boards.json, and
 * boards are passed on by their long links only.
 */
export function galleryApi(base, fetchImpl = (...args) => fetch(...args)) {
  if (!base) return null;

  async function call(path, init = {}) {
    const response = await fetchImpl(`${base}${path}`, init);
    if (!response.ok) throw new Error(`The gallery answered ${response.status}`);
    return response.json();
  }

  return {
    /** The gallery as `Library.setGallery` takes it: `{ boards: [{ id, code }] }`, oldest first. */
    async list() {
      const { boards } = await call("/boards?limit=500", { cache: "no-cache" });
      return { boards: [...boards].reverse() };
    },

    /** The code of the board with this short id. */
    async get(id) {
      return (await call(`/boards/${encodeURIComponent(id)}`)).code;
    },

    /** Put a board in the gallery. Resolves to its short id. */
    async save(code) {
      // Sent as plain text, so the browser need not ask the server first whether it may.
      return (await call("/boards", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ code }) })).id;
    },
  };
}
