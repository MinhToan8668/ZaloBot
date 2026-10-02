/* Lược đồ D1. Áp dụng bằng lệnh: npx wrangler d1 execute com-trua --remote --file=schema.sql
   hoặc dán toàn bộ vào tab Console của database trên dashboard Cloudflare.
   Chỉ dùng chú thích dạng này, vì console gộp mọi dòng thành một dòng và "--" sẽ nuốt SQL phía sau.
   tin_nhan.luc và nhom.lan_cuoi là mốc thời gian mili giây; tin_nhan.ngay là 'YYYY-MM-DD' theo giờ Việt Nam. */
CREATE TABLE IF NOT EXISTS tin_nhan (
    id INTEGER PRIMARY KEY,
    chat_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    user_id TEXT,
    ten TEXT,
    noi_dung TEXT,
    luc INTEGER NOT NULL,
    ngay TEXT NOT NULL,
    UNIQUE (chat_id, message_id)
);
CREATE INDEX IF NOT EXISTS ix_tin_ngay ON tin_nhan (chat_id, ngay);

CREATE TABLE IF NOT EXISTS nhom (
    chat_id TEXT PRIMARY KEY,
    chat_type TEXT,
    lan_cuoi INTEGER,
    lan_tra_loi INTEGER
);

CREATE TABLE IF NOT EXISTS lich (
    chat_id TEXT NOT NULL,
    ngay TEXT NOT NULL,
    da_nhac INTEGER NOT NULL DEFAULT 0,
    da_chot INTEGER NOT NULL DEFAULT 0,
    nghi INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, ngay)
);
