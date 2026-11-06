/* Lược đồ D1 của bot nhắc video. Bot tự tạo bảng khi chạy lần đầu, file này chỉ để tham khảo hoặc tạo tay:
   npx wrangler d1 execute bot-video --remote --file=schema.sql
   Ngày lưu dạng YYYY-MM-DD giờ Việt Nam; tuan là ngày thứ Hai đầu tuần; luc là mốc mili giây. */
CREATE TABLE IF NOT EXISTS thanh_vien ( id INTEGER PRIMARY KEY, ten TEXT NOT NULL, ten_khoa TEXT NOT NULL, user_id TEXT, ten_zalo TEXT, tu_tuan TEXT NOT NULL, trang_thai TEXT NOT NULL DEFAULT 'hoat_dong', them_luc INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_tv_user ON thanh_vien (user_id);
CREATE TABLE IF NOT EXISTS video ( id INTEGER PRIMARY KEY, khoa TEXT NOT NULL UNIQUE, link TEXT, nen_tang TEXT, user_id TEXT, thanh_vien_id INTEGER, tuan TEXT NOT NULL, luc INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_video_tuan ON video (tuan);
CREATE INDEX IF NOT EXISTS ix_video_tv ON video (thanh_vien_id);
CREATE TABLE IF NOT EXISTS mien ( thanh_vien_id INTEGER NOT NULL, tuan TEXT NOT NULL, ly_do TEXT, luc INTEGER NOT NULL, PRIMARY KEY (thanh_vien_id, tuan));
CREATE TABLE IF NOT EXISTS yeu_cau ( id INTEGER PRIMARY KEY, loai TEXT NOT NULL, chat_id TEXT, user_id TEXT, ten_zalo TEXT, thanh_vien_id INTEGER, tuan TEXT, ly_do TEXT, trang_thai TEXT NOT NULL DEFAULT 'cho', luc INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS viec (khoa TEXT PRIMARY KEY, luc INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cai_dat (khoa TEXT PRIMARY KEY, gia_tri TEXT);
