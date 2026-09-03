'use strict';

/* ============================================================
   みんやせ / app.js
   2026-09-03 審査対応版
   ・API 宛先を window.MINYASE_API_BASE から取得（Capacitor 対応）
   ・prompt / confirm / alert を .ov/.sheet ベースのシートUIへ置換
   ・投稿内容フィルタ（NG語・連絡先混入）追加：Guideline 1.2
   ・通報→ブロック導線、初回同意ゲート追加
   ・規約/プライバシーはアプリ内オーバーレイで開く（戻れない問題の解消）
   ・index.html / style.css の ID・クラスは一切増やしていない
   ============================================================ */

/* ===== API ===== */
/* index.html 側で
   window.MINYASE_API_BASE =
     location.hostname === 'tdtd.la-kofu.workers.dev' ? '' : 'https://tdtd.la-kofu.workers.dev';
   を定義している。アプリ（capacitor://localhost）では絶対URLになる。 */
const API = (typeof window !== 'undefined' && window.MINYASE_API_BASE) || '';

const K_DEV = 'tsudatsu.device_id.v1';   /* 変更禁止 */
const K_AGREE = 'minyase.agreed.v1';     /* 初回同意の記録 */
const AGREE_VER = '2026-09-03';

const ICON_SIZE = 256;                   /* 正方形クロップ後の一辺 */
const ICON_LIMIT = 280 * 1024;           /* Worker 側の上限(300KB)より内側 */
const CANCELED = 'canceled';             /* 切り取りをやめたときの内部合図 */
const API_TIMEOUT = 15000;               /* 通信のタイムアウト(ms) */

/* randomUUID は Safari 15.4 以降。古い端末向けにフォールバックを持つ */
function uuid() {
  if (crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(n => n.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function deviceId() {
  let v = localStorage.getItem(K_DEV);
  if (!v) {
    v = 'dev_' + uuid();
    localStorage.setItem(K_DEV, v);
  }
  return v;
}

function withTimeout(ms) {
  if (typeof AbortController !== 'function') return { signal: undefined, done: () => {} };
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

async function api(path, opt = {}) {
  const t = withTimeout(API_TIMEOUT);
  let res;
  try {
    res = await fetch(API + path, {
      method: opt.method || 'GET',
      headers: { 'content-type': 'application/json', 'x-device-id': deviceId() },
      body: opt.body !== undefined ? JSON.stringify(opt.body) : undefined,
      cache: 'no-store',
      signal: t.signal,
    });
  } catch (e) {
    throw new Error(e && e.name === 'AbortError' ? 'timeout' : 'network_error');
  } finally {
    t.done();
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok || data.ok === false) throw new Error(data.error || ('http_' + res.status));
  return data;
}

/* 画像は JSON ではなく生バイトで送る */
async function apiBlob(path, blob, method = 'POST') {
  const t = withTimeout(API_TIMEOUT * 2);
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: { 'content-type': 'image/jpeg', 'x-device-id': deviceId() },
      body: blob,
      cache: 'no-store',
      signal: t.signal,
    });
  } catch (e) {
    throw new Error(e && e.name === 'AbortError' ? 'timeout' : 'network_error');
  } finally {
    t.done();
  }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok || data.ok === false) throw new Error(data.error || ('http_' + res.status));
  return data;
}

/* ===== エラー文言 ===== */
const ERR = {
  /* 通信 */
  network_error: '通信できませんでした。電波状況をご確認ください',
  timeout: '通信に時間がかかりすぎました。もう一度お試しください',

  /* 端末・アカウント */
  bad_device_id: '端末IDが不正です',
  not_registered: '登録が見つかりません。再読み込みしてください',
  banned: 'このアカウントは利用できません',

  /* 記録 */
  bad_kg: '体重の値が不正です',
  bad_ymd: '日付が不正です',
  future_ymd: '未来の日付は登録できません',

  /* グループ */
  bad_code: 'コードは8文字です',
  group_not_found: 'そのコードのグループはありません',
  banned_from_group: 'このグループには参加できません',
  already_in_group: 'すでにグループに参加しています',
  not_in_group: 'グループに参加していません',
  group_full: 'グループが満員です',
  not_owner: 'オーナーだけが操作できます',
  owner_must_dissolve: 'オーナーは解散を使ってください',
  own_group: '自分のグループです',
  bad_name: '名前を入力してください',
  bad_nickname: 'ニックネームを入力してください',
  bad_member_id: '相手を特定できませんでした',
  bad_reason: '通報理由を入力してください',
  bad_notify: '通知設定の値が不正です',
  member_not_found: 'その人は見つかりません',
  not_watching: 'このチームは登録されていません',
  self_not_allowed: '自分は対象にできません',
  cannot_kick_self: '自分は除名できません',
  nothing_to_update: '変更点がありません',

  /* 制限 */
  rate_limited: '操作が多すぎます。1分ほど待ってください',
  too_many_requests: '操作が多すぎます。1分ほど待ってください',

  /* 画像 */
  not_jpeg: '画像を変換できませんでした。別の写真でお試しください',
  icon_too_large: '画像が大きすぎます。別の写真でお試しください',
  icon_empty: '画像を読み込めませんでした',
  no_bucket: '画像の保存先が未設定です',
  not_image: '画像ファイルを選んでください',
  bad_image: '画像を読み込めませんでした',

  /* 端末側フィルタ（Guideline 1.2） */
  ng_word: 'この表現は登録できません。別の言葉に変えてください',
  has_contact: 'URL・メールアドレス・電話番号・SNSのIDは入れられません',

  /* 管理・入出力（管理画面と共通のコード） */
  unauthorized: '認証できませんでした',
  no_admin_token: '管理用の設定がされていません',
  private_group_admin_only: '非公開グループのため表示できません',
  admin_only: '管理者だけが操作できます',
  bad_format: '書式が正しくありません',
  csv_empty: 'CSVの中身が空です',
  csv_header_invalid: 'CSVの見出し行が正しくありません',
  import_too_large: 'ファイルが大きすぎます（2MBまで）',
  new_device_not_empty: '移行先の端末にすでにデータがあります',

  server_error: 'サーバーエラーが発生しました',
};
const emsg = e => ERR[e.message] || ('エラー（' + e.message + '）');

/* ===== 投稿内容フィルタ（Guideline 1.2）=====
   ニックネーム・グループ名・通報理由に適用する。
   語を足したいときは NG_WORDS に追記するだけでよい。 */
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

function moderate(raw) {
  const s = String(raw || '').normalize('NFKC').toLowerCase();
  if (!s) return null;
  if (RE_CONTACT.test(s)) return 'has_contact';
  /* 記号・空白・区切りを抜いて素通りを防ぐ */
  const flat = s.replace(/[\s\u3000!-\/:-@\[-`{-~。、・゛゜「」…]/g, '');
  for (const w of NG_WORDS) {
    if (flat.includes(w.replace(/\s/g, ''))) return 'ng_word';
  }
  return null;
}

/* ===== キャッシュ ===== */
const cache = {
  weights: {}, goal: null, me: null, group: null,
  watching: [], blocks: [], ready: false,
};

const store = {
  all() { return cache.weights; },
  put(ymd, kg) {
    const before = cache.weights[ymd];
    cache.weights[ymd] = kg;
    api('/api/weights', { method: 'POST', body: { ymd, kg } })
      .then(() => { if (cache.group) loadRanking(); })
      .catch(err => {
        if (before === undefined) delete cache.weights[ymd]; else cache.weights[ymd] = before;
        renderLog(); say(el.msg, '保存できませんでした：' + emsg(err), false);
      });
  },
  del(ymd) {
    const before = cache.weights[ymd];
    delete cache.weights[ymd];
    api('/api/weights/' + encodeURIComponent(ymd), { method: 'DELETE' })
      .then(() => { if (cache.group) loadRanking(); })
      .catch(err => {
        if (before !== undefined) cache.weights[ymd] = before;
        renderLog(); say(el.msg, '削除できませんでした：' + emsg(err), false);
      });
  },
  goal() { return cache.goal; },
  setGoal(v) {
    const before = cache.goal;
    cache.goal = v;
    api('/api/me', { method: 'PATCH', body: { goal_weight: v } })
      .catch(err => {
        cache.goal = before; renderLog();
        say(el.mmsg, '目標を保存できませんでした：' + emsg(err), false);
      });
  },
};

/* ===== JST 日付 ===== */
const JST_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
});

function todayYmdJST() {
  const p = JST_FMT.formatToParts(new Date());
  const g = t => p.find(x => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

function ymdToDay(ymd) {
  return Math.round(Date.parse(ymd + 'T00:00:00+09:00') / 86400000);
}

function dayToYmd(day) {
  const p = JST_FMT.formatToParts(new Date(day * 86400000));
  const g = t => p.find(x => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

function fmtJp(ymd) {
  const [, m, d] = ymd.split('-');
  return `${Number(m)}月${Number(d)}日`;
}

function fmtJpFull(ymd) {
  const [y, m, d] = ymd.split('-');
  return `${y}年${Number(m)}月${Number(d)}日`;
}

function normKg(raw) {
  const v = parseFloat(raw);
  if (!Number.isFinite(v)) return null;
  const r = Math.round(v * 10) / 10;
  return (r >= 20 && r <= 300) ? r : null;
}

/* Worker は code を "ABCD-1234" 形式で返す。二重にハイフンを入れない */
function fmtCode(c) {
  if (!c) return '—';
  const s = String(c).toUpperCase().replace(/[^0-9A-Z]/g, '');
  return s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4) : String(c);
}

function rawCode(c) {
  return String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/* 減量幅の表示：正 = 減った */
function signKg(v) {
  if (v === null || v === undefined) return '—';
  if (v > 0) return '−' + Math.abs(v).toFixed(1) + 'kg';
  if (v < 0) return '+' + Math.abs(v).toFixed(1) + 'kg';
  return '±0.0kg';
}

/* ===== 要素 ===== */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const state = { period: 'week', offset: 0, view: 'log', rank: 'mine', watchId: null };

const el = {
  hdTitle: $('#hdTitle'),
  todayLabel: $('#todayLabel'), kgInput: $('#kgInput'), msg: $('#msg'),
  pastBox: $('#pastBox'), pastYmd: $('#pastYmd'), pastKg: $('#pastKg'),
  chart: $('#chart'), rangeLabel: $('#rangeLabel'), summary: $('#summary'),
  hist: $('#hist'), tabs: $('#periodTabs'),

  viewGroup: $('#view-group'),
  noGroupBox: $('#noGroupBox'), joinCode: $('#joinCode'),
  newGroupName: $('#newGroupName'), newStartYmd: $('#newStartYmd'), newShowWeight: $('#newShowWeight'),
  gmsg: $('#gmsg'),
  myGroupBox: $('#myGroupBox'), gName: $('#gName'), gMeta: $('#gMeta'),
  gCodeBox: $('#gCodeBox'), gCode: $('#gCode'),
  ownerTools: $('#ownerTools'), memberTools: $('#memberTools'), gmsg2: $('#gmsg2'),
  rankBox: $('#rankBox'), rankTabs: $('#rankTabs'), rankHead: $('#rankHead'),
  rankList: $('#rankList'), rmsg: $('#rmsg'),
  watchNav: $('#watchNav'), watchSel: $('#watchSel'),

  nickInput: $('#nickInput'), goalInput: $('#goalInput'), mmsg: $('#mmsg'),
  notifyOn: $('#notifyOn'), notifyDays: $('#notifyDays'), notifyHour: $('#notifyHour'), nmsg: $('#nmsg'),
  blockList: $('#blockList'),
  myMemberId: $('#myMemberId'), myDeviceId: $('#myDeviceId'), dmsg: $('#dmsg'),

  iconBox: $('#iconBox'), iconFile: $('#iconFile'), iconPick: $('#iconPick'),
  iconDel: $('#iconDel'), imsg: $('#imsg'),

  cropOv: $('#cropOv'), cropCv: $('#cropCv'), cropZoom: $('#cropZoom'),
  cropOk: $('#cropOk'), cropCancel: $('#cropCancel'),
};

const timers = new WeakMap();

function say(node, text, ok) {
  if (!node) return;
  node.textContent = text;
  node.className = 'msg ' + (ok ? 'ok' : 'ng');
  clearTimeout(timers.get(node));
  timers.set(node, setTimeout(() => {
    node.textContent = '';
    node.className = 'msg';
  }, 3600));
}

function clearMsg(node) {
  if (!node) return;
  clearTimeout(timers.get(node));
  node.textContent = '';
  node.className = 'msg';
}

/* ============================================================
   シートUI（prompt / confirm / alert の置き換え）
   style.css の .ov / .sheet / .h2 / .note / .past-row /
   .primary / .ghost / .danger をそのまま使う。
   新しいクラスやIDは作らない。
   ============================================================ */
const INPUT_STYLE =
  'width:100%;padding:14px 15px;font-size:16px;font-weight:500;font-family:inherit;' +
  'color:#191714;background:#faf8f5;border:1.5px solid #f1ece4;border-radius:16px;' +
  '-webkit-appearance:none;appearance:none;';

function sheetOpen(title, note) {
  const ov = document.createElement('div');
  ov.className = 'ov';

  const sh = document.createElement('div');
  sh.className = 'sheet';
  sh.style.textAlign = 'left';

  if (title) {
    const h = document.createElement('h2');
    h.className = 'h2';
    h.textContent = title;
    sh.appendChild(h);
  }
  if (note) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = note;
    sh.appendChild(p);
  }

  ov.appendChild(sh);
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';

  const close = () => {
    ov.remove();
    if (!document.querySelector('.ov:not([hidden])')) {
      document.body.style.overflow = '';
    }
  };

  return { ov, sh, close };
}

function sheetRow(sh) {
  const d = document.createElement('div');
  d.className = 'past-row';
  d.style.justifyContent = 'flex-end';
  sh.appendChild(d);
  return d;
}

function sheetBtn(row, label, cls) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  row.appendChild(b);
  return b;
}

/* はい / いいえ */
function confirmSheet(title, note, okLabel, danger) {
  return new Promise(resolve => {
    const { sh, close } = sheetOpen(title, note);
    const row = sheetRow(sh);
    const ok = sheetBtn(row, okLabel || 'OK', danger ? 'danger sm' : 'primary sm');
    const no = sheetBtn(row, 'やめる', 'ghost sm');
    ok.onclick = () => { close(); resolve(true); };
    no.onclick = () => { close(); resolve(false); };
    setTimeout(() => ok.focus(), 30);
  });
}

/* 通知だけ（alert の代わり） */
function alertSheet(title, note, okLabel) {
  return new Promise(resolve => {
    const { sh, close } = sheetOpen(title, note);
    const row = sheetRow(sh);
    const ok = sheetBtn(row, okLabel || 'OK', 'primary sm');
    ok.onclick = () => { close(); resolve(); };
    setTimeout(() => ok.focus(), 30);
  });
}

/* 文字・数値・日付の入力（prompt の代わり）。取り消しは null */
function promptSheet(o) {
  return new Promise(resolve => {
    const { sh, close } = sheetOpen(o.title, o.note);

    let inp;
    if (o.multiline) {
      inp = document.createElement('textarea');
      inp.rows = 4;
      inp.style.cssText = INPUT_STYLE + 'min-height:104px;line-height:1.6;resize:vertical;';
    } else {
      inp = document.createElement('input');
      inp.type = o.type || 'text';
      if (o.type === 'number') {
        inp.step = o.step || '0.1';
        inp.inputMode = 'decimal';
        if (o.min !== undefined) inp.min = String(o.min);
        if (o.max !== undefined) inp.max = String(o.max);
      }
      if (o.type === 'date' && o.max) inp.max = o.max;
      inp.style.cssText = INPUT_STYLE;
    }

    if (o.maxlength) inp.maxLength = o.maxlength;
    if (o.placeholder) inp.placeholder = o.placeholder;
    if (o.upper) { inp.autocapitalize = 'characters'; inp.autocomplete = 'off'; }
    inp.value = o.value === undefined || o.value === null ? '' : String(o.value);

    const wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.appendChild(inp);
    sh.appendChild(wrap);

    const err = document.createElement('p');
    err.className = 'msg';
    sh.appendChild(err);

    const row = sheetRow(sh);
    const ok = sheetBtn(row, o.ok || '決定', 'primary sm');
    const no = sheetBtn(row, 'やめる', 'ghost sm');

    const submit = () => {
      const v = inp.value;
      if (o.validate) {
        const bad = o.validate(v);
        if (bad) {
          err.textContent = bad;
          err.className = 'msg ng';
          return;
        }
      }
      close();
      resolve(v);
    };

    ok.onclick = submit;
    no.onclick = () => { close(); resolve(null); };

    if (!o.multiline) {
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });
    }

    setTimeout(() => { inp.focus(); }, 60);
  });
}

/* 一覧から選ぶ（番号入力の置き換え）。取り消しは -1 */
function menuSheet(title, note, items) {
  return new Promise(resolve => {
    const { sh, close } = sheetOpen(title, note);

    const list = document.createElement('div');
    list.style.cssText =
      'display:flex;flex-direction:column;gap:8px;margin:16px 0 4px;' +
      'max-height:52vh;overflow:auto;-webkit-overflow-scrolling:touch;';

    items.forEach((it, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = it.danger ? 'danger' : 'ghost';
      b.textContent = it.label;
      b.style.cssText = 'width:100%;text-align:left;';
      b.onclick = () => { close(); resolve(i); };
      list.appendChild(b);
    });

    sh.appendChild(list);

    const row = sheetRow(sh);
    const no = sheetBtn(row, '閉じる', 'ghost sm');
    no.onclick = () => { close(); resolve(-1); };
  });
}

/* 規約・プライバシーをアプリ内で開く。
   Capacitor には戻るボタンが無いため、遷移させず iframe で重ねる。 */
function docSheet(url, title) {
  const { sh, close } = sheetOpen(title, null);

  const fr = document.createElement('iframe');
  fr.src = url;
  fr.setAttribute('title', title);
  fr.style.cssText =
    'width:100%;height:min(68vh,540px);margin:14px 0 4px;border:0;' +
    'border-radius:16px;background:#fff;';
  sh.appendChild(fr);

  const row = sheetRow(sh);
  const ok = sheetBtn(row, '閉じる', 'primary sm');
  ok.onclick = close;
}

/* index.html の <a href="./terms.html"> などを横取りする */
document.addEventListener('click', e => {
  const t = e.target;
  const a = t && t.closest ? t.closest('a[href]') : null;
  if (!a) return;
  const href = a.getAttribute('href') || '';
  const m = /^(?:\.\/)?(terms|privacy)\.html$/.exec(href);
  if (!m) return;
  e.preventDefault();
  docSheet(
    href,
    m[1] === 'privacy' ? 'プライバシーポリシー' : '利用規約'
  );
}, true);

/* ===== 初回同意（登録APIを走らせる前に出す） ===== */
function agreed() {
  return localStorage.getItem(K_AGREE) === AGREE_VER;
}

function agreeSheet() {
  return new Promise(resolve => {
    const { sh, close } = sheetOpen(
      'ご利用の前に',
      'みんやせは、あなたが入力した体重と、グループのメンバーに見せる' +
      'ニックネームやプロフィール画像をサーバーに保存します。'
    );

    const p2 = document.createElement('p');
    p2.className = 'note';
    p2.textContent =
      '13歳未満の方はご利用いただけません。' +
      '他の人を傷つける表現、性的な内容、他人の写真や連絡先の掲載は禁止です。' +
      '違反を見つけたときは各メンバーの「⋯」から通報とブロックができます。';
    sh.appendChild(p2);

    const links = document.createElement('p');
    links.className = 'note';
    links.style.marginTop = '12px';

    const a1 = document.createElement('a');
    a1.href = './terms.html';
    a1.textContent = '利用規約';
    const a2 = document.createElement('a');
    a2.href = './privacy.html';
    a2.textContent = 'プライバシーポリシー';

    links.append(a1, document.createTextNode('　／　'), a2);
    sh.appendChild(links);

    const row = sheetRow(sh);
    const ok = sheetBtn(row, '同意して始める', 'primary sm');
    const no = sheetBtn(row, '同意しない', 'ghost sm');

    ok.onclick = () => {
      localStorage.setItem(K_AGREE, AGREE_VER);
      close();
      resolve(true);
    };

    no.onclick = () => {
      close();
      resolve(false);
    };
  });
}

async function ensureAgreed() {
  if (agreed()) return true;
  for (;;) {
    if (await agreeSheet()) return true;
    await alertSheet(
      '同意が必要です',
      '利用規約とプライバシーポリシーに同意いただけない場合、みんやせはご利用いただけません。'
    );
  }
}

/* ===== アイコン ===== */
function canvasToBlob(cv, q) {
  return new Promise(r => cv.toBlob(r, 'image/jpeg', q));
}

function loadImageEl(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); res(im); };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad_image')); };
    im.src = url;
  });
}

async function loadImageAny(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* 非対応ブラウザは <img> にフォールバック */
    }
  }
  return await loadImageEl(file);
}

/* 切り取り画面。決定すると元画像上の切り取り範囲を返す */
function cropDialog(img) {
  return new Promise((resolve, reject) => {
    const ov = el.cropOv, cv = el.cropCv, zoom = el.cropZoom;
    const ok = el.cropOk, cancel = el.cropCancel;

    const S = Math.max(200, Math.min(320, window.innerWidth - 96));
    const dpr = window.devicePixelRatio || 1;
    cv.style.width = S + 'px';
    cv.style.height = S + 'px';
    cv.width = Math.round(S * dpr);
    cv.height = Math.round(S * dpr);
    const ctx = cv.getContext('2d');

    const iw = img.width, ih = img.height;
    const base = Math.max(S / iw, S / ih);
    let z = 1, tx = 0, ty = 0;

    const clamp = () => {
      const dw = iw * base * z, dh = ih * base * z;
      tx = Math.min(0, Math.max(S - dw, tx));
      ty = Math.min(0, Math.max(S - dh, ty));
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, S, S);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, tx, ty, iw * base * z, ih * base * z);
    };

    const setZoom = (nz, ax, ay) => {
      nz = Math.min(4, Math.max(1, nz));
      const k = nz / z;
      tx = ax - (ax - tx) * k;
      ty = ay - (ay - ty) * k;
      z = nz;
      clamp();
      draw();
      zoom.value = String(Math.round(z * 100));
    };

    tx = (S - iw * base) / 2;
    ty = (S - ih * base) / 2;
    clamp();
    draw();
    zoom.value = '100';

    const pts = new Map();
    let lastDist = 0;

    const onDown = e => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      lastDist = 0;
    };

    const onMove = e => {
      if (!pts.has(e.pointerId)) return;
      e.preventDefault();

      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const arr = [...pts.values()];

      if (arr.length >= 2) {
        const d = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
        const r = cv.getBoundingClientRect();
        const mx = (arr[0].x + arr[1].x) / 2 - r.left;
        const my = (arr[0].y + arr[1].y) / 2 - r.top;
        if (lastDist) setZoom(z * d / lastDist, mx, my);
        lastDist = d;
      } else {
        tx += e.clientX - prev.x;
        ty += e.clientY - prev.y;
        clamp();
        draw();
      }
    };

    const onUp = e => { pts.delete(e.pointerId); lastDist = 0; };

    const onWheel = e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      setZoom(z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top);
    };

    const onSlider = () => setZoom(Number(zoom.value) / 100, S / 2, S / 2);

    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove, { passive: false });
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('wheel', onWheel, { passive: false });
    zoom.addEventListener('input', onSlider);

    const close = () => {
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointercancel', onUp);
      cv.removeEventListener('wheel', onWheel);
      zoom.removeEventListener('input', onSlider);
      ok.onclick = null;
      cancel.onclick = null;
      ov.hidden = true;
      if (!document.querySelector('.ov:not([hidden])')) {
        document.body.style.overflow = '';
      }
    };

    ok.onclick = () => {
      const scale = base * z;
      const rect = { sx: -tx / scale, sy: -ty / scale, sw: S / scale, sh: S / scale };
      close();
      resolve(rect);
    };

    cancel.onclick = () => { close(); reject(new Error(CANCELED)); };

    ov.hidden = false;
    document.body.style.overflow = 'hidden';
  });
}

/* 切り取り範囲を256pxへ縮小してJPEG化。処理はすべて端末側で行う */
async function fileToIconBlob(file) {
  if (!file) throw new Error('bad_image');
  if (file.type && !/^image\//.test(file.type)) throw new Error('not_image');

  const img = await loadImageAny(file);

  try {
    const iw = img.width, ih = img.height;
    if (!iw || !ih) throw new Error('bad_image');

    let rect;

    if (el.cropOv && el.cropCv && el.cropZoom && el.cropOk && el.cropCancel) {
      rect = await cropDialog(img);
    } else {
      const s = Math.min(iw, ih);
      rect = { sx: (iw - s) / 2, sy: (ih - s) / 2, sw: s, sh: s };
    }

    const cv = document.createElement('canvas');
    cv.width = ICON_SIZE;
    cv.height = ICON_SIZE;

    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ICON_SIZE, ICON_SIZE);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, ICON_SIZE, ICON_SIZE);

    let q = 0.85;
    let blob = await canvasToBlob(cv, q);

    while (blob && blob.size > ICON_LIMIT && q > 0.4) {
      q -= 0.15;
      blob = await canvasToBlob(cv, q);
    }

    if (!blob) throw new Error('bad_image');
    return blob;
  } finally {
    if (img.close) img.close();
  }
}

function initialOf(row) {
  const n = String((row && row.nickname) || '').trim();
  return n ? [...n][0] : '?';
}

/* 丸アイコン。CSS 未更新でも見た目が崩れないよう最低限の指定を入れる */
function avatar(row, size) {
  const px = size || 36;
  const d = document.createElement('div');

  d.className = 'av';
  d.style.cssText =
    `width:${px}px;height:${px}px;flex:0 0 auto;border-radius:50%;overflow:hidden;` +
    `background:#ece7e2;display:flex;align-items:center;justify-content:center;` +
    `font-weight:700;color:#a8998f;font-size:${Math.round(px * 0.42)}px;line-height:1;`;

  if (row && row.icon_url) {
    const im = document.createElement('img');
    im.src = API + row.icon_url;
    im.alt = '';
    im.loading = 'lazy';
    im.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    im.onerror = () => { im.remove(); d.textContent = initialOf(row); };
    d.appendChild(im);
  } else {
    d.textContent = initialOf(row);
  }

  return d;
}

function renderIcon() {
  if (!el.iconBox) return;
  el.iconBox.innerHTML = '';
  el.iconBox.appendChild(avatar(cache.me || {}, 72));
  if (el.iconDel) el.iconDel.hidden = !(cache.me && cache.me.icon_url);
}

async function uploadIcon(file) {
  if (!cache.ready) {
    say(el.imsg, 'サーバーに接続中です', false);
    return;
  }

  try {
    const blob = await fileToIconBlob(file);
    say(el.imsg, 'アップロード中…', true);

    const d = await apiBlob('/api/icon', blob);

    if (cache.me) {
      cache.me.icon_ver = d.icon_ver;
      cache.me.icon_url = d.icon_url;
    }

    renderIcon();
    if (cache.group || state.rank === 'rival') loadRanking();

    say(el.imsg, 'アイコンを設定しました', true);
  } catch (e) {
    if (e && e.message === CANCELED) clearMsg(el.imsg);
    else say(el.imsg, emsg(e), false);
  }
}

async function removeIcon() {
  if (!await confirmSheet('アイコンの削除', 'プロフィール画像を削除します。', '削除する', true)) return;

  try {
    await api('/api/icon', { method: 'DELETE' });

    if (cache.me) {
      cache.me.icon_ver = 0;
      cache.me.icon_url = null;
    }

    renderIcon();
    if (cache.group || state.rank === 'rival') loadRanking();

    say(el.imsg, 'アイコンを削除しました', true);
  } catch (e) {
    say(el.imsg, emsg(e), false);
  }
}

/* ===== 保存 ===== */
function saveWeight(ymd, kg) {
  if (!cache.ready) {
    say(el.msg, 'サーバーに接続中です', false);
    return false;
  }

  if (ymd > todayYmdJST()) {
    say(el.msg, '未来の日付は登録できません', false);
    return false;
  }

  const v = normKg(kg);

  if (v === null) {
    say(el.msg, '体重を 20〜300kg で入力してください', false);
    return false;
  }

  store.put(ymd, v);
  renderLog();
  say(el.msg, `${fmtJp(ymd)} を ${v.toFixed(1)}kg で記録しました`, true);
  return true;
}

/* ===== 期間 ===== */
function currentRange() {
  const today = todayYmdJST();
  const tDay = ymdToDay(today);
  const [ty, tm] = today.split('-').map(Number);

  if (state.period === 'week') {
    const end = tDay + state.offset * 7;
    return {
      from: end - 6,
      to: end,
      label: `${fmtJp(dayToYmd(end - 6))} 〜 ${fmtJp(dayToYmd(end))}`
    };
  }

  if (state.period === 'month') {
    let y = ty, m = tm + state.offset;
    y += Math.floor((m - 1) / 12);
    m = ((m - 1) % 12 + 12) % 12 + 1;

    const mm = String(m).padStart(2, '0');
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();

    return {
      from: ymdToDay(`${y}-${mm}-01`),
      to: ymdToDay(`${y}-${mm}-${String(lastDay).padStart(2, '0')}`),
      label: `${y}年${m}月`
    };
  }

  if (state.period === 'year') {
    const y = ty + state.offset;
    return {
      from: ymdToDay(`${y}-01-01`),
      to: ymdToDay(`${y}-12-31`),
      label: `${y}年`
    };
  }

  const keys = Object.keys(store.all()).sort();

  if (!keys.length) {
    return { from: tDay - 6, to: tDay, label: '全期間' };
  }

  return {
    from: ymdToDay(keys[0]),
    to: Math.max(ymdToDay(keys[keys.length - 1]), tDay),
    label: `${fmtJpFull(keys[0])} 〜`
  };
}

/* ===== グラフ ===== */
function drawChart() {
  const c = el.chart, ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  const cssW = c.clientWidth, cssH = 240;
  c.width = Math.round(cssW * dpr);
  c.height = Math.round(cssH * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const pad = { l: 42, r: 12, t: 14, b: 24 };
  const W = cssW - pad.l - pad.r;
  const H = cssH - pad.t - pad.b;
  const all = store.all();
  const { from, to } = currentRange();

  const pts = Object.keys(all)
    .map(ymd => ({ ymd, day: ymdToDay(ymd), kg: all[ymd] }))
    .filter(p => p.day >= from && p.day <= to)
    .sort((a, b) => a.day - b.day);

  const before = Object.keys(all)
    .map(ymd => ({ day: ymdToDay(ymd), kg: all[ymd] }))
    .filter(p => p.day < from)
    .sort((a, b) => a.day - b.day)
    .pop();

  ctx.font = '10px -apple-system,sans-serif';
  ctx.textBaseline = 'middle';

  if (!pts.length && !before) {
    ctx.fillStyle = '#8a8a8a';
    ctx.textAlign = 'center';
    ctx.fillText(
      cache.ready ? 'この期間の記録はありません' : '読み込み中…',
      cssW / 2, cssH / 2
    );
    return;
  }

  const goal = store.goal();
  const vals = pts.map(p => p.kg);

  if (before) vals.push(before.kg);
  if (goal !== null) vals.push(goal);

  let lo = Math.min(...vals), hi = Math.max(...vals);

  if (hi - lo < 0.5) {
    const mid = (hi + lo) / 2;
    lo = mid - 0.25;
    hi = mid + 0.25;
  }

  const mg = (hi - lo) * 0.12;
  lo -= mg;
  hi += mg;

  const x = day => pad.l + (to === from ? W / 2 : (day - from) / (to - from) * W);
  const y = kg => pad.t + (hi - kg) / (hi - lo) * H;

  ctx.strokeStyle = '#f0eeea';
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#a5a29d';

  for (let i = 0; i <= 4; i++) {
    const kg = lo + (hi - lo) * i / 4;
    const yy = Math.round(y(kg)) + .5;

    ctx.beginPath();
    ctx.moveTo(pad.l, yy);
    ctx.lineTo(cssW - pad.r, yy);
    ctx.stroke();

    ctx.fillText(kg.toFixed(1), pad.l - 6, yy);
  }

  if (goal !== null && goal >= lo && goal <= hi) {
    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = '#7aa3c9';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pad.l, y(goal));
    ctx.lineTo(cssW - pad.r, y(goal));
    ctx.stroke();
    ctx.restore();
  }

  const seq = [];
  if (before) seq.push({ day: from, kg: before.kg, virtual: true });
  seq.push(...pts);

  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i];

    if (b.day - a.day === 1 && !a.virtual) {
      ctx.setLineDash([]);
      ctx.strokeStyle = '#e2725b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x(a.day), y(a.kg));
      ctx.lineTo(x(b.day), y(b.kg));
      ctx.stroke();
    } else {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = '#c9948a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x(a.day), y(a.kg));
      ctx.lineTo(x(b.day), y(a.kg));
      ctx.lineTo(x(b.day), y(b.kg));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  const last = pts[pts.length - 1] || (before ? { day: from, kg: before.kg } : null);
  const rightEnd = Math.min(to, ymdToDay(todayYmdJST()));

  if (last && rightEnd > last.day) {
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#c9948a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x(last.day), y(last.kg));
    ctx.lineTo(x(rightEnd), y(last.kg));
    ctx.stroke();
    ctx.restore();
  }

  ctx.fillStyle = '#e2725b';
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(x(p.day), y(p.kg), 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#a5a29d';
  ctx.textAlign = 'left';
  ctx.fillText(fmtJp(dayToYmd(from)), pad.l, cssH - pad.b / 2);
  ctx.textAlign = 'right';
  ctx.fillText(fmtJp(dayToYmd(to)), cssW - pad.r, cssH - pad.b / 2);
}

/* ===== サマリ・履歴 ===== */
function drawSummary() {
  const all = store.all();
  const keys = Object.keys(all).sort();

  if (!keys.length) {
    el.summary.textContent = '';
    return;
  }

  const first = all[keys[0]];
  const last = all[keys[keys.length - 1]];
  const d = last - first;

  let s =
    `記録 ${keys.length}件 ／ ` +
    `開始 ${first.toFixed(1)}kg → 最新 ${last.toFixed(1)}kg` +
    `（${d <= 0 ? '' : '+'}${d.toFixed(1)}kg）`;

  const goal = store.goal();

  if (goal !== null) {
    const rest = last - goal;
    s += rest > 0 ? ` ／ 目標まで あと ${rest.toFixed(1)}kg` : ' ／ 目標達成';
  }

  el.summary.textContent = s;
}

function drawHist() {
  const all = store.all();
  const keys = Object.keys(all).sort().reverse();

  el.hist.innerHTML = '';

  if (!keys.length) {
    el.hist.innerHTML =
      `<li class="empty">${cache.ready ? 'まだ記録がありません' : '読み込み中…'}</li>`;
    return;
  }

  for (let i = 0; i < keys.length; i++) {
    const ymd = keys[i], kg = all[ymd];
    const prev = keys[i + 1] ? all[keys[i + 1]] : null;
    const li = document.createElement('li');

    const d = document.createElement('span');
    d.className = 'd';
    d.textContent = fmtJpFull(ymd).slice(5);

    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = kg.toFixed(1) + ' kg';

    const df = document.createElement('span');
    df.className = 'diff';

    if (prev !== null) {
      const v = kg - prev;
      df.textContent = (v > 0 ? '+' : '') + v.toFixed(1);
      df.style.color = v > 0 ? '#c0392b' : (v < 0 ? '#3a8a5f' : '#8a8a8a');
    }

    const eb = document.createElement('button');
    eb.type = 'button';
    eb.textContent = '編集';

    eb.onclick = async () => {
      const v = await promptSheet({
        title: fmtJpFull(ymd) + ' の体重',
        note: '20〜300kg の範囲で入力してください。',
        type: 'number',
        value: kg.toFixed(1),
        min: 20, max: 300,
        ok: '保存する',
        validate: s => (normKg(s) === null ? '20〜300kg で入力してください' : null),
      });
      if (v !== null) saveWeight(ymd, v);
    };

    const db = document.createElement('button');
    db.type = 'button';
    db.textContent = '削除';

    db.onclick = async () => {
      const ok = await confirmSheet(
        '記録の削除',
        `${fmtJpFull(ymd)} の記録（${kg.toFixed(1)}kg）を削除します。`,
        '削除する', true
      );
      if (!ok) return;
      store.del(ymd);
      renderLog();
      say(el.msg, '削除しました', true);
    };

    li.append(d, k, df, eb, db);
    el.hist.appendChild(li);
  }
}

function renderLog() {
  drawChart();
  drawSummary();
  drawHist();
  el.rangeLabel.textContent = currentRange().label;
}

/* ===== グループ描画 ===== */
function renderGroup() {
  const g = cache.group;

  el.noGroupBox.hidden = !!g;
  el.myGroupBox.hidden = !g;
  el.rankBox.hidden = false;

  /* 未所属なら参加・作成を最上段、所属中ならランキングを最上段にする */
  el.viewGroup.classList.toggle('no-group', !g);

  if (!g) return;

  el.gName.textContent = g.name;

  el.gMeta.textContent =
    `メンバー ${g.members}人 ／ ` +
    `スタート ${fmtJpFull(g.start_ymd)} ／ ` +
    `体重${g.show_weight ? '公開' : '非公開'}`;

  el.gCodeBox.hidden = !g.is_owner;

  if (g.is_owner) el.gCode.textContent = fmtCode(g.code || g.group_id);

  el.ownerTools.hidden = !g.is_owner;
  el.memberTools.hidden = !!g.is_owner;
}

function renderWatchSel() {
  el.watchSel.innerHTML = '';

  if (!cache.watching.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '登録なし';
    el.watchSel.appendChild(o);
    state.watchId = null;
    return;
  }

  for (const w of cache.watching) {
    const o = document.createElement('option');
    o.value = w.group_id;
    o.textContent = w.name;
    el.watchSel.appendChild(o);
  }

  const ids = cache.watching.map(w => w.group_id);

  if (!state.watchId || !ids.includes(state.watchId)) state.watchId = ids[0];

  el.watchSel.value = state.watchId;
}

function drawRank(data) {
  el.rankList.innerHTML = '';

  const rows = data.rows || [];

  if (!rows.length) {
    el.rankList.innerHTML = '<li class="empty">表示できるメンバーがいません</li>';
    return;
  }

  for (const r of rows) {
    const li = document.createElement('li');

    if (r.is_self) li.classList.add('self');
    if (r.inactive) li.classList.add('rest');

    const no = document.createElement('span');
    no.className = 'no' + (r.rank && r.rank <= 3 ? ' top' : '');
    no.textContent = r.rank ? r.rank : '—';

    const av = avatar(r, 38);

    const whoBox = document.createElement('div');
    whoBox.className = 'who';

    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = r.nickname || '名前未設定';

    if (r.is_self) nm.appendChild(badge('あなた'));
    if (r.is_rival && !r.is_self) nm.appendChild(badge('ライバル', 'rival'));
    if (r.inactive) nm.appendChild(badge('休止中'));

    const sb = document.createElement('div');
    sb.className = 'sb';

    if (!r.last_ymd) {
      sb.textContent = '記録なし';
    } else {
      const kgPart =
        (r.start_kg != null && r.latest_kg != null)
          ? `${r.start_kg.toFixed(1)} → ${r.latest_kg.toFixed(1)}kg ／ `
          : '';
      const idle = r.idle_days === 0 ? '今日' : `${r.idle_days}日前`;
      const gname = r.group_name ? `${r.group_name} ／ ` : '';
      sb.textContent = gname + kgPart + `最終 ${fmtJp(r.last_ymd)}（${idle}）`;
    }

    whoBox.append(nm, sb);

    const ls = document.createElement('span');

    if (r.loss === null) {
      ls.className = 'ls none';
      ls.textContent = '—';
    } else {
      ls.className = 'ls ' + (r.loss > 0 ? 'minus' : (r.loss < 0 ? 'plus' : ''));
      ls.textContent = signKg(r.loss);
    }

    const kb = document.createElement('button');
    kb.className = 'kebab';
    kb.type = 'button';
    kb.textContent = '⋯';
    kb.setAttribute('aria-label', 'このメンバーへの操作');
    kb.onclick = () => memberMenu(r, data);

    li.append(no, av, whoBox, ls);
    if (!r.is_self) li.append(kb);

    el.rankList.appendChild(li);
  }
}

function badge(text, cls) {
  const b = document.createElement('span');
  b.className = 'badge' + (cls ? ' ' + cls : '');
  b.textContent = text;
  return b;
}

const who = r => r.nickname || '名前未設定';

/* メンバーへの操作。番号入力ではなくシートから選ぶ */
async function memberMenu(r, data) {
  const isOwner = !!(data && data.group && data.group.is_owner && data.group.is_mine !== false);

  const acts = [];

  acts.push(
    r.is_rival
      ? { label: 'ライバルから外す', run: () => rivalDel(r) }
      : { label: 'ライバルに追加', run: () => rivalAdd(r) }
  );

  acts.push({ label: 'この人を通報する', run: () => doReport(r) });
  acts.push({ label: 'この人をブロックする', run: () => doBlock(r), danger: true });

  if (isOwner) {
    acts.push({ label: 'グループから除名する', run: () => doKick(r), danger: true });
  }

  const i = await menuSheet(
    who(r),
    '通報された内容は開発者が確認します。ブロックすると、その人はランキングに表示されなくなります。',
    acts
  );

  if (i >= 0 && acts[i]) acts[i].run();
}

async function rivalAdd(r) {
  try {
    await api('/api/rivals', { method: 'POST', body: { member_id: r.member_id } });
    say(el.rmsg, `${who(r)} をライバルに追加しました`, true);
    loadRanking();
  } catch (e) {
    say(el.rmsg, emsg(e), false);
  }
}

async function rivalDel(r) {
  try {
    await api('/api/rivals/' + encodeURIComponent(r.member_id), { method: 'DELETE' });
    say(el.rmsg, `${who(r)} をライバルから外しました`, true);
    loadRanking();
  } catch (e) {
    say(el.rmsg, emsg(e), false);
  }
}

/* 通報：定型の理由から選ぶ。最後に自由記述も選べる。
   通報後に「あわせてブロック」まで案内する（Guideline 1.2） */
const REPORT_PRESETS = [
  'ニックネームが不適切',
  'アイコン画像が不適切',
  'なりすまし・他人の写真',
  'いやがらせ・攻撃的な言動',
  '性的な内容',
  'スパム・宣伝・勧誘',
];

async function doReport(r) {
  const items = REPORT_PRESETS.map(label => ({ label }));
  items.push({ label: 'その他（自分で書く）' });

  const i = await menuSheet(
    `${who(r)} を通報`,
    '当てはまるものを選んでください。内容は開発者が確認し、必要に応じて表示の停止や利用停止を行います。',
    items
  );

  if (i < 0) return;

  let reason;

  if (i === REPORT_PRESETS.length) {
    reason = await promptSheet({
      title: '通報の理由',
      note: '200文字まで。相手の連絡先や個人情報は書かないでください。',
      multiline: true,
      maxlength: 200,
      placeholder: '何があったかを具体的に書いてください',
      ok: '通報する',
      validate: s => {
        if (!String(s).trim()) return '理由を入力してください';
        if (moderate(s) === 'has_contact') return ERR.has_contact;
        return null;
      },
    });
    if (reason === null) return;
  } else {
    reason = REPORT_PRESETS[i];
  }

  try {
    await api('/api/reports', {
      method: 'POST',
      body: { target_id: r.member_id, reason },
    });
    say(el.rmsg, '通報を受け付けました。確認まで少しお時間をください', true);
  } catch (e) {
    say(el.rmsg, emsg(e), false);
    return;
  }

  if (r.is_blocked) return;

  const alsoBlock = await confirmSheet(
    'あわせてブロックしますか？',
    `${who(r)} をブロックすると、ランキングに表示されなくなります。あとから「マイページ」で解除できます。`,
    'ブロックする', true
  );

  if (alsoBlock) await blockNow(r);
}

async function blockNow(r) {
  try {
    await api('/api/blocks', { method: 'POST', body: { member_id: r.member_id } });
    say(el.rmsg, 'ブロックしました', true);
    await loadBlocks();
    loadRanking();
  } catch (e) {
    say(el.rmsg, emsg(e), false);
  }
}

async function doBlock(r) {
  const ok = await confirmSheet(
    `${who(r)} をブロック`,
    'ランキングに表示されなくなります。あとから「マイページ」の「ブロック中」で解除できます。',
    'ブロックする', true
  );
  if (!ok) return;
  await blockNow(r);
}

async function doKick(r) {
  const ok = await confirmSheet(
    `${who(r)} を除名`,
    '同じコードでは再参加できなくなります。除名した人は「除名リスト」から戻せます。',
    '除名する', true
  );
  if (!ok) return;

  try {
    await api('/api/groups/kick', { method: 'POST', body: { member_id: r.member_id } });
    say(el.rmsg, '除名しました', true);
    await loadMe();
    loadRanking();
  } catch (e) {
    say(el.rmsg, emsg(e), false);
  }
}

/* ===== 読み込み ===== */
async function loadMe() {
  const m = await api('/api/me');

  cache.me = m.me || null;
  cache.group = m.group || null;
  cache.goal = (m.me && m.me.goal_weight != null) ? Number(m.me.goal_weight) : null;

  renderGroup();
  renderMy();
}

async function loadWeights() {
  const w = await api('/api/weights');

  cache.weights = {};

  for (const r of (w.weights || [])) cache.weights[r.ymd] = r.kg;
}

async function loadWatching() {
  try {
    const d = await api('/api/watching');
    cache.watching = d.watching || [];
    renderWatchSel();
  } catch {}
}

async function loadBlocks() {
  try {
    const d = await api('/api/blocks');
    cache.blocks = d.blocks || [];
    drawBlocks();
  } catch {}
}

async function loadRanking() {
  if (state.view !== 'group') return;

  let path = '/api/ranking?scope=mine';

  if (state.rank === 'rival') {
    path = '/api/ranking?scope=rival';
  } else if (state.rank === 'watch') {
    if (!state.watchId) {
      el.rankHead.textContent = '';
      el.rankList.innerHTML =
        '<li class="empty">下の「チームを追加」からコードを登録してください</li>';
      return;
    }
    path = '/api/ranking?scope=watch&group_id=' + encodeURIComponent(state.watchId);
  } else if (!cache.group) {
    el.rankHead.textContent = '';
    el.rankList.innerHTML = '<li class="empty">グループに参加すると表示されます</li>';
    return;
  }

  el.rankList.innerHTML = '<li class="empty">読み込み中…</li>';

  try {
    const d = await api(path);
    const s = d.summary;

    if (d.group) {
      const parts = [d.group.name, `スタート ${fmtJpFull(d.group.start_ymd)}`];

      if (s && s.counted) {
        parts.push(`全体 ${signKg(s.total_loss)}`);
        parts.push(`平均 ${signKg(s.avg_loss)}/人`);
      }

      el.rankHead.textContent = parts.join(' ／ ');
    } else {
      el.rankHead.textContent = `自分＋ライバル ${(d.rows || []).length}人`;
    }

    drawRank(d);
  } catch (e) {
    el.rankHead.textContent = '';
    el.rankList.innerHTML = `<li class="empty">${emsg(e)}</li>`;
  }
}

/* 他チームの追加。ランキング内の＋追加と、下のカードの両方から使う */
async function addWatchByCode(msgNode) {
  const code = await promptSheet({
    title: 'チームを追加',
    note: '見たいチームの参加コード（8文字）を入れてください。',
    value: '',
    placeholder: 'ABCD-1234',
    upper: true,
    maxlength: 12,
    ok: '追加する',
    validate: s => (rawCode(s).length === 8 ? null : 'コードは8文字です'),
  });

  if (code === null) return;

  try {
    const d = await api('/api/watching', { method: 'POST', body: { code: code.trim() } });

    cache.watching = d.watching || [];

    const want = rawCode(code);
    const hit = cache.watching.find(w => rawCode(w.group_id) === want);

    state.watchId = hit
      ? hit.group_id
      : (cache.watching.length ? cache.watching[cache.watching.length - 1].group_id : null);

    renderWatchSel();

    /* 追加したチームをすぐ見せる */
    state.rank = 'watch';

    [...el.rankTabs.children].forEach(t =>
      t.classList.toggle('is-on', t.dataset.r === 'watch')
    );

    el.watchNav.hidden = false;

    loadRanking();

    say(msgNode || el.rmsg, 'チームを追加しました', true);
  } catch (e) {
    say(msgNode || el.rmsg, emsg(e), false);
  }
}

/* ===== マイページ描画 ===== */
function renderMy() {
  const m = cache.me;

  if (!m) return;

  if (document.activeElement !== el.nickInput) el.nickInput.value = m.nickname || '';

  if (document.activeElement !== el.goalInput) {
    el.goalInput.value = cache.goal !== null ? cache.goal.toFixed(1) : '';
  }

  if (el.notifyOn) el.notifyOn.checked = !!m.notify_on;
  if (el.notifyDays) el.notifyDays.value = String(m.notify_days || 3);
  if (el.notifyHour) {
    el.notifyHour.value = String(m.notify_hour == null ? 20 : m.notify_hour);
  }

  el.myMemberId.textContent = m.member_id || '—';
  el.myDeviceId.textContent = deviceId();

  renderIcon();
}

function drawBlocks() {
  el.blockList.innerHTML = '';

  if (!cache.blocks.length) {
    el.blockList.innerHTML = '<li class="empty">ブロックしている人はいません</li>';
    return;
  }

  for (const b of cache.blocks) {
    const li = document.createElement('li');

    const av = avatar(b, 28);

    const d = document.createElement('span');
    d.className = 'd';
    d.textContent = b.nickname || b.member_id;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '解除';

    btn.onclick = async () => {
      const ok = await confirmSheet(
        'ブロックの解除',
        `${b.nickname || b.member_id} のブロックを解除します。ランキングに再び表示されます。`,
        '解除する'
      );
      if (!ok) return;

      try {
        await api('/api/blocks/' + encodeURIComponent(b.member_id), { method: 'DELETE' });
        await loadBlocks();
        loadRanking();
        say(el.mmsg, 'ブロックを解除しました', true);
      } catch (e) {
        say(el.mmsg, emsg(e), false);
      }
    };

    li.append(av, d, btn);
    el.blockList.appendChild(li);
  }
}

/* ===== 画面切替 ===== */
function switchView(v) {
  state.view = v;

  $$('.view').forEach(n => n.classList.toggle('is-on', n.id === 'view-' + v));
  $$('.tabbtn').forEach(b => b.classList.toggle('is-on', b.dataset.v === v));

  el.hdTitle.textContent =
    v === 'log' ? '体重記録' : (v === 'group' ? 'グループ' : 'マイページ');

  window.scrollTo(0, 0);

  if (v === 'log') renderLog();

  if (v === 'group') {
    loadWatching();
    loadRanking();
  }

  if (v === 'my') {
    renderMy();
    loadBlocks();
  }
}

/* ===== 配線 ===== */
function init() {
  const today = todayYmdJST();

  el.todayLabel.textContent = fmtJpFull(today) + ' の体重';

  el.pastYmd.max = today;
  el.pastYmd.value = today;
  el.newStartYmd.value = today;

  if (el.notifyHour) {
    for (let h = 0; h < 24; h++) {
      const o = document.createElement('option');
      o.value = String(h);
      o.textContent = String(h).padStart(2, '0') + ':00';
      el.notifyHour.appendChild(o);
    }
    el.notifyHour.value = '20';
  }

  const bump = n => {
    const keys = Object.keys(store.all()).sort();
    const latest = keys.length ? store.all()[keys[keys.length - 1]] : 60;
    const cur = normKg(el.kgInput.value);
    const base = cur === null ? latest : cur;
    el.kgInput.value = (Math.round((base + n) * 10) / 10).toFixed(1);
  };

  $('#plus').onclick = () => bump(0.1);
  $('#minus').onclick = () => bump(-0.1);

  $('#saveToday').onclick = () => saveWeight(todayYmdJST(), el.kgInput.value);

  $('#openPast').onclick = () => {
    el.pastBox.hidden = false;
    el.pastKg.focus();
  };

  $('#closePast').onclick = () => { el.pastBox.hidden = true; };

  $('#savePast').onclick = () => {
    const ymd = el.pastYmd.value;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      say(el.msg, '日付を選んでください', false);
      return;
    }

    if (saveWeight(ymd, el.pastKg.value)) el.pastKg.value = '';
  };

  el.tabs.onclick = e => {
    const b = e.target.closest('.tab');
    if (!b) return;

    [...el.tabs.children].forEach(t => t.classList.toggle('is-on', t === b));

    state.period = b.dataset.p;
    state.offset = 0;
    renderLog();
  };

  $('#prevRange').onclick = () => { state.offset--; renderLog(); };
  $('#nextRange').onclick = () => { if (state.offset < 0) state.offset++; renderLog(); };

  /* グループ */
  $('#doJoin').onclick = async () => {
    const code = el.joinCode.value.trim();

    if (!code) {
      say(el.gmsg, 'コードを入力してください', false);
      return;
    }

    try {
      await api('/api/groups/join', { method: 'POST', body: { code } });
      el.joinCode.value = '';
      await loadMe();
      loadRanking();
      say(el.gmsg2, '参加しました', true);
    } catch (e) {
      say(el.gmsg, emsg(e), false);
    }
  };

  $('#doCreate').onclick = async () => {
    const name = el.newGroupName.value.trim();

    if (!name) {
      say(el.gmsg, 'グループ名を入力してください', false);
      return;
    }

    const ng = moderate(name);
    if (ng) {
      say(el.gmsg, ERR[ng], false);
      return;
    }

    try {
      await api('/api/groups/create', {
        method: 'POST',
        body: {
          name,
          start_ymd: el.newStartYmd.value || undefined,
          show_weight: el.newShowWeight.checked,
        },
      });

      await loadMe();
      loadRanking();
      say(el.gmsg2, 'グループを作りました。コードを配ってください', true);
    } catch (e) {
      say(el.gmsg, emsg(e), false);
    }
  };

  $('#copyCode').onclick = async () => {
    const g = cache.group;
    const c = g ? rawCode(g.code || g.group_id) : '';

    if (!c) return;

    try {
      await navigator.clipboard.writeText(c);
      say(el.gmsg2, 'コードをコピーしました', true);
    } catch {
      say(el.gmsg2, 'コピーできませんでした。手で入力してください', false);
    }
  };

  $('#renameGroup').onclick = async () => {
    const v = await promptSheet({
      title: 'グループ名の変更',
      note: '24文字まで。メンバー全員に表示されます。',
      value: cache.group ? cache.group.name : '',
      maxlength: 24,
      ok: '変更する',
      validate: s => {
        if (!String(s).trim()) return '名前を入力してください';
        const ng = moderate(s);
        return ng ? ERR[ng] : null;
      },
    });

    if (v === null) return;

    try {
      await api('/api/groups/rename', { method: 'POST', body: { name: v.trim() } });
      await loadMe();
      loadRanking();
      say(el.gmsg2, '名前を変更しました', true);
    } catch (e) {
      say(el.gmsg2, emsg(e), false);
    }
  };

  $('#editStart').onclick = async () => {
    const v = await promptSheet({
      title: 'スタート日',
      note: 'この日以降の最初の記録が、減量幅の基準になります。',
      type: 'date',
      value: cache.group ? cache.group.start_ymd : todayYmdJST(),
      max: todayYmdJST(),
      ok: '変更する',
      validate: s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s).trim()) ? null : '日付を選んでください'),
    });

    if (v === null) return;

    try {
      await api('/api/groups/start', { method: 'POST', body: { start_ymd: v.trim() } });
      await loadMe();
      loadRanking();
      say(el.gmsg2, 'スタート日を変更しました', true);
    } catch (e) {
      say(el.gmsg2, emsg(e), false);
    }
  };

  $('#showBans').onclick = async () => {
    try {
      const d = await api('/api/groups/bans');
      const bans = d.bans || [];

      if (!bans.length) {
        say(el.gmsg2, '除名した人はいません', true);
        return;
      }

      const i = await menuSheet(
        '除名リスト',
        '選ぶと再参加できるように戻します。',
        bans.map(b => ({ label: b.nickname || b.member_id }))
      );

      if (i < 0) return;

      const t = bans[i];
      if (!t) return;

      const ok = await confirmSheet(
        '再参加を許可',
        `${t.nickname || t.member_id} が同じコードで再参加できるようになります。`,
        '許可する'
      );
      if (!ok) return;

      await api('/api/groups/unban', { method: 'POST', body: { member_id: t.member_id } });
      say(el.gmsg2, `${t.nickname || t.member_id} を戻しました`, true);
    } catch (e) {
      say(el.gmsg2, emsg(e), false);
    }
  };

  $('#dissolveGroup').onclick = async () => {
    const ok = await confirmSheet(
      'グループを解散',
      'メンバー全員がグループ無しになります。体重の記録は残ります。取り消せません。',
      '解散する', true
    );
    if (!ok) return;

    try {
      await api('/api/groups/dissolve', { method: 'POST' });
      await loadMe();
      loadRanking();
      say(el.gmsg, '解散しました', true);
    } catch (e) {
      say(el.gmsg2, emsg(e), false);
    }
  };

  $('#leaveGroup').onclick = async () => {
    const ok = await confirmSheet(
      'グループを抜ける',
      '体重の記録は残ります。もう一度参加するには参加コードが必要です。',
      '抜ける', true
    );
    if (!ok) return;

    try {
      await api('/api/groups/leave', { method: 'POST' });
      await loadMe();
      loadRanking();
      say(el.gmsg, '抜けました', true);
    } catch (e) {
      say(el.gmsg2, emsg(e), false);
    }
  };

  el.rankTabs.onclick = e => {
    const b = e.target.closest('.tab');
    if (!b) return;

    [...el.rankTabs.children].forEach(t => t.classList.toggle('is-on', t === b));

    state.rank = b.dataset.r;
    el.watchNav.hidden = state.rank !== 'watch';

    loadRanking();
  };

  el.watchSel.onchange = () => {
    state.watchId = el.watchSel.value;
    loadRanking();
  };

  $('#addWatch').onclick = () => addWatchByCode(el.rmsg);

  const addWatch2 = $('#addWatch2');
  if (addWatch2) addWatch2.onclick = () => addWatchByCode(el.rmsg);

  /* マイページ：アイコン */
  if (el.iconPick && el.iconFile) {
    el.iconPick.onclick = () => el.iconFile.click();
  }

  if (el.iconFile) {
    el.iconFile.onchange = () => {
      const f = el.iconFile.files && el.iconFile.files[0];
      el.iconFile.value = '';
      if (f) uploadIcon(f);
    };
  }

  if (el.iconDel) el.iconDel.onclick = removeIcon;

  /* マイページ */
  $('#saveNick').onclick = async () => {
    const v = el.nickInput.value.trim();

    if (!v) {
      say(el.mmsg, 'ニックネームを入力してください', false);
      return;
    }

    const ng = moderate(v);
    if (ng) {
      say(el.mmsg, ERR[ng], false);
      return;
    }

    try {
      await api('/api/me', { method: 'PATCH', body: { nickname: v } });
      await loadMe();
      say(el.mmsg, '保存しました', true);
    } catch (e) {
      say(el.mmsg, emsg(e), false);
    }
  };

  $('#saveGoal').onclick = () => {
    if (!cache.ready) {
      say(el.mmsg, 'サーバーに接続中です', false);
      return;
    }

    const raw = el.goalInput.value.trim();

    if (raw === '') {
      store.setGoal(null);
      renderLog();
      say(el.mmsg, '目標を解除しました', true);
      return;
    }

    const v = normKg(raw);

    if (v === null) {
      say(el.mmsg, '目標体重を 20〜300kg で入力してください', false);
      return;
    }

    store.setGoal(v);
    el.goalInput.value = v.toFixed(1);
    renderLog();
    say(el.mmsg, '目標を保存しました', true);
  };

  const saveNotify = $('#saveNotify');
  if (saveNotify) {
    saveNotify.onclick = async () => {
      try {
        await api('/api/me', {
          method: 'PATCH',
          body: {
            notify_on: el.notifyOn.checked,
            notify_days: Number(el.notifyDays.value),
            notify_hour: Number(el.notifyHour.value),
          },
        });

        await loadMe();
        say(el.nmsg, '通知設定を保存しました', true);
      } catch (e) {
        say(el.nmsg, emsg(e), false);
      }
    };
  }

  $('#copyDeviceId').onclick = async () => {
    try {
      await navigator.clipboard.writeText(deviceId());
      say(el.dmsg, '端末IDをコピーしました', true);
    } catch {
      say(el.dmsg, 'コピーできませんでした', false);
    }
  };

  $('#deleteAll').onclick = async () => {
    const ok1 = await confirmSheet(
      '利用データの削除',
      '体重の記録、目標体重、ニックネーム、プロフィール画像、グループの所属を削除します。取り消せません。',
      '次へ進む', true
    );
    if (!ok1) return;

    const ok2 = await confirmSheet(
      '本当に削除しますか？',
      'この端末のデータはサーバーからも消えます。元に戻すことはできません。',
      '削除する', true
    );
    if (!ok2) return;

    try {
      await api('/api/me', { method: 'DELETE' });
      localStorage.removeItem(K_DEV);
      await alertSheet(
        '削除しました',
        '利用データを削除しました。画面を読み込み直します。'
      );
      location.reload();
    } catch (e) {
      say(el.dmsg, emsg(e), false);
    }
  };

  $$('.tabbtn').forEach(b => { b.onclick = () => switchView(b.dataset.v); });

  window.addEventListener('resize', () => {
    if (state.view === 'log') drawChart();
  });

  renderLog();
}

/* ===== 起動 ===== */
async function boot() {
  try {
    await api('/api/register', { method: 'POST', body: { device_id: deviceId() } });

    await Promise.all([loadWeights(), loadMe()]);

    cache.ready = true;

    const today = todayYmdJST();

    if (cache.weights[today] !== undefined) {
      el.kgInput.value = cache.weights[today].toFixed(1);
    }

    renderLog();
    clearMsg(el.msg);
  } catch (err) {
    say(el.msg, 'サーバーに接続できません：' + emsg(err), false);

    const ok = await confirmSheet(
      '接続できませんでした',
      'みんやせは記録の保存にインターネット接続が必要です。電波状況をご確認のうえ、もう一度お試しください。',
      'もう一度試す'
    );

    if (ok) boot();
  }
}

async function start() {
  init();
  await ensureAgreed();
  boot();
}

start();
