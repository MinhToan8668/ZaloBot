import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as chot from '../src/chot.js';
import { layChu } from '../src/gemini.js';
import { catNgan } from '../src/zalo.js';

const VN = 'Asia/Ho_Chi_Minh';
const luc = (h, m) => Date.UTC(2026, 9, 2, h - 7, m); // 2/10/2026, giờ VN

test('gioDiaPhuong đổi đúng sang giờ Việt Nam', () => {
  const g = chot.gioDiaPhuong(Date.UTC(2026, 9, 2, 4, 15), VN); // 04:15 UTC
  assert.deepEqual(g, { ngay: '2026-10-02', gio: '11:15', thu: 'Fri' });
  assert.equal(chot.gioDiaPhuong(Date.UTC(2026, 9, 2, 17, 0), VN).ngay, '2026-10-03'); // 00:00 VN hôm sau
});

test('dongChat có giờ và tên, gộp khoảng trắng', () => {
  const tin = [{ ten: 'An', noi_dung: 'cơm  gà\nnha', luc: luc(10, 5) }];
  assert.equal(chot.dongChat(tin, VN), '[10:05] An: cơm gà nha');
});

test('docKetQua bỏ code fence và chuẩn hóa', () => {
  const chu = '```json\n' + JSON.stringify({
    mon_chot: 'Cơm gà', dat_rieng: [{ ten: 'An', mon: null }, { mon: 'thiếu tên' }],
    khong_an: ['Bình', ''], chua_ro: 'sai kiểu',
  }) + '\n```';
  const kq = chot.docKetQua(chu);
  assert.equal(kq.mon_chot, 'Cơm gà');
  assert.deepEqual(kq.dat_rieng, [{ ten: 'An', mon: '', ghi_chu: '' }]);
  assert.deepEqual(kq.khong_an, ['Bình']);
  assert.deepEqual(kq.chua_ro, []);
  assert.deepEqual(chot.docKetQua('{"dat_rieng": 3}').dat_rieng, []);
  assert.throws(() => chot.docKetQua('không phải json'));
  assert.throws(() => chot.docKetQua('[1]'));
});

test('dinhDangChot đếm suất và ghi chú', () => {
  const kq = chot.docKetQua(JSON.stringify({
    mon_chot: 'Bún bò', quan: 'Quán Huế', ly_do: '3/4 người chọn',
    dat_rieng: [{ ten: 'An', mon: '', ghi_chu: 'không hành' }, { ten: 'Chi', mon: 'Bún chả' }],
    khong_an: ['Bình'],
  }));
  const text = chot.dinhDangChot(kq, 'CHỐT');
  for (const d of ['Chốt: Bún bò - Quán Huế', 'Đặt 2 suất:', '1. An: Bún bò (không hành)', '2. Chi: Bún chả', 'Không ăn: Bình']) {
    assert.ok(text.includes(d), d);
  }
  assert.ok(chot.dinhDangChot(chot.docKetQua('{}'), 'CHỐT').includes('chưa thấy ai bàn'));
});

test('chotDuPhong lấy tin cuối của mỗi người', () => {
  const text = chot.chotDuPhong([
    { ten: 'An', noi_dung: 'phở', luc: 1 }, { ten: 'An', noi_dung: 'thôi cơm tấm', luc: 2 }, { ten: 'Bình', noi_dung: 'bún', luc: 3 },
  ], 'T');
  assert.ok(text.includes('- An: thôi cơm tấm'));
  assert.ok(!text.includes('phở'));
});

test('tachLenh và laGoiBot', () => {
  assert.deepEqual(chot.tachLenh('/CHOT'), { lenh: 'chot', phanCon: '' });
  assert.deepEqual(chot.tachLenh('/id@bot abc'), { lenh: 'id', phanCon: 'abc' });
  assert.equal(chot.tachLenh('ăn gì').lenh, null);
  const tu = ['bot', 'Ngự Trù'];
  assert.ok(chot.laGoiBot('@Bot gợi ý món đi', tu));
  assert.ok(chot.laGoiBot('ngự trù ơi hôm nay ăn gì', tu));
  assert.ok(!chot.laGoiBot('robot hút bụi', tu));
  assert.ok(!chot.laGoiBot('ăn gì đây', tu));
});

test('khopGio cho phép cron trễ vài phút', () => {
  assert.ok(chot.khopGio('11:15', '11:15'));
  assert.ok(chot.khopGio('11:17', '11:15'));
  assert.ok(!chot.khopGio('11:14', '11:15'));
  assert.ok(!chot.khopGio('11:20', '11:15'));
});

test('tiện ích', () => {
  assert.deepEqual(chot.docDs(' a, b ,,c '), ['a', 'b', 'c']);
  assert.deepEqual(chot.docDs(undefined), []);
  assert.equal(catNgan('x'.repeat(3000)).length, 2000);
  assert.equal(layChu({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }), 'ab');
  assert.equal(layChu({}), '');
});

test('Gemini tự chuyển model dự phòng khi 404/429', async () => {
  const { Gemini } = await import('../src/gemini.js');
  const goi = [];
  const fetchCu = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const model = url.match(/models\/([^:]+):/)[1];
    goi.push(model);
    if (model === 'model-chet') return new Response('{"error":"gone"}', { status: 404 });
    if (model === 'gemini-flash-latest') return new Response('{"error":"quota"}', { status: 429 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok ' + model }] } }] }), { status: 200 });
  };
  try {
    const ai = new Gemini('k', 'model-chet');
    assert.equal(await ai.hoi('hệ thống', 'hỏi'), 'ok gemini-3.5-flash');
    assert.deepEqual(goi, ['model-chet', 'gemini-flash-latest', 'gemini-3.5-flash']);
  } finally {
    globalThis.fetch = fetchCu;
  }
});

test('dongDaAn gắn nhãn hôm qua / hôm kia', () => {
  const t = chot.dongDaAn([{ ngay: '2026-10-01', mon: 'Phở', quan: '' }, { ngay: '2026-09-30', mon: '', quan: 'Cơm Hoa Mai' }, { ngay: '2026-09-28', mon: '', quan: '' }], '2026-10-02');
  assert.equal(t, 'Hôm qua (01/10): Phở\nHôm kia (30/09): Cơm Hoa Mai');
});

test('boMarkdown dọn định dạng Gemini trả về', () => {
  assert.equal(chot.boMarkdown('## Gợi ý\n\n1. **Cơm Tấm A** - 12 Lê Lợi\n* ngon\n\n\n```\nx\n```'), 'Gợi ý\n\n1. Cơm Tấm A - 12 Lê Lợi\n- ngon\n\nx');
});

test('Gemini banDo: hết quota Maps thì hỏi lại không kèm công cụ', async () => {
  const { Gemini } = await import('../src/gemini.js');
  const goi = [];
  const fetchCu = globalThis.fetch;
  globalThis.fetch = async (url, { body }) => {
    const model = url.match(/models\/([^:]+):/)[1];
    const coTools = Boolean(JSON.parse(body).tools);
    goi.push(`${model}${coTools ? '+maps' : ''}`);
    if (coTools) return new Response('{"error":"quota"}', { status: 429 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'tra loi thuong' }] } }] }), { status: 200 });
  };
  try {
    const ai = new Gemini('k', 'gemini-flash-latest');
    assert.equal(await ai.hoi('ht', 'nd', { banDo: true }), 'tra loi thuong');
    assert.deepEqual(goi, ['gemini-flash-lite-latest+maps', 'gemini-3.5-flash-lite+maps', 'gemini-3.1-flash-lite+maps', 'gemini-flash-latest']);
  } finally {
    globalThis.fetch = fetchCu;
  }
});

test('laDiAnNgoai nhận ra ý đi ăn tại quán', () => {
  for (const c of ['bot ơi đi ăn ngoài đi', 'ra ngoài ăn gì giờ', 'quán nào gần công ty ngon', 'ăn tại quán nha', 'đi bộ ra đâu ăn']) assert.ok(chot.laDiAnNgoai(c), c);
  for (const c of ['bot ơi gợi ý món đặt grab', 'nay ăn gì', 'tầm 50k món nước']) assert.ok(!chot.laDiAnNgoai(c), c);
});

test('prompt ship nói về Grab/ShopeeFood, prompt ngoài nói về Google Maps', () => {
  assert.ok(chot.heThongTroChuyen('B', '11:15', 'Q1', 'ship').includes('ĐẶT SHIP'));
  assert.ok(!chot.heThongTroChuyen('B', '11:15', 'Q1', 'ship').includes('Google Maps'));
  assert.ok(chot.heThongTroChuyen('B', '11:15', 'Q1', 'ngoai').includes('Google Maps'));
  assert.ok(chot.heThongTroChuyen('B', '11:15', '', 'ngoai').includes('CHƯA biết nhóm ở đâu'));
});
