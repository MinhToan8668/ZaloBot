// Gọi Zalo Bot API (https://bot.zapps.me/docs).

const API_GOC = 'https://bot-api.zaloplatforms.com/bot';
export const DO_DAI_TOI_DA = 2000; // sendMessage nhận 1–2000 ký tự

// getUpdates có thể trả một update hoặc một danh sách. Luôn trả về mảng.
export function chuanHoaUpdates(data) {
  if (!data || typeof data !== 'object' || !data.ok) return [];
  const kq = data.result;
  if (Array.isArray(kq)) return kq.filter((u) => u && typeof u === 'object');
  return kq && typeof kq === 'object' ? [kq] : [];
}

export function catNgan(text, toiDa = DO_DAI_TOI_DA) {
  const t = String(text ?? '').trim();
  return t.length <= toiDa ? t : t.slice(0, toiDa - 1).trimEnd() + '…';
}

export class ZaloBot {
  constructor(token) {
    if (!token) throw new Error('Thiếu ZALO_BOT_TOKEN');
    this._token = token;
  }

  // Gọi API, trả về nguyên JSON {ok, result, error_code...}
  async _goiTho(method, payload = {}, choToiDaMs = 20_000) {
    let r;
    try {
      r = await fetch(`${API_GOC}${this._token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(choToiDaMs),
      });
    } catch (e) {
      // Không in e.message: có thể chứa URL kèm token
      throw new Error(`${method}: lỗi mạng (${e.name})`);
    }
    let data;
    try { data = await r.json(); } catch { throw new Error(`${method}: HTTP ${r.status}, không phải JSON`); }
    if (!data || typeof data !== 'object') throw new Error(`${method}: HTTP ${r.status}, JSON không đúng dạng`);
    return data;
  }

  async _goi(method, payload = {}) {
    const data = await this._goiTho(method, payload);
    if (!data.ok) throw new Error(`${method} thất bại: ${data.error_code ?? ''} ${data.description ?? ''}`.trim());
    return data.result;
  }

  getMe() { return this._goi('getMe'); }

  // Chờ tin mới tối đa `timeoutGiay`. Hết giờ mà không có tin, Zalo trả 408: đó là bình thường.
  async getUpdates(timeoutGiay = 25) {
    const data = await this._goiTho('getUpdates', { timeout: String(timeoutGiay) }, (timeoutGiay + 10) * 1000);
    if (!data.ok && data.error_code !== 408) {
      throw new Error(`getUpdates thất bại: ${data.error_code ?? ''} ${data.description ?? ''}`.trim());
    }
    return chuanHoaUpdates(data);
  }

  async sendMessage(chatId, text) {
    const t = catNgan(text);
    if (!t) return null;
    return this._goi('sendMessage', { chat_id: chatId, text: t });
  }

  async sendTyping(chatId) {
    try { await this._goi('sendChatAction', { chat_id: chatId, action: 'typing' }); } catch { /* chỉ là hiệu ứng */ }
  }

  setWebhook(url, secretToken) { return this._goi('setWebhook', { url, secret_token: secretToken }); }
  getWebhookInfo() { return this._goi('getWebhookInfo'); }
  deleteWebhook() { return this._goi('deleteWebhook'); }
}
