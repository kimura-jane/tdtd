'use strict';

/* ============================================================
   みんやせ / weekly-summary-ui.js

   対象5チームの月曜速報表示
   ------------------------------------------------------------
   ・月曜日：ランキング直前に、その日までの月曜速報を表示
   ・火曜以降：ランキング下に「過去の月曜日履歴」として表示
   ・集計値は /api/weekly-summary から取得
   ============================================================ */

(() => {

  const API =
    (
      typeof window !== 'undefined' &&
      window.MINYASE_API_BASE
    ) ||
    '';


  const K_DEV =
    'tsudatsu.device_id.v1';


  const TARGET_GROUP_IDS =
    new Set([
      '84Q8CG58',
      'AJ6N7AFJ',
      'T92787Z2',
      'XGQGRGRV',
      'C47DTD4C',
    ]);


  let requestSeq =
    0;


  /* ==========================================================
     小物
     ========================================================== */

  function normalizeGroupId(raw) {

    const value =
      String(
        raw ||
        ''
      )
        .trim()
        .toUpperCase()
        .replace(
          /[^0-9A-Z]/g,
          ''
        );


    return /^[0-9A-Z]{8}$/
      .test(
        value
      )
        ? value
        : null;
  }


  function num(value) {

    if (
      value === null ||
      value === undefined ||
      value === ''
    ) {

      return null;
    }


    const n =
      Number(
        value
      );


    return Number.isFinite(
      n
    )
      ? n
      : null;
  }


  function kgText(value) {

    const n =
      num(
        value
      );


    return n === null
      ? '—'
      : n.toFixed(1) +
        'kg';
  }


  function lossText(value) {

    const n =
      num(
        value
      );


    if (
      n === null
    ) {

      return '—';
    }


    if (
      n < 0
    ) {

      return (
        Math.abs(
          n
        ).toFixed(1) +
        'kg増量'
      );
    }


    return (
      n.toFixed(1) +
      'kg減量'
    );
  }


  function dateText(ymd) {

    const m =
      /^(\d{4})-(\d{2})-(\d{2})$/
        .exec(
          String(
            ymd ||
            ''
          )
        );


    if (!m) {

      return String(
        ymd ||
        ''
      );
    }


    return (
      Number(
        m[2]
      ) +
      '/' +
      Number(
        m[3]
      )
    );
  }


  function currentScope() {

    const active =
      document.querySelector(
        '#rankTabs .tab.is-on'
      );


    return active &&
      active.dataset
        ? String(
            active.dataset.r ||
            ''
          )
        : '';
  }


  /* ==========================================================
     API
     ========================================================== */

  async function fetchSummary(groupId) {

    const deviceId =
      localStorage.getItem(
        K_DEV
      ) ||
      '';


    if (!deviceId) {

      throw new Error(
        'not_registered'
      );
    }


    let response;


    try {

      response =
        await fetch(
          API +
          '/api/weekly-summary?group_id=' +
          encodeURIComponent(
            groupId
          ),
          {
            method:
              'GET',

            headers: {
              'x-device-id':
                deviceId,
            },

            cache:
              'no-store',
          }
        );

    } catch {

      throw new Error(
        'network_error'
      );
    }


    let data =
      {};


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
        'http_' +
        response.status
      );
    }


    return data;
  }


  /* ==========================================================
     CSS
     ========================================================== */

  function addStyle() {

    if (
      document.getElementById(
        'weeklySummaryUiStyle'
      )
    ) {

      return;
    }


    const style =
      document.createElement(
        'style'
      );


    style.id =
      'weeklySummaryUiStyle';


    style.textContent = `
.weekly-summary-current{
  margin:14px 0 13px;
  padding:14px;
  border:1px solid rgba(239,88,196,.18);
  border-radius:19px;
  background:
    radial-gradient(circle at 100% 0%,rgba(239,88,196,.10),transparent 38%),
    linear-gradient(180deg,#fff 0%,#fffafc 100%);
  box-shadow:0 5px 18px rgba(82,57,35,.055)
}

.weekly-summary-current-title{
  margin:0 0 10px;
  color:var(--ink,#181614);
  font-size:15px;
  font-weight:900;
  line-height:1.4
}

.weekly-summary-current-list{
  display:grid;
  gap:8px
}

.weekly-summary-current-row{
  padding:11px 12px;
  border:1px solid var(--line2,#f4ede6);
  border-radius:15px;
  background:rgba(255,255,255,.88)
}

.weekly-summary-current-row.is-today{
  border-color:rgba(239,88,196,.26);
  background:rgba(255,247,252,.96)
}

.weekly-summary-current-head{
  display:flex;
  align-items:center;
  gap:7px;
  margin-bottom:4px
}

.weekly-summary-current-date{
  color:var(--ink,#181614);
  font-size:15px;
  font-weight:900
}

.weekly-summary-badge{
  display:inline-flex;
  align-items:center;
  min-height:20px;
  padding:2px 7px;
  border-radius:999px;
  background:#ef58c4;
  color:#fff;
  font-size:9px;
  font-weight:900;
  line-height:1
}

.weekly-summary-current-main{
  color:var(--ink,#181614);
  font-size:18px;
  font-variant-numeric:tabular-nums;
  font-weight:900;
  line-height:1.45
}

.weekly-summary-current-main .weekly-summary-slash{
  padding:0 4px;
  color:var(--faint,#b6aca3);
  font-weight:700
}

.weekly-summary-current-count{
  margin-top:3px;
  color:var(--sub,#7e756d);
  font-size:10px;
  font-weight:700
}

.weekly-summary-history{
  margin:15px 0 2px;
  padding:13px 14px;
  border:1px solid var(--line,#eee5dc);
  border-radius:18px;
  background:rgba(255,255,255,.72)
}

.weekly-summary-history-title{
  margin:0 0 7px;
  color:var(--ink,#181614);
  font-size:13px;
  font-weight:900
}

.weekly-summary-history-list{
  list-style:none;
  margin:0;
  padding:0
}

.weekly-summary-history-row{
  display:grid;
  grid-template-columns:54px 1fr;
  gap:8px;
  align-items:center;
  padding:9px 0;
  border-top:1px solid var(--line2,#f4ede6)
}

.weekly-summary-history-row:first-child{
  border-top:0
}

.weekly-summary-history-date{
  color:var(--ink2,#4b433d);
  font-size:12px;
  font-weight:900
}

.weekly-summary-history-main{
  min-width:0;
  color:var(--ink,#181614);
  font-size:13px;
  font-variant-numeric:tabular-nums;
  font-weight:800;
  line-height:1.45
}

.weekly-summary-history-count{
  display:block;
  margin-top:1px;
  color:var(--sub,#7e756d);
  font-size:9px;
  font-weight:700
}

@media(max-width:380px){
  .weekly-summary-current-main{
    font-size:16px
  }

  .weekly-summary-history-row{
    grid-template-columns:48px 1fr
  }
}
`;


    document.head.appendChild(
      style
    );
  }


  /* ==========================================================
     DOM
     ========================================================== */

  function clearUi() {

    document
      .querySelectorAll(
        '.weekly-summary-current, .weekly-summary-history'
      )
      .forEach(
        node =>
          node.remove()
      );
  }


  function currentRow(summary, todayYmd) {

    const row =
      document.createElement(
        'div'
      );


    row.className =
      'weekly-summary-current-row';


    if (
      summary.ymd ===
        todayYmd
    ) {

      row.classList.add(
        'is-today'
      );
    }


    const head =
      document.createElement(
        'div'
      );


    head.className =
      'weekly-summary-current-head';


    const date =
      document.createElement(
        'span'
      );


    date.className =
      'weekly-summary-current-date';


    date.textContent =
      dateText(
        summary.ymd
      );


    head.appendChild(
      date
    );


    if (
      summary.ymd ===
        todayYmd
    ) {

      const badge =
        document.createElement(
          'span'
        );


      badge.className =
        'weekly-summary-badge';


      badge.textContent =
        '速報';


      head.appendChild(
        badge
      );
    }


    const main =
      document.createElement(
        'div'
      );


    main.className =
      'weekly-summary-current-main';


    const total =
      document.createElement(
        'span'
      );


    total.textContent =
      '総体重 ' +
      kgText(
        summary.total_kg
      );


    const slash =
      document.createElement(
        'span'
      );


    slash.className =
      'weekly-summary-slash';


    slash.textContent =
      ' / ';


    const loss =
      document.createElement(
        'span'
      );


    loss.textContent =
      lossText(
        summary.loss_kg
      );


    main.append(
      total,
      slash,
      loss
    );


    const count =
      document.createElement(
        'div'
      );


    count.className =
      'weekly-summary-current-count';


    count.textContent =
      '集計対象 ' +
      Number(
        summary.counted ||
        0
      ) +
      '人';


    row.append(
      head,
      main,
      count
    );


    return row;
  }


  function historyRow(summary) {

    const item =
      document.createElement(
        'li'
      );


    item.className =
      'weekly-summary-history-row';


    const date =
      document.createElement(
        'div'
      );


    date.className =
      'weekly-summary-history-date';


    date.textContent =
      dateText(
        summary.ymd
      );


    const main =
      document.createElement(
        'div'
      );


    main.className =
      'weekly-summary-history-main';


    const line =
      document.createElement(
        'div'
      );


    line.textContent =
      '総体重 ' +
      kgText(
        summary.total_kg
      ) +
      ' / ' +
      lossText(
        summary.loss_kg
      );


    const count =
      document.createElement(
        'span'
      );


    count.className =
      'weekly-summary-history-count';


    count.textContent =
      '集計対象 ' +
      Number(
        summary.counted ||
        0
      ) +
      '人';


    main.append(
      line,
      count
    );


    item.append(
      date,
      main
    );


    return item;
  }


  function renderCurrent(data) {

    const rankHead =
      document.getElementById(
        'rankHead'
      );


    if (!rankHead) {

      return;
    }


    const summaries =
      Array.isArray(
        data.summaries
      )
        ? data.summaries
        : [];


    if (!summaries.length) {

      return;
    }


    const section =
      document.createElement(
        'section'
      );


    section.className =
      'weekly-summary-current';


    const title =
      document.createElement(
        'h3'
      );


    title.className =
      'weekly-summary-current-title';


    title.textContent =
      '月曜速報まとめ';


    const list =
      document.createElement(
        'div'
      );


    list.className =
      'weekly-summary-current-list';


    for (
      const summary of
      summaries
    ) {

      list.appendChild(
        currentRow(
          summary,
          data.today_ymd
        )
      );
    }


    section.append(
      title,
      list
    );


    rankHead.insertAdjacentElement(
      'afterend',
      section
    );
  }


  function renderHistory(data) {

    const rankList =
      document.getElementById(
        'rankList'
      );


    if (!rankList) {

      return;
    }


    const summaries =
      Array.isArray(
        data.summaries
      )
        ? [...data.summaries]
        : [];


    if (!summaries.length) {

      return;
    }


    summaries.sort(
      (
        a,
        b
      ) =>
        String(
          b.ymd ||
          ''
        )
          .localeCompare(
            String(
              a.ymd ||
              ''
            )
          )
    );


    const section =
      document.createElement(
        'section'
      );


    section.className =
      'weekly-summary-history';


    const title =
      document.createElement(
        'h3'
      );


    title.className =
      'weekly-summary-history-title';


    title.textContent =
      '過去の月曜日履歴';


    const list =
      document.createElement(
        'ul'
      );


    list.className =
      'weekly-summary-history-list';


    for (
      const summary of
      summaries
    ) {

      list.appendChild(
        historyRow(
          summary
        )
      );
    }


    section.append(
      title,
      list
    );


    rankList.insertAdjacentElement(
      'afterend',
      section
    );
  }


  function renderSummary(data) {

    clearUi();


    if (
      !data ||
      !Array.isArray(
        data.summaries
      ) ||
      !data.summaries.length
    ) {

      return;
    }


    if (
      data.today_is_monday ===
        true
    ) {

      renderCurrent(
        data
      );

    } else {

      renderHistory(
        data
      );
    }
  }


  /* ==========================================================
     ランキング連動
     ========================================================== */

  async function updateForRanking(data) {

    const seq =
      ++requestSeq;


    clearUi();


    const scope =
      currentScope();


    if (
      scope !==
        'mine' &&
      scope !==
        'watch'
    ) {

      return;
    }


    const groupId =
      normalizeGroupId(
        data &&
        data.group &&
        (
          data.group.group_id ||
          data.group.id
        )
      );


    if (
      !groupId ||
      !TARGET_GROUP_IDS.has(
        groupId
      )
    ) {

      return;
    }


    try {

      const result =
        await fetchSummary(
          groupId
        );


      if (
        seq !==
          requestSeq
      ) {

        return;
      }


      if (
        currentScope() !==
          scope
      ) {

        return;
      }


      renderSummary(
        result
      );

    } catch (error) {

      if (
        seq !==
          requestSeq
      ) {

        return;
      }


      clearUi();


      console.warn(
        'weekly_summary_load_error',
        error &&
        error.message
          ? error.message
          : error
      );
    }
  }


  function patchDrawRank() {

    if (
      typeof window.drawRank !==
        'function'
    ) {

      return false;
    }


    if (
      window.drawRank
        .__weeklySummaryPatched
    ) {

      return true;
    }


    const original =
      window.drawRank;


    const wrapped =
      data => {

        original(
          data
        );


        updateForRanking(
          data
        );
      };


    Object.assign(
      wrapped,
      original
    );


    wrapped.__weeklySummaryPatched =
      true;


    window.drawRank =
      wrapped;


    return true;
  }


  /* ==========================================================
     起動
     ========================================================== */

  function start() {

    addStyle();


    const hadMemberPatch =
      !!(
        window.drawRank &&
        window.drawRank
          .__memberDetailPatched
      );


    if (
      patchDrawRank()
    ) {

      /*
       * member-detail-ui.js が先に読み込まれている場合、
       * そちらが loadRanking() を予約済みなので重複取得しない。
       */
      if (
        !hadMemberPatch &&
        typeof window.loadRanking ===
          'function'
      ) {

        setTimeout(
          () =>
            window.loadRanking(),
          0
        );
      }


      return;
    }


    let tries =
      0;


    const timer =
      setInterval(
        () => {

          tries++;


          if (
            patchDrawRank()
          ) {

            clearInterval(
              timer
            );


            if (
              typeof window.loadRanking ===
                'function'
            ) {

              window.loadRanking();
            }


            return;
          }


          if (
            tries >=
              20
          ) {

            clearInterval(
              timer
            );
          }
        },
        100
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
