'use strict';

/* ============================================================
   みんやせ / tsuda-fx.js

   体重保存成功後に、
   前回記録との増減率に応じて津田さんがリアクションする。

   ・app.js は変更しない
   ・window.saveWeight をラップする
   ・今日の入力 / 過去入力のみ対象
   ・履歴編集や削除では表示しない
   ・初回記録は表示しない
   ・増減率 0% は表示しない
   ・演出でエラーが出ても保存処理には影響させない
   ============================================================ */

(function () {

  /* ============================================================
     画像
     ============================================================ */

  const LOCAL_DIR = './gazo/';

  const REMOTE_DIR =
    ((typeof window !== 'undefined' && window.MINYASE_API_BASE) || '') +
    '/gazo/';

  const F_BEST =
    '260ADE23-FC00-4BBE-913C-143B54FCCA5D.png';

  const F_GOOD =
    '122AF07F-6507-47EE-9A00-D47114A31AFB.png';

  const F_OK =
    '677F7DEA-24BB-430B-8EAC-9FA41CE88D12.png';

  const F_TINY =
    '7BFCA8FD-B440-4049-A389-B6CC2C6B2EF4.png';

  const F_UP0 =
    'A0D7EFB1-EE53-4055-8529-E8BA38B045AC.png';

  const F_UP1 =
    'E9ECE02D-1B3F-4021-ADC0-205B877A2A46.png';

  const F_UP2 =
    '210929BF-D402-446F-8BE4-90FC71F893CE.png';


  /* ============================================================
     判定段階
     ============================================================ */

  const STAGES = {

    best: {
      file: F_BEST,
      text: 'かなりつだつだしてるねー',
      hold: 2500,
      spark: true
    },

    good: {
      file: F_GOOD,
      text: 'つだつだしてるぜ',
      hold: 2250,
      spark: false
    },

    ok: {
      file: F_OK,
      text: 'その調子',
      hold: 2100,
      spark: false
    },

    tiny: {
      file: F_TINY,
      text: 'その調子',
      hold: 2000,
      spark: false
    },

    up0: {
      file: F_UP0,
      text: 'もっと頑張ろう',
      hold: 2050,
      spark: false
    },

    up1: {
      file: F_UP1,
      text: '気合い入れて',
      hold: 2150,
      spark: false
    },

    up2: {
      file: F_UP2,
      text: '俺みたいになるよ',
      hold: 2350,
      spark: false
    }

  };


  /* ============================================================
     増減率 → 段階
     ============================================================ */

  function stageIdOf(rate) {

    if (!isFinite(rate)) return null;

    if (Math.abs(rate) < 1e-9) {
      return null;
    }

    if (rate < 0) {

      if (rate <= -1.5) {
        return 'best';
      }

      if (rate <= -0.8) {
        return 'good';
      }

      if (rate <= -0.3) {
        return 'ok';
      }

      return 'tiny';
    }

    if (rate < 0.3) {
      return 'up0';
    }

    if (rate < 0.8) {
      return 'up1';
    }

    return 'up2';
  }


  /* ============================================================
     前回記録
     ============================================================ */

  function prevRecord(ymd) {

    if (
      typeof store === 'undefined' ||
      !store ||
      typeof store.all !== 'function'
    ) {
      return null;
    }

    const all = store.all();

    if (!all) {
      return null;
    }

    let bestYmd = null;

    for (const k of Object.keys(all)) {

      /* 同日と未来は除外 */
      if (k >= ymd) {
        continue;
      }

      const v = Number(all[k]);

      if (!isFinite(v) || v <= 0) {
        continue;
      }

      if (
        bestYmd === null ||
        k > bestYmd
      ) {
        bestYmd = k;
      }
    }

    if (bestYmd === null) {
      return null;
    }

    return {
      ymd: bestYmd,
      kg: Number(all[bestYmd])
    };
  }


  /* ============================================================
     表示する数値
     ============================================================ */

  function signed(value, digits) {

    const n = Number(value);

    if (!isFinite(n)) {
      return '';
    }

    const fixed = n.toFixed(digits);

    if (n > 0) {
      return '+' + fixed;
    }

    return fixed;
  }


  function subText(rate, base, now) {

    const percent =
      signed(rate, 2) + '%';

    const diff =
      Math.round((now - base) * 10) / 10;

    const kg =
      signed(diff, 1) + 'kg';

    return `前回比 ${percent} · ${kg}`;
  }


  /* ============================================================
     動きを減らす設定
     ============================================================ */

  function reduced() {

    try {

      return !!(
        window.matchMedia &&
        window
          .matchMedia('(prefers-reduced-motion: reduce)')
          .matches
      );

    } catch (_) {

      return false;
    }
  }


  /* ============================================================
     閉じる
     ============================================================ */

  let closeTimer = null;

  function close(node) {

    if (
      !node ||
      !node.parentNode
    ) {
      return;
    }

    clearTimeout(closeTimer);

    node.classList.add('tsuda-fx-out');

    setTimeout(() => {

      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }

    }, 280);
  }


  /* ============================================================
     紙吹雪
     ============================================================ */

  function appendSparks(wrap) {

    const field =
      document.createElement('div');

    field.className =
      'tsuda-fx-sparks';

    for (let i = 0; i < 16; i++) {

      const spark =
        document.createElement('i');

      spark.className =
        'tsuda-fx-spark';

      spark.style.setProperty(
        '--x',
        (8 + Math.random() * 84).toFixed(2) + '%'
      );

      spark.style.setProperty(
        '--dx',
        (Math.random() * 120 - 60).toFixed(1) + 'px'
      );

      spark.style.setProperty(
        '--d',
        (0.04 + Math.random() * 0.42).toFixed(2) + 's'
      );

      spark.style.setProperty(
        '--t',
        (1.05 + Math.random() * 0.65).toFixed(2) + 's'
      );

      spark.style.setProperty(
        '--sz',
        (5 + Math.random() * 5).toFixed(1) + 'px'
      );

      field.appendChild(spark);
    }

    wrap.appendChild(field);
  }


  /* ============================================================
     表示
     ============================================================ */

  function show(
    id,
    stage,
    rate,
    base,
    now
  ) {

    /* 既存演出があれば閉じる */
    const old =
      document.querySelector('.tsuda-fx');

    if (old) {
      close(old);
    }


    /* ---------- 全画面 ---------- */

    const wrap =
      document.createElement('div');

    wrap.className =
      'tsuda-fx ' +
      'tsuda-fx-' + id + ' ' +
      (rate < 0
        ? 'tsuda-fx-down'
        : 'tsuda-fx-up');

    wrap.setAttribute(
      'role',
      'status'
    );

    wrap.setAttribute(
      'aria-live',
      'polite'
    );


    /* ---------- 中身 ---------- */

    const card =
      document.createElement('div');

    card.className =
      'tsuda-fx-card';


    /* ---------- キャラクター ---------- */

    const stageBox =
      document.createElement('div');

    stageBox.className =
      'tsuda-fx-stage';


    const halo =
      document.createElement('span');

    halo.className =
      'tsuda-fx-halo';


    const img =
      document.createElement('img');

    img.className =
      'tsuda-fx-img';

    img.alt = '';

    img.decoding =
      'async';

    img.src =
      LOCAL_DIR + stage.file;


    /* ローカル画像が無ければWorkerから取得 */
    let retried = false;

    img.onerror = () => {

      if (
        !retried &&
        REMOTE_DIR !== LOCAL_DIR
      ) {

        retried = true;

        img.src =
          REMOTE_DIR + stage.file;

        return;
      }

      img.classList.add(
        'tsuda-fx-noimg'
      );
    };


    stageBox.append(
      halo,
      img
    );


    /* ---------- 吹き出し ---------- */

    const bubble =
      document.createElement('div');

    bubble.className =
      'tsuda-fx-bubble';


    const msg =
      document.createElement('div');

    msg.className =
      'tsuda-fx-msg';

    msg.textContent =
      stage.text;


    bubble.appendChild(msg);


    /* ---------- 前回比 ---------- */

    const sub =
      document.createElement('div');

    sub.className =
      'tsuda-fx-sub';

    sub.textContent =
      subText(
        rate,
        base,
        now
      );


    /* ---------- タイマー線 ---------- */

    const bar =
      document.createElement('div');

    bar.className =
      'tsuda-fx-bar';


    const fill =
      document.createElement('span');

    bar.appendChild(fill);


    /* ---------- 組み立て ---------- */

    card.append(
      stageBox,
      bubble,
      sub,
      bar
    );

    wrap.appendChild(card);


    /* ---------- 最高評価だけ紙吹雪 ---------- */

    if (
      stage.spark &&
      !reduced()
    ) {

      appendSparks(wrap);
    }


    /* ---------- 表示時間 ---------- */

    const hold =
      reduced()
        ? 1500
        : stage.hold;


    fill.style.animationDuration =
      hold + 'ms';


    /* ---------- タップで閉じる ---------- */

    wrap.addEventListener(
      'click',
      () => close(wrap)
    );


    /* ---------- 表示 ---------- */

    document.body.appendChild(wrap);


    closeTimer =
      setTimeout(
        () => close(wrap),
        hold
      );
  }


  /* ============================================================
     通常入力からの保存だけ対象にする
     ============================================================ */

  let armed = false;

  document.addEventListener(
    'click',
    e => {

      const target =
        e.target;

      if (
        !target ||
        !target.closest
      ) {
        return;
      }

      if (
        !target.closest(
          '#saveToday, #savePast'
        )
      ) {
        return;
      }

      armed = true;


      /* saveWeightに到達しなかった場合に解除 */
      setTimeout(
        () => {
          armed = false;
        },
        0
      );
    },
    true
  );


  /* ============================================================
     saveWeight ラップ
     ============================================================ */

  const originalSaveWeight =
    window.saveWeight;


  if (
    typeof originalSaveWeight !==
    'function'
  ) {

    return;
  }


  window.saveWeight =
    function (ymd, kg) {

      let prev = null;

      const fire =
        armed;

      armed =
        false;


      /*
       * 保存前に前回記録を取得
       * 保存後だと同日の値がキャッシュに入るため
       */
      if (fire) {

        try {

          prev =
            prevRecord(
              String(ymd)
            );

        } catch (_) {

          prev = null;
        }
      }


      /* 本来の保存 */
      const ok =
        originalSaveWeight
          .apply(
            this,
            arguments
          );


      /*
       * 保存成功時だけ演出
       */
      if (
        ok === true &&
        fire &&
        prev
      ) {

        try {

          const base =
            Number(prev.kg);

          const raw =
            Number(kg);


          if (
            isFinite(raw) &&
            isFinite(base) &&
            base > 0
          ) {

            /*
             * app.jsと同じく0.1kg単位
             */
            const now =
              Math.round(
                raw * 10
              ) / 10;


            /*
             * 前回体重からの増減率
             */
            const rate =
              (
                (now - base) /
                base
              ) * 100;


            const id =
              stageIdOf(rate);


            if (id) {

              show(
                id,
                STAGES[id],
                rate,
                base,
                now
              );
            }
          }

        } catch (_) {

          /*
           * 演出エラーで
           * 保存結果を壊さない
           */
        }
      }


      return ok;
    };


  /* ============================================================
     画像先読み
     ============================================================ */

  function preload() {

    try {

      for (
        const key
        of Object.keys(STAGES)
      ) {

        const img =
          new Image();

        img.src =
          LOCAL_DIR +
          STAGES[key].file;
      }

    } catch (_) {
      /* 無視 */
    }
  }


  if (
    typeof requestIdleCallback ===
    'function'
  ) {

    requestIdleCallback(
      preload,
      {
        timeout:4000
      }
    );

  } else {

    setTimeout(
      preload,
      2500
    );
  }

})();
