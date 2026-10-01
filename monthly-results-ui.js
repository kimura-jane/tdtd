'use strict';

/* ============================================================
   みんやせ / monthly-results-ui.js

   月間正式結果表示
   ------------------------------------------------------------
   ・正式結果確定から7日間
     →「つだつダイエット部」の最上部に表示

   ・7日経過後
     → 上部から消える
     → 既存「過去の月曜日履歴」の直下へ
        「月間結果履歴」として表示

   ・正式結果はAPIの保存済みスナップショットを表示
   ・体重を後から編集しても、この画面では再計算しない
   ============================================================ */

(() => {

  const API =
    (
      typeof window !==
        'undefined' &&
      window.MINYASE_API_BASE
    ) ||
    '';


  const DEVICE_KEY =
    'tsudatsu.device_id.v1';


  const MEDALS = [
    '🥇',
    '🥈',
    '🥉',
  ];


  let resultData = {
    current:
      null,

    history:
      [],
  };


  let loading =
    false;


  let observer =
    null;


  let renderTimer =
    null;


  /* ==========================================================
     小物
     ========================================================== */

  function deviceId() {

    return localStorage.getItem(
      DEVICE_KEY
    ) || '';
  }


  function activeRankScope() {

    const active =
      document.querySelector(
        '#rankTabs .tab.is-on'
      );


    if (
      !active ||
      !active.dataset
    ) {

      return '';
    }


    return String(
      active.dataset.r ||
      ''
    );
  }


  function parseYmd(ymd) {

    const match =
      /^(\d{4})-(\d{2})-(\d{2})$/
        .exec(
          String(
            ymd ||
            ''
          )
        );


    if (!match) {

      return null;
    }


    return {
      year:
        Number(
          match[1]
        ),

      month:
        Number(
          match[2]
        ),

      day:
        Number(
          match[3]
        ),
    };
  }


  function dateText(ymd) {

    const p =
      parseYmd(
        ymd
      );


    if (!p) {

      return String(
        ymd ||
        ''
      );
    }


    return (
      p.month +
      '月' +
      p.day +
      '日'
    );
  }


  function periodText(result) {

    if (!result) {

      return '';
    }


    return (
      dateText(
        result.period_start
      ) +
      '〜' +
      dateText(
        result.period_end
      )
    );
  }


  /*
   * APIでは
   *
   * loss_kg = 開始合計 - 終了合計
   *
   * なので、
   * 22.2kg減量 → loss_kg=22.2
   *
   * 正式結果の表示仕様では
   * 「-22.2kg」と表示する。
   */
  function resultKgText(value) {

    const loss =
      Number(
        value
      );


    if (
      !Number.isFinite(
        loss
      )
    ) {

      return '—';
    }


    const change =
      Math.round(
        (
          -loss
        ) *
        10
      ) /
      10;


    if (
      Object.is(
        change,
        -0
      ) ||
      change ===
        0
    ) {

      return '0.0kg';
    }


    return (
      (
        change >
        0
          ? '+'
          : ''
      ) +
      change.toFixed(
        1
      ) +
      'kg'
    );
  }


  function safeRankings(result) {

    return (
      result &&
      Array.isArray(
        result.rankings
      )
    )
      ? result.rankings
          .slice(
            0,
            3
          )
      : [];
  }


  /* ==========================================================
     API
     ========================================================== */

  async function requestResults() {

    const did =
      deviceId();


    if (!did) {

      throw new Error(
        'not_registered'
      );
    }


    let response;


    try {

      response =
        await fetch(
          API +
          '/api/vote/current',
          {
            method:
              'GET',

            headers: {
              'x-device-id':
                did,
            },

            cache:
              'no-store',
          }
        );

    } catch (_) {

      throw new Error(
        'network_error'
      );
    }


    let data = {};


    try {

      data =
        await response.json();

    } catch {}


    if (
      !response.ok ||
      data.ok ===
        false
    ) {

      throw new Error(
        data.error ||
        (
          'http_' +
          response.status
        )
      );
    }


    const monthly =
      data &&
      data.monthly_results &&
      typeof data.monthly_results ===
        'object'
        ? data.monthly_results
        : null;


    return {
      current:
        monthly &&
        monthly.current
          ? monthly.current
          : null,

      history:
        monthly &&
        Array.isArray(
          monthly.history
        )
          ? monthly.history
          : [],
    };
  }


  /* ==========================================================
     CSS
     ========================================================== */

  function addStyle() {

    if (
      document.getElementById(
        'monthlyResultsUiStyle'
      )
    ) {

      return;
    }


    const style =
      document.createElement(
        'style'
      );


    style.id =
      'monthlyResultsUiStyle';


    style.textContent = `
.monthly-result-current{
  margin:0 0 14px;
  padding:15px 14px;
  border:1px solid rgba(216,169,29,.28);
  border-radius:20px;
  background:
    radial-gradient(
      circle at 100% 0%,
      rgba(255,216,79,.20),
      transparent 40%
    ),
    linear-gradient(
      180deg,
      #fffef8 0%,
      #fffaf0 100%
    );
  box-shadow:
    0 6px 20px
    rgba(82,57,35,.07)
}

.monthly-result-current-kicker{
  margin:0 0 4px;
  color:#9b7614;
  font-size:10px;
  font-weight:900;
  letter-spacing:.04em
}

.monthly-result-current-title{
  margin:0 0 12px;
  color:var(--ink,#181614);
  font-size:17px;
  font-weight:900;
  line-height:1.45
}

.monthly-result-current-list{
  display:grid;
  gap:7px
}

.monthly-result-current-row{
  display:grid;
  grid-template-columns:
    30px minmax(0,1fr) auto;
  gap:8px;
  align-items:center;
  min-width:0;
  padding:10px 11px;
  border:1px solid
    var(--line2,#f4ede6);
  border-radius:14px;
  background:rgba(255,255,255,.90)
}

.monthly-result-current-medal{
  font-size:20px;
  line-height:1;
  text-align:center
}

.monthly-result-current-team{
  overflow:hidden;
  min-width:0;
  color:var(--ink,#181614);
  font-size:14px;
  font-weight:900;
  text-overflow:ellipsis;
  white-space:nowrap
}

.monthly-result-current-kg{
  color:var(--ink2,#4b433d);
  font-size:14px;
  font-variant-numeric:tabular-nums;
  font-weight:900;
  white-space:nowrap
}

.monthly-results-history{
  margin:15px 0 2px;
  padding:13px 14px;
  border:1px solid
    var(--line,#eee5dc);
  border-radius:18px;
  background:rgba(255,255,255,.72)
}

.monthly-results-history-title{
  margin:0 0 7px;
  color:var(--ink,#181614);
  font-size:13px;
  font-weight:900
}

.monthly-results-history-list{
  display:grid;
  gap:0
}

.monthly-results-history-item{
  padding:12px 0;
  border-top:1px solid
    var(--line2,#f4ede6)
}

.monthly-results-history-item:first-child{
  border-top:0
}

.monthly-results-history-period{
  margin:0 0 8px;
  color:var(--ink2,#4b433d);
  font-size:12px;
  font-weight:900
}

.monthly-results-history-ranking{
  display:grid;
  gap:5px
}

.monthly-results-history-row{
  display:grid;
  grid-template-columns:
    25px minmax(0,1fr) auto;
  gap:7px;
  align-items:center;
  min-width:0
}

.monthly-results-history-medal{
  font-size:15px;
  line-height:1;
  text-align:center
}

.monthly-results-history-team{
  overflow:hidden;
  min-width:0;
  color:var(--ink,#181614);
  font-size:12px;
  font-weight:800;
  text-overflow:ellipsis;
  white-space:nowrap
}

.monthly-results-history-kg{
  color:var(--ink2,#4b433d);
  font-size:12px;
  font-variant-numeric:tabular-nums;
  font-weight:900;
  white-space:nowrap
}

@media(max-width:380px){

  .monthly-result-current{
    padding:13px 12px
  }

  .monthly-result-current-title{
    font-size:16px
  }

  .monthly-result-current-row{
    grid-template-columns:
      27px minmax(0,1fr) auto;
    gap:6px;
    padding:9px
  }

  .monthly-result-current-team,
  .monthly-result-current-kg{
    font-size:13px
  }
}
`;


    document.head
      .appendChild(
        style
      );
  }


  /* ==========================================================
     上部結果発表
     ========================================================== */

  function removeCurrentCard() {

    const old =
      document.getElementById(
        'monthlyResultCurrent'
      );


    if (old) {

      old.remove();
    }
  }


  function buildCurrentCard(
    result
  ) {

    const rankings =
      safeRankings(
        result
      );


    if (
      !rankings.length
    ) {

      return null;
    }


    const card =
      document.createElement(
        'section'
      );


    card.id =
      'monthlyResultCurrent';

    card.className =
      'monthly-result-current';


    const kicker =
      document.createElement(
        'p'
      );


    kicker.className =
      'monthly-result-current-kicker';

    kicker.textContent =
      'つだつダイエット部';


    const title =
      document.createElement(
        'h3'
      );


    title.className =
      'monthly-result-current-title';

    title.textContent =
      '🏆 ' +
      periodText(
        result
      ) +
      'の結果発表';


    const list =
      document.createElement(
        'div'
      );


    list.className =
      'monthly-result-current-list';


    rankings.forEach(
      (
        row,
        index
      ) => {

        const item =
          document.createElement(
            'div'
          );


        item.className =
          'monthly-result-current-row';


        const medal =
          document.createElement(
            'span'
          );


        medal.className =
          'monthly-result-current-medal';

        medal.textContent =
          MEDALS[index] ||
          (
            String(
              index + 1
            ) +
            '位'
          );


        const team =
          document.createElement(
            'span'
          );


        team.className =
          'monthly-result-current-team';

        team.textContent =
          (
            index +
            1
          ) +
          '位 ' +
          (
            row.team_name ||
            row.team_id ||
            '—'
          );


        const kg =
          document.createElement(
            'span'
          );


        kg.className =
          'monthly-result-current-kg';

        kg.textContent =
          resultKgText(
            row.loss_kg
          );


        item.append(
          medal,
          team,
          kg
        );


        list.appendChild(
          item
        );
      }
    );


    card.append(
      kicker,
      title,
      list
    );


    return card;
  }


  function renderCurrentCard() {

    const panel =
      document.getElementById(
        'clubPanel'
      );


    const result =
      resultData.current;


    if (
      !panel ||
      !result
    ) {

      removeCurrentCard();

      return;
    }


    removeCurrentCard();


    const card =
      buildCurrentCard(
        result
      );


    if (!card) {

      return;
    }


    panel.insertBefore(
      card,
      panel.firstChild
    );
  }


  /* ==========================================================
     月間結果履歴
     ========================================================== */

  function removeHistory() {

    const old =
      document.getElementById(
        'monthlyResultsHistory'
      );


    if (old) {

      old.remove();
    }
  }


  function buildHistory(
    results
  ) {

    if (
      !Array.isArray(
        results
      ) ||
      !results.length
    ) {

      return null;
    }


    const section =
      document.createElement(
        'section'
      );


    section.id =
      'monthlyResultsHistory';

    section.className =
      'monthly-results-history';


    const title =
      document.createElement(
        'h3'
      );


    title.className =
      'monthly-results-history-title';

    title.textContent =
      '月間結果履歴';


    const list =
      document.createElement(
        'div'
      );


    list.className =
      'monthly-results-history-list';


    for (
      const result of
      results
    ) {

      const item =
        document.createElement(
          'div'
        );


      item.className =
        'monthly-results-history-item';


      const period =
        document.createElement(
          'div'
        );


      period.className =
        'monthly-results-history-period';

      period.textContent =
        '🏆 ' +
        periodText(
          result
        );


      const ranking =
        document.createElement(
          'div'
        );


      ranking.className =
        'monthly-results-history-ranking';


      safeRankings(
        result
      )
        .forEach(
          (
            row,
            index
          ) => {

            const line =
              document.createElement(
                'div'
              );


            line.className =
              'monthly-results-history-row';


            const medal =
              document.createElement(
                'span'
              );


            medal.className =
              'monthly-results-history-medal';

            medal.textContent =
              MEDALS[index] ||
              (
                String(
                  index + 1
                ) +
                '位'
              );


            const team =
              document.createElement(
                'span'
              );


            team.className =
              'monthly-results-history-team';

            team.textContent =
              (
                index +
                1
              ) +
              '位 ' +
              (
                row.team_name ||
                row.team_id ||
                '—'
              );


            const kg =
              document.createElement(
                'span'
              );


            kg.className =
              'monthly-results-history-kg';

            kg.textContent =
              resultKgText(
                row.loss_kg
              );


            line.append(
              medal,
              team,
              kg
            );


            ranking.appendChild(
              line
            );
          }
        );


      item.append(
        period,
        ranking
      );


      list.appendChild(
        item
      );
    }


    section.append(
      title,
      list
    );


    return section;
  }


  function renderHistory() {

    const results =
      Array.isArray(
        resultData.history
      )
        ? resultData.history
        : [];


    if (!results.length) {

      removeHistory();

      return;
    }


    const weekly =
      document.querySelector(
        '.weekly-summary-history'
      );


    const rankList =
      document.getElementById(
        'rankList'
      );


    const anchor =
      weekly ||
      rankList;


    if (!anchor) {

      removeHistory();

      return;
    }


    removeHistory();


    const section =
      buildHistory(
        results
      );


    if (!section) {

      return;
    }


    anchor.insertAdjacentElement(
      'afterend',
      section
    );


    /*
     * 月間履歴は
     * 「過去の月曜日履歴」の下で見るもの。
     *
     * つだつダイエット部タブでは
     * clubPanelだけを表示するため、
     * 月間履歴側も隠す。
     */
    const scope =
      activeRankScope();


    section.hidden =
      !(
        scope ===
          'mine' ||
        scope ===
          'watch'
      );
  }


  function syncHistoryVisibility() {

    const history =
      document.getElementById(
        'monthlyResultsHistory'
      );


    if (!history) {

      return;
    }


    const scope =
      activeRankScope();


    history.hidden =
      !(
        scope ===
          'mine' ||
        scope ===
          'watch'
      );
  }


  /* ==========================================================
     DOM再描画連動
     ========================================================== */

  function disconnectObserver() {

    if (observer) {

      observer.disconnect();
    }
  }


  function connectObserver() {

    const rankBox =
      document.getElementById(
        'rankBox'
      );


    if (!rankBox) {

      return;
    }


    if (!observer) {

      observer =
        new MutationObserver(
          () => {

            scheduleRender();
          }
        );
    }


    observer.observe(
      rankBox,
      {
        childList:
          true,

        subtree:
          true,
      }
    );
  }


  function renderAll() {

    disconnectObserver();


    try {

      renderCurrentCard();

      renderHistory();

      syncHistoryVisibility();

    } finally {

      connectObserver();
    }
  }


  function scheduleRender(
    delay = 0
  ) {

    if (renderTimer) {

      clearTimeout(
        renderTimer
      );
    }


    renderTimer =
      setTimeout(
        () => {

          renderTimer =
            null;

          renderAll();

        },
        delay
      );
  }


  /* ==========================================================
     データ取得
     ========================================================== */

  async function refresh() {

    if (loading) {

      return;
    }


    const did =
      deviceId();


    if (!did) {

      return;
    }


    loading =
      true;


    try {

      resultData =
        await requestResults();


      renderAll();

    } catch (error) {

      if (
        error &&
        (
          error.message ===
            'vote_not_available' ||
          error.message ===
            'not_registered'
        )
      ) {

        resultData = {
          current:
            null,

          history:
            [],
        };


        removeCurrentCard();

        removeHistory();

        return;
      }


      console.warn(
        'monthly_results_load_error',
        error &&
        error.message
          ? error.message
          : error
      );

    } finally {

      loading =
        false;
    }
  }


  function scheduleRefresh() {

    setTimeout(
      refresh,
      120
    );


    setTimeout(
      refresh,
      900
    );
  }


  /* ==========================================================
     起動
     ========================================================== */

  function start() {

    addStyle();

    connectObserver();


    /*
     * app.js の登録処理後に取得。
     */
    setTimeout(
      refresh,
      1800
    );


    setTimeout(
      refresh,
      4500
    );


    /*
     * グループタブを開いた時。
     */
    document.addEventListener(
      'click',
      event => {

        const mainTab =
          event.target.closest(
            '.tabbtn[data-v]'
          );


        if (
          mainTab &&
          mainTab.dataset.v ===
            'group'
        ) {

          scheduleRefresh();

          scheduleRender(
            160
          );

          return;
        }


        const rankTab =
          event.target.closest(
            '#rankTabs .tab[data-r]'
          );


        if (rankTab) {

          scheduleRender(
            80
          );


          /*
           * つだつダイエット部を開いた時は
           * club-ui.js がclubPanelを描き直すため、
           * 少し後でもう一度差し込む。
           */
          if (
            rankTab.dataset.r ===
              'rival'
          ) {

            scheduleRender(
              220
            );
          }
        }
      }
    );


    /*
     * 画面へ戻った時に
     * 7日経過判定を含めて再取得する。
     */
    document.addEventListener(
      'visibilitychange',
      () => {

        if (
          document.visibilityState ===
            'visible'
        ) {

          setTimeout(
            refresh,
            150
          );
        }
      }
    );
  }


  if (
    document.readyState ===
      'loading'
  ) {

    document.addEventListener(
      'DOMContentLoaded',
      start,
      {
        once:
          true,
      }
    );

  } else {

    start();
  }

})();
