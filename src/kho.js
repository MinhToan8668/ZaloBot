// Lưu tin nhắn và trạng thái hẹn giờ trong Cloudflare D1. Lược đồ đầy đủ: schema.sql

// Bảng thêm sau này: tạo tự động nếu chưa có, để không phải chạy lại schema.sql trên dashboard.
const LUOC_DO_THEM = [
  'CREATE TABLE IF NOT EXISTS cai_dat (chat_id TEXT NOT NULL, khoa TEXT NOT NULL, gia_tri TEXT, PRIMARY KEY (chat_id, khoa))',
  'CREATE TABLE IF NOT EXISTS chot_ngay (chat_id TEXT NOT NULL, ngay TEXT NOT NULL, mon TEXT, quan TEXT, PRIMARY KEY (chat_id, ngay))',
  'CREATE TABLE IF NOT EXISTS viec_ngay (chat_id TEXT NOT NULL, ngay TEXT NOT NULL, viec TEXT NOT NULL, PRIMARY KEY (chat_id, ngay, viec))',
];
let daDamBao = false;

export class Kho {
  constructor(db) { this._db = db; }

  // Chạy một lần cho mỗi lần Worker khởi động
  async damBaoLuocDo() {
    if (daDamBao) return;
    await this._db.batch(LUOC_DO_THEM.map((sql) => this._db.prepare(sql)));
    daDamBao = true;
  }

  async layCaiDat(chatId, khoa) {
    const r = await this._db.prepare('SELECT gia_tri FROM cai_dat WHERE chat_id = ? AND khoa = ?').bind(chatId, khoa).first();
    return r?.gia_tri ?? '';
  }

  datCaiDat(chatId, khoa, giaTri) {
    return this._db.prepare(
      'INSERT INTO cai_dat (chat_id, khoa, gia_tri) VALUES (?, ?, ?) ON CONFLICT(chat_id, khoa) DO UPDATE SET gia_tri = excluded.gia_tri',
    ).bind(chatId, khoa, giaTri).run();
  }

  luuChot(chatId, ngay, mon, quan) {
    return this._db.prepare(
      'INSERT INTO chot_ngay (chat_id, ngay, mon, quan) VALUES (?, ?, ?, ?)'
      + ' ON CONFLICT(chat_id, ngay) DO UPDATE SET mon = excluded.mon, quan = excluded.quan',
    ).bind(chatId, ngay, mon, quan).run();
  }

  // Các ngày gần đây đã chốt gì (trừ hôm nay), mới nhất trước.
  async chotGanDay(chatId, homNay, soNgay = 7) {
    const { results } = await this._db.prepare(
      'SELECT ngay, mon, quan FROM chot_ngay WHERE chat_id = ? AND ngay < ? ORDER BY ngay DESC LIMIT ?',
    ).bind(chatId, homNay, soNgay).all();
    return results;
  }

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

  // Bot vừa trả lời trong nhóm này chưa lâu? (để nối mạch hội thoại không cần tag)
  async dangTroChuyen(chatId, bayGio, cuaSoMs) {
    const r = await this._db.prepare('SELECT lan_tra_loi FROM nhom WHERE chat_id = ?').bind(chatId).first();
    return Boolean(r?.lan_tra_loi) && bayGio - r.lan_tra_loi <= cuaSoMs;
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

  // Giành quyền làm một việc trong ngày. Trả true đúng một lần, kể cả khi cron chạy trùng.
  // da_nhac/da_chot nằm trong bảng lich; việc khác (vd nhac2) ghi vào bảng viec_ngay.
  async gianhViec(chatId, ngay, viec) {
    if (viec !== 'da_nhac' && viec !== 'da_chot') {
      if (!/^[a-z0-9_]+$/.test(viec)) throw new Error(`Việc không hợp lệ: ${viec}`);
      if ((await this.layLich(chatId, ngay)).nghi) return false;
      const r = await this._db.prepare('INSERT OR IGNORE INTO viec_ngay (chat_id, ngay, viec) VALUES (?, ?, ?)').bind(chatId, ngay, viec).run();
      return (r.meta?.changes ?? 0) > 0;
    }
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
