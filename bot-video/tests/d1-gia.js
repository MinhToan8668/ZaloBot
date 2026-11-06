// Giả lập Cloudflare D1 bằng SQLite có sẵn trong Node 22 (node:sqlite), để test chạy SQL thật.
import { DatabaseSync } from 'node:sqlite';

export function taoD1() {
  const db = new DatabaseSync(':memory:');
  const cauLenh = (sql, thamSo = []) => ({
    bind: (...a) => cauLenh(sql, a),
    async run() { const r = db.prepare(sql).run(...thamSo); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    async first() { const r = db.prepare(sql).get(...thamSo); return r ? { ...r } : null; },
    async all() { return { results: db.prepare(sql).all(...thamSo).map((r) => ({ ...r })) }; },
  });
  return {
    prepare: (sql) => cauLenh(sql),
    async batch(ds) { const kq = []; for (const c of ds) kq.push(await c.run()); return kq; },
  };
}
