// Đăng ký webhook với Zalo (chỉ khi Worker có tên miền riêng, xem README):
//   ZALO_BOT_TOKEN=... WEBHOOK_SECRET=... WEBHOOK_URL=https://<tên miền>/webhook npm run webhook
// Hoặc điền ba biến đó vào .dev.vars rồi chạy `npm run webhook`.
// Xóa webhook để bot nhận tin bằng getUpdates: `npm run webhook -- --xoa`
import { readFileSync } from 'node:fs';
import { ZaloBot } from '../src/zalo.js';

function docDevVars() {
  try {
    return Object.fromEntries(
      readFileSync('.dev.vars', 'utf8').split('\n')
        .map((d) => d.trim()).filter((d) => d && !d.startsWith('#'))
        .map((d) => { const i = d.indexOf('='); return [d.slice(0, i).trim(), d.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
    );
  } catch { return {}; }
}

const env = { ...docDevVars(), ...process.env };
if (process.argv.includes('--xoa')) {
  if (!env.ZALO_BOT_TOKEN) { console.error('Thiếu biến: ZALO_BOT_TOKEN'); process.exit(1); }
  console.log(JSON.stringify(await new ZaloBot(env.ZALO_BOT_TOKEN).deleteWebhook(), null, 2));
  process.exit(0);
}
const thieu = ['ZALO_BOT_TOKEN', 'WEBHOOK_SECRET', 'WEBHOOK_URL'].filter((k) => !env[k]);
if (thieu.length) { console.error('Thiếu biến:', thieu.join(', ')); process.exit(1); }
if (!/^https:\/\//.test(env.WEBHOOK_URL)) { console.error('WEBHOOK_URL phải bắt đầu bằng https://'); process.exit(1); }

const zalo = new ZaloBot(env.ZALO_BOT_TOKEN);
const me = await zalo.getMe();
console.log('Bot:', me.display_name || me.account_name);
console.log('Đăng ký webhook:', env.WEBHOOK_URL);
console.log(JSON.stringify(await zalo.setWebhook(env.WEBHOOK_URL, env.WEBHOOK_SECRET), null, 2));
