// Gọi Gemini qua REST (generateContent).

const API_GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/';
const MA_THU_LAI = new Set([500, 502, 503, 504]);
// 404: model bị Google tắt; 429: hết quota của model đó -> thử model kế tiếp
const MA_DOI_MODEL = new Set([404, 429]);
const SO_LAN_THU = 2;
// gemini-flash-latest là bí danh luôn trỏ về bản Flash hiện hành, ít bị "chết" nhất
export const MODEL_MAC_DINH = 'gemini-flash-latest';
export const MODEL_DU_PHONG = ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];
// Tra Google Maps (grounding) chỉ có quota free trên các bản Flash-Lite
export const MODEL_BAN_DO = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];

// Ghép text từ candidates[0]. Trả '' nếu bị chặn hoặc rỗng.
export function layChu(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('').trim();
}

export class Gemini {
  constructor(apiKey, model) {
    this._key = apiKey;
    // Model cấu hình đứng đầu, sau đó tới các model dự phòng (bỏ trùng)
    this._models = [...new Set([(model || '').trim() || MODEL_MAC_DINH, ...MODEL_DU_PHONG])];
  }

  get sanSang() { return Boolean(this._key); }

  // banDo = true: cho Gemini tra Google Maps để tìm quán có thật. Hết quota thì tự hỏi lại không kèm bản đồ.
  async hoi(heThong, noiDung, { jsonMode = false, nhietDo = 0.5, banDo = false } = {}) {
    if (!this._key) throw new Error('Chưa cấu hình GEMINI_API_KEY');
    if (banDo) {
      try {
        return await this._hoiModels(MODEL_BAN_DO, heThong, noiDung, { nhietDo, tools: [{ google_maps: {} }] });
      } catch (e) {
        console.warn('Không tra được Google Maps, trả lời không kèm bản đồ:', e.message);
      }
    }
    return this._hoiModels(this._models, heThong, noiDung, { jsonMode, nhietDo });
  }

  async _hoiModels(models, heThong, noiDung, { jsonMode = false, nhietDo = 0.5, tools = null } = {}) {
    const generationConfig = { temperature: nhietDo };
    if (jsonMode) generationConfig.responseMimeType = 'application/json';
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: heThong }] },
      contents: [{ role: 'user', parts: [{ text: noiDung }] }],
      generationConfig,
      ...(tools ? { tools } : {}),
    });

    let loi = '';
    for (const model of models) {
      for (let lan = 1; lan <= SO_LAN_THU; lan++) {
        let r;
        try {
          r = await fetch(`${API_GEMINI}${model}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this._key },
            body,
          });
        } catch (e) {
          loi = `${model}: lỗi mạng: ${e.name}`;
          continue;
        }
        if (r.ok) {
          const chu = layChu(await r.json());
          if (!chu) throw new Error(`${model}: Gemini trả về rỗng (có thể bị chặn nội dung)`);
          return chu;
        }
        loi = `${model}: HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`;
        if (MA_DOI_MODEL.has(r.status)) { console.warn('Gemini đổi model dự phòng:', loi); break; }
        if (!MA_THU_LAI.has(r.status)) throw new Error(loi);
      }
    }
    throw new Error(loi);
  }
}
