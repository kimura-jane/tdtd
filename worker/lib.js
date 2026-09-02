// かなたけの CORS/JSON/日付ヘルパーを移植。Capacitor 用オリジンを追加。
const ALLOWED = [
  'https://kimura-jane.github.io',
  // ↓ 初回デプロイ後に出る workers.dev の URL に差し替える
  'https://tdtd.kimura-jane.workers.dev',
  'capacitor://localhost',   // iOS WebView
  'http://localhost',        // Android WebView
];
const FALLBACK = ALLOWED[0];

export function pickOrigin(request) {
  const o = request.headers.get('Origin') || '';
  return ALLOWED.includes(o) ? o : FALLBACK;
}
export function corsHeaders(allowOrigin) {
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,x-device-id',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
}
export function json(obj, status, allowOrigin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...corsHeaders(allowOrigin),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/* ---- JST 日付（send.js の getTomorrowYmdJST と同じ作り） ---- */
const JST = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
});
export function todayYmdJST(d = new Date()) {
  const p = JST.formatToParts(d);
  const g = t => p.find(x => x.type === t)?.value;
  const [y, m, day] = [g('year'), g('month'), g('day')];
  if (!y || !m || !day) throw new Error('Failed to format JST date');
  return `${y}-${m}-${day}`;
}
export function isValidYmd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s + 'T00:00:00+09:00');
  if (!Number.isFinite(t)) return false;
  return todayYmdJST(new Date(t)) === s;   // 2026-02-30 のような値を弾く
}
export const nowIso = () => new Date().toISOString();

/* ---- sha256Hex（subscribe.js から） ---- */
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ---- Crockford's Base32（O I L U を除く32文字） ---- */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function randomCode(len) {
  const buf = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const b of buf) s += B32[b % 32];
  return s;
}
export function normalizeCode(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.toUpperCase().replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(s) ? s : null;
}

/* ---- 検証 ---- */
export function normKg(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n * 10) / 10;
  return (r >= 20 && r <= 300) ? r : null;
}
export function normNickname(v) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, '')
             .replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const arr = [...s];
  return arr.length > 12 ? arr.slice(0, 12).join('') : s;
}

/* ---- 認証 ---- */
export async function auth(request, env) {
  const id = request.headers.get('x-device-id') || '';
  if (!/^dev_[0-9a-fA-F-]{36}$/.test(id)) return { error: 'bad_device_id', status: 401 };
  const row = await env.DB.prepare('SELECT * FROM devices WHERE device_id = ?')
    .bind(id).first();
  if (!row) return { error: 'not_registered', status: 404 };
  if (row.banned) return { error: 'banned', status: 403 };
  return { me: row };
}

/* ---- レート制限（Workers のバインディング。period は 10 か 60 のみ） ---- */
export async function rateOk(env, key) {
  if (!env.JOIN_LIMITER) return true;
  const { success } = await env.JOIN_LIMITER.limit({ key });
  return success;
}

/* ---- device_id は絶対に返さない ---- */
export function pubMe(r) {
  return {
    member_id: r.member_id, nickname: r.nickname, icon_ver: r.icon_ver,
    group_id: r.group_id, goal_weight: r.goal_weight,
    notify: { on: !!r.notify_on, days: r.notify_days, hour: r.notify_hour },
  };
}
