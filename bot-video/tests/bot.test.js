import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BotVideo, docCauHinh } from '../src/index.js';
import { Kho } from '../src/kho.js';
import { taoD1 } from './d1-gia.js';

// Giờ Việt Nam -> mốc ms
const vn = (thang, ngay, gio = 10, phut = 0) => Date.UTC(2026, thang - 1, ngay, gio - 7, phut);
const G = 'g1';

async function tao(env = {}) {
  const daGui = [];
  const zalo = { async sendMessage(c, t) { daGui.push([c, t]); }, async getUpdates() { return []; } };
  const kho = new Kho(taoD1());
  await kho.damBaoLuocDo();
  let gio = vn(11, 6); // thứ Sáu 6/11, trước tuần bắt đầu
  const bot = new BotVideo(docCauHinh({ GROUP_ID: G, ADMIN_IDS: 'admin', NGAY_BAT_DAU: '2026-11-09', ...env }), zalo, kho, () => gio);
  let dem = 0;
  const nhan = (text, { ten = 'Thầy', uid = 'admin', chat = G, kieu = 'GROUP', luc } = {}) => bot.xuLyUpdate({
    event_name: 'message.text.received',
    message: { from: { id: uid, display_name: ten, is_bot: false }, chat: { id: chat, chat_type: kieu }, text, message_id: `m${++dem}`, date: luc ?? gio },
  });
  const tinCuoi = () => daGui.at(-1)?.[1] ?? '';
  return { bot, kho, daGui, nhan, tinCuoi, datGio: (ms) => { gio = ms; } };
}

const LINK = (so) => `https://www.tiktok.com/@kenh/video/73000000000000000${String(so).padStart(2, '0')}`;

test('chỉ admin được nạp danh sách; người mới nạp trước tuần đầu được tính từ 09/11', async () => {
  const { nhan, tinCuoi, kho } = await tao();
  await nhan('/nap An', { ten: 'An', uid: 'u1' });
  assert.match(tinCuoi(), /chỉ dành cho admin/);
  await nhan('/nap Nguyễn Văn An, Trần Bình\nLê Chi');
  assert.match(tinCuoi(), /Đã thêm 3 người, bắt đầu tính từ tuần 09\/11 – 15\/11/);
  await nhan('/nap Trần Bình');
  assert.match(tinCuoi(), /Đã thêm 0 người/);
  assert.equal((await kho.dsThanhVien()).length, 3);
});

test('gửi link video: tự nhận ra người theo tên Zalo, chống nộp trùng', async () => {
  const { nhan, tinCuoi, kho, datGio } = await tao();
  await nhan('/nap Nguyễn Văn An, Trần Bình');
  datGio(vn(11, 10, 21));
  await nhan(`Video mới của em ${LINK(1)}`, { ten: 'Nguyễn Văn An', uid: 'u1' });
  assert.match(tinCuoi(), /Đã ghi nhận 1 video của Nguyễn Văn An – tuần 09\/11 – 15\/11 \(tuần này: 1 video\)/);
  assert.equal((await kho.thanhVienTheoUser('u1')).ten, 'Nguyễn Văn An');

  await nhan(`gửi lại ${LINK(1)}`, { ten: 'Nguyễn Văn An', uid: 'u1' });
  assert.match(tinCuoi(), /đã được ghi nhận trước đó.*không tính lại/);
  await nhan(`ủng hộ An nha ${LINK(1)}`, { ten: 'Trần Bình', uid: 'u2' });
  assert.match(tinCuoi(), /đã có người khác gửi trước, không tính cho bạn/);

  await nhan('kênh em https://www.tiktok.com/@binh', { ten: 'Trần Bình', uid: 'u2' });
  assert.match(tinCuoi(), /không phải link video/);
});

test('người lạ gửi link: lưu lại, /thamgia, admin duyệt gắn vào STT thì video được tính', async () => {
  const { nhan, tinCuoi, kho, datGio, daGui } = await tao();
  await nhan('/nap Lê Thị Chi');
  await nhan('chào bot', { kieu: 'PRIVATE', chat: 'rieng-admin' }); // admin nhắn riêng để bot biết đường báo
  datGio(vn(11, 11));
  await nhan(LINK(2), { ten: 'Chi Lê 🌸', uid: 'u3' });
  assert.match(tinCuoi(), /chưa thấy tên này trong danh sách/);
  await nhan('/thamgia', { ten: 'Chi Lê 🌸', uid: 'u3' });
  assert.match(tinCuoi(), /đã gửi yêu cầu tham gia \(mã 1\)/);
  assert.ok(daGui.some(([c, t]) => c === 'rieng-admin' && /Yêu cầu tham gia mã 1/.test(t)));

  await nhan('/duyet 1 1', { kieu: 'PRIVATE', chat: 'rieng-admin' });
  assert.ok(daGui.some(([c, t]) => c === G && /Chi Lê 🌸 đã được duyệt vào danh sách \(STT 1 – Lê Thị Chi\)/.test(t)));
  const ds = await kho.soVideoTheoTuan();
  assert.deepEqual(ds.map((r) => [r.thanh_vien_id, r.tuan, r.so]), [[1, '2026-11-09', 1]]);
});

test('xin nghỉ phải được admin duyệt mới tính', async () => {
  const { nhan, tinCuoi, kho, datGio } = await tao();
  await nhan('/nap Trần Bình');
  datGio(vn(11, 10));
  await nhan('hello', { ten: 'Trần Bình', uid: 'u2' });
  await nhan('/xinnghi sau', { ten: 'Trần Bình', uid: 'u2' });
  assert.match(tinCuoi(), /Cần ghi rõ lý do/);
  await nhan('/xinnghi sau đi công tác nước ngoài', { ten: 'Trần Bình', uid: 'u2' });
  assert.match(tinCuoi(), /đã gửi yêu cầu nghỉ tuần 16\/11 – 22\/11 \(mã 1\)/);
  assert.equal((await kho.dsMien()).length, 0);
  await nhan('/duyet 1', { ten: 'Trần Bình', uid: 'u2' });
  assert.match(tinCuoi(), /chỉ dành cho admin/);
  await nhan('/duyet 1');
  assert.match(tinCuoi(), /Thầy đã duyệt cho Trần Bình nghỉ tuần 16\/11 – 22\/11/);
  assert.deepEqual((await kho.dsMien()).map((m) => m.tuan), ['2026-11-16']);
  await nhan('/duyet 1');
  assert.match(tinCuoi(), /Không có yêu cầu mã 1 đang chờ/);
});

test('nhắc thứ Năm 20:00 đúng một lần, liệt kê người chưa nộp', async () => {
  const { bot, nhan, daGui, datGio } = await tao();
  await nhan('/nap Nguyễn Văn An, Trần Bình');
  datGio(vn(11, 10));
  await nhan(LINK(3), { ten: 'Nguyễn Văn An', uid: 'u1' });
  const truoc = daGui.length;
  datGio(vn(11, 12, 19, 59));
  await bot.kiemTraLich();
  assert.equal(daGui.length, truoc);
  datGio(vn(11, 12, 20, 0));
  await bot.kiemTraLich();
  datGio(vn(11, 12, 20, 1));
  await bot.kiemTraLich();
  assert.equal(daGui.length, truoc + 1);
  const tin = daGui.at(-1)[1];
  assert.match(tin, /NHẮC NỘP VIDEO – tuần 09\/11 – 15\/11/);
  assert.match(tin, /Đã nộp: 1\/2/);
  assert.match(tin, /1\. Trần Bình \(bot chưa nhận ra tài khoản Zalo/);
  assert.doesNotMatch(tin, /Nguyễn Văn An/);
  assert.match(tin, /còn 3 ngày 4 giờ/);
});

test('tổng kết thứ Hai: tuần 1 cảnh báo, tuần 2 mời ra và báo riêng admin', async () => {
  const { bot, nhan, daGui, datGio } = await tao();
  await nhan('/nap Nguyễn Văn An, Trần Bình, Lê Chi');
  await nhan('hi', { kieu: 'PRIVATE', chat: 'rieng-admin' });
  // Tuần 1: An nộp 2 video, Chi xin nghỉ được duyệt, Bình không nộp
  datGio(vn(11, 10));
  await nhan(`${LINK(4)} ${LINK(5)}`, { ten: 'Nguyễn Văn An', uid: 'u1' });
  await nhan('/xinnghi nay ốm phải nằm viện', { ten: 'Lê Chi', uid: 'u3' });
  await nhan('/duyet 1');

  datGio(vn(11, 16, 8, 0));
  await bot.kiemTraLich();
  let tin = daGui.filter(([c]) => c === G).at(-1)[1];
  assert.match(tin, /TỔNG KẾT TUẦN 09\/11 – 15\/11/);
  assert.match(tin, /Đã nộp: 1\/2 thành viên \(50%\) – 2 video/);
  assert.match(tin, /Nguyễn Văn An: https:\/\/www\.tiktok\.com/);
  assert.match(tin, /Chăm nhất tuần: Nguyễn Văn An \(2 video\)/);
  assert.match(tin, /Nghỉ có phép: Lê Chi/);
  assert.match(tin, /CẢNH BÁO[\s\S]*1\. Trần Bình/);
  assert.doesNotMatch(tin, /MỜI RA/);
  const soTin = daGui.length;
  await bot.kiemTraLich(); // cron chạy lại cùng mốc: không gửi lần hai
  assert.equal(daGui.length, soTin);

  // Tuần 2: An và Chi nộp, Bình vẫn không
  datGio(vn(11, 18));
  await nhan(LINK(6), { ten: 'Nguyễn Văn An', uid: 'u1' });
  await nhan(LINK(7), { ten: 'Lê Chi', uid: 'u3' });
  datGio(vn(11, 23, 8, 5));
  await bot.kiemTraLich();
  tin = daGui.filter(([c]) => c === G).at(-1)[1];
  assert.match(tin, /TỔNG KẾT TUẦN 16\/11 – 22\/11/);
  assert.match(tin, /CHUỖI KỶ LUẬT:\n- Nguyễn Văn An: 2 tuần liên tiếp/);
  assert.match(tin, /MỜI RA KHỎI NHÓM – thiếu 2 tuần liên tiếp:\n1\. Trần Bình/);
  const rieng = daGui.filter(([c]) => c === 'rieng-admin').at(-1)[1];
  assert.match(rieng, /CẦN MỜI RA KHỎI NHÓM[\s\S]*STT 2: Trần Bình – thiếu 2 tuần/);

  await nhan('/dakick 2');
  assert.match(daGui.at(-1)[1], /Trần Bình đã bị mời ra khỏi nhóm/);
  await nhan('/bang');
  assert.doesNotMatch(daGui.at(-1)[1], /Trần Bình/);
});

test('/toi cho biết trạng thái cá nhân; nhóm lạ bị bỏ qua', async () => {
  const { nhan, tinCuoi, daGui, datGio } = await tao();
  await nhan('/nap Trần Bình');
  datGio(vn(11, 17));
  await nhan('/toi', { ten: 'Trần Bình', uid: 'u2' });
  const tin = tinCuoi();
  assert.match(tin, /Tuần này \(16\/11 – 22\/11\): ❌ chưa nộp/);
  assert.match(tin, /🟡 đã thiếu 1 tuần, tuần này không nộp sẽ bị mời ra khỏi nhóm/);
  const soTin = daGui.length;
  await nhan('/hd', { chat: 'nhom-khac' });
  assert.equal(daGui.length, soTin);
});

test('các lệnh admin còn lại chạy được và trả lời đúng', async () => {
  const { nhan, tinCuoi, kho, datGio, daGui } = await tao();
  for (const l of ['/hd', '/hdadmin', '/ds', '/cho', '/tongket', '/thunhac', '/id']) {
    await nhan(l);
    assert.ok(tinCuoi().length > 0, l);
  }
  await nhan('/nap Nguyễn Văn An, Trần Bình');
  datGio(vn(11, 11));
  await nhan('/ds');
  assert.match(tinCuoi(), /1\. Nguyễn Văn An – chưa nhận ra Zalo/);
  await nhan('/mien 2 sau về quê', { kieu: 'PRIVATE', chat: 'rieng-admin' });
  assert.ok(daGui.some(([c, t]) => c === G && /Trần Bình được nghỉ có phép tuần 16\/11 – 22\/11\. Lý do: về quê/.test(t)));
  await nhan('/huymien 2 sau');
  assert.match(tinCuoi(), /Đã hủy nghỉ có phép của Trần Bình/);
  await nhan('/ghinhan 1');
  assert.match(tinCuoi(), /ghi nhận thủ công 1 video cho Nguyễn Văn An – tuần 09\/11/);
  await nhan(LINK(9), { ten: 'Trần Bình', uid: 'u2' });
  await nhan(`/huyvideo ${LINK(9)}`);
  assert.match(tinCuoi(), /Đã bỏ video này/);
  assert.deepEqual((await kho.soVideoTheoTuan()).map((r) => r.thanh_vien_id), [1]);
  await nhan('/tongket nay');
  assert.match(tinCuoi(), /\[XEM TRƯỚC\] 📊 TỔNG KẾT TUẦN 09\/11 – 15\/11[\s\S]*Đã nộp: 1\/2/);
  await nhan('/huylienket 2');
  assert.equal(await kho.thanhVienTheoUser('u2'), null);
  await nhan('/abc');
  assert.match(tinCuoi(), /không có lệnh này/);
});
