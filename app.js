'use strict';

/* ===== API ===== */
const API = '';                            // 同一オリジン。アプリ化時に絶対URLへ
const K_DEV = 'tsudatsu.device_id.v1';

function deviceId() {
  let v = localStorage.getItem(K_DEV);
  if (!v) {
    v = 'dev_' + crypto.randomUUID();
    localStorage.setItem(K_DEV, v);
  }
  return v;
}

async function api(path, opt = {}) {
  const res = await fetch(API + path, {
    method: opt.method || 'GET',
    headers: { 'content-type': 'application/json', 'x-device-id': deviceId() },
    body: opt.body !== undefined ? JSON.stringify(opt.body) : undefined,
    cache: 'no-store',
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok || data.ok === false) throw new Error(data.error || ('http_' + res.status));
  return data;
}

const ERR = {
  bad_device_id: '端末IDが不正です',
  not_registered: '登録が見つかりません。再読み込みしてください',
  banned: 'このアカウントは利用できません',
  bad_kg: '体重の値が不正です',
  bad_ymd: '日付が不正です',
  future_ymd: '未来の日付は登録できません',
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
  bad_start_ymd: 'スタート日が不正です',
  too_many_requests: '操作が多すぎます。1分ほど待ってください',
  already_reported_today: 'すでに通報済みです',
  cannot_kick_self: '自分は除名できません',
  not_allowed: '閲覧権限がありません',
};
const emsg = e => ERR[e.message] || ('エラー（' + e.message + '）');

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
function ymdToDay(ymd) { return Math.round(Date.parse(ymd + 'T00:00:00+09:00') / 86400000); }
function dayToYmd(day) {
  const p = JST_FMT.formatToParts(new Date(day * 86400000));
  const g = t => p.find(x => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
function fmtJp(ymd) { const [, m, d] = ymd.split('-'); return `${Number(m)}月${Number(d)}日`; }
function fmtJpFull(ymd) { const [y, m, d] = ymd.split('-'); return `${y}年${Number(m)}月${Number(d)}日`; }

function normKg(raw) {
  const v = parseFloat(raw);
  if (!Number.isFinite(v)) return null;
  const r = Math.round(v * 10) / 10;
  return (r >= 20 && r <= 300) ? r : null;
}
function fmtCode(c) { return c ? c.slice(0, 4) + '-' + c.slice(4) : '—'; }

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
};

const timers = new WeakMap();
function say(node, text, ok) {
  if (!node) return;
  node.textContent = text;
  node.className = 'msg ' + (ok ? 'ok' : 'ng');
  clearTimeout(timers.get(node));
  timers.set(node, setTimeout(() => { node.textContent = ''; node.className = 'msg'; }, 3200));
}

/* ===== 保存 ===== */
function saveWeight(ymd, kg) {
  if (!cache.ready) { say(el.msg, 'サーバーに接続中です', false); return false; }
  if (ymd > todayYmdJST()) { say(el.msg, '未来の日付は登録できません', false); return false; }
  const v = normKg(kg);
  if (v === null) { say(el.msg, '体重を 20〜300kg で入力してください', false); return false; }
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
    return { from: end - 6, to: end, label: `${fmtJp(dayToYmd(end - 6))} 〜 ${fmtJp(dayToYmd(end))}` };
  }
  if (state.period === 'month') {
    let y = ty, m = tm + state.offset;
    y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1;
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
    return { from: ymdToDay(`${y}-01-01`), to: ymdToDay(`${y}-12-31`), label: `${y}年` };
  }
  const keys = Object.keys(store.all()).sort();
  if (!keys.length) return { from: tDay - 6, to: tDay, label: '全期間' };
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
  c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const pad = { l: 42, r: 12, t: 14, b: 24 };
  const W = cssW - pad.l - pad.r, H = cssH - pad.t - pad.b;
  const all = store.all();
  const { from, to } = currentRange();

  const pts = Object.keys(all)
    .map(ymd => ({ ymd, day: ymdToDay(ymd), kg: all[ymd] }))
    .filter(p => p.day >= from && p.day <= to)
    .sort((a, b) => a.day - b.day);

  const before = Object.keys(all)
    .map(ymd => ({ day: ymdToDay(ymd), kg: all[ymd] }))
    .filter(p => p.day < from)
    .sort((a, b) => a.day - b.day).pop();

  ctx.font = '10px -apple-system,sans-serif';
  ctx.textBaseline = 'middle';

  if (!pts.length && !before) {
    ctx.fillStyle = '#8a8a8a'; ctx.textAlign = 'center';
    ctx.fillText(cache.ready ? 'この期間の記録はありません' : '読み込み中…', cssW / 2, cssH / 2);
    return;
  }

  const goal = store.goal();
  const vals = pts.map(p => p.kg);
  if (before) vals.push(before.kg);
  if (goal !== null) vals.push(goal);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 0.5) { const mid = (hi + lo) / 2; lo = mid - 0.25; hi = mid + 0.25; }
  const mg = (hi - lo) * 0.12; lo -= mg; hi += mg;

  const x = day => pad.l + (to === from ? W / 2 : (day - from) / (to - from) * W);
  const y = kg => pad.t + (hi - kg) / (hi - lo) * H;

  ctx.strokeStyle = '#f0eeea'; ctx.lineWidth = 1;
  ctx.textAlign = 'right'; ctx.fillStyle = '#a5a29d';
  for (let i = 0; i <= 4; i++) {
    const kg = lo + (hi - lo) * i / 4, yy = Math.round(y(kg)) + .5;
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(cssW - pad.r, yy); ctx.stroke();
    ctx.fillText(kg.toFixed(1), pad.l - 6, yy);
  }

  if (goal !== null && goal >= lo && goal <= hi) {
    ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = '#7aa3c9'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(pad.l, y(goal)); ctx.lineTo(cssW - pad.r, y(goal)); ctx.stroke();
    ctx.restore();
  }

  const seq = [];
  if (before) seq.push({ day: from, kg: before.kg, virtual: true });
  seq.push(...pts);

  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i];
    if (b.day - a.day === 1 && !a.virtual) {
      ctx.setLineDash([]); ctx.strokeStyle = '#e2725b'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x(a.day), y(a.kg)); ctx.lineTo(x(b.day), y(b.kg)); ctx.stroke();
    } else {
      ctx.setLineDash([3, 3]); ctx.strokeStyle = '#c9948a'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x(a.day), y(a.kg));
      ctx.lineTo(x(b.day), y(a.kg));
      ctx.lineTo(x(b.day), y(b.kg));
      ctx.stroke(); ctx.setLineDash([]);
    }
  }

  const last = pts[pts.length - 1] || (before ? { day: from, kg: before.kg } : null);
  const rightEnd = Math.min(to, ymdToDay(todayYmdJST()));
  if (last && rightEnd > last.day) {
    ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = '#c9948a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x(last.day), y(last.kg)); ctx.lineTo(x(rightEnd), y(last.kg)); ctx.stroke();
    ctx.restore();
  }

  ctx.fillStyle = '#e2725b';
  for (const p of pts) { ctx.beginPath(); ctx.arc(x(p.day), y(p.kg), 3.2, 0, Math.PI * 2); ctx.fill(); }

  ctx.fillStyle = '#a5a29d'; ctx.textAlign = 'left';
  ctx.fillText(fmtJp(dayToYmd(from)), pad.l, cssH - pad.b / 2);
  ctx.textAlign = 'right';
  ctx.fillText(fmtJp(dayToYmd(to)), cssW - pad.r, cssH - pad.b / 2);
}

/* ===== サマリ・履歴 ===== */
function drawSummary() {
  const all = store.all();
  const keys = Object.keys(all).sort();
  if (!keys.length) { el.summary.textContent = ''; return; }
  const first = all[keys[0]], last = all[keys[keys.length - 1]];
  const d = last - first;
  let s = `記録 ${keys.length}件 ／ 開始 ${first.toFixed(1)}kg → 最新 ${last.toFixed(1)}kg（${d <= 0 ? '' : '+'}${d.toFixed(1)}kg）`;
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
    el.hist.innerHTML = `<li class="empty">${cache.ready ? 'まだ記録がありません' : '読み込み中…'}</li>`;
    return;
  }
  for (let i = 0; i < keys.length; i++) {
    const ymd = keys[i], kg = all[ymd];
    const prev = keys[i + 1] ? all[keys[i + 1]] : null;
    const li = document.createElement('li');

    const d = document.createElement('span');
    d.className = 'd'; d.textContent = fmtJpFull(ymd).slice(5);

    const k = document.createElement('span');
    k.className = 'k'; k.textContent = kg.toFixed(1) + ' kg';

    const df = document.createElement('span');
    df.className = 'diff';
    if (prev !== null) {
      const v = kg - prev;
      df.textContent = (v > 0 ? '+' : '') + v.toFixed(1);
      df.style.color = v > 0 ? '#c0392b' : (v < 0 ? '#3a8a5f' : '#8a8a8a');
    }

    const eb = document.createElement('button');
    eb.type = 'button'; eb.textContent = '編集';
    eb.onclick = () => {
      const v = prompt(`${fmtJpFull(ymd)} の体重`, kg.toFixed(1));
      if (v !== null) saveWeight(ymd, v);
    };

    const db = document.createElement('button');
    db.type = 'button'; db.textContent = '削除';
    db.onclick = () => {
      if (!confirm(`${fmtJpFull(ymd)} の記録を削除しますか？`)) return;
      store.del(ymd); renderLog(); say(el.msg, '削除しました', true);
    };

    li.append(d, k, df, eb, db);
    el.hist.appendChild(li);
  }
}

function renderLog() {
  drawChart(); drawSummary(); drawHist();
  el.rangeLabel.textContent = currentRange().label;
}

/* ===== グループ描画 ===== */
function renderGroup() {
  const g = cache.group;
  el.noGroupBox.hidden = !!g;
  el.myGroupBox.hidden = !g;
  el.rankBox.hidden = !g && !cache.watching.length && !state.rankHasRival;

  if (!g) { el.rankBox.hidden = state.rank === 'mine'; return; }

  el.gName.textContent = g.name;
  el.gMeta.textContent =
    `メンバー ${g.members}人 ／ スタート ${fmtJpFull(g.start_ymd)} ／ 体重${g.show_weight ? '公開' : '非公開'}`;
  el.gCodeBox.hidden = !g.is_owner;
  if (g.is_owner) el.gCode.textContent = fmtCode(g.code || g.group_id);
  el.ownerTools.hidden = !g.is_owner;
  el.memberTools.hidden = !!g.is_owner;
  el.rankBox.hidden = false;
}

function renderWatchSel() {
  el.watchSel.innerHTML = '';
  if (!cache.watching.length) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = '登録なし';
    el.watchSel.appendChild(o);
    return;
  }
  for (const w of cache.watching) {
    const o = document.createElement('option');
    o.value = w.group_id; o.textContent = w.name;
    el.watchSel.appendChild(o);
  }
  if (state.watchId) el.watchSel.value = state.watchId;
  else state.watchId = cache.watching[0].group_id;
}

function drawRank(data) {
  el.rankList.innerHTML = '';
  const rows = data.rows || [];
  if (!rows.length) {
    el.rankList.innerHTML = '<li class="empty">表示できるメンバーがいません</li>';
    return;
  }
  const showKg = data.group ? data.group.show_weight : true;

  for (const r of rows) {
    const li = document.createElement('li');
    if (r.is_self) li.classList.add('self');
    if (r.inactive) li.classList.add('rest');

    const no = document.createElement('span');
    no.className = 'no' + (r.rank && r.rank <= 3 ? ' top' : '');
    no.textContent = r.rank ? r.rank : '—';

    const who = document.createElement('div');
    who.className = 'who';
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = r.nickname;
    if (r.is_self) nm.appendChild(badge('あなた'));
    if (r.is_rival) nm.appendChild(badge('ライバル', 'rival'));
    if (r.inactive) nm.appendChild(badge('休止中'));
    const sb = document.createElement('div');
    sb.className = 'sb';
    if (r.records === 0) sb.textContent = '記録なし';
    else {
      const kgPart = (showKg && r.start_kg != null)
        ? `${r.start_kg.toFixed(1)} → ${r.latest_kg.toFixed(1)}kg ／ ` : '';
      sb.textContent = kgPart + `最終 ${fmtJp(r.last_ymd)}（${r.days_since}日前）`;
    }
    who.append(nm, sb);

    const ls = document.createElement('span');
    if (r.loss === null) { ls.className = 'ls none'; ls.textContent = '—'; }
    else {
      ls.className = 'ls ' + (r.loss > 0 ? 'minus' : (r.loss < 0 ? 'plus' : ''));
      ls.textContent = (r.loss > 0 ? '−' : (r.loss < 0 ? '+' : '±')) + Math.abs(r.loss).toFixed(1) + 'kg';
    }

    const kb = document.createElement('button');
    kb.className = 'kebab'; kb.type = 'button'; kb.textContent = '⋯';
    kb.onclick = () => memberMenu(r, data);

    li.append(no, who, ls);
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

function memberMenu(r, data) {
  const isOwner = data.group && data.group.is_owner && data.group.is_mine;
  const acts = [];
  acts.push(r.is_rival ? ['ライバルから外す', () => rivalDel(r)] : ['ライバルに追加', () => rivalAdd(r)]);
  acts.push(['通報する', () => doReport(r)]);
  acts.push(['ブロックする', () => doBlock(r)]);
  if (isOwner) acts.push(['グループから除名', () => doKick(r)]);

  const lines = acts.map((a, i) => `${i + 1}. ${a[0]}`).join('\n');
  const sel = prompt(`${r.nickname}\n\n${lines}\n\n番号を入力`, '');
  if (sel === null) return;
  const i = parseInt(sel, 10) - 1;
  if (acts[i]) acts[i][1]();
}

async function rivalAdd(r) {
  try {
    await api('/api/rivals', { method: 'POST', body: { member_id: r.member_id } });
    say(el.rmsg, `${r.nickname} をライバルに追加しました`, true);
    loadRanking();
  } catch (e) { say(el.rmsg, emsg(e), false); }
}
async function rivalDel(r) {
  try {
    await api('/api/rivals?member_id=' + encodeURIComponent(r.member_id), { method: 'DELETE' });
    say(el.rmsg, `${r.nickname} をライバルから外しました`, true);
    loadRanking();
  } catch (e) { say(el.rmsg, emsg(e), false); }
}
async function doReport(r) {
  const reason = prompt(`${r.nickname} を通報します。理由を入力してください`, '');
  if (reason === null || !reason.trim()) return;
  try {
    await api('/api/reports', { method: 'POST', body: { member_id: r.member_id, reason } });
    say(el.rmsg, '通報を受け付けました', true);
  } catch (e) { say(el.rmsg, emsg(e), false); }
}
async function doBlock(r) {
  if (!confirm(`${r.nickname} をブロックしますか？\nランキングに表示されなくなります。`)) return;
  try {
    await api('/api/blocks', { method: 'POST', body: { member_id: r.member_id } });
    say(el.rmsg, 'ブロックしました', true);
    await loadBlocks(); loadRanking();
  } catch (e) { say(el.rmsg, emsg(e), false); }
}
async function doKick(r) {
  if (!confirm(`${r.nickname} を除名しますか？\n同じコードでは再参加できなくなります。`)) return;
  try {
    await api('/api/groups/kick', { method: 'POST', body: { member_id: r.member_id } });
    say(el.rmsg, '除名しました', true);
    await loadMe(); loadRanking();
  } catch (e) { say(el.rmsg, emsg(e), false); }
}

/* ===== 読み込み ===== */
async function loadMe() {
  const m = await api('/api/me');
  cache.me = m.me || null;
  cache.group = m.group || null;
  cache.goal = (m.me && m.me.goal_weight != null) ? Number(m.me.goal_weight) : null;
  renderGroup(); renderMy();
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
  let path = '/api/ranking?mode=group';
  if (state.rank === 'rival') path = '/api/ranking?mode=rival';
  else if (state.rank === 'watch') {
    if (!state.watchId) {
      el.rankHead.textContent = '';
      el.rankList.innerHTML = '<li class="empty">コードを追加すると他チームを見られます</li>';
      return;
    }
    path = '/api/ranking?mode=group&group_id=' + encodeURIComponent(state.watchId);
  } else if (!cache.group) {
    el.rankHead.textContent = '';
    el.rankList.innerHTML = '<li class="empty">グループに参加すると表示されます</li>';
    return;
  }

  el.rankList.innerHTML = '<li class="empty">読み込み中…</li>';
  try {
    const d = await api(path);
    if (d.group) {
      el.rankHead.textContent =
        `${d.group.name} ／ スタート ${fmtJpFull(d.group.start_ymd)} ／ チーム合計 −${d.total_loss.toFixed(1)}kg`;
    } else {
      el.rankHead.textContent = `ライバル ${d.rows.length}人`;
    }
    drawRank(d);
  } catch (e) {
    el.rankHead.textContent = '';
    el.rankList.innerHTML = `<li class="empty">${emsg(e)}</li>`;
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
  el.notifyOn.checked = !!(m.notify && m.notify.on);
  if (m.notify) {
    el.notifyDays.value = String(m.notify.days);
    el.notifyHour.value = String(m.notify.hour);
  }
  el.myMemberId.textContent = m.member_id || '—';
  el.myDeviceId.textContent = deviceId();
}

function drawBlocks() {
  el.blockList.innerHTML = '';
  if (!cache.blocks.length) {
    el.blockList.innerHTML = '<li class="empty">ブロックしている人はいません</li>';
    return;
  }
  for (const b of cache.blocks) {
    const li = document.createElement('li');
    const d = document.createElement('span');
    d.className = 'd'; d.textContent = b.nickname || b.member_id;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.textContent = '解除';
    btn.onclick = async () => {
      try {
        await api('/api/blocks?member_id=' + encodeURIComponent(b.member_id), { method: 'DELETE' });
        await loadBlocks(); loadRanking();
      } catch (e) { alert(emsg(e)); }
    };
    li.append(d, btn);
    el.blockList.appendChild(li);
  }
}

/* ===== 画面切替 ===== */
function switchView(v) {
  state.view = v;
  $$('.view').forEach(n => n.classList.toggle('is-on', n.id === 'view-' + v));
  $$('.tabbtn').forEach(b => b.classList.toggle('is-on', b.dataset.v === v));
  el.hdTitle.textContent = v === 'log' ? '体重記録' : (v === 'group' ? 'グループ' : 'マイページ');
  window.scrollTo(0, 0);
  if (v === 'log') renderLog();
  if (v === 'group') { loadWatching(); loadRanking(); }
  if (v === 'my') { renderMy(); loadBlocks(); }
}

/* ===== 配線 ===== */
function init() {
  const today = todayYmdJST();
  el.todayLabel.textContent = fmtJpFull(today) + ' の体重';
  el.pastYmd.max = today; el.pastYmd.value = today;
  el.newStartYmd.value = today;

  for (let h = 0; h < 24; h++) {
    const o = document.createElement('option');
    o.value = String(h); o.textContent = String(h).padStart(2, '0') + ':00';
    el.notifyHour.appendChild(o);
  }
  el.notifyHour.value = '20';

  const bump = n => {
    const keys = Object.keys(store.all()).sort();
    const latest = keys.length ? store.all()[keys[keys.length - 1]] : 60;
    const base = normKg(el.kgInput.value) ?? latest;
    el.kgInput.value = (Math.round((base + n) * 10) / 10).toFixed(1);
  };
  $('#plus').onclick = () => bump(0.1);
  $('#minus').onclick = () => bump(-0.1);
  $('#saveToday').onclick = () => saveWeight(todayYmdJST(), el.kgInput.value);
  $('#openPast').onclick = () => { el.pastBox.hidden = false; el.pastKg.focus(); };
  $('#closePast').onclick = () => { el.pastBox.hidden = true; };
  $('#savePast').onclick = () => {
    const ymd = el.pastYmd.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) { say(el.msg, '日付を選んでください', false); return; }
    if (saveWeight(ymd, el.pastKg.value)) el.pastKg.value = '';
  };

  el.tabs.onclick = e => {
    const b = e.target.closest('.tab'); if (!b) return;
    [...el.tabs.children].forEach(t => t.classList.toggle('is-on', t === b));
    state.period = b.dataset.p; state.offset = 0; renderLog();
  };
  $('#prevRange').onclick = () => { state.offset--; renderLog(); };
  $('#nextRange').onclick = () => { if (state.offset < 0) state.offset++; renderLog(); };

  /* グループ */
  $('#doJoin').onclick = async () => {
    const code = el.joinCode.value.trim();
    if (!code) { say(el.gmsg, 'コードを入力してください', false); return; }
    try {
      await api('/api/groups/join', { method: 'POST', body: { code } });
      el.joinCode.value = '';
      await loadMe(); loadRanking();
      say(el.gmsg, '参加しました', true);
    } catch (e) { say(el.gmsg, emsg(e), false); }
  };

  $('#doCreate').onclick = async () => {
    const name = el.newGroupName.value.trim();
    if (!name) { say(el.gmsg, 'グループ名を入力してください', false); return; }
    try {
      await api('/api/groups', {
        method: 'POST',
        body: {
          name,
          start_ymd: el.newStartYmd.value || undefined,
          show_weight: el.newShowWeight.checked,
        },
      });
      await loadMe(); loadRanking();
      say(el.gmsg2, 'グループを作りました。コードを配ってください', true);
    } catch (e) { say(el.gmsg, emsg(e), false); }
  };

  $('#copyCode').onclick = async () => {
    const c = cache.group && (cache.group.code || cache.group.group_id);
    if (!c) return;
    try { await navigator.clipboard.writeText(c); say(el.gmsg2, 'コードをコピーしました', true); }
    catch { say(el.gmsg2, 'コピーできませんでした。手で入力してください', false); }
  };

  $('#renameGroup').onclick = async () => {
    const v = prompt('新しいグループ名', cache.group ? cache.group.name : '');
    if (v === null || !v.trim()) return;
    try {
      await api('/api/groups', { method: 'PATCH', body: { name: v.trim() } });
      await loadMe(); loadRanking(); say(el.gmsg2, '名前を変更しました', true);
    } catch (e) { say(el.gmsg2, emsg(e), false); }
  };

  $('#editStart').onclick = async () => {
    const v = prompt('スタート日（YYYY-MM-DD）', cache.group ? cache.group.start_ymd : '');
    if (v === null || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return;
    try {
      await api('/api/groups', { method: 'PATCH', body: { start_ymd: v.trim() } });
      await loadMe(); loadRanking(); say(el.gmsg2, 'スタート日を変更しました', true);
    } catch (e) { say(el.gmsg2, emsg(e), false); }
  };

  $('#showBans').onclick = async () => {
    try {
      const d = await api('/api/groups/bans');
      if (!d.bans.length) { say(el.gmsg2, '除名した人はいません', true); return; }
      const lines = d.bans.map((b, i) => `${i + 1}. ${b.nickname || b.member_id}`).join('\n');
      const sel = prompt(`除名リスト\n\n${lines}\n\n復活させる番号を入力（空欄で閉じる）`, '');
      if (sel === null || !sel.trim()) return;
      const t = d.bans[parseInt(sel, 10) - 1];
      if (!t) return;
      await api('/api/groups/unban', { method: 'POST', body: { member_id: t.member_id } });
      say(el.gmsg2, `${t.nickname || t.member_id} を復活させました`, true);
    } catch (e) { say(el.gmsg2, emsg(e), false); }
  };

  $('#dissolveGroup').onclick = async () => {
    if (!confirm('グループを解散しますか？\nメンバー全員がグループ無しになります。体重の記録は残ります。')) return;
    try {
      await api('/api/groups/dissolve', { method: 'POST' });
      await loadMe(); loadRanking(); say(el.gmsg, '解散しました', true);
    } catch (e) { say(el.gmsg2, emsg(e), false); }
  };

  $('#leaveGroup').onclick = async () => {
    if (!confirm('グループを抜けますか？\n体重の記録は残ります。')) return;
    try {
      await api('/api/groups/leave', { method: 'POST' });
      await loadMe(); loadRanking(); say(el.gmsg, '抜けました', true);
    } catch (e) { say(el.gmsg2, emsg(e), false); }
  };

  el.rankTabs.onclick = e => {
    const b = e.target.closest('.tab'); if (!b) return;
    [...el.rankTabs.children].forEach(t => t.classList.toggle('is-on', t === b));
    state.rank = b.dataset.r;
    el.watchNav.hidden = state.rank !== 'watch';
    loadRanking();
  };

  el.watchSel.onchange = () => { state.watchId = el.watchSel.value; loadRanking(); };

  $('#addWatch').onclick = async () => {
    const code = prompt('見たいチームの参加コード（8文字）', '');
    if (code === null || !code.trim()) return;
    try {
      const d = await api('/api/watching', { method: 'POST', body: { code: code.trim() } });
      await loadWatching();
      state.watchId = d.added.group_id;
      el.watchSel.value = state.watchId;
      loadRanking();
    } catch (e) { say(el.rmsg, emsg(e), false); }
  };

  /* マイページ */
  $('#saveNick').onclick = async () => {
    const v = el.nickInput.value.trim();
    if (!v) { say(el.mmsg, 'ニックネームを入力してください', false); return; }
    try {
      await api('/api/me', { method: 'PATCH', body: { nickname: v } });
      await loadMe(); say(el.mmsg, '保存しました', true);
    } catch (e) { say(el.mmsg, emsg(e), false); }
  };

  $('#saveGoal').onclick = () => {
    if (!cache.ready) { say(el.mmsg, 'サーバーに接続中です', false); return; }
    const raw = el.goalInput.value.trim();
    if (raw === '') { store.setGoal(null); renderLog(); say(el.mmsg, '目標を解除しました', true); return; }
    const v = normKg(raw);
    if (v === null) { say(el.mmsg, '目標体重を 20〜300kg で入力してください', false); return; }
    store.setGoal(v); el.goalInput.value = v.toFixed(1); renderLog();
    say(el.mmsg, '目標を保存しました', true);
  };

  $('#saveNotify').onclick = async () => {
    try {
      await api('/api/me', {
        method: 'PATCH',
        body: {
          notify_on: el.notifyOn.checked,
          notify_days: Number(el.notifyDays.value),
          notify_hour: Number(el.notifyHour.value),
        },
      });
      await loadMe(); say(el.nmsg, '通知設定を保存しました', true);
    } catch (e) { say(el.nmsg, emsg(e), false); }
  };

  $('#copyDeviceId').onclick = async () => {
    try { await navigator.clipboard.writeText(deviceId()); say(el.dmsg, '端末IDをコピーしました', true); }
    catch { say(el.dmsg, 'コピーできませんでした', false); }
  };

  $('#deleteAll').onclick = async () => {
    if (!confirm('すべてのデータを削除しますか？\n体重の記録も消えます。取り消せません。')) return;
    if (!confirm('本当に削除します。よろしいですか？')) return;
    try {
      await api('/api/me', { method: 'DELETE' });
      localStorage.removeItem(K_DEV);
      alert('削除しました。画面を読み込み直します。');
      location.reload();
    } catch (e) { say(el.dmsg, emsg(e), false); }
  };

  $$('.tabbtn').forEach(b => { b.onclick = () => switchView(b.dataset.v); });

  window.addEventListener('resize', () => { if (state.view === 'log') drawChart(); });
  renderLog();
}

/* ===== 起動 ===== */
async function boot() {
  try {
    await api('/api/register', { method: 'POST', body: { device_id: deviceId() } });
    await Promise.all([loadWeights(), loadMe()]);
    cache.ready = true;

    const today = todayYmdJST();
    if (cache.weights[today] !== undefined) el.kgInput.value = cache.weights[today].toFixed(1);
    renderLog();
  } catch (err) {
    say(el.msg, 'サーバーに接続できません：' + emsg(err), false);
  }
}

init();
boot();
