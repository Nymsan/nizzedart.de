// The boards, kept in the Cloudflare D1 database (schema.sql). A board that is
// hidden (hidden = 1, set by hand in the Cloudflare dashboard) is left out of
// the gallery and its link stops working.

export function d1Store(db) {
  return {
    async findByCode(code) {
      return db.prepare("SELECT id FROM boards WHERE code = ?").bind(code).first();
    },

    async get(id) {
      return db.prepare("SELECT id, code FROM boards WHERE id = ? AND hidden = 0").bind(id).first();
    },

    async list({ limit, before }) {
      const { results } = await db
        .prepare("SELECT id, code, added_at AS addedAt FROM boards WHERE hidden = 0 AND added_at < ? ORDER BY added_at DESC LIMIT ?")
        .bind(before, limit)
        .all();
      return results;
    },

    async countSince(sender, since) {
      const row = await db.prepare("SELECT COUNT(*) AS count FROM boards WHERE sender = ? AND added_at >= ?").bind(sender, since).first();
      return row?.count ?? 0;
    },

    /** Returns false if the id or the board is already there. */
    async insert({ id, code, addedAt, sender }) {
      const result = await db
        .prepare("INSERT OR IGNORE INTO boards (id, code, added_at, sender) VALUES (?, ?, ?, ?)")
        .bind(id, code, addedAt, sender)
        .run();
      return result.meta.changes === 1;
    },
  };
}
