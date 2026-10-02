# Bot Zalo chốt cơm trưa (Cloudflare Workers)

Bot ngồi trong nhóm Zalo đặt cơm trưa của công ty, chạy hoàn toàn trên Cloudflare
(miễn phí, không cần VPS):

- Ghi lại mọi tin nhắn trong ngày để biết ai muốn ăn gì (lưu trong Cloudflare D1).
- Ai gọi "bot" (hoặc tên bot) thì trả lời, gợi ý món bằng Gemini.
- 10:30 nhắc cả nhóm chọn món. **11:15 tự chốt**: món chính, danh sách từng người ăn gì
  kèm ghi chú, ai không ăn, ai chưa rõ. Người đặt cơm chỉ cần nhìn tin này để gọi quán.
- Chỉ chạy thứ Hai đến thứ Sáu (đổi được), mỗi ngày tự chốt đúng một lần.
- Gemini lỗi hoặc chưa có key thì vẫn chốt, liệt kê tin nhắn cuối của từng người.

## Lệnh trong nhóm

| Lệnh | Việc |
|---|---|
| `/chot` | Chốt ngay, không đợi 11:15 (chốt lại nếu có người đổi món) |
| `/tinhhinh` | Xem mọi người đang chọn gì, chưa chốt |
| `/nghi` | Hôm nay không đặt cơm, bot không tự chốt |
| `/id` | Xem mã nhóm và mã của bạn để điền cấu hình |
| `/hd` | Hướng dẫn |

Nếu điền `ADMIN_IDS` thì chỉ những người đó được dùng `/chot` và `/nghi`.

## Cách hoạt động trên Cloudflare

```
Zalo ──webhook POST /webhook──▶ Worker ──▶ D1 (tin nhắn, lịch)
                                  │
Cron 03:30 & 04:15 UTC ──────────▶│──▶ Gemini (gợi ý, tổng hợp)
                                  └──▶ Zalo sendMessage
```

- `src/index.js` – `fetch()` nhận webhook, `scheduled()` chạy theo Cron Trigger.
- `src/chot.js` – logic thuần: prompt, đọc JSON của Gemini, định dạng tin chốt.
- `src/kho.js` – D1; `src/zalo.js`, `src/gemini.js` – gọi API.
- `wrangler.toml` – cấu hình Worker, cron, biến công khai.

## Cài đặt lần đầu

Cần Node 18+ và tài khoản Cloudflare (gói Free đủ dùng).

```bash
git clone https://github.com/MinhToan8668/ZaloBot.git && cd ZaloBot
npm install
npx wrangler login

# 1. Tạo database D1, dán database_id nhận được vào wrangler.toml
npx wrangler d1 create com-trua
npm run db:init

# 2. Đặt bí mật (mỗi lệnh sẽ hỏi giá trị, dán vào rồi Enter)
npx wrangler secret put ZALO_BOT_TOKEN     # token từ Zalo Bot Manager
npx wrangler secret put GEMINI_API_KEY     # https://aistudio.google.com/apikey
npx wrangler secret put WEBHOOK_SECRET     # chuỗi ngẫu nhiên tự đặt, vd: openssl rand -hex 24

# 3. Deploy, nhận địa chỉ dạng https://com-trua-bot.<tên>.workers.dev
npm run deploy

# 4. Báo Zalo gửi tin về Worker (điền 3 biến vào .dev.vars hoặc truyền thẳng)
cp .dev.vars.example .dev.vars   # điền ZALO_BOT_TOKEN, WEBHOOK_SECRET, WEBHOOK_URL
npm run webhook
```

Kết quả `npm run webhook` có `verification` là thành công. Mở địa chỉ Worker trên trình
duyệt sẽ thấy "Bot cơm trưa đang chạy."

### Đưa bot vào nhóm

1. Thêm bot vào nhóm Zalo đặt cơm.
2. Trong nhóm gõ `/id`, bot trả về mã nhóm. Điền vào `GROUP_IDS` trong `wrangler.toml`,
   chạy `npm run deploy` lại. Từ đó bot chỉ nhắc, chốt và trả lời trong đúng nhóm này.
3. Muốn chỉ mình được chốt: lấy "Mã của bạn" từ `/id`, điền vào `ADMIN_IDS`.
4. Sửa `QUAN_QUEN` theo các quán hay đặt để bot gợi ý và chốt sát thực tế.

> Tính năng nhóm của Zalo Bot đang ở bản Beta. Nếu bot chỉ nhận được tin khi có người tag
> nó, dặn cả nhóm tag bot khi chọn món, ví dụ "@Bot Ngự Trù cho mình cơm gà".

## Đổi giờ nhắc / giờ chốt

Cron của Cloudflare tính theo **UTC**, giờ Việt Nam trừ đi 7. Ví dụ muốn chốt 11:30:

```toml
crons = ["30 3 * * 1-5", "30 4 * * 1-5"]   # 10:30 và 11:30 VN
GIO_CHOT = "11:30"
```

Hai chỗ phải khớp nhau; cron chạy mà không khớp `GIO_NHAC`/`GIO_CHOT` thì bot bỏ qua và
ghi cảnh báo. Muốn chạy cả thứ Bảy thì đổi `1-5` thành `1-6`.

## Chạy thử trên máy

```bash
cp .dev.vars.example .dev.vars    # điền token, key
npm run db:init:local
npm run dev                       # Worker chạy ở http://localhost:8787
```

Gửi thử một tin giả như Zalo gửi:

```bash
curl -X POST http://localhost:8787/webhook \
  -H 'Content-Type: application/json' \
  -H 'X-Bot-Api-Secret-Token: <WEBHOOK_SECRET trong .dev.vars>' \
  -d '{"event_name":"message.text.received","message":{"message_id":"1","date":1759400000000,
       "from":{"id":"u1","display_name":"An","is_bot":false},"chat":{"id":"g1","chat_type":"GROUP"},"text":"bot ơi ăn gì"}}'
```

Chạy thử cron: `curl "http://localhost:8787/__scheduled?cron=15+4+*+*+1-5"` (cần
`npm run dev -- --test-scheduled`).

Kiểm tra tự động: `npm test`. Xem log trên Cloudflare: `npx wrangler tail`.

## Bảo mật

- Token Zalo, key Gemini và `WEBHOOK_SECRET` chỉ nằm trong Cloudflare Secrets (và
  `.dev.vars` trên máy, đã có trong `.gitignore`). Không ghi vào `wrangler.toml`.
- Worker chỉ nhận webhook có header `X-Bot-Api-Secret-Token` đúng với `WEBHOOK_SECRET`.
- Token lỡ lộ: vào Zalo Bot Manager tạo token mới, `wrangler secret put ZALO_BOT_TOKEN`
  lại rồi chạy `npm run webhook` lại.
