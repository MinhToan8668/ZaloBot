-- Lược đồ D1. Áp dụng: npx wrangler d1 execute com-trua --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS tin_nhan (
    id INTEGER PRIMARY KEY,
    chat_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    user_id TEXT,
    ten TEXT,
    noi_dung TEXT,
    luc INTEGER NOT NULL,      -- mốc thời gian, mili giây
    ngay TEXT NOT NULL,        -- 'YYYY-MM-DD' theo giờ Việt Nam
    UNIQUE (chat_id, message_id)
);
CREATE INDEX IF NOT EXISTS ix_tin_ngay ON tin_nhan (chat_id, ngay);

CREATE TABLE IF NOT EXISTS nhom (
    chat_id TEXT PRIMARY KEY,
    chat_type TEXT,
    lan_cuoi INTEGER,          -- lần cuối có tin, mili giây
    lan_tra_loi INTEGER        -- lần cuối bot trả lời bằng AI
);

CREATE TABLE IF NOT EXISTS lich (
    chat_id TEXT NOT NULL,
    ngay TEXT NOT NULL,
    da_nhac INTEGER NOT NULL DEFAULT 0,
    da_chot INTEGER NOT NULL DEFAULT 0,
    nghi INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, ngay)
);
