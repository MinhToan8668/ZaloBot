// Bot Zalo nhóm cơm trưa chạy trên Cloudflare Workers.
// - fetch():     nhận webhook từ Zalo, ghi tin, trả lời khi được gọi, xử lý lệnh
// - scheduled(): Cron Trigger nhắc chọn món (GIO_NHAC) và tự chốt (GIO_CHOT)

import * as chot from './chot.js';
import { Gemini } from './gemini.js';
import { Kho } from './kho.js';
import { ZaloBot } from './zalo.js';

const GIAN_CACH_TRA_LOI_MS = 5_000;  // tối thiểu giữa hai câu trả lời AI trong cùng nhóm
const SO_NGAY_NHOM_HOAT_DONG = 7;
const SO_NGAY_GIU_TIN = 30;

const HUONG_DAN = (ten, goi, gio) => `Mình là ${ten}, lo vụ trưa nay ăn gì cho cả nhóm.
- Cứ nhắn thoải mái món muốn ăn, mình ghi lại hết.
- Gọi "${goi}" kèm câu hỏi nếu cần mình gợi ý món.
- ${gio} mình tự chốt món và danh sách suất để đặt.

Lệnh:
/chot - chốt ngay
/tinhhinh - xem mọi người đang chọn gì
/nghi - hôm nay không đặt cơm, bot không tự chốt
/id - xem mã nhóm (để cấu hình)
/hd - xem lại hướng dẫn này`;

export function docCauHinh(env) {
  const tenBot = (env.TEN_BOT || 'Bot Cơm Trưa').trim();
  return {
    muiGio: env.MUI_GIO || 'Asia/Ho_Chi_Minh',
    gioChot: env.GIO_CHOT || '11:15',
    gioNhac: env.GIO_NHAC || '',
    groupIds: chot.docDs(env.GROUP_IDS),
    adminIds: chot.docDs(env.ADMIN_IDS),
    tenBot,
    tuGoi: chot.docDs(env.TU_GOI || `bot,${tenBot}`),
    quanQuen: env.QUAN_QUEN || '',
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

    const { lenh } = chot.tachLenh(text);
    if (lenh) return this.xuLyLenh(lenh, chatId, userId);

    const ngay = chot.gioDiaPhuong(luc, this.cfg.muiGio).ngay;
    const messageId = String(msg.message_id ?? `${userId}-${luc}`);
    const moi = await this.kho.luuTin({ chatId, messageId, userId, ten, noiDung: text, luc, ngay });
    if (!moi) return; // Zalo gửi lại tin cũ

    if (chot.laGoiBot(text, this.cfg.tuGoi) || chat.chat_type === 'PRIVATE') {
      await this.traLoi(chatId, ten, text);
    }
  }

  async xuLyLenh(lenh, chatId, userId) {
    switch (lenh) {
      case 'hd': case 'help': case 'start':
        return this.gui(chatId, HUONG_DAN(this.cfg.tenBot, this.cfg.tuGoi[0] || 'bot', this.cfg.gioChot));
      case 'id':
        return this.gui(chatId, `Mã cuộc trò chuyện này: ${chatId}\nMã của bạn: ${userId}`);
      case 'tinhhinh':
        return this.gui(chatId, await this.tongHop(chatId, `Tình hình đến ${this.gioHienTai()} (chưa chốt)`));
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

  async traLoi(chatId, ten, text) {
    if (!this.ai.sanSang) return;
    if (!(await this.kho.xinTraLoi(chatId, this.bayGio(), GIAN_CACH_TRA_LOI_MS))) return;
    await this.zalo.sendTyping(chatId);
    const tin = await this.kho.tinTrongNgay(chatId, this.homNay());
    const noiDung = chot.noiDungGuiAI(tin, this.cfg.muiGio, this.cfg.quanQuen,
      `Tin nhắn mới nhất, của ${ten}: ${text}\nHãy trả lời tin này.`);
    try {
      const cau = await this.ai.hoi(chot.heThongTroChuyen(this.cfg.tenBot, this.cfg.gioChot), noiDung);
      await this.gui(chatId, cau);
    } catch (e) {
      console.error('Gemini lỗi khi trả lời:', e.message);
    }
  }

  // Tổng hợp ý kiến hôm nay thành tin nhắn. AI lỗi thì dùng bản dự phòng.
  async tongHop(chatId, tieuDe) {
    const tin = await this.kho.tinTrongNgay(chatId, this.homNay());
    if (tin.length && this.ai.sanSang) {
      try {
        const chu = await this.ai.hoi(chot.HE_THONG_CHOT, chot.noiDungGuiAI(tin, this.cfg.muiGio, this.cfg.quanQuen),
          { jsonMode: true, nhietDo: 0.2 });
        return chot.dinhDangChot(chot.docKetQua(chu), tieuDe);
      } catch (e) {
        console.error('Không tổng hợp được bằng AI:', e.message);
      }
    }
    return chot.chotDuPhong(tin, tieuDe);
  }

  async chot(chatId) {
    await this.zalo.sendTyping(chatId);
    return this.gui(chatId, await this.tongHop(chatId, `🍱 CHỐT CƠM TRƯA ${this.gioHienTai()}`));
  }

  // ---------- hẹn giờ (cron) ----------

  async chayHenGio(gioCron) {
    const ngay = this.homNay();
    const nhac = this.cfg.gioNhac && chot.khopGio(gioCron, this.cfg.gioNhac);
    const chotGio = chot.khopGio(gioCron, this.cfg.gioChot);
    if (!nhac && !chotGio) { console.warn(`Cron chạy lúc ${gioCron} không khớp GIO_NHAC/GIO_CHOT`); return; }

    for (const chatId of await this.nhomDich()) {
      try {
        if (nhac && await this.kho.gianhViec(chatId, ngay, 'da_nhac')) {
          await this.gui(chatId, `Trưa nay ăn gì mọi người ơi? 🍚 Nhắn món muốn ăn nha, ${this.cfg.gioChot} bot chốt.`);
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
    if (request.method !== 'POST' || url.pathname !== '/webhook') return new Response('Not found', { status: 404 });

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
    ctx.waitUntil(taoBot(env).xuLyUpdate(upd).catch((e) => console.error('Lỗi xử lý tin:', e)));
    return Response.json({ ok: true });
  },

  async scheduled(event, env, ctx) {
    const bot = taoBot(env);
    bot.bayGio = () => event.scheduledTime;
    const { gio } = chot.gioDiaPhuong(event.scheduledTime, bot.cfg.muiGio);
    ctx.waitUntil(bot.chayHenGio(gio));
  },
};
