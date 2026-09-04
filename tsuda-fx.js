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
   ============================================================ */

(function () {

  /* ===== 設定 ===== */

  const HOLD_MS = 1800;          /* 自動で閉じるまで */
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

  /* 段階の定義。上から順に判定する。 */
  const STAGES = [
    { id: 'best', max: -1.5, file: F_BEST, text: 'かなりつだつだしてるねー' },
    { id: 'good', max: -0.8, file: F_GOOD, text: 'つだつだしてるぜ' },
    { id: 'ok',   max: -0.3, file: F_OK,   text: 'その調子' },
    { id: 'tiny', max:  0,   file: F_TINY, text: 'その調子' },
    { id: 'up0',  max:  0.3, file: F_UP0,  text: 'もっと頑張ろう' },
    { id: 'up1',  max:  0.8, file: F_UP1,  text: '気合い入れて' },
    { id: 'up2',  max:  Infinity, file: F_UP2, text: '俺みたいになるよ' },
  ];

  /* 増減率(%) から段階を選ぶ。0%（および極小の誤差）は null。
       rate <= -1.5            → best
     -1.5 <  rate <= -0.8      → good
     -0.8 <  rate <= -0.3      → ok
     -0.3 <  rate <   0        → tiny
        0 <  rate <   0.3      → up0
      0.3 <= rate <   0.8      → up1
      0.8 <= rate             → up2                        */
  function stageOf(rate) {
    if (!isFinite(rate)) return null;
    if (Math.abs(rate) < 1e-9) return null;

    if (rate < 0) {
      if (rate <= -1.5) return STAGES[0];
      if (rate <= -0.8) return STAGES[1];
      if (rate <= -0.3) return STAGES[2];
      return STAGES[3];
    }

    if (rate < 0.3) return STAGES[4];
    if (rate < 0.8) return STAGES[5];
    return STAGES[6];
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

  function fmtRate(rate) {
    return '前回比 ' + (rate > 0 ? '+' : '') + rate.toFixed(2) + '%';
  }

  /* ===== 表示 ===== */

  let closeTimer = null;

  function close(node) {
    if (!node || !node.parentNode) return;
    node.classList.add('tsuda-fx-out');
    setTimeout(() => { if (node.parentNode) node.parentNode.removeChild(node); }, 220);
  }

  function show(stage, rate) {
    /* 前の演出が残っていれば片付ける */
    const old = document.querySelector('.tsuda-fx');
    if (old) { clearTimeout(closeTimer); close(old); }

    const wrap = document.createElement('div');
    wrap.className = 'tsuda-fx tsuda-fx-' + stage.id;
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');

    const card = document.createElement('div');
    card.className = 'tsuda-fx-card';

    const img = document.createElement('img');
    img.className = 'tsuda-fx-img';
    img.alt = '';
    img.decoding = 'async';
    img.src = LOCAL_DIR + stage.file;

    /* 同梱されていなければサーバーから取り直す。それも失敗したら画像だけ消す。 */
    let retried = false;
    img.onerror = () => {
      if (!retried && REMOTE_DIR !== LOCAL_DIR) {
        retried = true;
        img.src = REMOTE_DIR + stage.file;
        return;
      }
      img.remove();
    };

    const msg = document.createElement('div');
    msg.className = 'tsuda-fx-msg';
    msg.textContent = stage.text;

    const sub = document.createElement('div');
    sub.className = 'tsuda-fx-sub';
    sub.textContent = fmtRate(rate);

    card.append(img, msg, sub);
    wrap.appendChild(card);

    wrap.addEventListener('click', () => { clearTimeout(closeTimer); close(wrap); });

    document.body.appendChild(wrap);
    closeTimer = setTimeout(() => close(wrap), HOLD_MS);
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
        const now = Number(kg);
        const base = Number(prev.kg);

        if (isFinite(now) && isFinite(base) && base > 0) {
          /* app.js の normKg と同じ丸め方に揃える */
          const v = Math.round(now * 10) / 10;
          const rate = (v - base) / base * 100;
          const stage = stageOf(rate);
          if (stage) show(stage, rate);
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
      for (const s of STAGES) {
        const im = new Image();
        im.src = LOCAL_DIR + s.file;
      }
    } catch (_) {}
  }

  if (typeof requestIdleCallback === 'function') requestIdleCallback(preload, { timeout: 4000 });
  else setTimeout(preload, 3000);

})();
