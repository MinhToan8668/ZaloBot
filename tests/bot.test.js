import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BotComTrua, docCauHinh } from '../src/index.js';

// Kho trong bộ nhớ, cùng giao diện với src/kho.js
class KhoGia {
  tin = []; nhom = new Map(); lich = new Map();
  khoaLich(c, n) { return `${c}|${n}`; }
  async luuTin(t) {
    if (this.tin.some((x) => x.chatId === t.chatId && x.messageId === t.messageId)) return false;
    this.tin.push(t); return true;
  }
  async tinTrongNgay(chatId, ngay) {
    return this.tin.filter((t) => t.chatId === chatId && t.ngay === ngay).map((t) => ({ ten: t.ten, noi_dung: t.noiDung, luc: t.luc }));
  }
  async ghiNhom(chatId, chatType, luc) { this.nhom.set(chatId, { ...(this.nhom.get(chatId) ?? {}), chatType, luc }); }
  async nhomGanDay() { return [...this.nhom].filter(([, v]) => v.chatType === 'GROUP').map(([k]) => k); }
  async xinTraLoi(chatId, bayGio, gianCach) {
    const n = this.nhom.get(chatId); if (!n) return false;
    if (n.lanTraLoi != null && n.lanTraLoi > bayGio - gianCach) return false;
    n.lanTraLoi = bayGio; return true;
  }
  async layLich(c, n) { return this.lich.get(this.khoaLich(c, n)) ?? { da_nhac: 0, da_chot: 0, nghi: 0 }; }
  async datNghi(c, n) { this.lich.set(this.khoaLich(c, n), { ...(await this.layLich(c, n)), nghi: 1 }); }
  async gianhViec(c, n, viec) {
    const l = await this.layLich(c, n);
    if (l[viec] || l.nghi) return false;
    this.lich.set(this.khoaLich(c, n), { ...l, [viec]: 1 }); return true;
  }
  async donDep() {}
}

const zaloGia = () => ({ daGui: [], async sendMessage(c, t) { this.daGui.push([c, t]); }, async sendTyping() {}, async getUpdates() { return []; } });
const aiGia = (traVe, loi = false) => ({ sanSang: true, async hoi() { if (loi) throw new Error('hỏng'); return traVe; } });

const T0 = Date.UTC(2026, 9, 2, 3, 0); // 10:00 VN thứ Sáu 2/10/2026

function tao(ai, env = {}) {
  const zalo = zaloGia();
  const kho = new KhoGia();
  let gio = T0;
  const bot = new BotComTrua(docCauHinh({ GIO_NHAC: '10:30', ...env }), zalo, ai, kho, () => gio);
  return { bot, zalo, kho, datGio: (ms) => { gio = ms; } };
}

const update = (chatId, text, { ten = 'An', uid = 'u1', kieu = 'GROUP', luc = T0 } = {}) => ({
  event_name: 'message.text.received',
  message: { from: { id: uid, display_name: ten, is_bot: false }, chat: { id: chatId, chat_type: kieu }, text, message_id: `m-${text}`, date: luc },
});

test('cron 11:15 tự chốt đúng một lần, bỏ qua cron trùng', async () => {
  const { bot, zalo } = tao(aiGia(JSON.stringify({ mon_chot: 'Cơm tấm', dat_rieng: [{ ten: 'An', mon: 'Cơm tấm' }] })));
  await bot.xuLyUpdate(update('g1', 'trưa nay cơm tấm nha'));
  await bot.chayHenGio('11:15');
  await bot.chayHenGio('11:16');
  const tinChot = zalo.daGui.filter(([, t]) => t.includes('CHỐT'));
  assert.equal(tinChot.length, 1);
  assert.ok(tinChot[0][1].includes('Cơm tấm'));
});

test('cron 10:30 nhắc, không chốt; /nghi thì không tự chốt', async () => {
  const { bot, zalo } = tao(aiGia('{}'));
  await bot.xuLyUpdate(update('g1', 'ăn gì'));
  await bot.chayHenGio('10:30');
  assert.equal(zalo.daGui.length, 1);
  assert.ok(zalo.daGui[0][1].includes('11:15 bot chốt'));
  await bot.xuLyUpdate(update('g1', '/nghi'));
  await bot.chayHenGio('11:15');
  assert.equal(zalo.daGui.filter(([, t]) => t.includes('CHỐT')).length, 0);
});

test('cron không khớp giờ cấu hình thì không làm gì', async () => {
  const { bot, zalo } = tao(aiGia('{}'));
  await bot.xuLyUpdate(update('g1', 'ăn gì'));
  await bot.chayHenGio('09:00');
  assert.equal(zalo.daGui.length, 0);
});

test('AI lỗi vẫn chốt bằng bản dự phòng', async () => {
  const { bot, zalo } = tao(aiGia('', true));
  await bot.xuLyUpdate(update('g1', 'cho mình phở'));
  await bot.xuLyUpdate(update('g1', '/chot'));
  assert.ok(zalo.daGui.at(-1)[1].includes('- An: cho mình phở'));
});

test('chỉ admin được /chot', async () => {
  const { bot, zalo } = tao(aiGia('{}'), { ADMIN_IDS: 'sep' });
  await bot.xuLyUpdate(update('g1', '/chot'));
  assert.ok(zalo.daGui.at(-1)[1].includes('chỉ người phụ trách'));
});

test('lệnh không lưu vào lịch sử; tin trùng message_id chỉ ghi một lần', async () => {
  const { bot, kho } = tao(aiGia('{}'));
  await bot.xuLyUpdate(update('g1', '/id'));
  await bot.xuLyUpdate(update('g1', 'phở'));
  await bot.xuLyUpdate(update('g1', 'phở'));
  assert.equal(kho.tin.length, 1);
});

test('gọi bot thì trả lời, có giãn cách giữa hai lần', async () => {
  const { bot, zalo, datGio } = tao(aiGia('Ăn bún chả đi cả nhà!'));
  await bot.xuLyUpdate(update('g1', 'nay nóng quá'));
  await bot.xuLyUpdate(update('g1', 'bot ơi gợi ý món đi'));
  await bot.xuLyUpdate(update('g1', 'bot ơi nữa', { luc: T0 + 1000 }));
  assert.deepEqual(zalo.daGui, [['g1', 'Ăn bún chả đi cả nhà!']]);
  datGio(T0 + 10_000);
  await bot.xuLyUpdate(update('g1', 'bot ơi lần ba', { luc: T0 + 10_000 }));
  assert.equal(zalo.daGui.length, 2);
});

test('GROUP_IDS chặn nhóm lạ và chat riêng của người không phải admin', async () => {
  const { bot, zalo, kho } = tao(aiGia('ok'), { GROUP_IDS: 'g1' });
  await bot.xuLyUpdate(update('g2', 'bot ơi'));
  await bot.xuLyUpdate(update('u9', 'bot ơi', { kieu: 'PRIVATE', uid: 'u9' }));
  assert.equal(zalo.daGui.length, 0);
  assert.equal(kho.tin.length, 0);
});

test('vongNhanTin xử lý tin từ getUpdates rồi dừng khi hết giờ', async () => {
  const { bot, zalo, kho } = tao(aiGia('{}'));
  let lan = 0;
  zalo.getUpdates = async () => (++lan === 1 ? [update('g1', 'cơm gà nha'), { event_name: 'khac' }] : []);
  const n = await bot.vongNhanTin(3500);
  assert.equal(n, 2);
  assert.equal(kho.tin.length, 1);
  assert.ok(lan >= 1);
});

test('vongNhanTin dừng khi getUpdates lỗi, không lặp vô hạn', async () => {
  const { bot, zalo } = tao(aiGia('{}'));
  let lan = 0;
  zalo.getUpdates = async () => { lan++; throw new Error('token sai'); };
  await bot.vongNhanTin(60_000);
  assert.equal(lan, 1);
});
