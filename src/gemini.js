// Gọi Gemini qua REST (generateContent).

const API_GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/';
const MA_THU_LAI = new Set([429, 500, 502, 503, 504]);
const SO_LAN_THU = 2;

// Ghép text từ candidates[0]. Trả '' nếu bị chặn hoặc rỗng.
export function layChu(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('').trim();
}

export class Gemini {
  constructor(apiKey, model) {
    this._key = apiKey;
    this._model = model || 'gemini-2.5-flash';
  }

  get sanSang() { return Boolean(this._key); }

  async hoi(heThong, noiDung, { jsonMode = false, nhietDo = 0.5 } = {}) {
    if (!this._key) throw new Error('Chưa cấu hình GEMINI_API_KEY');
    const generationConfig = { temperature: nhietDo };
    if (jsonMode) generationConfig.responseMimeType = 'application/json';
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: heThong }] },
      contents: [{ role: 'user', parts: [{ text: noiDung }] }],
      generationConfig,
    });

    let loi = '';
    for (let lan = 1; lan <= SO_LAN_THU; lan++) {
      let r;
      try {
        r = await fetch(`${API_GEMINI}${this._model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this._key },
          body,
        });
      } catch (e) {
        loi = `lỗi mạng: ${e.name}`;
        continue;
      }
      if (r.ok) {
        const chu = layChu(await r.json());
        if (!chu) throw new Error('Gemini trả về rỗng (có thể bị chặn nội dung)');
        return chu;
      }
      loi = `HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`;
      if (!MA_THU_LAI.has(r.status)) throw new Error(loi);
    }
    throw new Error(loi);
  }
}
