// Bot Zalo nhóm cơm trưa chạy trên Cloudflare Workers.
// - scheduled() mỗi phút: hỏi Zalo tin mới (getUpdates), ghi tin, trả lời khi được gọi, xử lý lệnh
// - scheduled() giờ cấu hình: nhắc chọn món (GIO_NHAC) và tự chốt (GIO_CHOT)
// - fetch(): webhook, chỉ dùng được khi Worker có tên miền riêng (workers.dev chặn máy chủ Zalo)

import * as chot from './chot.js';
import { Gemini } from './gemini.js';
import { Kho } from './kho.js';
import { ZaloBot } from './zalo.js';

const GIAN_CACH_TRA_LOI_MS = 5_000;  // tối thiểu giữa hai câu trả lời AI trong cùng nhóm
const CUA_SO_TRO_CHUYEN_MS = 3 * 60_000; // sau khi bot trả lời, trong chừng này tin không tag vẫn được coi là nói với bot
const SO_NGAY_NHOM_HOAT_DONG = 7;
const SO_NGAY_GIU_TIN = 30;
const CRON_NHAN_TIN = '* * * * *';   // mỗi phút một lần, mỗi lần hỏi Zalo liên tục chừng này lâu:
const THOI_GIAN_HOI_MS = 50_000;
const MOT_LAN_CHO_GIAY = 20;         // một lần getUpdates chờ tối đa bao lâu

const HUONG_DAN = (ten, goi, gio) => `Mình là ${ten}, lo vụ trưa nay ăn gì cho cả nhóm.
- Cứ nhắn thoải mái món muốn ăn, mình ghi lại hết.
- Gọi "${goi}" kèm câu hỏi nếu cần mình gợi ý món (đặt Grab/ShopeeFood). Nói thêm tầm giá, món khô/nước... mình gợi ý sát hơn.
- Muốn đi ăn tại quán thì nhắn "${goi} ơi đi ăn ngoài", mình tìm quán gần công ty.
- ${gio} mình tự chốt món và danh sách suất để đặt.

Lệnh:
/chot - chốt ngay
/tinhhinh - xem mọi người đang chọn gì
/nghi - hôm nay không đặt cơm, bot không tự chốt
/diachi <địa chỉ> - đặt địa điểm công ty để bot gợi ý quán gần đó
/id - xem mã nhóm (để cấu hình)
/hd - xem lại hướng dẫn này`;

export function docCauHinh(env) {
  const tenBot = (env.TEN_BOT || 'Bot Cơm Trưa').trim();
  return {
    muiGio: env.MUI_GIO || 'Asia/Ho_Chi_Minh',
    gioChot: env.GIO_CHOT || '11:15',
    ngayLam: chot.docDs(env.NGAY_LAM || 'Mon,Tue,Wed,Thu,Fri').map((d) => d.slice(0, 3).toLowerCase()),
    gioNhac: env.GIO_NHAC || '',
    gioNhac2: env.GIO_NHAC_2 || '',
    groupIds: chot.docDs(env.GROUP_IDS),
    adminIds: chot.docDs(env.ADMIN_IDS),
    tenBot,
    tuGoi: chot.docDs(env.TU_GOI || `bot,${tenBot}`),
    quanQuen: env.QUAN_QUEN || '',
    diaDiem: (env.DIA_DIEM || '').trim(),
  };
}

export class BotComTrua {
  constructor(cfg, zalo, ai, kho, bayGio = () => Date.now()) {
    this.cfg = cfg;
    this.zalo = zalo;
    this.ai = ai;
    this.kho = kho;
    this.bayGio = bayGio;
  }

  // ---------- tiện ích ----------

  homNay() { return chot.gioDiaPhuong(this.bayGio(), this.cfg.muiGio).ngay; }
  gioHienTai() { return chot.gioDiaPhuong(this.bayGio(), this.cfg.muiGio).gio; }

  async gui(chatId, text) {
    try { await this.zalo.sendMessage(chatId, text); return true; } catch (e) { console.error(`Gửi tin vào ${chatId} lỗi:`, e.message); return false; }
  }

  laAdmin(userId) { return !this.cfg.adminIds.length || this.cfg.adminIds.includes(userId); }

  // Địa điểm: nhóm đặt bằng /diachi được ưu tiên, không thì lấy DIA_DIEM cấu hình chung.
  async diaDiemCua(chatId) {
    return (await this.kho.layCaiDat(chatId, 'dia_diem')) || this.cfg.diaDiem;
  }

  async boiCanh(chatId) {
    const homNay = this.homNay();
    const [diaDiem, lichSu] = await Promise.all([this.diaDiemCua(chatId), this.kho.chotGanDay(chatId, homNay)]);
    return { diaDiem, daAn: chot.dongDaAn(lichSu, homNay) };
  }

  // Đã cấu hình GROUP_IDS thì chỉ phục vụ các nhóm đó, và chat riêng của admin.
  duocPhucVu(chatId, chatType, userId) {
    if (!this.cfg.groupIds.length) return true;
    if (chatType === 'PRIVATE') return this.cfg.adminIds.length > 0 && this.cfg.adminIds.includes(userId);
    return this.cfg.groupIds.includes(chatId);
  }

  // Các nhóm được nhắc và tự chốt: GROUP_IDS nếu có, không thì nhóm có hoạt động gần đây.
  async nhomDich() {
    return this.cfg.groupIds.length ? this.cfg.groupIds : this.kho.nhomGanDay(SO_NGAY_NHOM_HOAT_DONG, this.bayGio());
  }

  // ---------- nhận tin ----------

  async xuLyUpdate(upd) {
    if (upd?.event_name !== 'message.text.received') return;
    const msg = upd.message ?? {};
    const nguoi = msg.from ?? {};
    const chat = msg.chat ?? {};
    const chatId = String(chat.id ?? '');
    const text = String(msg.text ?? '').trim();
    if (!chatId || !text || nguoi.is_bot) return;
    const userId = String(nguoi.id ?? '');
    if (!this.duocPhucVu(chatId, chat.chat_type, userId)) return;

    const luc = Number(msg.date) || this.bayGio();
    await this.kho.ghiNhom(chatId, chat.chat_type ?? '', luc);
    const ten = String(nguoi.display_name ?? 'Ẩn danh').trim() || 'Ẩn danh';

    const daTag = /@/.test(text) && chot.boTagBot(text, this.cfg.tenBot, this.cfg.tuGoi) !== text.trim();
    const textSach = chot.boTagBot(text, this.cfg.tenBot, this.cfg.tuGoi);
    if (chat.chat_type === 'GROUP') console.log(`Tin nhóm ${chatId} từ ${ten}: ${text.slice(0, 120)}`);
    const { lenh, phanCon } = chot.tachLenh(textSach);
    if (lenh) return this.xuLyLenh(lenh, chatId, userId, phanCon);

    const ngay = chot.gioDiaPhuong(luc, this.cfg.muiGio).ngay;
    const messageId = String(msg.message_id ?? `${userId}-${luc}`);
    const moi = await this.kho.luuTin({ chatId, messageId, userId, ten, noiDung: text, luc, ngay });
    if (!moi) return; // Zalo gửi lại tin cũ

    const goiBot = daTag || chot.laGoiBot(text, this.cfg.tuGoi) || chat.chat_type === 'PRIVATE';
    if (goiBot || await this.kho.dangTroChuyen(chatId, this.bayGio(), CUA_SO_TRO_CHUYEN_MS)) {
      await this.traLoi(chatId, ten, text, goiBot);
    }
  }

  async xuLyLenh(lenh, chatId, userId, phanCon = '') {
    switch (lenh) {
      case 'diachi': {
        if (!phanCon) {
          const hienTai = await this.diaDiemCua(chatId);
          return this.gui(chatId, hienTai ? `Địa điểm hiện tại: ${hienTai}\nĐổi bằng: /diachi <địa chỉ mới>` : 'Chưa đặt địa điểm. Gõ: /diachi <địa chỉ công ty>, ví dụ /diachi 123 Nguyễn Huệ, Quận 1, TP.HCM');
        }
        if (!this.laAdmin(userId)) return this.gui(chatId, 'Lệnh này chỉ người phụ trách đặt cơm dùng được nha.');
        await this.kho.datCaiDat(chatId, 'dia_diem', phanCon.slice(0, 200));
        return this.gui(chatId, `Đã ghi nhớ địa điểm: ${phanCon.slice(0, 200)}. Từ giờ bot gợi ý quán quanh đây.`);
      }
      case 'hd': case 'help': case 'start':
        return this.gui(chatId, HUONG_DAN(this.cfg.tenBot, this.cfg.tuGoi[0] || 'bot', this.cfg.gioChot));
      case 'id':
        return this.gui(chatId, `Mã cuộc trò chuyện này: ${chatId}\nMã của bạn: ${userId}`);
      case 'tinhhinh':
        return this.gui(chatId, (await this.tongHop(chatId, `Tình hình đến ${this.gioHienTai()} (chưa chốt)`)).text);
      case 'chot': case 'nghi': {
        if (!this.laAdmin(userId)) return this.gui(chatId, 'Lệnh này chỉ người phụ trách đặt cơm dùng được nha.');
        if (lenh === 'chot') return this.chot(chatId);
        await this.kho.datNghi(chatId, this.homNay());
        return this.gui(chatId, 'Ok, hôm nay bot không tự chốt. Gõ /chot nếu đổi ý.');
      }
      default:
        return this.gui(chatId, 'Bot chưa hiểu lệnh này. Gõ /hd để xem các lệnh.');
    }
  }

  // ---------- AI ----------

  async traLoi(chatId, ten, text, goiBot = true) {
    if (!this.ai.sanSang) return;
    if (!(await this.kho.xinTraLoi(chatId, this.bayGio(), GIAN_CACH_TRA_LOI_MS))) return;
    await this.zalo.sendTyping(chatId);
    const [tin, boiCanh] = await Promise.all([this.kho.tinTrongNgay(chatId, this.homNay()), this.boiCanh(chatId)]);
    const noiDung = chot.noiDungGuiAI(tin, this.cfg.muiGio, this.cfg.quanQuen,
      `Tin nhắn mới nhất, của ${ten}: ${text}\n${goiBot ? 'Tin này gọi bạn, hãy trả lời.' : 'Tin này KHÔNG tag bạn. Chỉ trả lời nếu nó đang nói tiếp với bạn hoặc cần bạn chốt lại; không thì trả lời đúng một chữ: IM'}`, boiCanh);
    try {
      // Mặc định nhóm đặt ship (gợi ý món); nói "đi ăn ngoài" thì tra Google Maps tìm quán gần công ty
      const cheDo = chot.laDiAnNgoai(text) ? 'ngoai' : 'ship';
      const cau = await this.ai.hoi(chot.heThongTroChuyen(this.cfg.tenBot, this.cfg.gioChot, boiCanh.diaDiem, cheDo), noiDung,
        { banDo: cheDo === 'ngoai' && Boolean(boiCanh.diaDiem) });
      const sach = chot.boMarkdown(cau);
      if (/^im[.!]?$/i.test(sach)) return;
      if (await this.gui(chatId, sach)) {
        // Lưu câu bot vừa nói để lần sau nối mạch
        const luc = this.bayGio();
        await this.kho.luuTin({ chatId, messageId: `bot-${luc}`, userId: 'bot', ten: this.cfg.tenBot, noiDung: sach, luc, ngay: this.homNay() });
      }
    } catch (e) {
      console.error('Gemini lỗi khi trả lời:', e.message);
    }
  }

  // Tổng hợp ý kiến hôm nay. Trả {text, kq}; kq = null khi AI lỗi (dùng bản dự phòng).
  async tongHop(chatId, tieuDe) {
    const tin = await this.kho.tinTrongNgay(chatId, this.homNay());
    if (tin.length && this.ai.sanSang) {
      try {
        const boiCanh = await this.boiCanh(chatId);
        const chu = await this.ai.hoi(chot.HE_THONG_CHOT,
          chot.noiDungGuiAI(tin, this.cfg.muiGio, this.cfg.quanQuen, '', boiCanh), { jsonMode: true, nhietDo: 0.2 });
        const kq = chot.docKetQua(chu);
        return { text: chot.dinhDangChot(kq, tieuDe), kq };
      } catch (e) {
        console.error('Không tổng hợp được bằng AI:', e.message);
      }
    }
    return { text: chot.chotDuPhong(tin, tieuDe), kq: null };
  }

  async chot(chatId) {
    await this.zalo.sendTyping(chatId);
    const { text, kq } = await this.tongHop(chatId, `🍱 CHỐT CƠM TRƯA ${this.gioHienTai()}`);
    const daGui = await this.gui(chatId, text);
    // Nhớ lại để mai không gợi ý trùng
    if (daGui && kq?.mon_chot) await this.kho.luuChot(chatId, this.homNay(), kq.mon_chot, kq.quan);
    return daGui;
  }

  // ---------- nhận tin bằng getUpdates ----------

  // Hỏi Zalo liên tục trong `hanMs` mili giây rồi dừng, để lần cron sau tiếp tục.
  async vongNhanTin(hanMs) {
    const het = Date.now() + hanMs;
    let daXuLy = 0;
    while (true) {
      const conLaiGiay = Math.floor((het - Date.now()) / 1000);
      if (conLaiGiay < 3) break;
      let upds;
      try {
        upds = await this.zalo.getUpdates(Math.min(MOT_LAN_CHO_GIAY, conLaiGiay));
      } catch (e) {
        console.error('getUpdates lỗi, dừng vòng này:', e.message);
        break;
      }
      for (const upd of upds) {
        try { await this.xuLyUpdate(upd); daXuLy++; } catch (e) { console.error('Lỗi xử lý tin:', e.message); }
      }
    }
    return daXuLy;
  }

  // ---------- hẹn giờ (cron) ----------

  async chayHenGio(gioCron) {
    const { ngay, thu } = chot.gioDiaPhuong(this.bayGio(), this.cfg.muiGio);
    if (!this.cfg.ngayLam.includes(thu.toLowerCase())) { console.log(`Hôm nay ${thu}, không phải ngày làm việc, bỏ qua`); return; }
    const nhac = this.cfg.gioNhac && chot.khopGio(gioCron, this.cfg.gioNhac);
    const nhac2 = this.cfg.gioNhac2 && chot.khopGio(gioCron, this.cfg.gioNhac2);
    const chotGio = chot.khopGio(gioCron, this.cfg.gioChot);
    if (!nhac && !nhac2 && !chotGio) { console.warn(`Cron chạy lúc ${gioCron} không khớp GIO_NHAC/GIO_NHAC_2/GIO_CHOT`); return; }

    for (const chatId of await this.nhomDich()) {
      try {
        if (nhac && await this.kho.gianhViec(chatId, ngay, 'da_nhac')) {
          await this.gui(chatId, `Trưa nay ăn gì mọi người ơi? 🍚 Nhắn món muốn ăn nha, ${this.cfg.gioChot} bot chốt.`);
        }
        if (nhac2 && await this.kho.gianhViec(chatId, ngay, 'nhac2')) {
          const conPhut = chot.phutGiua(this.cfg.gioNhac2, this.cfg.gioChot);
          await this.gui(chatId, `⏰ Còn ${conPhut} phút nữa (${this.cfg.gioChot}) bot chốt cơm. Ai chưa chọn món thì nhắn liền nha!`);
        }
        if (chotGio && await this.kho.gianhViec(chatId, ngay, 'da_chot')) {
          await this.chot(chatId);
        }
      } catch (e) {
        console.error(`Lỗi hẹn giờ ở nhóm ${chatId}:`, e.message);
      }
    }
    if (chotGio) await this.kho.donDep(SO_NGAY_GIU_TIN, this.bayGio());
  }
}

function taoBot(env) {
  return new BotComTrua(docCauHinh(env), new ZaloBot(env.ZALO_BOT_TOKEN), new Gemini(env.GEMINI_API_KEY, env.GEMINI_MODEL), new Kho(env.DB));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') return new Response('Bot cơm trưa đang chạy.', { status: 200 });
    if (url.pathname !== '/webhook') return new Response('Not found', { status: 404 });
    // Zalo gọi thử webhook có thể bằng GET/HEAD: cứ trả 200
    if (request.method !== 'POST') return Response.json({ ok: true });

    // Lúc setWebhook, Zalo gọi thử KHÔNG kèm secret và cần nhận 2xx mới "verification" được.
    // Nên: sai hoặc thiếu secret thì vẫn trả 200 nhưng bỏ qua, không xử lý gì.
    if (!env.WEBHOOK_SECRET || request.headers.get('X-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
      console.warn('Webhook không có secret hợp lệ, bỏ qua');
      return Response.json({ ok: true });
    }
    let body;
    try { body = await request.json(); } catch { return new Response('Bad request', { status: 400 }); }
    // Zalo có thể bọc update trong {ok, result}; chấp nhận cả hai dạng
    const upd = body?.result && typeof body.result === 'object' ? body.result : body;

    // Trả 200 ngay để Zalo không gửi lại; xử lý (có gọi Gemini) tiếp trong nền
    const bot = taoBot(env);
    ctx.waitUntil(bot.kho.damBaoLuocDo().then(() => bot.xuLyUpdate(upd)).catch((e) => console.error('Lỗi xử lý tin:', e)));
    return Response.json({ ok: true });
  },

  async scheduled(event, env) {
    const bot = taoBot(env);
    await bot.kho.damBaoLuocDo();
    if (event.cron === CRON_NHAN_TIN) {
      await bot.vongNhanTin(THOI_GIAN_HOI_MS);
      return;
    }
    bot.bayGio = () => event.scheduledTime;
    const { gio } = chot.gioDiaPhuong(event.scheduledTime, bot.cfg.muiGio);
    await bot.chayHenGio(gio);
  },
};
