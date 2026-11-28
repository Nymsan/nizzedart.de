// The Cloudflare Worker: src/app.js, with the boards in the D1 database.
// Settings are in wrangler.toml; see README.md.

import { handle } from "./app.js";
import { d1Store } from "./store.js";

export default {
  async fetch(request, env) {
    return handle(request, {
      store: d1Store(env.DB),
      origins: String(env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
      savesPerHour: Number(env.SAVES_PER_HOUR) || 20,
    });
  },
};
