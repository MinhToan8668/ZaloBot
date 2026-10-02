# Bot Zalo chốt cơm trưa (Cloudflare Workers)

Bot ngồi trong nhóm Zalo đặt cơm trưa của công ty, chạy hoàn toàn trên Cloudflare
(gói Free, không cần VPS, không cần tên miền):

- Ghi lại mọi tin nhắn trong ngày để biết ai muốn ăn gì (lưu trong Cloudflare D1).
- Ai gọi "bot" (hoặc tên bot) thì Gemini gợi ý, hai chế độ tự nhận theo câu chat:
  - **Đặt ship** (mặc định, nhóm đặt Grab/ShopeeFood): 2–3 món kèm lý do, tầm giá, từ khóa gõ trên app.
  - **Đi ăn ngoài** (nhóm nói "đi ăn ngoài", "quán gần công ty"...): tra **Google Maps** quanh địa
    điểm công ty, đưa quán có thật kèm địa chỉ, món, giá, khoảng cách.
  Cả hai đều bám yêu cầu trong chat (tầm giá, khô/nước, chay...) và tránh lặp món đã chốt hôm qua, hôm kia.
- 10:30 nhắc cả nhóm chọn món, 11:00 nhắc "còn 15 phút". **11:15 tự chốt**: món chính, danh sách từng người ăn gì
  kèm ghi chú, ai không ăn, ai chưa rõ. Người đặt cơm chỉ cần nhìn tin này để gọi quán.
- Chỉ chạy thứ Hai đến thứ Sáu (đổi được), mỗi ngày tự chốt đúng một lần.
- Gemini lỗi hoặc chưa có key thì vẫn chốt, liệt kê tin nhắn cuối của từng người.

## Lệnh trong nhóm

| Lệnh | Việc |
|---|---|
| `/chot` | Chốt ngay, không đợi 11:15 (chốt lại nếu có người đổi món) |
| `/tinhhinh` | Xem mọi người đang chọn gì, chưa chốt |
| `/nghi` | Hôm nay không đặt cơm, bot không tự chốt |
| `/diachi <địa chỉ>` | Đặt địa điểm công ty để bot gợi ý quán quanh đó (không có tham số: xem địa điểm hiện tại) |
| `/id` | Xem mã nhóm và mã của bạn để điền cấu hình |
| `/hd` | Hướng dẫn |

Nếu điền `ADMIN_IDS` thì chỉ những người đó được dùng `/chot` và `/nghi`.

## Cách hoạt động trên Cloudflare

```
Cron mỗi phút ──▶ Worker ──getUpdates (giữ ~50s)──▶ Zalo ──▶ ghi D1, trả lời
Cron 03:30 UTC ─▶ Worker ──▶ nhắc chọn món
Cron 04:15 UTC ─▶ Worker ──▶ Gemini tổng hợp ──▶ Zalo sendMessage (chốt)
```

Bot **tự hỏi Zalo** có tin mới không (`getUpdates`) chứ không dùng webhook, vì tên miền
`*.workers.dev` chặn máy chủ Zalo (Cloudflare error 1010, User-Agent `Java/1.8`). Mỗi phút
Cron Trigger gọi Worker một lần, Worker giữ kết nối hỏi Zalo liên tục khoảng 50 giây rồi
dừng, lần cron sau tiếp tục. Tin nhắn được trả lời trong vài giây.

- `src/index.js` – `scheduled()` nhận tin mỗi phút, nhắc và chốt theo giờ; `fetch()` là
  webhook dự phòng, chỉ dùng được khi Worker gắn tên miền riêng.
- `src/chot.js` – logic thuần: prompt, đọc JSON của Gemini, định dạng tin chốt.
- `src/kho.js` – D1; `src/zalo.js`, `src/gemini.js` – gọi API.
- `wrangler.toml` – cấu hình Worker, cron, biến công khai.

## Cài đặt (dashboard, không cần cài gì trên máy)

1. **Nối Git**: Workers & Pages → Create → Import a repository → chọn repo này. Deploy
   command để mặc định `npx wrangler deploy`. Mỗi lần push lên `main` là tự deploy.
2. **Tạo D1**: Storage & Databases → D1 → Create → tên `com-trua`. Vào tab *Console*, dán
   nội dung `schema.sql` (chỉ phần SQL, bỏ chú thích) → Execute. Copy *Database ID* dán vào
   `database_id` trong `wrangler.toml`, push.
3. **Bí mật**: Worker → Settings → Variables and Secrets → Add, kiểu **Secret**:
   - `ZALO_BOT_TOKEN` – token từ Zalo Bot Manager
   - `GEMINI_API_KEY` – <https://aistudio.google.com/apikey>
   - `WEBHOOK_SECRET` – chuỗi bất kỳ (chỉ dùng nếu sau này gắn tên miền; vẫn phải có)
4. **Không đặt webhook** cho bot trên Zalo. Nếu đã lỡ đặt, gọi `deleteWebhook`
   (có sẵn trong `scripts/set-webhook.mjs --xoa` hoặc curl), vì Zalo không trả tin qua
   `getUpdates` khi webhook đang bật.
5. Mở `https://zalobot.<tên>.workers.dev/` thấy "Bot cơm trưa đang chạy." là xong. Tab
   *Observability → Logs* của Worker hiện mỗi phút một lần chạy cron.

### Đưa bot vào nhóm

1. Thêm bot vào nhóm Zalo đặt cơm.
2. Trong nhóm gõ `/id`, bot trả về mã nhóm. Điền vào `GROUP_IDS` trong `wrangler.toml`,
   push. Từ đó bot chỉ nhắc, chốt và trả lời trong đúng nhóm này.
3. Muốn chỉ mình được chốt: lấy "Mã của bạn" từ `/id`, điền vào `ADMIN_IDS`.
4. Đặt địa điểm công ty: gõ `/diachi 123 Nguyễn Huệ, Quận 1, TP.HCM` trong nhóm (hoặc điền
   `DIA_DIEM` trong `wrangler.toml`). Không có địa điểm, bot sẽ hỏi nhóm ở đâu trước khi gợi ý.
5. (Tùy chọn) `QUAN_QUEN`: quán hay đặt mà Google Maps không có, ví dụ cô bán cơm trong hẻm.

> Tính năng nhóm của Zalo Bot đang ở bản Beta. Nếu bot chỉ nhận được tin khi có người tag
> nó, dặn cả nhóm tag bot khi chọn món, ví dụ "@Bot Ngự Trù cho mình cơm gà".

## Đổi giờ nhắc / giờ chốt

Cron của Cloudflare tính theo **UTC**, giờ Việt Nam trừ đi 7. Ví dụ muốn nhắc 10:30, nhắc lần 2 lúc 11:15, chốt 11:30:

```toml
crons = ["* * * * *", "30 3 * * 1-5", "15 4 * * 1-5", "30 4 * * 1-5"]
GIO_NHAC = "10:30"
GIO_NHAC_2 = "11:15"
GIO_CHOT = "11:30"
```

Giữ nguyên `"* * * * *"` (bot nhận tin nhờ dòng này). Hai chỗ giờ phải khớp nhau; cron chạy
mà không khớp `GIO_NHAC`/`GIO_CHOT` thì bot bỏ qua và ghi cảnh báo. Muốn chạy cả thứ Bảy
thì đổi `1-5` thành `1-6`.

## Chạy thử trên máy

```bash
npm install
cp .dev.vars.example .dev.vars    # điền token, key
npm run db:init:local
npm run dev -- --test-scheduled   # Worker chạy ở http://localhost:8787
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"       # hỏi Zalo tin mới ~50 giây
curl "http://localhost:8787/__scheduled?cron=15+4+*+*+1-5"    # chạy thử chốt (giờ phải khớp GIO_CHOT)
```

Kiểm tra tự động: `npm test`. Xem log trên Cloudflare: Worker → Observability → Logs.

## Nếu sau này có tên miền riêng

Gắn tên miền vào Worker (Settings → Domains & Routes), tắt *Browser Integrity Check* hoặc
thêm WAF rule Skip cho `/webhook`, rồi `npm run webhook` để đăng ký webhook. Khi đó bỏ
cron `"* * * * *"` đi, bot nhận tin tức thì qua `fetch()`.

## Bảo mật

- Token Zalo, key Gemini và `WEBHOOK_SECRET` chỉ nằm trong Cloudflare Secrets (và
  `.dev.vars` trên máy, đã có trong `.gitignore`). Không ghi vào `wrangler.toml`.
- Token lỡ lộ: vào Zalo Bot Manager tạo token mới, cập nhật secret `ZALO_BOT_TOKEN`.
