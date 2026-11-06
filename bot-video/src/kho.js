// Lưu dữ liệu trong Cloudflare D1. Bảng tự tạo khi Worker chạy lần đầu (schema.sql chỉ để tham khảo).

export const LUOC_DO = [
  `CREATE TABLE IF NOT EXISTS thanh_vien (
    id INTEGER PRIMARY KEY, ten TEXT NOT NULL, ten_khoa TEXT NOT NULL, user_id TEXT, ten_zalo TEXT,
    tu_tuan TEXT NOT NULL, trang_thai TEXT NOT NULL DEFAULT 'hoat_dong', them_luc INTEGER NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS ix_tv_user ON thanh_vien (user_id)',
  `CREATE TABLE IF NOT EXISTS video (
    id INTEGER PRIMARY KEY, khoa TEXT NOT NULL UNIQUE, link TEXT, nen_tang TEXT, user_id TEXT,
    thanh_vien_id INTEGER, tuan TEXT NOT NULL, luc INTEGER NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS ix_video_tuan ON video (tuan)',
  'CREATE INDEX IF NOT EXISTS ix_video_tv ON video (thanh_vien_id)',
  `CREATE TABLE IF NOT EXISTS mien (
    thanh_vien_id INTEGER NOT NULL, tuan TEXT NOT NULL, ly_do TEXT, luc INTEGER NOT NULL, PRIMARY KEY (thanh_vien_id, tuan))`,
  `CREATE TABLE IF NOT EXISTS yeu_cau (
    id INTEGER PRIMARY KEY, loai TEXT NOT NULL, chat_id TEXT, user_id TEXT, ten_zalo TEXT, thanh_vien_id INTEGER,
    tuan TEXT, ly_do TEXT, trang_thai TEXT NOT NULL DEFAULT 'cho', luc INTEGER NOT NULL)`,
  'CREATE TABLE IF NOT EXISTS viec (khoa TEXT PRIMARY KEY, luc INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS cai_dat (khoa TEXT PRIMARY KEY, gia_tri TEXT)',
];

const doi = (r) => r.meta?.changes ?? 0;

export class Kho {
  constructor(db) { this._db = db; this._daDamBao = false; }

  _q(sql, ...thamSo) { return this._db.prepare(sql).bind(...thamSo.map((x) => (x === undefined ? null : x))); }
  async _tatCa(sql, ...thamSo) { return (await this._q(sql, ...thamSo).all()).results; }

  async damBaoLuocDo() {
    if (this._daDamBao) return;
    await this._db.batch(LUOC_DO.map((sql) => this._db.prepare(sql)));
    this._daDamBao = true;
  }

  // ---------- cài đặt, việc chạy một lần ----------

  async layCaiDat(khoa) { return (await this._q('SELECT gia_tri FROM cai_dat WHERE khoa = ?', khoa).first())?.gia_tri ?? ''; }
  datCaiDat(khoa, giaTri) {
    return this._q('INSERT INTO cai_dat (khoa, gia_tri) VALUES (?, ?) ON CONFLICT(khoa) DO UPDATE SET gia_tri = excluded.gia_tri', khoa, giaTri).run();
  }

  // Trả true đúng một lần cho mỗi khoa, kể cả khi hai lần cron chạy chồng nhau.
  async gianhViec(khoa, luc) { return doi(await this._q('INSERT OR IGNORE INTO viec (khoa, luc) VALUES (?, ?)', khoa, luc).run()) > 0; }

  // ---------- thành viên ----------

  // Thêm người vào danh sách. Đã có người cùng tên đang hoạt động thì bỏ qua.
  async themThanhVien(ten, tenKhoa, tuTuan, luc) {
    const co = await this._q("SELECT id FROM thanh_vien WHERE ten_khoa = ? AND trang_thai = 'hoat_dong'", tenKhoa).first();
    if (co) return { id: co.id, moi: false };
    const r = await this._q('INSERT INTO thanh_vien (ten, ten_khoa, tu_tuan, them_luc) VALUES (?, ?, ?, ?)', ten, tenKhoa, tuTuan, luc).run();
    return { id: r.meta.last_row_id, moi: true };
  }

  dsThanhVien() { return this._tatCa("SELECT * FROM thanh_vien WHERE trang_thai = 'hoat_dong' ORDER BY id"); }
  layThanhVien(id) { return this._q("SELECT * FROM thanh_vien WHERE id = ? AND trang_thai = 'hoat_dong'", id).first(); }
  thanhVienTheoUser(userId) { return this._q("SELECT * FROM thanh_vien WHERE user_id = ? AND trang_thai = 'hoat_dong'", userId).first(); }

  // Gắn tài khoản Zalo vào một người trong danh sách; video người đó gửi trước khi được gắn cũng được tính.
  async lienKet(id, userId, tenZalo) {
    await this._db.batch([
      this._q('UPDATE thanh_vien SET user_id = ?, ten_zalo = ? WHERE id = ?', userId, tenZalo, id),
      this._q('UPDATE video SET thanh_vien_id = ? WHERE user_id = ? AND thanh_vien_id IS NULL', id, userId),
    ]);
  }

  capNhatTenZalo(id, tenZalo) { return this._q('UPDATE thanh_vien SET ten_zalo = ? WHERE id = ?', tenZalo, id).run(); }
  huyLienKet(id) { return this._q('UPDATE thanh_vien SET user_id = NULL, ten_zalo = NULL WHERE id = ?', id).run(); }
  async datTrangThai(id, trangThai) {
    return doi(await this._q("UPDATE thanh_vien SET trang_thai = ? WHERE id = ? AND trang_thai = 'hoat_dong'", trangThai, id).run()) > 0;
  }

  // ---------- video ----------

  // Trả { moi: true } nếu ghi được, { moi: false, cu } nếu link đã có người nộp.
  async luuVideo({ khoa, link, nenTang, userId, thanhVienId, tuan, luc }) {
    const r = await this._q(
      'INSERT OR IGNORE INTO video (khoa, link, nen_tang, user_id, thanh_vien_id, tuan, luc) VALUES (?, ?, ?, ?, ?, ?, ?)',
      khoa, link, nenTang, userId, thanhVienId, tuan, luc,
    ).run();
    if (doi(r) > 0) return { moi: true };
    return { moi: false, cu: await this._q('SELECT * FROM video WHERE khoa = ?', khoa).first() };
  }

  async xoaVideo(khoa) { return doi(await this._q('DELETE FROM video WHERE khoa = ?', khoa).run()) > 0; }

  // Số video theo từng người, từng tuần (chỉ video đã gắn với thành viên).
  soVideoTheoTuan() { return this._tatCa('SELECT thanh_vien_id, tuan, COUNT(*) AS so FROM video WHERE thanh_vien_id IS NOT NULL GROUP BY thanh_vien_id, tuan'); }

  videoTrongTuan(tuan) {
    return this._tatCa(
      `SELECT v.link, v.nen_tang, v.luc, t.ten FROM video v JOIN thanh_vien t ON t.id = v.thanh_vien_id
       WHERE v.tuan = ? ORDER BY v.luc, v.id`, tuan,
    );
  }

  // ---------- nghỉ có phép ----------

  datMien(thanhVienId, tuan, lyDo, luc) {
    return this._q(
      'INSERT INTO mien (thanh_vien_id, tuan, ly_do, luc) VALUES (?, ?, ?, ?) ON CONFLICT(thanh_vien_id, tuan) DO UPDATE SET ly_do = excluded.ly_do',
      thanhVienId, tuan, lyDo, luc,
    ).run();
  }
  async huyMien(thanhVienId, tuan) { return doi(await this._q('DELETE FROM mien WHERE thanh_vien_id = ? AND tuan = ?', thanhVienId, tuan).run()) > 0; }
  dsMien() { return this._tatCa('SELECT thanh_vien_id, tuan, ly_do FROM mien'); }

  // ---------- yêu cầu chờ duyệt (tham gia, xin nghỉ) ----------

  async taoYeuCau({ loai, chatId, userId, tenZalo, thanhVienId, tuan, lyDo, luc }) {
    const trung = await this._q(
      "SELECT id FROM yeu_cau WHERE loai = ? AND user_id = ? AND IFNULL(tuan, '') = IFNULL(?, '') AND trang_thai = 'cho'",
      loai, userId, tuan,
    ).first();
    if (trung) return { id: trung.id, moi: false };
    const r = await this._q(
      'INSERT INTO yeu_cau (loai, chat_id, user_id, ten_zalo, thanh_vien_id, tuan, ly_do, luc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      loai, chatId, userId, tenZalo, thanhVienId, tuan, lyDo, luc,
    ).run();
    return { id: r.meta.last_row_id, moi: true };
  }

  layYeuCau(id) { return this._q('SELECT * FROM yeu_cau WHERE id = ?', id).first(); }
  yeuCauDangCho() { return this._tatCa("SELECT * FROM yeu_cau WHERE trang_thai = 'cho' ORDER BY id"); }
  // Trả true nếu đổi được (yêu cầu còn đang chờ).
  async ketThucYeuCau(id, trangThai) {
    return doi(await this._q("UPDATE yeu_cau SET trang_thai = ? WHERE id = ? AND trang_thai = 'cho'", trangThai, id).run()) > 0;
  }
}
