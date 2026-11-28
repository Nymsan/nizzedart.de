/**
 * The gallery's server (worker/, see worker/README.md), e.g.
 * "https://nizzedart.<your-name>.workers.dev". Empty until it is set up: the
 * gallery is then read from GALLERY_URL, and boards saved here wait to be
 * uploaded until it is.
 */
export const API_URL = "https://nizzedart.andnymand.workers.dev";

/** The gallery as it was before the server: a file in the repository. */
export const GALLERY_URL = "data/boards.json";

export const STORAGE_KEY = "nizzedart.v1";
