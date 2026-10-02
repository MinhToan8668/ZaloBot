// Lưu tin nhắn và trạng thái hẹn giờ trong Cloudflare D1. Lược đồ: schema.sql

export class Kho {
  constructor(db) { this._db = db; }

  // Trả true nếu là tin mới (webhook có thể gửi lại cùng một tin).
  async luuTin({ chatId, messageId, userId, ten, noiDung, luc, ngay }) {
    const r = await this._db.prepare(
      'INSERT OR IGNORE INTO tin_nhan (chat_id, message_id, user_id, ten, noi_dung, luc, ngay) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(chatId, messageId, userId, ten, noiDung, luc, ngay).run();
    return (r.meta?.changes ?? 0) > 0;
  }

  async tinTrongNgay(chatId, ngay, gioiHan = 300) {
    const { results } = await this._db.prepare(
      'SELECT ten, noi_dung, luc FROM tin_nhan WHERE chat_id = ? AND ngay = ? ORDER BY luc DESC, id DESC LIMIT ?',
    ).bind(chatId, ngay, gioiHan).all();
    return results.reverse();
  }

  ghiNhom(chatId, chatType, luc) {
    return this._db.prepare(
      'INSERT INTO nhom (chat_id, chat_type, lan_cuoi) VALUES (?, ?, ?)'
      + ' ON CONFLICT(chat_id) DO UPDATE SET chat_type = excluded.chat_type, lan_cuoi = excluded.lan_cuoi',
    ).bind(chatId, chatType, luc).run();
  }

  async nhomGanDay(soNgay, bayGio) {
    const { results } = await this._db.prepare(
      "SELECT chat_id FROM nhom WHERE chat_type = 'GROUP' AND lan_cuoi >= ?",
    ).bind(bayGio - soNgay * 86400_000).all();
    return results.map((r) => r.chat_id);
  }

  // Giãn cách trả lời AI theo nhóm: trả true nếu được phép trả lời lúc này.
  async xinTraLoi(chatId, bayGio, gianCachMs) {
    const r = await this._db.prepare(
      'UPDATE nhom SET lan_tra_loi = ? WHERE chat_id = ? AND (lan_tra_loi IS NULL OR lan_tra_loi <= ?)',
    ).bind(bayGio, chatId, bayGio - gianCachMs).run();
    return (r.meta?.changes ?? 0) > 0;
  }

  async layLich(chatId, ngay) {
    const r = await this._db.prepare(
      'SELECT da_nhac, da_chot, nghi FROM lich WHERE chat_id = ? AND ngay = ?',
    ).bind(chatId, ngay).first();
    return r ?? { da_nhac: 0, da_chot: 0, nghi: 0 };
  }

  datNghi(chatId, ngay) {
    return this._db.prepare(
      'INSERT INTO lich (chat_id, ngay, nghi) VALUES (?, ?, 1) ON CONFLICT(chat_id, ngay) DO UPDATE SET nghi = 1',
    ).bind(chatId, ngay).run();
  }

  // Giành quyền làm một việc (nhac/chot) trong ngày. Trả true đúng một lần, kể cả khi cron chạy trùng.
  async gianhViec(chatId, ngay, viec) {
    if (viec !== 'da_nhac' && viec !== 'da_chot') throw new Error(`Việc không hợp lệ: ${viec}`);
    const r = await this._db.prepare(
      `INSERT INTO lich (chat_id, ngay, ${viec}) VALUES (?, ?, 1)`
      + ` ON CONFLICT(chat_id, ngay) DO UPDATE SET ${viec} = 1 WHERE ${viec} = 0 AND nghi = 0`,
    ).bind(chatId, ngay).run();
    return (r.meta?.changes ?? 0) > 0;
  }

  donDep(giuSoNgay, bayGio) {
    return this._db.prepare('DELETE FROM tin_nhan WHERE luc < ?').bind(bayGio - giuSoNgay * 86400_000).run();
  }
}
