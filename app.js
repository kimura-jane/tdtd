'use strict';

/* ===== ストレージ（ステップ2でサーバー同期に差し替える層） ===== */
const K_W = 'tsudatsu.weights.v1';   // { "2026-09-02": 72.4, ... }
const K_G = 'tsudatsu.goal.v1';

const store = {
  all() {
    try { return JSON.parse(localStorage.getItem(K_W) || '{}'); }
    catch { return {}; }
  },
  put(ymd, kg) {
    const o = this.all();
    o[ymd] = kg;                       // 同日は後勝ち
    localStorage.setItem(K_W, JSON.stringify(o));
  },
  del(ymd) {
    const o = this.all();
    delete o[ymd];
    localStorage.setItem(K_W, JSON.stringify(o));
  },
  goal() {
    const v = parseFloat(localStorage.getItem(K_G));
    return Number.isFinite(v) ? v : null;
  },
  setGoal(v) {
    if (v === null) localStorage.removeItem(K_G);
    else localStorage.setItem(K_G, String(v));
  }
};

/* ===== JST 日付ユーティリティ ===== */
const JST_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
});
function todayYmdJST() {
  const p = JST_FMT.formatToParts(new Date());
  const g = t => p.find(x => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
function ymdToDay(ymd) {                       // JST 0時基準の連番
  return Math.round(Date.parse(ymd + 'T00:00:00+09:00') / 86400000);
}
function dayToYmd(day) {
  const d = new Date(day * 86400000);
  const p = JST_FMT.formatToParts(d);
  const g = t => p.find(x => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
function addDaysYmd(ymd, n) { return dayToYmd(ymdToDay(ymd) + n); }
function fmtJp(ymd) {
  const [, m, d] = ymd.split('-');
  return `${Number(m)}月${Number(d)}日`;
}
function fmtJpFull(ymd) {
  const [y, m, d] = ymd.split('-');
  return `${y}年${Number(m)}月${Number(d)}日`;
}

/* ===== 体重の正規化 ===== */
function normKg(raw) {
  const v = parseFloat(raw);
  if (!Number.isFinite(v)) return null;
  const r = Math.round(v * 10) / 10;           // 0.1kg 刻み
  if (r < 20 || r > 300) return null;
  return r;
}

/* ===== 表示状態 ===== */
const state = { period: 'week', offset: 0 };   // offset=0 が「今」を含む区間

const $ = s => document.querySelector(s);
const el = {
  todayLabel: $('#todayLabel'), kgInput: $('#kgInput'),
  msg: $('#msg'), pastBox: $('#pastBox'), pastYmd: $('#pastYmd'), pastKg: $('#pastKg'),
  chart: $('#chart'), rangeLabel: $('#rangeLabel'), summary: $('#summary'),
  hist: $('#hist'), goalInput: $('#goalInput'), tabs: $('#periodTabs')
};

let msgTimer = null;
function say(text, ok) {
  el.msg.textContent = text;
  el.msg.className = 'msg ' + (ok ? 'ok' : 'ng');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { el.msg.textContent = ''; el.msg.className = 'msg'; }, 2600);
}

/* ===== 保存 ===== */
function saveWeight(ymd, kg) {
  const today = todayYmdJST();
  if (ymd > today) { say('未来の日付は登録できません', false); return false; }
  const v = normKg(kg);
  if (v === null) { say('体重を 20〜300kg の範囲で入力してください', false); return false; }
  store.put(ymd, v);
  render();
  say(`${fmtJp(ymd)} を ${v.toFixed(1)}kg で記録しました`, true);
  return true;
}

/* ===== 期間の算出 ===== */
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
    const first = `${y}-${mm}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return {
      from: ymdToDay(first),
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
  c.width = Math.round(cssW * dpr);
  c.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const pad = { l: 42, r: 12, t: 14, b: 24 };
  const W = cssW - pad.l - pad.r, H = cssH - pad.t - pad.b;
  const all = store.all();
  const { from, to } = currentRange();

  // 区間内の実測点
  const pts = Object.keys(all)
    .map(ymd => ({ ymd, day: ymdToDay(ymd), kg: all[ymd] }))
    .filter(p => p.day >= from && p.day <= to)
    .sort((a, b) => a.day - b.day);

  // 区間開始時点の「継続値」（区間より前の最新の実測）
  const before = Object.keys(all)
    .map(ymd => ({ day: ymdToDay(ymd), kg: all[ymd] }))
    .filter(p => p.day < from)
    .sort((a, b) => a.day - b.day).pop();

  ctx.font = '10px -apple-system,sans-serif';
  ctx.textBaseline = 'middle';

  if (!pts.length && !before) {
    ctx.fillStyle = '#8a8a8a';
    ctx.textAlign = 'center';
    ctx.fillText('この期間の記録はありません', cssW / 2, cssH / 2);
    return;
  }

  // Y レンジ（目標ラインも含める・最小 0.5kg の余白）
  const goal = store.goal();
  const vals = pts.map(p => p.kg);
  if (before) vals.push(before.kg);
  if (goal !== null) vals.push(goal);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const MIN_SPAN = 0.5;
  if (hi - lo < MIN_SPAN) {
    const mid = (hi + lo) / 2;
    lo = mid - MIN_SPAN / 2; hi = mid + MIN_SPAN / 2;
  }
  const margin = (hi - lo) * 0.12;
  lo -= margin; hi += margin;

  const x = day => pad.l + (to === from ? W / 2 : (day - from) / (to - from) * W);
  const y = kg => pad.t + (hi - kg) / (hi - lo) * H;

  // 横グリッド + Y ラベル
  ctx.strokeStyle = '#f0eeea'; ctx.lineWidth = 1; ctx.textAlign = 'right';
  ctx.fillStyle = '#a5a29d';
  for (let i = 0; i <= 4; i++) {
    const kg = lo + (hi - lo) * i / 4, yy = Math.round(y(kg)) + .5;
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(cssW - pad.r, yy); ctx.stroke();
    ctx.fillText(kg.toFixed(1), pad.l - 6, yy);
  }

  // 目標ライン
  if (goal !== null && goal >= lo && goal <= hi) {
    ctx.save();
    ctx.setLineDash([2, 3]); ctx.strokeStyle = '#7aa3c9'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(pad.l, y(goal)); ctx.lineTo(cssW - pad.r, y(goal)); ctx.stroke();
    ctx.restore();
  }

  // 折れ線（連続日は実線 / 欠損は前の値で水平に破線）
  const seq = [];
  if (before) seq.push({ day: from, kg: before.kg, virtual: true });
  seq.push(...pts);

  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i];
    ctx.strokeStyle = '#e2725b'; ctx.lineWidth = 2;
    if (b.day - a.day === 1 && !a.virtual) {
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x(a.day), y(a.kg)); ctx.lineTo(x(b.day), y(b.kg)); ctx.stroke();
    } else {
      ctx.setLineDash([3, 3]); ctx.strokeStyle = '#c9948a'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x(a.day), y(a.kg));
      ctx.lineTo(x(b.day), y(a.kg));    // サボった期間 = 水平
      ctx.lineTo(x(b.day), y(b.kg));    // 実測日に垂直で合わせる
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // 最新実測より後ろも前の値で継続
  const last = pts[pts.length - 1] || (before ? { day: from, kg: before.kg } : null);
  const tDay = ymdToDay(todayYmdJST());
  const rightEnd = Math.min(to, tDay);
  if (last && rightEnd > last.day) {
    ctx.save();
    ctx.setLineDash([3, 3]); ctx.strokeStyle = '#c9948a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x(last.day), y(last.kg)); ctx.lineTo(x(rightEnd), y(last.kg)); ctx.stroke();
    ctx.restore();
  }

  // 実測点（丸）
  ctx.fillStyle = '#e2725b';
  for (const p of pts) {
    ctx.beginPath(); ctx.arc(x(p.day), y(p.kg), 3.2, 0, Math.PI * 2); ctx.fill();
  }

  // X ラベル（両端のみ）
  ctx.fillStyle = '#a5a29d'; ctx.textAlign = 'left';
  ctx.fillText(fmtJp(dayToYmd(from)), pad.l, cssH - pad.b / 2);
  ctx.textAlign = 'right';
  ctx.fillText(fmtJp(dayToYmd(to)), cssW - pad.r, cssH - pad.b / 2);
}

/* ===== サマリ ===== */
function drawSummary() {
  const all = store.all();
  const keys = Object.keys(all).sort();
  if (!keys.length) { el.summary.textContent = ''; return; }
  const first = all[keys[0]], last = all[keys[keys.length - 1]];
  const d = last - first;
  const sign = d <= 0 ? '' : '+';
  let s = `記録 ${keys.length}件 ／ 開始 ${first.toFixed(1)}kg → 最新 ${last.toFixed(1)}kg（${sign}${d.toFixed(1)}kg）`;
  const goal = store.goal();
  if (goal !== null) {
    const rest = last - goal;
    s += rest > 0 ? ` ／ 目標まで あと ${rest.toFixed(1)}kg` : ' ／ 目標達成';
  }
  el.summary.textContent = s;
}

/* ===== 履歴 ===== */
function drawHist() {
  const all = store.all();
  const keys = Object.keys(all).sort().reverse();
  el.hist.innerHTML = '';
  if (!keys.length) {
    el.hist.innerHTML = '<li class="empty">まだ記録がありません</li>';
    return;
  }
  for (let i = 0; i < keys.length; i++) {
    const ymd = keys[i], kg = all[ymd];
    const prev = keys[i + 1] ? all[keys[i + 1]] : null;   // 1つ前の記録日との差
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

    const eBtn = document.createElement('button');
    eBtn.type = 'button'; eBtn.textContent = '編集';
    eBtn.onclick = () => {
      const v = prompt(`${fmtJpFull(ymd)} の体重`, kg.toFixed(1));
      if (v === null) return;
      saveWeight(ymd, v);
    };

    const dBtn = document.createElement('button');
    dBtn.type = 'button'; dBtn.textContent = '削除';
    dBtn.onclick = () => {
      if (!confirm(`${fmtJpFull(ymd)} の記録を削除しますか？`)) return;
      store.del(ymd); render(); say('削除しました', true);
    };

    li.append(d, k, df, eBtn, dBtn);
    el.hist.appendChild(li);
  }
}

function render() { drawChart(); drawSummary(); drawHist(); el.rangeLabel.textContent = currentRange().label; }

/* ===== 初期化 ===== */
function init() {
  const today = todayYmdJST();
  el.todayLabel.textContent = fmtJpFull(today) + ' の体重';
  el.pastYmd.max = today;
  el.pastYmd.value = today;

  const all = store.all();
  if (all[today] !== undefined) el.kgInput.value = all[today].toFixed(1);
  const g = store.goal();
  if (g !== null) el.goalInput.value = g.toFixed(1);

  const bump = n => {
    const base = normKg(el.kgInput.value) ?? (Object.values(all).pop() ?? 60);
    el.kgInput.value = (Math.round((base + n) * 10) / 10).toFixed(1);
  };
  $('#plus').onclick = () => bump(0.1);
  $('#minus').onclick = () => bump(-0.1);

  $('#saveToday').onclick = () => saveWeight(todayYmdJST(), el.kgInput.value);

  $('#openPast').onclick = () => { el.pastBox.hidden = false; el.pastKg.focus(); };
  $('#closePast').onclick = () => { el.pastBox.hidden = true; };
  $('#savePast').onclick = () => {
    const ymd = el.pastYmd.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) { say('日付を選んでください', false); return; }
    if (saveWeight(ymd, el.pastKg.value)) el.pastKg.value = '';
  };

  $('#saveGoal').onclick = () => {
    const raw = el.goalInput.value.trim();
    if (raw === '') { store.setGoal(null); render(); say('目標を解除しました', true); return; }
    const v = normKg(raw);
    if (v === null) { say('目標体重を 20〜300kg で入力してください', false); return; }
    store.setGoal(v); el.goalInput.value = v.toFixed(1); render(); say('目標を保存しました', true);
  };

  el.tabs.onclick = e => {
    const b = e.target.closest('.tab'); if (!b) return;
    [...el.tabs.children].forEach(t => t.classList.toggle('is-on', t === b));
    state.period = b.dataset.p; state.offset = 0; render();
  };
  $('#prevRange').onclick = () => { state.offset--; render(); };
  $('#nextRange').onclick = () => { if (state.offset < 0) state.offset++; render(); };

  window.addEventListener('resize', drawChart);
  render();
}
init();
