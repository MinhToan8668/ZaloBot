import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as L from '../src/luat.js';

test('tuần tính từ thứ Hai, theo giờ Việt Nam', () => {
  assert.equal(L.dauTuan('2026-11-09'), '2026-11-09');
  assert.equal(L.dauTuan('2026-11-15'), '2026-11-09');
  assert.equal(L.dauTuan('2026-11-08'), '2026-11-02');
  // 23:30 Chủ nhật 15/11 giờ VN = 16:30 UTC: vẫn thuộc tuần 09/11
  assert.equal(L.gioDiaPhuong(Date.UTC(2026, 10, 15, 16, 30), 'Asia/Ho_Chi_Minh').tuan, '2026-11-09');
  // 00:10 thứ Hai 16/11 giờ VN: sang tuần mới
  assert.equal(L.gioDiaPhuong(Date.UTC(2026, 10, 15, 17, 10), 'Asia/Ho_Chi_Minh').tuan, '2026-11-16');
  assert.equal(L.nhanTuan('2026-11-09'), '09/11 – 15/11');
});

test('nhận link video, bỏ link trang cá nhân, gộp link trùng', () => {
  const { video, khongHopLe } = L.timLinkVideo(`video mới nè https://www.tiktok.com/@an.nguyen/video/7311111111111111111?is_from_webapp=1.
    kênh mình: https://www.tiktok.com/@an.nguyen
    https://vt.tiktok.com/ZSabc123/ và youtu.be/dQw4w9WgXcQ, https://www.youtube.com/watch?v=dQw4w9WgXcQ
    https://www.facebook.com/reel/1234567890 https://www.instagram.com/reel/Cabc_12/`);
  assert.deepEqual(video.map((v) => v.khoa), ['tiktok:7311111111111111111', 'tiktok-ngan:ZSabc123', 'youtube:dQw4w9WgXcQ', 'facebook:1234567890', 'instagram:Cabc_12']);
  assert.equal(video[2].link, 'https://youtu.be/dQw4w9WgXcQ');
  assert.deepEqual(khongHopLe, ['https://www.tiktok.com/@an.nguyen']);
  assert.equal(L.phanLoaiLink('https://www.youtube.com/shorts/abcDEF123')?.khoa, 'youtube:abcDEF123');
  assert.equal(L.phanLoaiLink('https://m.facebook.com/watch/?v=987654321')?.khoa, 'facebook:987654321');
  assert.equal(L.phanLoaiLink('https://www.youtube.com/@kenh'), null);
  assert.equal(L.timLinkVideo('xem notyoutube.com/shorts/abcdef nha').video.length, 0);
});

test('đánh giá kỷ luật: đếm thiếu liên tiếp, nghỉ phép được bỏ qua', () => {
  const dg = (video, mien, denTuan = '2026-11-30', tuTuan = '2026-11-09') => L.danhGia({
    tuTuan, batDau: '2026-11-09', denTuan, tuanVideo: new Set(video), tuanMien: new Set(mien),
  });
  let r = dg(['2026-11-09', '2026-11-16'], []);
  assert.equal(r.thieuLienTiep, 2); // 23/11 và 30/11 thiếu
  assert.equal(L.mucDo(r.thieuLienTiep, 2), 'kick');
  r = dg(['2026-11-09', '2026-11-16', '2026-11-30'], []);
  assert.deepEqual([r.thieuLienTiep, r.chuoi], [0, 1]);
  r = dg(['2026-11-09', '2026-11-16'], ['2026-11-23', '2026-11-30']);
  assert.deepEqual([r.thieuLienTiep, r.chuoi], [0, 2]); // nghỉ phép không làm đứt chuỗi
  r = dg([], ['2026-11-16'], '2026-11-23');
  assert.equal(r.thieuLienTiep, 2); // thiếu, nghỉ phép, thiếu: vẫn là 2 tuần thiếu liên tiếp
  r = dg([], [], '2026-11-16', '2026-11-16');
  assert.deepEqual(r.cacTuan.map((x) => x.tuan), ['2026-11-16']); // người mới chỉ tính từ tuần của họ
  assert.equal(L.mucDo(1, 2), 'canh_bao');
});

test('đọc mốc giờ, tuần, tên và danh sách tên', () => {
  assert.deepEqual(L.docMoc('Sun 20:00'), { thuSo: 6, phut: 1200, chu: 'Sun 20:00' });
  assert.equal(L.docMoc('Chủ nhật 8h'), null);
  const bay = { thuSo: 6, phut: 1230 };
  assert.ok(L.denMoc(L.docMoc('Sun 20:00'), bay));
  assert.ok(!L.denMoc(L.docMoc('Sun 20:00'), { thuSo: 6, phut: 1199 }));
  assert.equal(L.dinhDangConLai(L.phutConLai({ thuSo: 6, phut: 1200 })), '4 giờ');
  assert.equal(L.dinhDangConLai(L.phutConLai({ thuSo: 3, phut: 1200 })), '3 ngày 4 giờ');
  assert.equal(L.docTuan('sau', '2026-11-09'), '2026-11-16');
  assert.equal(L.docTuan('20/11', '2026-11-09'), '2026-11-16');
  assert.equal(L.docTuan('02/01', '2026-12-28'), '2026-12-28'); // 02/01/2027 thuộc tuần 28/12/2026
  assert.equal(L.docTuan('31/02', '2026-11-09'), null);
  assert.deepEqual(L.tachTuan('sau đi công tác', '2026-11-09'), { tuan: '2026-11-16', conLai: 'đi công tác', coTuan: true });
  assert.deepEqual(L.tachTuan('bị ốm', '2026-11-09'), { tuan: '2026-11-09', conLai: 'bị ốm', coTuan: false });
  assert.equal(L.chuanHoaTen('  Nguyễn  Văn Đạt 🎬'), 'nguyen van dat');
  assert.deepEqual(L.tachDanhSachTen('1. Nguyễn An, Trần Bình\n- Lê Chi\n\n'), ['Nguyễn An', 'Trần Bình', 'Lê Chi']);
});

test('chia tin dài theo dòng, mỗi phần không quá giới hạn', () => {
  const dong = Array.from({ length: 100 }, (_, i) => `${i + 1}. Người thứ ${i}: https://www.tiktok.com/@x/video/${'1'.repeat(19)}`);
  const phan = L.chiaTin(dong.join('\n'), 500);
  assert.ok(phan.length > 1);
  assert.ok(phan.every((p) => p.length <= 500));
  assert.equal(phan.join('\n'), dong.join('\n'));
});
