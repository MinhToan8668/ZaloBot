// Luật nhóm và soạn tin nhắn. Toàn hàm thuần: không gọi mạng, không đụng DB, dễ kiểm thử.
// Quy ước: ngày là chuỗi 'YYYY-MM-DD' theo giờ Việt Nam; "tuần" là ngày thứ Hai đầu tuần.

export const THU = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TEN_THU = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];
const PHUT_MOT_NGAY = 1440;

// ---------- thời gian ----------

export function gioDiaPhuong(ms, muiGio) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: muiGio, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
    }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]),
  );
  const gio = p.hour === '24' ? '00' : p.hour;
  const ngay = `${p.year}-${p.month}-${p.day}`;
  return { ngay, gio: `${gio}:${p.minute}`, phut: Number(gio) * 60 + Number(p.minute), thuSo: THU.indexOf(p.weekday), tuan: dauTuan(ngay) };
}

export function congNgay(ngay, so) {
  const d = new Date(`${ngay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + so);
  return d.toISOString().slice(0, 10);
}

export function dauTuan(ngay) {
  const thuSo = (new Date(`${ngay}T00:00:00Z`).getUTCDay() + 6) % 7; // thứ Hai = 0
  return congNgay(ngay, -thuSo);
}

export const ddmm = (ngay) => `${ngay.slice(8, 10)}/${ngay.slice(5, 7)}`;
export const nhanTuan = (tuan) => `${ddmm(tuan)} – ${ddmm(congNgay(tuan, 6))}`;
export const hanChot = (tuan) => `23:59 Chủ nhật ${ddmm(congNgay(tuan, 6))}`;

// 'Thu 20:00' -> { thuSo: 3, phut: 1200 }
export function docMoc(chu) {
  const m = String(chu ?? '').trim().match(/^([A-Za-z]{3})\w*\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const thuSo = THU.findIndex((t) => t.toLowerCase() === m[1].toLowerCase());
  const h = Number(m[2]); const p = Number(m[3]);
  if (thuSo < 0 || h > 23 || p > 59) return null;
  return { thuSo, phut: h * 60 + p, chu: `${THU[thuSo]} ${m[2].padStart(2, '0')}:${m[3]}` };
}

// Đã tới mốc chưa: cùng thứ, đã qua giờ mốc, và chưa trễ quá `cuaSoPhut` (bot ngừng chạy lâu thì thôi, không nhắc muộn).
export function denMoc(moc, bay, cuaSoPhut = 180) {
  return Boolean(moc) && bay.thuSo === moc.thuSo && bay.phut >= moc.phut && bay.phut < moc.phut + cuaSoPhut;
}

// Số phút còn lại tới hết Chủ nhật của tuần hiện tại.
export const phutConLai = (bay) => (6 - bay.thuSo) * PHUT_MOT_NGAY + (PHUT_MOT_NGAY - bay.phut);

export function dinhDangConLai(phut) {
  const ngay = Math.floor(phut / PHUT_MOT_NGAY);
  const gio = Math.floor((phut % PHUT_MOT_NGAY) / 60);
  if (ngay > 0) return gio > 0 ? `${ngay} ngày ${gio} giờ` : `${ngay} ngày`;
  if (gio > 0) return `${gio} giờ`;
  return `${Math.max(phut, 0)} phút`;
}

// 'nay' | 'sau' | 'truoc' | 'dd/mm' | 'dd/mm/yyyy' -> thứ Hai của tuần đó, sai dạng trả null.
export function docTuan(chu, tuanNay) {
  const t = String(chu ?? '').trim().toLowerCase();
  if (!t || t === 'nay' || t === 'này') return tuanNay;
  if (t === 'sau') return congNgay(tuanNay, 7);
  if (t === 'truoc' || t === 'trước') return congNgay(tuanNay, -7);
  const m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (!m) return null;
  const nam0 = m[3] ? Number(m[3]) : Number(tuanNay.slice(0, 4));
  const dung = (nam) => `${nam}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  let ngay = dung(nam0);
  const d = new Date(`${ngay}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== ngay) return null;
  if (!m[3]) {
    const lech = (d - new Date(`${tuanNay}T00:00:00Z`)) / 86400_000;
    if (lech > 180) ngay = dung(nam0 - 1);
    else if (lech < -180) ngay = dung(nam0 + 1);
  }
  return dauTuan(ngay);
}

// Tách phần đầu là tuần (nếu có) khỏi phần còn lại: 'sau đi công tác' -> { tuan, conLai: 'đi công tác' }
export function tachTuan(chu, tuanNay) {
  const s = String(chu ?? '').trim();
  const [dau, ...sau] = s.split(/\s+/);
  // tuan = null khi viết sai ngày (vd 31/02)
  if (dau && /^(nay|này|sau|truoc|trước|\d{1,2}\/\d{1,2}(\/\d{4})?)$/i.test(dau)) return { tuan: docTuan(dau, tuanNay), conLai: sau.join(' ').trim(), coTuan: true };
  return { tuan: tuanNay, conLai: s, coTuan: false };
}

// ---------- tên ----------

// Bỏ dấu, chữ thường, gộp khoảng trắng: so tên trong danh sách với tên Zalo.
export function chuanHoaTen(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// '1. An, Bình\n- Chi' -> ['An', 'Bình', 'Chi']
export function tachDanhSachTen(chu) {
  return String(chu ?? '').split(/[,;\n]+/)
    .map((x) => x.replace(/^\s*(?:\d+[.)]|[-•*+])\s*/, '').trim())
    .filter((x) => chuanHoaTen(x));
}

// ---------- link video ----------

const URL_RE = /(?<![\w.@-])(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:tiktok\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|instagram\.com)(?:\/[^\s<>"'`]*)?/gi;

// Nhận diện một link: trả { khoa, nenTang } nếu là link video, null nếu không (vd trang cá nhân).
// `khoa` dùng để chống nộp trùng: cùng một video dán bằng hai kiểu link vẫn ra cùng khoa khi có thể.
export function phanLoaiLink(goc) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(goc) ? goc : `https://${goc}`); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const path = u.pathname.replace(/\/+$/, '');
  const co = (ten) => host === ten || host.endsWith(`.${ten}`);
  let m;

  if (co('tiktok.com')) {
    if ((host === 'vt.tiktok.com' || host === 'vm.tiktok.com') && /^\/[\w-]+$/.test(path)) return { khoa: `tiktok-ngan:${path.slice(1)}`, nenTang: 'TikTok' };
    if ((m = path.match(/\/video\/(\d+)/))) return { khoa: `tiktok:${m[1]}`, nenTang: 'TikTok' };
    if ((m = path.match(/^\/t\/([\w-]+)$/))) return { khoa: `tiktok-ngan:${m[1]}`, nenTang: 'TikTok' };
    return null;
  }
  if (host === 'youtu.be' && (m = path.match(/^\/([\w-]{6,})/))) return { khoa: `youtube:${m[1]}`, nenTang: 'YouTube' };
  if (co('youtube.com')) {
    if ((m = path.match(/^\/(?:shorts|live|embed)\/([\w-]{6,})/))) return { khoa: `youtube:${m[1]}`, nenTang: 'YouTube' };
    const v = u.searchParams.get('v');
    if (path === '/watch' && v && /^[\w-]{6,}$/.test(v)) return { khoa: `youtube:${v}`, nenTang: 'YouTube' };
    return null;
  }
  if (host === 'fb.watch' && /^\/[\w-]+$/.test(path)) return { khoa: `facebook-ngan:${path.slice(1)}`, nenTang: 'Facebook' };
  if (co('facebook.com')) {
    if ((m = path.match(/^\/reels?\/(\d+)/))) return { khoa: `facebook:${m[1]}`, nenTang: 'Facebook' };
    if ((m = path.match(/\/videos\/(?:[^/]+\/)?(\d+)/))) return { khoa: `facebook:${m[1]}`, nenTang: 'Facebook' };
    const v = u.searchParams.get('v');
    if (/^\/watch\/?$/.test(path) && v && /^\d+$/.test(v)) return { khoa: `facebook:${v}`, nenTang: 'Facebook' };
    if ((m = path.match(/^\/share\/[rv]\/([\w-]+)/))) return { khoa: `facebook-ngan:${m[1]}`, nenTang: 'Facebook' };
    return null;
  }
  if (co('instagram.com') && (m = path.match(/^\/(?:reels?|p|tv)\/([\w-]+)/))) return { khoa: `instagram:${m[1]}`, nenTang: 'Instagram' };
  return null;
}

// Tìm mọi link trong tin. video: link video hợp lệ (không trùng trong cùng tin); khongHopLe: link nền tảng nhưng không phải video.
export function timLinkVideo(text) {
  const video = []; const khongHopLe = [];
  for (const [tho] of String(text ?? '').matchAll(URL_RE)) {
    const goc = tho.replace(/[).,!?;:…]+$/u, '');
    const loai = phanLoaiLink(goc);
    if (!loai) { khongHopLe.push(goc); continue; }
    if (!video.some((v) => v.khoa === loai.khoa)) video.push({ link: /^https?:\/\//i.test(goc) ? goc : `https://${goc}`, ...loai });
  }
  return { video, khongHopLe };
}

// ---------- luật kỷ luật ----------

// Xét các tuần đã đóng của một thành viên, từ tuần đầu phải nộp tới `denTuan` (tính cả tuần đó).
// Mỗi tuần: 'nop' (có video), 'mien' (nghỉ có phép), 'thieu'. Tuần nghỉ có phép được bỏ qua khi đếm chuỗi:
// không xóa lỗi cũ, cũng không làm đứt chuỗi.
export function danhGia({ tuTuan, batDau, denTuan, tuanVideo, tuanMien }) {
  const dau = tuTuan > batDau ? tuTuan : batDau;
  const cacTuan = [];
  for (let t = dau; t <= denTuan; t = congNgay(t, 7)) {
    cacTuan.push({ tuan: t, tt: tuanVideo.has(t) ? 'nop' : tuanMien.has(t) ? 'mien' : 'thieu' });
  }
  const demCuoi = (loai) => {
    let n = 0;
    for (let i = cacTuan.length - 1; i >= 0; i--) {
      if (cacTuan[i].tt === 'mien') continue;
      if (cacTuan[i].tt !== loai) break;
      n++;
    }
    return n;
  };
  return { tuanDau: dau, cacTuan, thieuLienTiep: demCuoi('thieu'), chuoi: demCuoi('nop') };
}

export const mucDo = (thieuLienTiep, soTuanKick) => (thieuLienTiep >= soTuanKick ? 'kick' : thieuLienTiep > 0 ? 'canh_bao' : 'an_toan');

// ---------- chia tin dài ----------

// Zalo nhận tối đa 2000 ký tự mỗi tin: chia theo dòng.
export function chiaTin(text, toiDa = 1900) {
  const ra = []; let cur = '';
  for (let dong of String(text ?? '').split('\n')) {
    while (dong.length > toiDa) { if (cur) { ra.push(cur); cur = ''; } ra.push(dong.slice(0, toiDa)); dong = dong.slice(toiDa); }
    if (cur && cur.length + 1 + dong.length > toiDa) { ra.push(cur); cur = dong; } else cur = cur ? `${cur}\n${dong}` : dong;
  }
  if (cur.trim()) ra.push(cur);
  return ra.map((x) => x.trim()).filter(Boolean);
}

// ---------- soạn tin ----------

const dsDong = (arr) => arr.map((x, i) => `${i + 1}. ${x}`).join('\n');

// chuaNop: [{ ten, canhBao, chuaLienKet }]
export function soanNhac({ tuan, bay, tongPhaiNop, soDaNop, chuaNop, soTuanKick }) {
  const tieuDe = `⏰ NHẮC NỘP VIDEO – tuần ${nhanTuan(tuan)}`;
  const han = `Hạn chót: ${hanChot(tuan)} (còn ${dinhDangConLai(phutConLai(bay))}).`;
  if (!chuaNop.length) return `${tieuDe}\n✅ Tất cả ${tongPhaiNop} thành viên đã nộp video tuần này. Giữ vững kỷ luật.`;
  const dong = chuaNop.map((x) => {
    let s = x.ten;
    if (x.canhBao) s += ` ⚠️ đã thiếu ${x.canhBao} tuần, tuần này không nộp sẽ bị mời ra khỏi nhóm`;
    if (x.chuaLienKet) s += ' (bot chưa nhận ra tài khoản Zalo: gõ /thamgia trong nhóm)';
    return s;
  });
  return [
    tieuDe, han, `Đã nộp: ${soDaNop}/${tongPhaiNop}.`, '',
    'Chưa nộp:', dsDong(dong), '',
    `Gửi link video (TikTok, YouTube, Facebook, Instagram) vào nhóm để được ghi nhận. Thiếu ${soTuanKick} tuần liên tiếp sẽ bị mời ra khỏi nhóm.`,
  ].join('\n');
}

// video: [{ ten, link }]; chuoi: [{ ten, chuoi }]; chamNhat: { ten: [], so }
export function soanTongKet({ tuan, tongPhaiNop, soDaNop, video, chuoi, chamNhat, mien, canhBao, kick, soTuanKick, xemTruoc = false }) {
  const tyLe = tongPhaiNop ? Math.round((soDaNop / tongPhaiNop) * 100) : 0;
  const phan = [
    `${xemTruoc ? '[XEM TRƯỚC] ' : ''}📊 TỔNG KẾT TUẦN ${nhanTuan(tuan)}`,
    `Đã nộp: ${soDaNop}/${tongPhaiNop} thành viên (${tyLe}%) – ${video.length} video.`,
  ];
  if (video.length) phan.push('', '🎬 VIDEO TRONG TUẦN – mọi người vào xem và tương tác cho nhau:', dsDong(video.map((v) => `${v.ten}: ${v.link}`)));
  if (chuoi.length) phan.push('', '🔥 CHUỖI KỶ LUẬT:', chuoi.map((x) => `- ${x.ten}: ${x.chuoi} tuần liên tiếp`).join('\n'));
  if (chamNhat?.ten?.length) phan.push('', `🏆 Chăm nhất tuần: ${chamNhat.ten.join(', ')} (${chamNhat.so} video).`);
  if (mien.length) phan.push('', `🟢 Nghỉ có phép: ${mien.join(', ')}.`);
  if (canhBao.length) phan.push('', '🟡 CẢNH BÁO – đã thiếu video, tuần này không nộp sẽ bị mời ra khỏi nhóm:', dsDong(canhBao));
  if (kick.length) phan.push('', `🔴 MỜI RA KHỎI NHÓM – thiếu ${soTuanKick} tuần liên tiếp:`, dsDong(kick));
  if (!canhBao.length && !kick.length && tongPhaiNop) phan.push('', '✅ Không ai bị cảnh báo. Cảm ơn mọi người đã giữ kỷ luật.');
  phan.push('', 'Tuần mới đã bắt đầu. Mỗi người ít nhất 1 video, hạn 23:59 Chủ nhật.');
  return phan.join('\n');
}

// Tình hình tuần đang chạy
export function soanBang({ tuan, bay, daNop, chuaNop, mien, moi }) {
  const tong = daNop.length + chuaNop.length;
  const phan = [`📋 TÌNH HÌNH TUẦN ${nhanTuan(tuan)}`, `Đã nộp: ${daNop.length}/${tong}. Hạn chót ${hanChot(tuan)} (còn ${dinhDangConLai(phutConLai(bay))}).`];
  if (daNop.length) phan.push('', '✅ Đã nộp:', dsDong(daNop.map((x) => `${x.ten} (${x.so} video)`)));
  if (chuaNop.length) phan.push('', '❌ Chưa nộp:', dsDong(chuaNop.map((x) => (x.canhBao ? `${x.ten} ⚠️` : x.ten))));
  if (mien.length) phan.push('', `🟢 Nghỉ có phép: ${mien.join(', ')}.`);
  if (moi.length) phan.push('', `🆕 Thành viên mới, chưa tính tuần này: ${moi.join(', ')}.`);
  if (chuaNop.some((x) => x.canhBao)) phan.push('', '⚠️ = đã thiếu tuần trước, tuần này không nộp sẽ bị mời ra khỏi nhóm.');
  return phan.join('\n');
}

const KY_HIEU = { nop: '✅', mien: '🟢', thieu: '❌' };

export function soanCaNhan({ ten, tuan, bay, batDau, tuanDau, soVideoTuan, mienTuan, tongVideo, chuoi, thieuLienTiep, soTuanKick, cacTuan }) {
  const phan = [`📋 ${ten}`];
  if (tuan < batDau) phan.push(`Luật nộp video bắt đầu tính từ tuần ${nhanTuan(batDau)}.`);
  else if (tuan < tuanDau) phan.push(`Bạn là thành viên mới, bắt đầu tính từ tuần ${nhanTuan(tuanDau)}.`);
  let tuanNay;
  if (soVideoTuan > 0) tuanNay = `✅ đã nộp ${soVideoTuan} video`;
  else if (mienTuan) tuanNay = '🟢 nghỉ có phép';
  else tuanNay = `❌ chưa nộp (hạn ${hanChot(tuan)}, còn ${dinhDangConLai(phutConLai(bay))})`;
  phan.push(`Tuần này (${nhanTuan(tuan)}): ${tuanNay}`);
  phan.push(`Tổng video đã nộp: ${tongVideo}`);
  phan.push(`Chuỗi kỷ luật: ${chuoi + (soVideoTuan > 0 ? 1 : 0)} tuần liên tiếp`);
  let tt;
  if (thieuLienTiep >= soTuanKick) tt = `🔴 đã thiếu ${thieuLienTiep} tuần liên tiếp, nằm trong danh sách mời ra khỏi nhóm`;
  else if (thieuLienTiep > 0) tt = soVideoTuan > 0 || mienTuan
    ? '🟢 đã nộp bù tuần này, an toàn'
    : `🟡 đã thiếu ${thieuLienTiep} tuần, tuần này không nộp sẽ bị mời ra khỏi nhóm`;
  else tt = '🟢 an toàn';
  phan.push(`Trạng thái: ${tt}`);
  const gan = cacTuan.slice(-8);
  if (gan.length) phan.push(`Các tuần gần nhất: ${gan.map((x) => KY_HIEU[x.tt]).join('')} (✅ nộp, 🟢 nghỉ phép, ❌ thiếu)`);
  return phan.join('\n');
}
