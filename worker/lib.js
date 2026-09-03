'use strict';

/* ============================================================
   つだつダイエット部 / worker/lib.js
   共通ユーティリティ・バリデーション・CORS・日付
   ============================================================ */

/* ---------- 定数 ---------- */
export const INACTIVE_DAYS = 14;   // 最後の記録から14日経過で「休止中」
export const NICK_MAX   = 12;      // ニックネーム
export const NAME_MAX   = 24;      // グループ名
export const REASON_MAX = 200;     // 通報理由（ニックネームとは別枠）
export const CODE_LEN   = 8;

// Crockford Base32：I L O U を含まない32文字。
// 「見間違い補正」はしない（U→V のような別コードへの化けを防ぐ）
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const ALLOWED = [
  'https://tdtd.la-kofu.workers.dev',
  'https://kimura-jane.github.io',
  'capacitor://localhost',
  'ionic://localhost',
  'https://localhost',        // androidScheme:"https" のときの WebView オリジン
  'http://localhost',
  'http://localhost:8788',
];

/* ---------- CORS / レスポンス ---------- */
export function corsHeaders(req) {
  const origin = req.headers.get('origin') || '';
  const h = {
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,x-device-id',
    'access-control-max-age': '86400',
    'vary': 'origin',
  };
  if (ALLOWED.includes(origin)) h['access-control-allow-origin'] = origin;
  return h;
}

export function preflight(req) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export function json(req, obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders(req),
    },
  });
}

export function bad(req, error, status = 400) {
  return json(req, { ok: false, error }, status);
}

export function notFound(req) {
  return json(req, { ok: false, error: 'not_found' }, 404);
}

/* ---------- 日付（JST固定） ---------- */
const JST = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
});

function partsToYmd(d) {
  const p = JST.formatToParts(d);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export function todayYmdJST() {
  return partsToYmd(new Date());
}

export function isYmd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return !Number.isNaN(Date.parse(s + 'T00:00:00+09:00'));
}

export function ymdToDay(ymd) {
  return Math.round(Date.parse(ymd + 'T00:00:00+09:00') / 86400000);
}

export function dayToYmd(day) {
  return partsToYmd(new Date(day * 86400000));
}

/* ---------- 数値 ---------- */
export function round1(v) {
  return Math.round(v * 10) / 10;
}

export function normKg(raw) {
  const v = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(v)) return null;
  const r = round1(v);
  if (r < 20 || r > 300) return null;
  return r;
}

/* ---------- 投稿内容フィルタ（Guideline 1.2）----------
   app.js 側と同じ判定をサーバでも行う。
   クライアントを通さず API を直接叩かれた場合の穴をふさぐのが目的。
   語を足したいときは NG_WORDS に追記する（app.js 側とそろえる）。 */
const NG_WORDS = [
  '死ね', 'しね', '殺す', 'ころす', 'ぶっ殺', '自殺しろ',
  'レイプ', '強姦', 'セックス', '売春', '風俗', '援交', '裏垢',
  'ちんこ', 'ちんぽ', 'まんこ', '射精', '中出し', 'ヤリマン', 'ヤリチン',
  'キチガイ', 'きちがい', '気違い', '池沼', 'カタワ', '知恵遅れ',
  'ゴキブリ以下', '消えろ', 'うんこ野郎',
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'porn', 'rape',
  'kill you', 'nigger', 'faggot',
];

const RE_CONTACT =
  /(https?:\/\/|www\.|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|line\s*id|ラインid|カカオ|@[a-z0-9_]{4,}|\d{10,})/i;

/* 表示名として使えない文字列なら true */
export function isBanned(raw) {
  const s = String(raw || '').normalize('NFKC').toLowerCase();
  if (!s) return false;
  if (RE_CONTACT.test(s)) return true;
  /* 記号・空白・区切りを抜いて素通りを防ぐ */
  const flat = s.replace(/[\s\u3000!-\/:-@\[-`{-~。、・゛゜「」…]/g, '');
  for (const w of NG_WORDS) {
    if (flat.includes(w.replace(/\s/g, ''))) return true;
  }
  return false;
}

/* ---------- 文字列 ---------- */
function stripCtrl(s) {
  return String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

export function normNickname(raw) {
  if (raw === null || raw === undefined) return null;
  const s = stripCtrl(raw).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const cut = [...s].slice(0, NICK_MAX).join('');
  if (isBanned(cut)) return null;
  return cut;
}

export function normGroupName(raw) {
  if (raw === null || raw === undefined) return null;
  const s = stripCtrl(raw).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const cut = [...s].slice(0, NAME_MAX).join('');
  if (isBanned(cut)) return null;
  return cut;
}

/* 通報理由は最大200文字。改行は残す（ニックネーム用関数を通さない）。
   不適切なニックネームの引用や、状況説明としてのURLを弾いてしまうと
   通報そのものができなくなるため、ここには NG 判定をかけない。 */
export function normReason(raw) {
  if (raw === null || raw === undefined) return null;
  const s = stripCtrl(raw).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!s) return null;
  return [...s].slice(0, REASON_MAX).join('');
}

/* ---------- 参加コード ----------
   大小文字・ハイフン・空白・全角だけを正規化する。
   O→0 / I→1 / U→V のような「推測変換」はしない。
   英数字以外や英数字でも辞書外の文字が入っていたら不正コードとして弾く。 */
export function normalizeCode(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw
    .normalize('NFKC')                                  // 全角英数→半角
    .replace(/[\s\u3000_\-\u2010-\u2015\u2212\uff0d]/g, '') // 空白・各種ハイフン・アンダースコア
    .toUpperCase();
  if (s.length !== CODE_LEN) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

export function fmtCode(code) {
  if (typeof code !== 'string' || code.length !== CODE_LEN) return code || '';
  return code.slice(0, 4) + '-' + code.slice(4);
}

/* ---------- ID生成（モジュロ偏りなし：32 | 256） ---------- */
export function genId(len) {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  let s = '';
  for (const n of b) s += CODE_ALPHABET[n & 31];
  return s;
}

export function genCode() {
  return genId(CODE_LEN);
}

/* ---------- レートリミット（未バインドなら常に許可） ---------- */
export async function rateOk(env, key) {
  if (!env || !env.JOIN_LIMITER || typeof env.JOIN_LIMITER.limit !== 'function') return true;
  try {
    const { success } = await env.JOIN_LIMITER.limit({ key: String(key) });
    return !!success;
  } catch {
    return true;
  }
}
