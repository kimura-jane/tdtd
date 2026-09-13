'use strict';

/* ============================================================
   みんやせ / weekly-summary-ui.js

   対象5チームの月曜速報表示
   ------------------------------------------------------------
   ・最新の月曜結果は次の月曜までランキング上に残す

   ・月曜日当日：
     最新2回分をランキング上に表示
     例 9/14 → 9/7 + 9/14

   ・火曜〜日曜：
     最新1回分をランキング上に表示
     それ以前はランキング下の履歴へ

   ・表示内容：
     総体重 + 総体重の対象人数
     9/1からの累計増減 + 減量集計人数
     この1週間の増減 + 週次集計人数

   ・総体重：
     現在、実体重を公開している人だけ

   ・減量：
     9/1の記録、
     または9/1以降の最初の記録を基準に集計

   ・9/7だけは前週月曜が存在しないため
     「9/1から」のみ表示する

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


  function countText(value) {

    const n =
      Number(
        value
      );


    return (
      Number.isFinite(
        n
      ) &&
      n >=
        0
    )
      ? Math.trunc(
          n
        ) +
        '人'
      : '0人';
  }


  function valueWithCount(
    value,
    count
  ) {

    return (
      value +
      '（' +
      countText(
        count
      ) +
      '）'
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


  function hasWeeklyComparison(
    summary,
    baselineYmd
  ) {

    return !!(
      summary &&
      summary.week_from_ymd &&
      summary.week_from_ymd !==
        baselineYmd
    );
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
    radial-gradient(
      circle at 100% 0%,
      rgba(239,88,196,.10),
      transparent 38%
    ),
    linear-gradient(
      180deg,
      #fff 0%,
      #fffafc 100%
    );
  box-shadow:
    0 5px 18px
    rgba(82,57,35,.055)
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
  gap:9px
}

.weekly-summary-current-row{
  padding:12px;
  border:
    1px solid
    var(--line2,#f4ede6);
  border-radius:16px;
  background:
    rgba(255,255,255,.90)
}

.weekly-summary-current-row.is-today{
  border-color:
    rgba(239,88,196,.28);
  background:
    rgba(255,247,252,.97);
  box-shadow:
    0 3px 12px
    rgba(239,88,196,.055)
}

.weekly-summary-current-head{
  display:flex;
  align-items:center;
  gap:7px;
  margin-bottom:9px
}

.weekly-summary-current-date{
  color:var(--ink,#181614);
  font-size:16px;
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

.weekly-summary-stats{
  display:grid;
  grid-template-columns:
    repeat(2,minmax(0,1fr));
  gap:7px
}

.weekly-summary-stat{
  min-width:0;
  padding:9px 10px;
  border:
    1px solid
    var(--line2,#f4ede6);
  border-radius:13px;
  background:
    rgba(255,255,255,.82)
}

.weekly-summary-stat.total{
  grid-column:1/-1
}

.weekly-summary-stat.only{
  grid-column:1/-1
}

.weekly-summary-stat small{
  display:block;
  margin-bottom:2px;
  color:var(--sub,#7e756d);
  font-size:10px;
  font-weight:700;
  line-height:1.35
}

.weekly-summary-stat b{
  display:block;
  overflow:hidden;
  color:var(--ink,#181614);
  font-size:17px;
  font-variant-numeric:
    tabular-nums;
  font-weight:900;
  line-height:1.35;
  text-overflow:ellipsis;
  white-space:nowrap
}

.weekly-summary-stat.total b{
  font-size:20px
}

.weekly-summary-current-count{
  margin-top:7px;
  color:var(--sub,#7e756d);
  font-size:10px;
  font-weight:700;
  line-height:1.45
}

.weekly-summary-history{
  margin:15px 0 2px;
  padding:13px 14px;
  border:
    1px solid
    var(--line,#eee5dc);
  border-radius:18px;
  background:
    rgba(255,255,255,.72)
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
  grid-template-columns:
    54px 1fr;
  gap:9px;
  align-items:start;
  padding:11px 0;
  border-top:
    1px solid
    var(--line2,#f4ede6)
}

.weekly-summary-history-row:first-child{
  border-top:0
}

.weekly-summary-history-date{
  padding-top:1px;
  color:var(--ink2,#4b433d);
  font-size:13px;
  font-weight:900
}

.weekly-summary-history-main{
  min-width:0;
  color:var(--ink,#181614);
  font-size:12px;
  font-variant-numeric:
    tabular-nums;
  font-weight:800;
  line-height:1.55
}

.weekly-summary-history-line{
  display:flex;
  justify-content:space-between;
  gap:10px;
  padding:1px 0
}

.weekly-summary-history-label{
  color:var(--sub,#7e756d);
  font-size:10px;
  font-weight:700
}

.weekly-summary-history-value{
  color:var(--ink,#181614);
  font-size:12px;
  font-weight:900;
  text-align:right
}

.weekly-summary-history-count{
  display:block;
  margin-top:4px;
  color:var(--sub,#7e756d);
  font-size:9px;
  font-weight:700
}

@media(max-width:380px){

  .weekly-summary-stat b{
    font-size:15px
  }

  .weekly-summary-stat.total b{
    font-size:18px
  }

  .weekly-summary-history-row{
    grid-template-columns:
      48px 1fr
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


  function makeStat(
    label,
    value,
    className = ''
  ) {

    const stat =
      document.createElement(
        'div'
      );


    stat.className =
      (
        'weekly-summary-stat ' +
        className
      )
        .trim();


    const small =
      document.createElement(
        'small'
      );


    small.textContent =
      label;


    const strong =
      document.createElement(
        'b'
      );


    strong.textContent =
      value;


    stat.append(
      small,
      strong
    );


    return stat;
  }


  function currentRow(
    summary,
    todayYmd,
    baselineYmd
  ) {

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


    const stats =
      document.createElement(
        'div'
      );


    stats.className =
      'weekly-summary-stats';


    stats.appendChild(
      makeStat(
        '総体重',
        valueWithCount(
          kgText(
            summary.total_kg
          ),
          summary.total_count
        ),
        'total'
      )
    );


    const weekly =
      hasWeeklyComparison(
        summary,
        baselineYmd
      );


    stats.appendChild(
      makeStat(
        dateText(
          baselineYmd
        ) +
        'から',
        valueWithCount(
          lossText(
            summary.loss_kg
          ),
          summary.loss_count
        ),
        weekly
          ? ''
          : 'only'
      )
    );


    if (
      weekly
    ) {

      stats.appendChild(
        makeStat(
          'この1週間',
          valueWithCount(
            lossText(
              summary.week_loss_kg
            ),
            summary.week_count
          )
        )
      );
    }


    const count =
      document.createElement(
        'div'
      );


    count.className =
      'weekly-summary-current-count';


    count.textContent =
      '※総体重は体重公開中のみ。減量は9/1以降の初回記録を基準に集計。';


    row.append(
      head,
      stats,
      count
    );


    return row;
  }


  function historyLine(
    labelText,
    valueText
  ) {

    const line =
      document.createElement(
        'div'
      );


    line.className =
      'weekly-summary-history-line';


    const label =
      document.createElement(
        'span'
      );


    label.className =
      'weekly-summary-history-label';


    label.textContent =
      labelText;


    const value =
      document.createElement(
        'span'
      );


    value.className =
      'weekly-summary-history-value';


    value.textContent =
      valueText;


    line.append(
      label,
      value
    );


    return line;
  }


  function historyRow(
    summary,
    baselineYmd
  ) {

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


    main.appendChild(
      historyLine(
        '総体重',
        valueWithCount(
          kgText(
            summary.total_kg
          ),
          summary.total_count
        )
      )
    );


    main.appendChild(
      historyLine(
        dateText(
          baselineYmd
        ) +
        'から',
        valueWithCount(
          lossText(
            summary.loss_kg
          ),
          summary.loss_count
        )
      )
    );


    if (
      hasWeeklyComparison(
        summary,
        baselineYmd
      )
    ) {

      main.appendChild(
        historyLine(
          'この1週間',
          valueWithCount(
            lossText(
              summary.week_loss_kg
            ),
            summary.week_count
          )
        )
      );
    }


    const count =
      document.createElement(
        'span'
      );


    count.className =
      'weekly-summary-history-count';


    count.textContent =
      '総体重は体重公開中のみ';


    main.appendChild(
      count
    );


    item.append(
      date,
      main
    );


    return item;
  }


  function renderCurrent(
    data,
    summaries
  ) {

    const rankHead =
      document.getElementById(
        'rankHead'
      );


    if (!rankHead) {

      return;
    }


    if (
      !Array.isArray(
        summaries
      ) ||
      !summaries.length
    ) {

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
          data.today_ymd,
          data.baseline_ymd
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


  function renderHistory(
    data,
    summaries
  ) {

    const rankList =
      document.getElementById(
        'rankList'
      );


    if (!rankList) {

      return;
    }


    const rows =
      Array.isArray(
        summaries
      )
        ? [...summaries]
        : [];


    if (!rows.length) {

      return;
    }


    rows.sort(
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
      rows
    ) {

      list.appendChild(
        historyRow(
          summary,
          data.baseline_ymd
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


    /*
     * APIは古い月曜 → 新しい月曜の順。
     *
     * 月曜日当日：
     *   最新2回を上へ。
     *
     * 火曜〜日曜：
     *   最新1回だけ上へ。
     *
     * 残りは全てランキング下の履歴。
     */
    const summaries =
      [...data.summaries];


    const currentCount =
      data.today_is_monday ===
        true
        ? Math.min(
            2,
            summaries.length
          )
        : 1;


    const splitIndex =
      Math.max(
        0,
        summaries.length -
        currentCount
      );


    const historySummaries =
      summaries.slice(
        0,
        splitIndex
      );


    const currentSummaries =
      summaries.slice(
        splitIndex
      );


    renderCurrent(
      data,
      currentSummaries
    );


    renderHistory(
      data,
      historySummaries
    );
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
