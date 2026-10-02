// Gọi Zalo Bot API (https://bot.zapps.me/docs).

const API_GOC = 'https://bot-api.zaloplatforms.com/bot';
export const DO_DAI_TOI_DA = 2000; // sendMessage nhận 1–2000 ký tự

export function catNgan(text, toiDa = DO_DAI_TOI_DA) {
  const t = String(text ?? '').trim();
  return t.length <= toiDa ? t : t.slice(0, toiDa - 1).trimEnd() + '…';
}

export class ZaloBot {
  constructor(token) {
    if (!token) throw new Error('Thiếu ZALO_BOT_TOKEN');
    this._token = token;
  }

  async _goi(method, payload = {}) {
    let r;
    try {
      r = await fetch(`${API_GOC}${this._token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      // Không in e.message: có thể chứa URL kèm token
      throw new Error(`${method}: lỗi mạng (${e.name})`);
    }
    let data;
    try { data = await r.json(); } catch { throw new Error(`${method}: HTTP ${r.status}, không phải JSON`); }
    if (!data || typeof data !== 'object') throw new Error(`${method}: HTTP ${r.status}, JSON không đúng dạng`);
    if (!data.ok) throw new Error(`${method} thất bại: ${data.error_code ?? ''} ${data.description ?? ''}`.trim());
    return data.result;
  }

  getMe() { return this._goi('getMe'); }

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
}
