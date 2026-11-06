# Bot Zalo kỷ luật đăng video (Cloudflare Workers)

Bot ngồi trong nhóm Zalo học viên, giữ luật **mỗi tuần ít nhất 1 video**. Chạy trên Cloudflare gói Free
giống bot cơm trưa, nhưng là **một bot riêng, Worker riêng, database riêng**.

## Luật bot đang áp dụng

- Tuần tính từ **thứ Hai đến Chủ nhật**, hạn chót **23:59 Chủ nhật** (giờ Việt Nam). Bắt đầu từ tuần **09/11/2026**.
- Học viên đăng video lên kênh rồi **gửi link vào nhóm** (TikTok, YouTube, Facebook, Instagram). Bot tự ghi nhận,
  dài ngắn hay dở gì cũng tính.
- Chỉ người trong **danh sách admin nạp** mới được tính.
- Thiếu **1 tuần**: 🟡 cảnh báo. Thiếu **2 tuần liên tiếp**: 🔴 mời ra khỏi nhóm.
- **Xin nghỉ** phải được admin duyệt. Tuần nghỉ có phép được bỏ qua: không tính là thiếu, cũng không làm đứt chuỗi,
  nhưng không xóa lỗi cũ (thiếu → nghỉ phép → thiếu vẫn là 2 tuần thiếu liên tiếp).
- Người được thêm giữa chừng bắt đầu tính từ **tuần sau** (người nạp trước hoặc trong tuần 09/11 thì tính luôn tuần 09/11).

## Bot làm gì

| Lúc | Việc |
|---|---|
| Có link video trong nhóm | ✅ Ghi nhận ngay, báo tuần này người đó đã nộp mấy video. Link trùng, link người khác đã gửi, link trang cá nhân thì không tính. |
| Thứ Năm, thứ Bảy, Chủ nhật 20:00 | ⏰ Nhắc: còn bao lâu tới hạn, đã nộp bao nhiêu/tổng, danh sách chưa nộp, đánh dấu ⚠️ người đang bị cảnh báo. |
| Thứ Hai 08:00 | 📊 Tổng kết tuần trước: tỷ lệ nộp, toàn bộ link video để mọi người vào tương tác, chuỗi kỷ luật, chăm nhất tuần, nghỉ phép, cảnh báo, mời ra. |
| Có người cần kick | 🔴 Nhắn riêng cho admin danh sách kèm STT. |

**Bot không tự kick được**: Zalo Bot API không có lệnh xóa thành viên. Admin kick tay trong nhóm rồi gõ `/dakick <STT>`.

## Lệnh

Học viên:

| Lệnh | Việc |
|---|---|
| `/toi` | Tình trạng của mình: tuần này nộp chưa, tổng video, chuỗi, đang an toàn hay bị cảnh báo |
| `/bang` | Tình hình cả nhóm tuần này |
| `/xinnghi [nay\|sau\|dd/mm] <lý do>` | Xin nghỉ, chờ admin duyệt |
| `/thamgia` | Khi bot chưa nhận ra mình (tên Zalo khác tên trong danh sách) |
| `/hd` | Hướng dẫn |

Admin (gõ trong nhóm hoặc nhắn riêng cho bot; `/hdadmin` để xem lại):

| Lệnh | Việc |
|---|---|
| `/nap tên1, tên2, ...` | Nạp danh sách (dấu phẩy hoặc mỗi người một dòng) |
| `/ds` | Danh sách, STT, ai đã được nhận ra tài khoản Zalo |
| `/cho` | Yêu cầu đang chờ duyệt |
| `/duyet <mã> [STT]` | Duyệt xin nghỉ hoặc tham gia. Tham gia: kèm STT để gắn vào người đã có trong danh sách, không kèm thì thêm người mới |
| `/tuchoi <mã> [lý do]` | Từ chối |
| `/mien <STT> [nay\|sau\|truoc\|dd/mm] <lý do>` | Cho nghỉ có phép trực tiếp |
| `/huymien <STT> [tuần]` | Hủy nghỉ có phép |
| `/ghinhan <STT> [tuần]` | Tính video thủ công (vd học viên gửi file video thay vì link) |
| `/huyvideo <link>` | Bỏ một video đã ghi nhận |
| `/dakick <STT>` / `/xoa <STT>` | Đã kick / bỏ khỏi danh sách |
| `/huylienket <STT>` | Gỡ tài khoản Zalo bị gắn nhầm |
| `/tongket [nay]` | Xem trước tổng kết tuần trước (hoặc tuần đang chạy) |
| `/thunhac` | Xem trước tin nhắc |
| `/id` | Mã nhóm và mã của bạn |

### Bot nhận ra học viên thế nào

Zalo không cho bot xem danh sách thành viên nhóm, bot chỉ biết ai **đã nhắn**. Nên:

1. Admin `/nap` danh sách tên, **nên ghi đúng tên Zalo** của từng người.
2. Học viên nhắn bất cứ gì trong nhóm (hoặc gửi link): tên Zalo trùng tên trong danh sách (không phân biệt dấu, hoa thường)
   thì bot tự gắn tài khoản.
3. Tên khác hoặc trùng tên với người khác: học viên gõ `/thamgia`, admin `/duyet <mã> <STT>`.
   Video gửi trước khi được duyệt vẫn được tính lại.
4. `/ds` cho thấy ai "chưa nhận ra Zalo". Tin nhắc cũng ghi chú những người này.

## Cài đặt

Cần: tài khoản Cloudflare, một **bot Zalo mới** (Zalo Bot Manager → tạo bot → lấy token). Không dùng chung token với
bot cơm trưa, vì mỗi token chỉ một nơi được đọc tin (`getUpdates`).

```bash
cd bot-video
npm install
npx wrangler login
npx wrangler d1 create bot-video        # chép database_id vào wrangler.toml
npx wrangler secret put ZALO_BOT_TOKEN  # dán token bot mới
npm run deploy
```

Sau đó:

1. Thêm bot vào nhóm học viên, gõ `/id` trong nhóm → lấy **mã nhóm** và **mã của bạn**.
2. Điền `GROUP_ID` và `ADMIN_IDS` trong `wrangler.toml`, chạy lại `npm run deploy`.
3. **Nhắn riêng cho bot một tin bất kỳ** (để bot có đường nhắn riêng báo bạn yêu cầu duyệt và danh sách kick).
4. Gõ `/nap ...` trong nhóm để nạp danh sách. Gõ `/ds` kiểm tra.
5. Gõ `/hd` trong nhóm để mọi người thấy luật.

Bảng trong database tự tạo khi bot chạy lần đầu, không cần chạy `schema.sql`.

### Cấu hình (`wrangler.toml` → `[vars]`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `GROUP_ID` | | Mã nhóm học viên |
| `ADMIN_IDS` | | Mã admin, cách nhau dấu phẩy |
| `NGAY_BAT_DAU` | `2026-11-09` | Tuần đầu tính luật |
| `LICH_NHAC` | `Thu 20:00,Sat 20:00,Sun 20:00` | Các mốc nhắc (giờ VN) |
| `GIO_TONG_KET` | `Mon 08:00` | Giờ đăng tổng kết tuần trước |
| `SO_TUAN_KICK` | `2` | Thiếu bao nhiêu tuần liên tiếp thì mời ra |

Chỉ có một cron mỗi phút. Bot tự so giờ Việt Nam với các mốc trên, mỗi mốc chạy đúng một lần
(bot ngừng quá 3 tiếng sau mốc thì bỏ, không nhắc muộn).

## Code

- `src/luat.js`: luật tuần, nhận diện link, đánh giá cảnh báo/kick, soạn tin. Hàm thuần.
- `src/kho.js`: Cloudflare D1.
- `src/index.js`: nhận tin, lệnh, hẹn giờ.
- `src/zalo.js`: gọi Zalo Bot API (chép từ bot cơm trưa).
- `npm test`: chạy test với SQLite có sẵn trong Node 22, không cần Cloudflare.
