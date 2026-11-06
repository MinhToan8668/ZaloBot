// Bot Zalo giữ kỷ luật đăng video cho nhóm học viên, chạy trên Cloudflare Workers.
// - Mỗi phút: hỏi Zalo tin mới (getUpdates), ghi nhận link video, xử lý lệnh; rồi xem tới giờ nhắc / tổng kết chưa.
// - Luật: mỗi tuần (thứ Hai – Chủ nhật) ít nhất 1 video; thiếu SO_TUAN_KICK tuần liên tiếp thì bị mời ra khỏi nhóm.
// - Bot không tự kick được (Zalo Bot API không có lệnh này): bot báo danh sách, admin kick tay rồi gõ /dakick.

import { Kho } from './kho.js';
import * as L from './luat.js';
import { ZaloBot } from './zalo.js';

const THOI_GIAN_HOI_MS = 50_000;
const MOT_LAN_CHO_GIAY = 20;

const docDs = (chu) => String(chu ?? '').split(',').map((x) => x.trim()).filter(Boolean);

export function docCauHinh(env) {
  const ngayBatDau = /^\d{4}-\d{2}-\d{2}$/.test(env.NGAY_BAT_DAU || '') ? env.NGAY_BAT_DAU : '2026-11-09';
  return {
    tenBot: (env.TEN_BOT || 'Bot Kỷ Luật Video').trim(),
    muiGio: env.MUI_GIO || 'Asia/Ho_Chi_Minh',
    groupId: (env.GROUP_ID || '').trim(),
    adminIds: docDs(env.ADMIN_IDS),
    batDau: L.dauTuan(ngayBatDau),
    lichNhac: docDs(env.LICH_NHAC ?? 'Thu 20:00,Sat 20:00,Sun 20:00').map(L.docMoc).filter(Boolean),
    tongKet: L.docMoc(env.GIO_TONG_KET || 'Mon 08:00'),
    soTuanKick: Math.max(1, Math.floor(Number(env.SO_TUAN_KICK)) || 2),
  };
}

export function tachLenh(text) {
  const m = String(text ?? '').trim().match(/^\/(\w+)(?:@\S+)?\s*([\s\S]*)$/);
  return m ? { lenh: m[1].toLowerCase(), phanCon: m[2].trim() } : { lenh: null, phanCon: String(text ?? '').trim() };
}

const HUONG_DAN = (cfg) => `${cfg.tenBot} – theo dõi kỷ luật đăng video của nhóm.

LUẬT NHÓM
- Mỗi tuần (thứ Hai – Chủ nhật) đăng ít nhất 1 video, dài hay ngắn đều được. Hạn chót 23:59 Chủ nhật.
- Đăng xong, gửi link video vào nhóm (TikTok, YouTube, Facebook, Instagram). Bot tự ghi nhận.
- Thiếu ${cfg.soTuanKick} tuần liên tiếp sẽ bị mời ra khỏi nhóm.
- Có việc riêng thì xin nghỉ, phải được thầy duyệt mới tính.
- Luật bắt đầu tính từ tuần ${L.nhanTuan(cfg.batDau)}.

LỆNH
/toi – xem tình trạng của bạn
/bang – tình hình cả nhóm tuần này
/xinnghi [nay|sau] <lý do> – xin nghỉ tuần này hoặc tuần sau
/thamgia – báo bot biết tài khoản Zalo của bạn (khi bot chưa nhận ra)
/hd – xem lại hướng dẫn
/hdadmin – lệnh dành cho admin`;

const HUONG_DAN_ADMIN = `LỆNH ADMIN (gõ trong nhóm hoặc nhắn riêng cho bot)
/nap <tên1, tên2, ...> – nạp danh sách học viên (mỗi tên cách nhau dấu phẩy hoặc xuống dòng)
/ds – xem danh sách và số thứ tự (STT)
/cho – xem yêu cầu đang chờ duyệt
/duyet <mã> [STT] – duyệt yêu cầu. Yêu cầu tham gia: kèm STT để gắn vào người có sẵn trong danh sách
/tuchoi <mã> [lý do] – từ chối yêu cầu
/mien <STT> [nay|sau|truoc|dd/mm] <lý do> – cho nghỉ có phép không cần yêu cầu
/huymien <STT> [tuần] – hủy nghỉ có phép
/ghinhan <STT> [tuần] – tính video thủ công (vd học viên gửi file thay vì link)
/huyvideo <link> – bỏ một video đã ghi nhận (vd link không phải của người gửi)
/dakick <STT> – báo đã kick khỏi nhóm, bot bỏ khỏi danh sách
/xoa <STT> – bỏ khỏi danh sách (không phải kick)
/huylienket <STT> – gỡ tài khoản Zalo đã gắn nhầm
/tongket [nay] – xem trước tổng kết tuần trước (hoặc tuần này)
/thunhac – xem trước tin nhắc
/id – xem mã nhóm và mã của bạn`;

export class BotVideo {
  constructor(cfg, zalo, kho, bayGio = () => Date.now()) {
    this.cfg = cfg;
    this.zalo = zalo;
    this.kho = kho;
    this.bayGio = bayGio;
  }

  // ---------- tiện ích ----------

  bay() { return L.gioDiaPhuong(this.bayGio(), this.cfg.muiGio); }
  laAdmin(userId) { return this.cfg.adminIds.includes(userId); }

  // Tuần đầu phải nộp của người mới thêm: từ tuần sau. Riêng lúc nạp trước hoặc ngay trong tuần bắt đầu thì tính luôn tuần bắt đầu.
  tuanDauNguoiMoi() {
    const { tuan } = this.bay();
    return tuan <= this.cfg.batDau ? this.cfg.batDau : L.congNgay(tuan, 7);
  }

  async gui(chatId, text) {
    let ok = true;
    for (const phan of L.chiaTin(text)) {
      try { await this.zalo.sendMessage(chatId, phan); } catch (e) { console.error(`Gửi tin vào ${chatId} lỗi:`, e.message); ok = false; }
    }
    return ok;
  }

  // Nhắn riêng cho admin. Chỉ được khi admin đã từng nhắn riêng cho bot (bot mới biết cuộc trò chuyện).
  async baoAdmin(text) {
    let daGui = false;
    for (const id of this.cfg.adminIds) {
      const chatId = await this.kho.layCaiDat(`chat_admin:${id}`);
      if (chatId && await this.gui(chatId, text)) daGui = true;
    }
    return daGui;
  }

  laNhomChinh(chatId) { return Boolean(this.cfg.groupId) && chatId === this.cfg.groupId; }

  // Nhận ra người gửi là ai trong danh sách: theo tài khoản đã gắn, không thì theo tên Zalo trùng tên trong danh sách.
  async nhanDien(userId, tenZalo) {
    const tv = await this.kho.thanhVienTheoUser(userId);
    if (tv) {
      if (tenZalo && tv.ten_zalo !== tenZalo) await this.kho.capNhatTenZalo(tv.id, tenZalo);
      return tv;
    }
    const khoa = L.chuanHoaTen(tenZalo);
    if (!khoa) return null;
    const ung = (await this.kho.dsThanhVien()).filter((x) => !x.user_id && x.ten_khoa === khoa);
    if (ung.length !== 1) return null; // không có, hoặc trùng tên: phải /thamgia để admin duyệt
    await this.kho.lienKet(ung[0].id, userId, tenZalo);
    return { ...ung[0], user_id: userId, ten_zalo: tenZalo };
  }

  // Tính tình hình mọi thành viên. Mức cảnh báo xét các tuần đã đóng tới `tuanDong`; số video và nghỉ phép xem ở `tuanXem`.
  async tinhHinh(tuanDong, tuanXem) {
    const [ds, soRows, mienRows] = await Promise.all([this.kho.dsThanhVien(), this.kho.soVideoTheoTuan(), this.kho.dsMien()]);
    const video = new Map(); const tong = new Map(); const mien = new Map();
    for (const r of soRows) {
      if (!video.has(r.thanh_vien_id)) video.set(r.thanh_vien_id, new Map());
      video.get(r.thanh_vien_id).set(r.tuan, Number(r.so));
      tong.set(r.thanh_vien_id, (tong.get(r.thanh_vien_id) ?? 0) + Number(r.so));
    }
    for (const r of mienRows) {
      if (!mien.has(r.thanh_vien_id)) mien.set(r.thanh_vien_id, new Map());
      mien.get(r.thanh_vien_id).set(r.tuan, r.ly_do);
    }
    return ds.map((tv) => {
      const tuanVideo = video.get(tv.id) ?? new Map();
      const tuanMien = mien.get(tv.id) ?? new Map();
      const dg = L.danhGia({ tuTuan: tv.tu_tuan, batDau: this.cfg.batDau, denTuan: tuanDong, tuanVideo, tuanMien });
      return {
        tv, ...dg,
        muc: L.mucDo(dg.thieuLienTiep, this.cfg.soTuanKick),
        phaiNop: dg.tuanDau <= tuanXem,
        soVideoTuan: tuanVideo.get(tuanXem) ?? 0,
        mienTuan: tuanMien.has(tuanXem),
        tongVideo: tong.get(tv.id) ?? 0,
      };
    });
  }

  // ---------- nhận tin ----------

  async xuLyUpdate(upd) {
    if (!String(upd?.event_name ?? '').startsWith('message.')) return;
    const msg = upd.message ?? {};
    const nguoi = msg.from ?? {};
    const chat = msg.chat ?? {};
    const chatId = String(chat.id ?? '');
    const text = String(msg.text ?? msg.caption ?? '').trim();
    if (!chatId || !text || nguoi.is_bot) return;
    const userId = String(nguoi.id ?? '');
    const ten = String(nguoi.display_name ?? '').trim() || 'Ẩn danh';
    const rieng = chat.chat_type === 'PRIVATE';
    // Đã đặt GROUP_ID thì chỉ phục vụ nhóm đó và chat riêng; chưa đặt thì chỉ trả lời /id để lấy mã.
    if (!rieng && this.cfg.groupId && !this.laNhomChinh(chatId)) return;

    if (rieng && this.laAdmin(userId)) await this.kho.datCaiDat(`chat_admin:${userId}`, chatId);
    const ctx = { chatId, userId, ten, rieng, luc: Number(msg.date) || this.bayGio() };
    // Ai nhắn trong nhóm cũng được thử nhận diện, để tên Zalo khớp danh sách là tự gắn tài khoản.
    if (this.laNhomChinh(chatId)) await this.nhanDien(userId, ten);

    const { lenh, phanCon } = tachLenh(text);
    if (lenh) {
      if (!this.cfg.groupId && lenh !== 'id') return this.gui(chatId, 'Bot chưa được cấu hình nhóm. Gõ /id trong nhóm để lấy mã, điền vào GROUP_ID.');
      return this.xuLyLenh(lenh, phanCon, ctx);
    }
    if (!this.cfg.groupId) return;

    const { video, khongHopLe } = L.timLinkVideo(text);
    if (!video.length) {
      if (khongHopLe.length && !rieng) return this.gui(chatId, `${ten}: link vừa gửi không phải link video (có thể là trang cá nhân). Hãy gửi link của chính video đó để được ghi nhận.`);
      return;
    }
    if (rieng) return this.gui(chatId, 'Hãy gửi link video vào nhóm để được ghi nhận và để mọi người cùng vào tương tác.');
    return this.ghiVideo(ctx, video);
  }

  async ghiVideo(ctx, video) {
    const tv = await this.nhanDien(ctx.userId, ctx.ten);
    const tuan = L.gioDiaPhuong(ctx.luc, this.cfg.muiGio).tuan;
    let moi = 0; const trung = [];
    for (const v of video) {
      const kq = await this.kho.luuVideo({ ...v, userId: ctx.userId, thanhVienId: tv?.id ?? null, tuan, luc: ctx.luc });
      if (kq.moi) moi++; else trung.push(kq.cu);
    }
    const dong = [];
    if (!tv) {
      if (moi) dong.push(`Đã lưu link của ${ctx.ten}, nhưng bot chưa thấy tên này trong danh sách thành viên nên chưa tính. Gõ /thamgia để gửi yêu cầu cho thầy duyệt; được duyệt thì video này được tính lại.`);
    } else if (moi) {
      const soTuan = (await this.kho.soVideoTheoTuan()).find((r) => r.thanh_vien_id === tv.id && r.tuan === tuan)?.so ?? moi;
      dong.push(`✅ Đã ghi nhận ${moi} video của ${tv.ten} – tuần ${L.nhanTuan(tuan)} (tuần này: ${soTuan} video).`);
      if (tuan < this.cfg.batDau) dong.push(`Lưu ý: luật bắt đầu tính từ tuần ${L.nhanTuan(this.cfg.batDau)}, video này chưa tính vào kỷ luật.`);
    }
    if (trung.length) {
      const cu = trung[0];
      const khac = cu && cu.user_id !== ctx.userId;
      dong.push(khac
        ? 'Link này đã có người khác gửi trước, không tính cho bạn. Chỉ gửi link video của chính mình.'
        : `Link này đã được ghi nhận trước đó (${L.ddmm(L.gioDiaPhuong(cu?.luc ?? ctx.luc, this.cfg.muiGio).ngay)}), không tính lại.`);
    }
    if (dong.length) await this.gui(ctx.chatId, dong.join('\n'));
  }

  // ---------- lệnh ----------

  async xuLyLenh(lenh, phanCon, ctx) {
    const { chatId, userId } = ctx;
    switch (lenh) {
      case 'hd': case 'help': case 'start': return this.gui(chatId, HUONG_DAN(this.cfg));
      case 'hdadmin': return this.gui(chatId, HUONG_DAN_ADMIN);
      case 'id': return this.gui(chatId, `Mã cuộc trò chuyện này: ${chatId}\nMã của bạn: ${userId}`);
      case 'toi': return this.lenhToi(ctx);
      case 'bang': return this.gui(chatId, await this.soanBang());
      case 'thamgia': return this.lenhThamGia(ctx);
      case 'xinnghi': return this.lenhXinNghi(phanCon, ctx);
      default: break;
    }
    const LENH_ADMIN = ['nap', 'ds', 'cho', 'duyet', 'tuchoi', 'mien', 'huymien', 'ghinhan', 'huyvideo', 'dakick', 'xoa', 'huylienket', 'tongket', 'thunhac'];
    if (!LENH_ADMIN.includes(lenh)) return this.gui(chatId, 'Bot không có lệnh này. Gõ /hd để xem các lệnh.');
    if (!this.cfg.adminIds.length) return this.gui(chatId, 'Chưa cấu hình ADMIN_IDS nên chưa ai dùng được lệnh admin.');
    if (!this.laAdmin(userId)) return this.gui(chatId, 'Lệnh này chỉ dành cho admin.');
    switch (lenh) {
      case 'nap': return this.lenhNap(phanCon, ctx);
      case 'ds': return this.lenhDs(ctx);
      case 'cho': return this.lenhCho(ctx);
      case 'duyet': return this.lenhDuyet(phanCon, ctx);
      case 'tuchoi': return this.lenhTuChoi(phanCon, ctx);
      case 'mien': return this.lenhMien(phanCon, ctx);
      case 'huymien': return this.lenhHuyMien(phanCon, ctx);
      case 'ghinhan': return this.lenhGhiNhan(phanCon, ctx);
      case 'huyvideo': return this.lenhHuyVideo(phanCon, ctx);
      case 'dakick': case 'xoa': return this.lenhBoKhoiDs(lenh, phanCon, ctx);
      case 'huylienket': return this.lenhHuyLienKet(phanCon, ctx);
      case 'tongket': {
        const { tuan } = this.bay();
        return this.gui(chatId, await this.soanTongKet(/^(nay|này)$/i.test(phanCon) ? tuan : L.congNgay(tuan, -7), true));
      }
      case 'thunhac': return this.gui(chatId, await this.soanNhac());
      default: return null;
    }
  }

  // Lấy thành viên từ STT ở đầu tham số. Trả { tv, conLai } hoặc gửi báo lỗi và trả null.
  async layTheoStt(phanCon, chatId, mau) {
    const m = String(phanCon).match(/^#?(\d+)\s*([\s\S]*)$/);
    if (!m) { await this.gui(chatId, `Gõ: ${mau}\nXem STT bằng /ds`); return null; }
    const tv = await this.kho.layThanhVien(Number(m[1]));
    if (!tv) { await this.gui(chatId, `Không có thành viên STT ${m[1]} trong danh sách. Xem lại bằng /ds`); return null; }
    return { tv, conLai: m[2].trim() };
  }

  async lenhToi(ctx) {
    const tv = await this.nhanDien(ctx.userId, ctx.ten);
    if (!tv) return this.gui(ctx.chatId, `${ctx.ten}: bot chưa nhận ra bạn trong danh sách thành viên. Gõ /thamgia trong nhóm để gửi yêu cầu cho thầy duyệt.`);
    const bay = this.bay();
    const x = (await this.tinhHinh(L.congNgay(bay.tuan, -7), bay.tuan)).find((r) => r.tv.id === tv.id);
    return this.gui(ctx.chatId, L.soanCaNhan({
      ten: tv.ten, tuan: bay.tuan, bay, batDau: this.cfg.batDau, tuanDau: x.tuanDau, soVideoTuan: x.soVideoTuan, mienTuan: x.mienTuan,
      tongVideo: x.tongVideo, chuoi: x.chuoi, thieuLienTiep: x.thieuLienTiep, soTuanKick: this.cfg.soTuanKick, cacTuan: x.cacTuan,
    }));
  }

  async lenhThamGia(ctx) {
    const tv = await this.nhanDien(ctx.userId, ctx.ten);
    if (tv) return this.gui(ctx.chatId, `${ctx.ten}: bạn đã có trong danh sách (STT ${tv.id} – ${tv.ten}). Gửi link video vào nhóm là được ghi nhận.`);
    const yc = await this.kho.taoYeuCau({ loai: 'thamgia', chatId: ctx.chatId, userId: ctx.userId, tenZalo: ctx.ten, luc: this.bayGio() });
    if (!yc.moi) return this.gui(ctx.chatId, `${ctx.ten}: yêu cầu tham gia của bạn (mã ${yc.id}) đang chờ thầy duyệt.`);
    await this.baoAdmin(`📥 Yêu cầu tham gia mã ${yc.id}: ${ctx.ten} (Zalo).\n- Người mới: /duyet ${yc.id}\n- Là người đã có trong danh sách: /duyet ${yc.id} <STT> (xem /ds)\n- Từ chối: /tuchoi ${yc.id} <lý do>`);
    return this.gui(ctx.chatId, `${ctx.ten}: đã gửi yêu cầu tham gia (mã ${yc.id}). Chờ thầy duyệt.`);
  }

  async lenhXinNghi(phanCon, ctx) {
    const tv = await this.nhanDien(ctx.userId, ctx.ten);
    if (!tv) return this.gui(ctx.chatId, `${ctx.ten}: bot chưa nhận ra bạn trong danh sách thành viên. Gõ /thamgia trước.`);
    const { tuan: tuanNay } = this.bay();
    const { tuan, conLai: lyDo } = L.tachTuan(phanCon, tuanNay);
    if (!tuan) return this.gui(ctx.chatId, 'Ngày không hợp lệ. Gõ: /xinnghi [nay|sau|dd/mm] <lý do>');
    if (tuan < tuanNay) return this.gui(ctx.chatId, 'Chỉ xin nghỉ được cho tuần này hoặc các tuần sau.');
    if (L.chuanHoaTen(lyDo).length < 3) return this.gui(ctx.chatId, 'Cần ghi rõ lý do. Ví dụ: /xinnghi sau đi công tác cả tuần');
    if ((await this.kho.dsMien()).some((m) => m.thanh_vien_id === tv.id && m.tuan === tuan)) {
      return this.gui(ctx.chatId, `${tv.ten}: tuần ${L.nhanTuan(tuan)} bạn đã được duyệt nghỉ rồi.`);
    }
    const yc = await this.kho.taoYeuCau({ loai: 'nghi', chatId: ctx.chatId, userId: ctx.userId, tenZalo: ctx.ten, thanhVienId: tv.id, tuan, lyDo: lyDo.slice(0, 300), luc: this.bayGio() });
    if (!yc.moi) return this.gui(ctx.chatId, `${tv.ten}: yêu cầu nghỉ tuần ${L.nhanTuan(tuan)} (mã ${yc.id}) đang chờ thầy duyệt.`);
    await this.baoAdmin(`📥 Xin nghỉ mã ${yc.id}: ${tv.ten} (STT ${tv.id}), tuần ${L.nhanTuan(tuan)}.\nLý do: ${lyDo}\nDuyệt: /duyet ${yc.id} – Từ chối: /tuchoi ${yc.id} <lý do>`);
    return this.gui(ctx.chatId, `${tv.ten}: đã gửi yêu cầu nghỉ tuần ${L.nhanTuan(tuan)} (mã ${yc.id}). Chưa được duyệt thì tuần đó vẫn phải nộp video.`);
  }

  async lenhNap(phanCon, ctx) {
    const ten = L.tachDanhSachTen(phanCon);
    if (!ten.length) return this.gui(ctx.chatId, 'Gõ: /nap Nguyễn Văn A, Trần Thị B, ...\n(cách nhau dấu phẩy hoặc mỗi người một dòng; tên nên trùng tên Zalo để bot tự nhận ra)');
    const tuTuan = this.tuanDauNguoiMoi();
    const them = []; const daCo = [];
    for (const t of ten) {
      const kq = await this.kho.themThanhVien(t.slice(0, 80), L.chuanHoaTen(t), tuTuan, this.bayGio());
      (kq.moi ? them : daCo).push(`${kq.id}. ${t}`);
    }
    const dong = [`Đã thêm ${them.length} người, bắt đầu tính từ tuần ${L.nhanTuan(tuTuan)}.`];
    if (them.length) dong.push(them.join('\n'));
    if (daCo.length) dong.push(`Đã có sẵn, bỏ qua: ${daCo.join(', ')}`);
    dong.push('Bot tự nhận ra mỗi người khi họ nhắn trong nhóm bằng tên Zalo trùng tên trong danh sách. Ai khác tên thì gõ /thamgia, rồi admin /duyet <mã> <STT>.');
    return this.gui(ctx.chatId, dong.join('\n'));
  }

  async lenhDs(ctx) {
    const ds = await this.kho.dsThanhVien();
    if (!ds.length) return this.gui(ctx.chatId, 'Danh sách trống. Nạp bằng: /nap tên1, tên2, ...');
    const chuaGan = ds.filter((x) => !x.user_id).length;
    const dong = ds.map((x) => `${x.id}. ${x.ten} – ${x.user_id ? `Zalo: ${x.ten_zalo || '?'}` : 'chưa nhận ra Zalo'}${x.tu_tuan > this.cfg.batDau ? ` – tính từ ${L.ddmm(x.tu_tuan)}` : ''}`);
    return this.gui(ctx.chatId, `👥 DANH SÁCH (${ds.length} người, ${chuaGan} chưa nhận ra Zalo)\nSố đầu dòng là STT dùng cho lệnh admin.\n${dong.join('\n')}`);
  }

  async lenhCho(ctx) {
    const ds = await this.kho.yeuCauDangCho();
    if (!ds.length) return this.gui(ctx.chatId, 'Không có yêu cầu nào đang chờ.');
    const tvs = new Map((await this.kho.dsThanhVien()).map((x) => [x.id, x]));
    const dong = ds.map((y) => (y.loai === 'nghi'
      ? `Mã ${y.id} – xin nghỉ: ${tvs.get(y.thanh_vien_id)?.ten ?? y.ten_zalo}, tuần ${L.nhanTuan(y.tuan)}. Lý do: ${y.ly_do}`
      : `Mã ${y.id} – tham gia: ${y.ten_zalo}`));
    return this.gui(ctx.chatId, `📥 YÊU CẦU CHỜ DUYỆT\n${dong.join('\n')}\n\n/duyet <mã> [STT] hoặc /tuchoi <mã> [lý do]`);
  }

  async lenhDuyet(phanCon, ctx) {
    const m = phanCon.match(/^#?(\d+)(?:\s+#?(\d+))?/);
    if (!m) return this.gui(ctx.chatId, 'Gõ: /duyet <mã> [STT]. Xem mã bằng /cho');
    const yc = await this.kho.layYeuCau(Number(m[1]));
    if (!yc || yc.trang_thai !== 'cho') return this.gui(ctx.chatId, `Không có yêu cầu mã ${m[1]} đang chờ.`);

    if (yc.loai === 'nghi') {
      const tv = await this.kho.layThanhVien(yc.thanh_vien_id);
      if (!tv) return this.gui(ctx.chatId, 'Người này không còn trong danh sách.');
      if (!(await this.kho.ketThucYeuCau(yc.id, 'duyet'))) return null;
      await this.kho.datMien(tv.id, yc.tuan, yc.ly_do, this.bayGio());
      return this.thongBao(yc.chat_id, ctx.chatId, `✅ Thầy đã duyệt cho ${tv.ten} nghỉ tuần ${L.nhanTuan(yc.tuan)}. Lý do: ${yc.ly_do}`);
    }

    // Yêu cầu tham gia
    const khac = await this.kho.thanhVienTheoUser(yc.user_id);
    if (khac) {
      await this.kho.ketThucYeuCau(yc.id, 'duyet');
      return this.gui(ctx.chatId, `${yc.ten_zalo} đã được gắn với STT ${khac.id} – ${khac.ten} rồi.`);
    }
    let tv;
    if (m[2]) {
      tv = await this.kho.layThanhVien(Number(m[2]));
      if (!tv) return this.gui(ctx.chatId, `Không có STT ${m[2]} trong danh sách.`);
      if (tv.user_id) return this.gui(ctx.chatId, `STT ${tv.id} – ${tv.ten} đã gắn với tài khoản Zalo khác (${tv.ten_zalo}). Gỡ bằng /huylienket ${tv.id} nếu gắn nhầm.`);
    } else {
      const kq = await this.kho.themThanhVien(yc.ten_zalo.slice(0, 80), L.chuanHoaTen(yc.ten_zalo), this.tuanDauNguoiMoi(), this.bayGio());
      tv = await this.kho.layThanhVien(kq.id);
      if (tv.user_id) return this.gui(ctx.chatId, `Danh sách đã có người tên "${tv.ten}" (STT ${tv.id}) gắn tài khoản khác. Dùng /duyet ${yc.id} <STT> để chỉ đúng người.`);
    }
    if (!(await this.kho.ketThucYeuCau(yc.id, 'duyet'))) return null;
    await this.kho.lienKet(tv.id, yc.user_id, yc.ten_zalo);
    return this.thongBao(yc.chat_id, ctx.chatId, `✅ ${yc.ten_zalo} đã được duyệt vào danh sách (STT ${tv.id} – ${tv.ten}), tính từ tuần ${L.nhanTuan(tv.tu_tuan > this.cfg.batDau ? tv.tu_tuan : this.cfg.batDau)}.`);
  }

  async lenhTuChoi(phanCon, ctx) {
    const m = phanCon.match(/^#?(\d+)\s*([\s\S]*)$/);
    if (!m) return this.gui(ctx.chatId, 'Gõ: /tuchoi <mã> [lý do]');
    const yc = await this.kho.layYeuCau(Number(m[1]));
    if (!yc || !(await this.kho.ketThucYeuCau(yc.id, 'tu_choi'))) return this.gui(ctx.chatId, `Không có yêu cầu mã ${m[1]} đang chờ.`);
    const lyDo = m[2].trim() ? ` Lý do: ${m[2].trim()}` : '';
    const viec = yc.loai === 'nghi' ? `xin nghỉ tuần ${L.nhanTuan(yc.tuan)}` : 'tham gia';
    const them = yc.loai === 'nghi' ? ' Tuần đó vẫn phải nộp video.' : '';
    return this.thongBao(yc.chat_id, ctx.chatId, `❌ Yêu cầu ${viec} của ${yc.ten_zalo} không được duyệt.${lyDo}${them}`);
  }

  // Báo kết quả về nơi người ta gửi yêu cầu, và báo lại cho admin nếu admin gõ lệnh ở chỗ khác.
  async thongBao(noiYeuCau, noiAdmin, text) {
    if (noiYeuCau) await this.gui(noiYeuCau, text);
    if (noiAdmin !== noiYeuCau) await this.gui(noiAdmin, `Đã xử lý: ${text}`);
  }

  async lenhMien(phanCon, ctx) {
    const kq = await this.layTheoStt(phanCon, ctx.chatId, '/mien <STT> [nay|sau|truoc|dd/mm] <lý do>');
    if (!kq) return null;
    const { tuan, conLai: lyDo } = L.tachTuan(kq.conLai, this.bay().tuan);
    if (!tuan) return this.gui(ctx.chatId, 'Ngày không hợp lệ. Gõ: /mien <STT> [nay|sau|truoc|dd/mm] <lý do>');
    await this.kho.datMien(kq.tv.id, tuan, lyDo || 'admin cho nghỉ', this.bayGio());
    const thongDiep = `✅ ${kq.tv.ten} được nghỉ có phép tuần ${L.nhanTuan(tuan)}${lyDo ? `. Lý do: ${lyDo}` : ''}.`;
    if (this.cfg.groupId && ctx.chatId !== this.cfg.groupId) await this.gui(this.cfg.groupId, thongDiep);
    return this.gui(ctx.chatId, thongDiep);
  }

  async lenhHuyMien(phanCon, ctx) {
    const kq = await this.layTheoStt(phanCon, ctx.chatId, '/huymien <STT> [nay|sau|truoc|dd/mm]');
    if (!kq) return null;
    const tuan = L.docTuan(kq.conLai, this.bay().tuan);
    if (!tuan) return this.gui(ctx.chatId, 'Ngày không hợp lệ.');
    const ok = await this.kho.huyMien(kq.tv.id, tuan);
    return this.gui(ctx.chatId, ok ? `Đã hủy nghỉ có phép của ${kq.tv.ten} tuần ${L.nhanTuan(tuan)}.` : `${kq.tv.ten} không có nghỉ phép tuần ${L.nhanTuan(tuan)}.`);
  }

  async lenhGhiNhan(phanCon, ctx) {
    const kq = await this.layTheoStt(phanCon, ctx.chatId, '/ghinhan <STT> [nay|truoc|dd/mm]');
    if (!kq) return null;
    const tuan = L.docTuan(kq.conLai, this.bay().tuan);
    if (!tuan) return this.gui(ctx.chatId, 'Ngày không hợp lệ.');
    const r = await this.kho.luuVideo({ khoa: `tay:${kq.tv.id}:${tuan}`, link: '', nenTang: 'thủ công', userId: kq.tv.user_id, thanhVienId: kq.tv.id, tuan, luc: this.bayGio() });
    return this.gui(ctx.chatId, r.moi ? `✅ Đã ghi nhận thủ công 1 video cho ${kq.tv.ten} – tuần ${L.nhanTuan(tuan)}.` : `${kq.tv.ten} đã được ghi nhận thủ công tuần ${L.nhanTuan(tuan)} rồi.`);
  }

  async lenhHuyVideo(phanCon, ctx) {
    const { video } = L.timLinkVideo(phanCon);
    if (!video.length) return this.gui(ctx.chatId, 'Gõ: /huyvideo <link video>');
    const ok = await this.kho.xoaVideo(video[0].khoa);
    return this.gui(ctx.chatId, ok ? 'Đã bỏ video này khỏi ghi nhận.' : 'Link này chưa được ghi nhận.');
  }

  async lenhBoKhoiDs(lenh, phanCon, ctx) {
    const kq = await this.layTheoStt(phanCon, ctx.chatId, `/${lenh} <STT>`);
    if (!kq) return null;
    await this.kho.datTrangThai(kq.tv.id, lenh === 'dakick' ? 'da_kick' : 'da_xoa');
    return this.gui(ctx.chatId, lenh === 'dakick' ? `Đã cập nhật: ${kq.tv.ten} đã bị mời ra khỏi nhóm.` : `Đã bỏ ${kq.tv.ten} khỏi danh sách.`);
  }

  async lenhHuyLienKet(phanCon, ctx) {
    const kq = await this.layTheoStt(phanCon, ctx.chatId, '/huylienket <STT>');
    if (!kq) return null;
    await this.kho.huyLienKet(kq.tv.id);
    return this.gui(ctx.chatId, `Đã gỡ tài khoản Zalo khỏi ${kq.tv.ten}. Người đúng gõ /thamgia để gắn lại.`);
  }

  // ---------- soạn nhắc, bảng, tổng kết ----------

  async soanNhac() {
    const bay = this.bay();
    const ds = (await this.tinhHinh(L.congNgay(bay.tuan, -7), bay.tuan)).filter((x) => x.phaiNop && !x.mienTuan);
    const chuaNop = ds.filter((x) => x.soVideoTuan === 0).map((x) => ({ ten: x.tv.ten, canhBao: x.thieuLienTiep, chuaLienKet: !x.tv.user_id }));
    return L.soanNhac({ tuan: bay.tuan, bay, tongPhaiNop: ds.length, soDaNop: ds.length - chuaNop.length, chuaNop, soTuanKick: this.cfg.soTuanKick });
  }

  async soanBang() {
    const bay = this.bay();
    const ds = await this.tinhHinh(L.congNgay(bay.tuan, -7), bay.tuan);
    const daNop = ds.filter((x) => x.phaiNop && x.soVideoTuan > 0).map((x) => ({ ten: x.tv.ten, so: x.soVideoTuan }));
    const chuaNop = ds.filter((x) => x.phaiNop && !x.soVideoTuan && !x.mienTuan).map((x) => ({ ten: x.tv.ten, canhBao: x.thieuLienTiep > 0 }));
    const mien = ds.filter((x) => x.phaiNop && !x.soVideoTuan && x.mienTuan).map((x) => x.tv.ten);
    const moi = ds.filter((x) => !x.phaiNop).map((x) => x.tv.ten);
    const dau = bay.tuan < this.cfg.batDau ? `(Luật bắt đầu tính từ tuần ${L.nhanTuan(this.cfg.batDau)}.)\n` : '';
    return dau + L.soanBang({ tuan: bay.tuan, bay, daNop, chuaNop, mien, moi });
  }

  async duLieuTongKet(tuan) {
    const ds = (await this.tinhHinh(tuan, tuan)).filter((x) => x.phaiNop);
    const video = (await this.kho.videoTrongTuan(tuan)).filter((v) => v.link).map((v) => ({ ten: v.ten, link: v.link }));
    const maxVideo = Math.max(0, ...ds.map((x) => x.soVideoTuan));
    return {
      ds,
      tuan,
      tongPhaiNop: ds.filter((x) => !x.mienTuan || x.soVideoTuan > 0).length,
      soDaNop: ds.filter((x) => x.soVideoTuan > 0).length,
      video,
      chuoi: ds.filter((x) => x.chuoi >= 2).sort((a, b) => b.chuoi - a.chuoi).slice(0, 5).map((x) => ({ ten: x.tv.ten, chuoi: x.chuoi })),
      chamNhat: maxVideo >= 2 ? { ten: ds.filter((x) => x.soVideoTuan === maxVideo).map((x) => x.tv.ten), so: maxVideo } : null,
      mien: ds.filter((x) => x.mienTuan && !x.soVideoTuan).map((x) => x.tv.ten),
      canhBao: ds.filter((x) => x.muc === 'canh_bao').map((x) => x.tv.ten),
      kickDs: ds.filter((x) => x.muc === 'kick'),
      soTuanKick: this.cfg.soTuanKick,
    };
  }

  async soanTongKet(tuan, xemTruoc = false) {
    const d = await this.duLieuTongKet(tuan);
    return L.soanTongKet({ ...d, kick: d.kickDs.map((x) => x.tv.ten), xemTruoc });
  }

  async guiTongKet(tuan) {
    const d = await this.duLieuTongKet(tuan);
    await this.gui(this.cfg.groupId, L.soanTongKet({ ...d, kick: d.kickDs.map((x) => x.tv.ten) }));
    if (d.kickDs.length) {
      const dong = d.kickDs.map((x) => `- STT ${x.tv.id}: ${x.tv.ten}${x.tv.ten_zalo && x.tv.ten_zalo !== x.tv.ten ? ` (Zalo: ${x.tv.ten_zalo})` : ''} – thiếu ${x.thieuLienTiep} tuần`);
      const daBao = await this.baoAdmin(`🔴 CẦN MỜI RA KHỎI NHÓM (tính đến tuần ${L.nhanTuan(tuan)}):\n${dong.join('\n')}\n\nZalo Bot không tự kick được. Thầy kick trong nhóm rồi gõ /dakick <STT> để bot cập nhật danh sách.`);
      if (!daBao) console.warn('Chưa nhắn riêng được cho admin nào: admin cần nhắn riêng cho bot một lần');
    }
  }

  // ---------- hẹn giờ ----------

  // Gọi mỗi phút. Mỗi mốc chỉ chạy một lần nhờ bảng `viec`.
  async kiemTraLich() {
    if (!this.cfg.groupId) return;
    const bay = this.bay();
    const tuanTruoc = L.congNgay(bay.tuan, -7);
    if (L.denMoc(this.cfg.tongKet, bay) && tuanTruoc >= this.cfg.batDau && await this.kho.gianhViec(`tongket:${tuanTruoc}`, this.bayGio())) {
      await this.guiTongKet(tuanTruoc);
    }
    if (bay.tuan < this.cfg.batDau) return;
    for (const moc of this.cfg.lichNhac) {
      if (L.denMoc(moc, bay) && await this.kho.gianhViec(`nhac:${bay.tuan}:${moc.chu}`, this.bayGio())) {
        await this.gui(this.cfg.groupId, await this.soanNhac());
      }
    }
  }

  // Hỏi Zalo liên tục trong `hanMs` mili giây rồi dừng, để lần cron sau tiếp tục.
  async vongNhanTin(hanMs) {
    const het = Date.now() + hanMs;
    let daXuLy = 0;
    while (true) {
      const conLaiGiay = Math.floor((het - Date.now()) / 1000);
      if (conLaiGiay < 3) break;
      let upds;
      try { upds = await this.zalo.getUpdates(Math.min(MOT_LAN_CHO_GIAY, conLaiGiay)); } catch (e) { console.error('getUpdates lỗi, dừng vòng này:', e.message); break; }
      for (const upd of upds) {
        try { await this.xuLyUpdate(upd); daXuLy++; } catch (e) { console.error('Lỗi xử lý tin:', e.message); }
      }
    }
    return daXuLy;
  }
}

function taoBot(env) {
  return new BotVideo(docCauHinh(env), new ZaloBot(env.ZALO_BOT_TOKEN), new Kho(env.DB));
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') return new Response('Bot nhắc video đang chạy.', { status: 200 });
    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env) {
    const bot = taoBot(env);
    await bot.kho.damBaoLuocDo();
    try { await bot.kiemTraLich(); } catch (e) { console.error('Lỗi hẹn giờ:', e.message); }
    await bot.vongNhanTin(THOI_GIAN_HOI_MS);
  },
};
