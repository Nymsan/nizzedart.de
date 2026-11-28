-- The gallery. Run on every deploy (.github/workflows/worker.yml): it only
-- creates what is not there yet.

CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,             -- the short id in the link: www.nizzedart.de/#<id>
  code TEXT NOT NULL UNIQUE,       -- the board, as js/codec.js writes it
  added_at INTEGER NOT NULL,       -- when it came in, in milliseconds since 1970
  sender TEXT,                     -- a hash of who sent it and the day, to limit how many one sends
  hidden INTEGER NOT NULL DEFAULT 0 -- 1: out of the gallery, and its link no longer works
);

CREATE INDEX IF NOT EXISTS boards_by_time ON boards (hidden, added_at DESC);
CREATE INDEX IF NOT EXISTS boards_by_sender ON boards (sender, added_at);
