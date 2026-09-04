'use strict';

/* ============================================================
   みんやせ / tsuda-fx.js
   体重保存の直後に、前回記録との増減率に応じて
   津田さんの画像とコメントを一時表示する。

   ・app.js は一切変更しない（window.saveWeight を包むだけ）
   ・index.html / style.css の既存 ID・クラスは変更しない
   ・発火は #saveToday / #savePast からの保存のみ
     （履歴の編集・削除では出さない）
   ・初回記録と増減率0%は出さない
   ・演出内で例外が出ても保存処理は止めない
   ・動きは transform / opacity のみ。レイアウトを触らない
   ============================================================ */

(function () {

  /* ===== 設定 ===== */

  const LOCAL_DIR = './gazo/';   /* アプリに同梱されている場合 */

  /* 画像が同梱されていないときの取得先。
     index.html が定義する window.MINYASE_API_BASE を使う。 */
  const REMOTE_DIR =
    ((typeof window !== 'undefined' && window.MINYASE_API_BASE) || '') + '/gazo/';

  /* gazo フォルダの実ファイル名。リポジトリの現物に合わせている。 */
  const F_BEST = '260ADE23-FC00-4BBE-913C-143B54FCCA5D.png'; /* 260 */
  const F_GOOD = '122AF07F-6507-47EE-9A00-D47114A31AFB.png'; /* 122 */
  const F_OK   = '677F7DEA-24BB-430B-8EAC-9FA41CE88D12.png'; /* 677 */
  const F_TINY = '7BFCA8FD-B440-4049-A389-B6CC2C6B2EF4.png'; /* 7BF */
  const F_UP0  = 'A0D7EFB1-EE53-4055-8529-E8BA38B045AC.png'; /* A0D */
  const F_UP1  = 'E9ECE02D-1B3F-4021-ADC0-205B877A2A46.png'; /* E9E */
  const F_UP2  = '210929BF-D402-446F-8BE4-90FC71F893CE.png'; /* 210 */

  /* 段階の定義。
       hold   … 自動で閉じるまでの時間(ms)。派手なものは少し長く見せる
       spark  … 光の粒を舞わせるか
       label  … 補足行の頭に付ける短い評価 */
  const STAGES = {
    best: { file: F_BEST, text: 'かなりつだつだしてるねー', hold: 2400, spark: true,  label: '最高' },
    good: { file: F_GOOD, text: 'つだつだしてるぜ',         hold: 2100, spark: false, label: 'いい調子' },
    ok:   { file: F_OK,   text: 'その調子',                 hold: 1900, spark: false, label: '順調' },
    tiny: { file: F_TINY, text: 'その調子',                 hold: 1800, spark: false, label: '前進' },
    up0:  { file: F_UP0,  text: 'もっと頑張ろう',           hold: 1800, spark: false, label: 'ふむ' },
    up1:  { file: F_UP1,  text: '気合い入れて',             hold: 1900, spark: false, label: '注意' },
    up2:  { file: F_UP2,  text: '俺みたいになるよ',         hold: 2100, spark: false, label: '警報' },
  };

  /* 増減率(%) から段階IDを選ぶ。0%（および極小の誤差）は null。
       rate <= -1.5            → best
     -1.5 <  rate <= -0.8      → good
     -0.8 <  rate <= -0.3      → ok
     -0.3 <  rate <   0        → tiny
        0 <  rate <   0.3      → up0
      0.3 <= rate <   0.8      → up1
      0.8 <= rate             → up2                        */
  function stageIdOf(rate) {
    if (!isFinite(rate)) return null;
    if (Math.abs(rate) < 1e-9) return null;

    if (rate < 0) {
      if (rate <= -1.5) return 'best';
      if (rate <= -0.8) return 'good';
      if (rate <= -0.3) return 'ok';
      return 'tiny';
    }

    if (rate < 0.3) return 'up0';
    if (rate < 0.8) return 'up1';
    return 'up2';
  }

  /* ===== 前回記録の取得 =====
     app.js の store.all() は { 'YYYY-MM-DD': kg } の形。
     保存対象日より前で、いちばん新しい実記録を返す。 */
  function prevRecord(ymd) {
    if (typeof store === 'undefined' || !store || typeof store.all !== 'function') return null;

    const all = store.all();
    if (!all) return null;

    let bestYmd = null;

    for (const k of Object.keys(all)) {
      if (k >= ymd) continue;                       /* 同日と未来は除く */
      const v = Number(all[k]);
      if (!isFinite(v) || v <= 0) continue;
      if (bestYmd === null || k > bestYmd) bestYmd = k;
    }

    return bestYmd === null ? null : { ymd: bestYmd, kg: Number(all[bestYmd]) };
  }

  /* 「前進 ／ 前回比 -0.82% ／ 68.4 → 67.8kg」 */
  function subText(stage, rate, base, now) {
    const r = (rate > 0 ? '+' : '') + rate.toFixed(2) + '%';
    return `${stage.label} ／ 前回比 ${r} ／ ${base.toFixed(1)} → ${now.toFixed(1)}kg`;
  }

  /* 動きを控えるべき環境かどうか */
  function reduced() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (_) {
      return false;
    }
  }

  /* ===== 表示 ===== */

  let closeTimer = null;

  function close(node) {
    if (!node || !node.parentNode) return;
    clearTimeout(closeTimer);
    node.classList.add('tsuda-fx-out');
    setTimeout(() => { if (node.parentNode) node.parentNode.removeChild(node); }, 260);
  }

  function show(id, stage, rate, base, now) {
    /* 前の演出が残っていれば片付ける */
    const old = document.querySelector('.tsuda-fx');
    if (old) close(old);

    const wrap = document.createElement('div');
    wrap.className = 'tsuda-fx tsuda-fx-' + id + (rate < 0 ? ' tsuda-fx-down' : ' tsuda-fx-up');
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');

    const card = document.createElement('div');
    card.className = 'tsuda-fx-card';

    /* 画像とその背後の光の輪 */
    const stageBox = document.createElement('div');
    stageBox.className = 'tsuda-fx-stage';

    const halo = document.createElement('span');
    halo.className = 'tsuda-fx-halo';

    const img = document.createElement('img');
    img.className = 'tsuda-fx-img';
    img.alt = '';
    img.decoding = 'async';
    img.src = LOCAL_DIR + stage.file;

    /* 同梱されていなければサーバーから取り直す。それも失敗したら枠だけ残す。 */
    let retried = false;
    img.onerror = () => {
      if (!retried && REMOTE_DIR !== LOCAL_DIR) {
        retried = true;
        img.src = REMOTE_DIR + stage.file;
        return;
      }
      img.classList.add('tsuda-fx-noimg');
    };

    stageBox.append(halo, img);

    const msg = document.createElement('div');
    msg.className = 'tsuda-fx-msg';
    msg.textContent = stage.text;

    const sub = document.createElement('div');
    sub.className = 'tsuda-fx-sub';
    sub.textContent = subText(stage, rate, base, now);

    /* 残り時間の細い線 */
    const bar = document.createElement('div');
    bar.className = 'tsuda-fx-bar';
    const fill = document.createElement('span');
    bar.appendChild(fill);

    card.append(stageBox, msg, sub, bar);
    wrap.appendChild(card);

    /* 1番痩せたときだけ光の粒を舞わせる */
    if (stage.spark && !reduced()) {
      const field = document.createElement('div');
      field.className = 'tsuda-fx-sparks';

      for (let i = 0; i < 12; i++) {
        const s = document.createElement('i');
        s.className = 'tsuda-fx-spark';
        /* 位置・方向・速さを個別に散らす */
        s.style.setProperty('--x', (8 + Math.random() * 84).toFixed(2) + '%');
        s.style.setProperty('--dx', (Math.random() * 60 - 30).toFixed(1) + 'px');
        s.style.setProperty('--d', (0.05 + Math.random() * 0.5).toFixed(2) + 's');
        s.style.setProperty('--t', (1.1 + Math.random() * 0.7).toFixed(2) + 's');
        s.style.setProperty('--sz', (5 + Math.random() * 5).toFixed(1) + 'px');
        field.appendChild(s);
      }

      wrap.appendChild(field);
    }

    const hold = reduced() ? 1400 : stage.hold;

    /* 線のアニメーション時間を hold に合わせる */
    fill.style.animationDuration = hold + 'ms';

    wrap.addEventListener('click', () => close(wrap));

    document.body.appendChild(wrap);
    closeTimer = setTimeout(() => close(wrap), hold);
  }

  /* ===== 発火元の限定 =====
     通常の入力UI（今日の体重を記録／過去の体重を追加）だけを対象にする。
     app.js は onclick（バブリング）で拾うので、こちらは捕捉フェーズで先に印を付ける。 */

  let armed = false;

  document.addEventListener('click', e => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (!t.closest('#saveToday, #savePast')) return;

    armed = true;
    /* 日付不正などで saveWeight まで届かなかったときに印を残さない */
    setTimeout(() => { armed = false; }, 0);
  }, true);

  /* ===== saveWeight を包む ===== */

  const orig = window.saveWeight;

  if (typeof orig !== 'function') {
    /* app.js より前に読み込まれた場合。演出は出さないが本体は無傷。 */
    return;
  }

  window.saveWeight = function (ymd, kg) {
    let prev = null;
    const fire = armed;
    armed = false;

    /* 保存で cache が書き換わる前に前回記録を控える */
    if (fire) {
      try { prev = prevRecord(String(ymd)); } catch (_) { prev = null; }
    }

    const ok = orig.apply(this, arguments);

    if (ok === true && fire && prev) {
      try {
        const base = Number(prev.kg);
        const raw = Number(kg);

        if (isFinite(raw) && isFinite(base) && base > 0) {
          /* app.js の normKg と同じ丸め方に揃える */
          const now = Math.round(raw * 10) / 10;
          const rate = (now - base) / base * 100;
          const id = stageIdOf(rate);
          if (id) show(id, STAGES[id], rate, base, now);
        }
      } catch (_) {
        /* 演出の失敗は保存結果に影響させない */
      }
    }

    return ok;
  };

  /* ===== 先読み =====
     画像が大きいので、手が空いたときに温めておく。失敗しても無視。 */
  function preload() {
    try {
      for (const k of Object.keys(STAGES)) {
        const im = new Image();
        im.src = LOCAL_DIR + STAGES[k].file;
      }
    } catch (_) {}
  }

  if (typeof requestIdleCallback === 'function') requestIdleCallback(preload, { timeout: 4000 });
  else setTimeout(preload, 3000);

})();
