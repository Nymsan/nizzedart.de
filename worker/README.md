# The gallery's server

A small Cloudflare Worker that keeps the gallery. It runs on Cloudflare's
servers. Nothing needs to run on your own computer.

- `POST /boards` puts a saved board in the gallery and gives it a short id, for
  links like `www.nizzedart.de/#k3x9q2m`.
- `GET /boards` lists the gallery, newest first. `GET /boards/<id>` returns one board.
- The boards are kept in a Cloudflare D1 database (`schema.sql`). The boards
  that were in `data/boards.json` are put in on the first deploy (`seed.sql`).
- The Worker checks each board with the site's own `js/codec.js`. It refuses
  anything that isn't a board, and boards with nothing written on them. One
  visitor can add 20 boards an hour (`SAVES_PER_HOUR` in `wrangler.toml`).

The Cloudflare free plan covers a site this size: 100,000 requests a day, and
5 GB in D1. No credit card is needed. Check https://www.cloudflare.com/plans/developer-platform/
if the site grows a lot.

## Setting it up (once)

1. Make a free account at https://dash.cloudflare.com/sign-up.
2. Make the database: **Storage & Databases → D1 → Create database**, name it
   `nizzedart`. Copy its **Database ID** into `database_id` in `wrangler.toml`.
3. Make an API token: **My Profile → API Tokens → Create Token**, with the
   template **Edit Cloudflare Workers**. Add the permission **Account → D1 →
   Edit** to it. Copy the token.
4. Find your **Account ID**. It's on the right of **Workers & Pages → Overview**.
5. On GitHub, go to the repository's **Settings → Secrets and variables →
   Actions → New repository secret**, and add:
   - `CLOUDFLARE_API_TOKEN`: the token from step 3
   - `CLOUDFLARE_ACCOUNT_ID`: the id from step 4
6. Commit and push. The workflow **Deploy the gallery server**
   (`.github/workflows/worker.yml`) creates the table, puts the old gallery
   in, and deploys the Worker. Follow it under the repository's **Actions**
   tab.
7. The Worker's address is under **Workers & Pages → nizzedart**, for example
   `https://nizzedart.<your-name>.workers.dev`. Put it in `API_URL` in
   `js/config.js`, then commit and push. The site now uses the gallery
   server. Boards that visitors saved before this are uploaded the next time
   they open the site.

## Looking after it

- **See the boards:** **Storage & Databases → D1 → nizzedart → Explore data**,
  table `boards`.
- **Take a board out of the gallery:** in the same view, set its `hidden` to
  `1`. Its link stops working too. Set it back to `0` to restore it. You can
  also run this in the **Console** tab:
  `UPDATE boards SET hidden = 1 WHERE id = 'k3x9q2m';`
- **Find a board from its link:** the id is the part after `#`.
- **See what the Worker does:** **Workers & Pages → nizzedart → Logs**
  (switch on *Workers Logs* the first time) and **Metrics**.
- **Change it:** edit the files in `worker/` and push. The workflow deploys it
  again. It also runs when `js/codec.js` or `js/glyphs.js` changes, because
  the Worker checks boards with them. You can rerun it by hand: **Actions →
  Deploy the gallery server → Run workflow**.
- **Settings:** `ALLOWED_ORIGINS` (the sites that may use it) and
  `SAVES_PER_HOUR` are in `wrangler.toml`.
- **Stop it:** **Workers & Pages → nizzedart → Settings → Delete**. Empty
  `API_URL` in `js/config.js` first, so the site goes back to
  `data/boards.json`.

## Testing

The Worker's logic (`src/app.js`) is tested with the rest of the site in
`/tests.html`, against boards kept in memory. `src/store.js`, which talks to
D1, is only tried for real once it's deployed.
