'use strict';

/* みんやせ / club-progress-ui.js
 * - 通常ランキングを縦にコンパクト化
 * - ランキング補助情報を体重 / 最終記録の2段表示へ
 * - 月グラフは月初を3チームとも0kgとして表示
 * - 全期間グラフは9/1からの累計を表示
 * - グラフ上の重複チーム凡例を非表示
 * - グラフ直下の重複詳細表示を非表示
 * - グラフ下に月間の仮順位 / 全期間の減量数を色付き表示
 */
(() => {
  const API =
    (typeof window !== 'undefined' && window.MINYASE_API_BASE) || '';

  const DEVICE_KEY =
    'tsudatsu.device_id.v1';

  const CAMPAIGN_START =
    '2026-09-01';

  const CAMPAIGN_END =
    '2026-12-31';

  const MEDALS = [
    '🥇',
    '🥈',
    '🥉',
  ];

  const SVG_NS =
    'http://www.w3.org/2000/svg';

  let clubData = null;
  let loading = false;
  let observer = null;
  let renderTimer = null;
  let rendering = false;


  /* ==========================================================
     共通
     ========================================================== */

  function deviceId() {
    return localStorage.getItem(DEVICE_KEY) || '';
  }


  function pad2(value) {
    return String(value).padStart(2, '0');
  }


  function parseYmd(ymd) {
    const m =
      /^(\d{4})-(\d{2})-(\d{2})$/
        .exec(String(ymd || ''));

    if (!m) return null;

    return {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
    };
  }


  function ymdDay(ymd) {
    const p = parseYmd(ymd);
    if (!p) return null;

    return Math.floor(
      Date.UTC(
        p.year,
        p.month - 1,
        p.day
      ) /
      86400000
    );
  }


  function dayToYmd(day) {
    const d = new Date(day * 86400000);

    return (
      d.getUTCFullYear() +
      '-' +
      pad2(d.getUTCMonth() + 1) +
      '-' +
      pad2(d.getUTCDate())
    );
  }


  function dateText(ymd) {
    const p = parseYmd(ymd);
    if (!p) return String(ymd || '—');

    return p.month + '月' + p.day + '日';
  }


  function shortDateText(ymd) {
    const p = parseYmd(ymd);
    if (!p) return String(ymd || '');

    return p.month + '/' + p.day;
  }


  function monthStartYmd(ymd) {
    const p = parseYmd(ymd);
    if (!p) return null;

    return (
      p.year +
      '-' +
      pad2(p.month) +
      '-01'
    );
  }


  function shiftMonthStart(
    ymd,
    amount
  ) {
    const p = parseYmd(ymd);
    if (!p) return null;

    const d =
      new Date(
        Date.UTC(
          p.year,
          p.month - 1,
          1
        )
      );

    d.setUTCMonth(
      d.getUTCMonth() +
      amount
    );

    return (
      d.getUTCFullYear() +
      '-' +
      pad2(
        d.getUTCMonth() +
        1
      ) +
      '-01'
    );
  }


  function prevMonthStartYmd(ymd) {
    return shiftMonthStart(
      ymd,
      -1
    );
  }


  function nextMonthStartYmd(ymd) {
    return shiftMonthStart(
      ymd,
      1
    );
  }


  function round1(value) {
    return (
      Math.round(
        Number(value) *
        10
      ) /
      10
    );
  }


  function progressKgText(lossKg) {
    const loss =
      Number(lossKg);

    if (!Number.isFinite(loss)) {
      return '—';
    }

    const change =
      round1(
        -loss
      );

    if (
      Object.is(change, -0) ||
      change === 0
    ) {
      return '0.0kg';
    }

    return (
      (change > 0 ? '+' : '') +
      change.toFixed(1) +
      'kg'
    );
  }


  function detailLossText(lossKg) {
    const n =
      Number(lossKg);

    if (!Number.isFinite(n)) {
      return '—';
    }

    return n < 0
      ? Math.abs(n).toFixed(1) + 'kg増量'
      : n.toFixed(1) + 'kg減量';
  }


  /* ==========================================================
     CSS
     ========================================================== */

  function addStyle() {
    if (
      document.getElementById(
        'clubProgressUiStyle'
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        'style'
      );

    style.id =
      'clubProgressUiStyle';

    style.textContent = `

/* ============================================================
   グラフの重複表示
   ============================================================ */

.club-team-legend{
  display:none !important
}

/*
 * 下の月間仮順位 / 全期間ランキングと
 * 内容が重複するため非表示。
 *
 * DOM自体は順位カードの挿入基準として残す。
 */
#clubChartDetail{
  display:none !important;
  width:0 !important;
  height:0 !important;
  min-height:0 !important;
  margin:0 !important;
  padding:0 !important;
  border:0 !important;
  overflow:hidden !important
}


/* ============================================================
   通常ランキング
   12人をできるだけ一覧できる高さへ
   ============================================================ */

#rankList.rank > li:not(.empty){
  gap:5px;
  min-height:0;
  padding:3px 0
}

#rankList.rank > li.self{
  margin:2px -3px;
  padding:4px 5px 4px 9px;
  border-radius:13px
}

#rankList.rank > li.self::before{
  top:4px;
  bottom:4px;
  width:3px
}

#rankList.rank .no{
  width:24px;
  flex:0 0 24px;
  font-size:11px;
  line-height:1
}

#rankList.rank .no.top{
  width:24px;
  height:24px;
  line-height:24px
}

/*
 * app.js 側は38pxで生成するが、
 * 大会用のランキング表示時だけ31pxへ圧縮。
 */
#rankList.rank .av{
  width:31px !important;
  height:31px !important;
  flex:0 0 31px !important
}

#rankList.rank .who{
  min-width:0
}

#rankList.rank .nm{
  overflow:hidden;
  font-size:12.5px;
  line-height:1.12;
  text-overflow:ellipsis;
  white-space:nowrap
}

#rankList.rank .badge{
  margin-left:4px;
  padding:1px 5px;
  font-size:8px;
  line-height:1.25
}

/*
 * 体重変化と最終記録を明示的に2段表示。
 */
#rankList.rank .sb{
  display:block;
  min-width:0;
  margin-top:1px;
  color:var(--sub,#7e756d);
  font-size:9px;
  line-height:1.12
}

#rankList.rank .rank-meta-line{
  display:block;
  overflow:hidden;
  min-width:0;
  text-overflow:ellipsis;
  white-space:nowrap
}

#rankList.rank .rank-meta-last{
  margin-top:1px;
  color:var(--sub,#7e756d)
}

#rankList.rank .ls{
  flex:0 0 auto;
  font-size:14.5px;
  line-height:1.05;
  white-space:nowrap
}

#rankList.rank .ls.none{
  font-size:11px
}

#rankList.rank .kebab{
  width:19px;
  min-width:19px;
  flex:0 0 19px;
  padding:0;
  font-size:14px;
  line-height:1
}


/* ============================================================
   グラフ下ランキング
   ============================================================ */

.club-progress-rankings{
  display:grid;
  gap:10px;
  margin-top:12px
}

.club-progress-card{
  padding:14px 14px 12px;
  border:
    1px solid
    var(--line2,#f4ede6);
  border-radius:18px;
  background:
    linear-gradient(
      180deg,
      rgba(255,255,255,.98) 0%,
      rgba(255,251,248,.98) 100%
    )
}

.club-progress-title{
  margin:0;
  color:var(--ink,#181614);
  font-size:16px;
  font-weight:900;
  line-height:1.4
}

.club-progress-period{
  margin:3px 0 8px;
  color:var(--sub,#7e756d);
  font-size:12px;
  font-weight:800;
  line-height:1.5
}

.club-progress-note{
  margin:0 0 8px;
  color:#9a7461;
  font-size:11px;
  font-weight:700;
  line-height:1.5
}

.club-progress-list{
  list-style:none;
  margin:0;
  padding:0
}

.club-progress-row{
  display:grid;
  grid-template-columns:
    44px minmax(0,1fr) auto;
  gap:8px;
  align-items:center;
  min-width:0;
  padding:8px 0;
  border-top:
    1px solid
    var(--line2,#f4ede6)
}

.club-progress-row:first-child{
  border-top:0
}

.club-progress-rank{
  color:var(--ink,#181614);
  font-size:14px;
  font-weight:900;
  white-space:nowrap
}

.club-progress-team-wrap{
  display:flex;
  align-items:center;
  gap:7px;
  min-width:0
}

.club-progress-team-dot{
  width:13px;
  height:13px;
  flex:0 0 13px;
  border:
    2px solid
    rgba(255,255,255,.95);
  border-radius:50%;
  box-shadow:
    0 1px 3px
    rgba(60,45,35,.18)
}

.club-progress-team{
  min-width:0;
  color:var(--ink2,#4b433d);
  font-size:14px;
  font-weight:900;
  line-height:1.35;
  white-space:nowrap
}

.club-progress-loss{
  color:var(--ink,#181614);
  font-size:15px;
  font-variant-numeric:tabular-nums;
  font-weight:900;
  white-space:nowrap
}

.club-progress-empty{
  margin:0;
  padding:5px 0 1px;
  color:var(--sub,#7e756d);
  font-size:12px;
  font-weight:700;
  line-height:1.55
}


@media(max-width:380px){

  #rankList.rank > li:not(.empty){
    gap:4px;
    padding:2px 0
  }

  #rankList.rank > li.self{
    padding-top:3px;
    padding-bottom:3px
  }

  #rankList.rank .no{
    width:22px;
    flex-basis:22px;
    font-size:10px
  }

  #rankList.rank .no.top{
    width:22px;
    height:22px;
    line-height:22px
  }

  #rankList.rank .av{
    width:29px !important;
    height:29px !important;
    flex-basis:29px !important
  }

  #rankList.rank .nm{
    font-size:12px
  }

  #rankList.rank .sb{
    font-size:8.5px
  }

  #rankList.rank .ls{
    font-size:14px
  }

  #rankList.rank .kebab{
    width:18px;
    min-width:18px;
    flex-basis:18px
  }

  .club-progress-card{
    padding:12px 12px 10px
  }

  .club-progress-title{
    font-size:15px
  }

  .club-progress-period{
    font-size:11px
  }

  .club-progress-row{
    grid-template-columns:
      42px minmax(0,1fr) auto;
    gap:6px
  }

  .club-progress-team{
    font-size:13px
  }

  .club-progress-loss{
    font-size:14px
  }
}
`;

    document.head.appendChild(
      style
    );
  }


  /* ==========================================================
     通常ランキング補助情報
     ========================================================== */

  function formatRankMeta() {
    const subs =
      document.querySelectorAll(
        '#rankList.rank .sb'
      );

    for (const sub of subs) {
      if (
        sub.dataset.compactRankMeta ===
        '1'
      ) {
        continue;
      }

      const text =
        String(
          sub.textContent ||
          ''
        ).trim();

      /*
       * 記録なし等はそのまま。
       */
      if (
        !text ||
        text === '記録なし'
      ) {
        sub.dataset.compactRankMeta =
          '1';

        continue;
      }

      /*
       * app.js:
       *
       * 79.0 → 75.9kg ／ 最終 10月1日（1日前）
       *
       * ↓
       *
       * 79.0 → 75.9kg
       * 最終 10月1日（1日前）
       */
      const marker =
        ' ／ 最終 ';

      const markerIndex =
        text.lastIndexOf(
          marker
        );

      /*
       * 体重非公開などで
       * 「最終 ...」しか無いケース。
       */
      if (
        markerIndex <
          0
      ) {
        if (
          text.startsWith(
            '最終 '
          )
        ) {
          sub.textContent =
            '';

          const lastLine =
            document.createElement(
              'span'
            );

          lastLine.className =
            'rank-meta-line rank-meta-last';

          lastLine.textContent =
            text;

          sub.appendChild(
            lastLine
          );
        }

        sub.dataset.compactRankMeta =
          '1';

        continue;
      }

      const firstText =
        text
          .slice(
            0,
            markerIndex
          )
          .trim();

      const lastText =
        (
          '最終 ' +
          text
            .slice(
              markerIndex +
              marker.length
            )
            .trim()
        );

      sub.textContent =
        '';

      if (firstText) {
        const firstLine =
          document.createElement(
            'span'
          );

        firstLine.className =
          'rank-meta-line rank-meta-weight';

        firstLine.textContent =
          firstText;

        sub.appendChild(
          firstLine
        );
      }

      const lastLine =
        document.createElement(
          'span'
        );

      lastLine.className =
        'rank-meta-line rank-meta-last';

      lastLine.textContent =
        lastText;

      sub.appendChild(
        lastLine
      );

      sub.dataset.compactRankMeta =
        '1';
    }
  }


  /* ==========================================================
     API
     ========================================================== */

  async function api(path) {
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
          API + path,
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

    let data =
      {};

    try {
      data =
        await response.json();
    } catch {}

    if (
      !response.ok ||
      data.ok === false
    ) {
      const error =
        new Error(
          data.error ||
          (
            'http_' +
            response.status
          )
        );

      error.status =
        response.status;

      throw error;
    }

    return data;
  }


  /* ==========================================================
     公式記録日
     ========================================================== */

  function allPointDates(data) {
    const dates =
      new Set();

    for (
      const team of
      (
        data &&
        data.teams
      ) ||
      []
    ) {
      for (
        const point of
        team.points ||
        []
      ) {
        if (
          point &&
          point.ymd
        ) {
          dates.add(
            String(
              point.ymd
            )
          );
        }
      }
    }

    return [
      ...dates
    ].sort();
  }


  function latestOfficialYmd(data) {
    const today =
      String(
        (
          data &&
          data.today_ymd
        ) ||
        ''
      );

    const dates =
      allPointDates(
        data
      )
        .filter(
          ymd =>
            ymd >=
              CAMPAIGN_START &&
            ymd <=
              CAMPAIGN_END &&
            (
              !today ||
              ymd <=
                today
            )
        )
        .sort();

    return dates.length
      ? dates[
          dates.length -
          1
        ]
      : null;
  }


  /*
   * 下の仮順位用。
   *
   * 10/2時点:
   * 9/1〜10/1（仮）
   *
   * 10/5以降:
   * 10/1〜11/1（仮）
   */
  function progressContext(data) {
    const end =
      latestOfficialYmd(
        data
      );

    if (!end) {
      return null;
    }

    const p =
      parseYmd(
        end
      );

    if (!p) {
      return null;
    }

    let provisionalStart =
      p.day === 1
        ? prevMonthStartYmd(
            end
          )
        : monthStartYmd(
            end
          );

    let provisionalLabelEnd =
      p.day === 1
        ? end
        : nextMonthStartYmd(
            end
          );

    if (
      provisionalStart <
      CAMPAIGN_START
    ) {
      provisionalStart =
        CAMPAIGN_START;
    }

    if (
      provisionalLabelEnd >
      CAMPAIGN_END
    ) {
      provisionalLabelEnd =
        CAMPAIGN_END;
    }

    return {
      end,

      baseline:
        String(
          (
            data &&
            data.baseline_ymd
          ) ||
          CAMPAIGN_START
        ),

      provisional_start:
        provisionalStart,

      provisional_label_end:
        provisionalLabelEnd,
    };
  }


  /*
   * 「月」グラフ用。
   *
   * 10月:
   * 10/1〜11/1
   *
   * 11月:
   * 11/1〜12/1
   *
   * 12月:
   * 12/1〜12/31
   */
  function currentMonthRange(data) {
    let today =
      String(
        (
          data &&
          data.today_ymd
        ) ||
        latestOfficialYmd(
          data
        ) ||
        CAMPAIGN_START
      );

    if (
      today <
      CAMPAIGN_START
    ) {
      today =
        CAMPAIGN_START;
    }

    if (
      today >
      CAMPAIGN_END
    ) {
      today =
        CAMPAIGN_END;
    }

    const start =
      monthStartYmd(
        today
      );

    if (!start) {
      return null;
    }

    let end =
      nextMonthStartYmd(
        start
      );

    if (
      !end ||
      end >
      CAMPAIGN_END
    ) {
      end =
        CAMPAIGN_END;
    }

    let dataEnd =
      latestOfficialYmd(
        data
      ) ||
      start;

    if (
      dataEnd <
      start
    ) {
      dataEnd =
        start;
    }

    if (
      dataEnd >
      end
    ) {
      dataEnd =
        end;
    }

    return {
      start,
      end,
      data_end:
        dataEnd,
    };
  }


  /* ==========================================================
     チーム順位計算
     ========================================================== */

  function pointAt(
    team,
    ymd
  ) {
    const point =
      (
        team &&
        team.points ||
        []
      )
        .find(
          row =>
            row &&
            row.ymd ===
              ymd
        );

    if (!point) {
      return null;
    }

    const value =
      Number(
        point.loss_kg
      );

    return Number.isFinite(
      value
    )
      ? value
      : null;
  }


  function rankedRows(
    data,
    mode
  ) {
    const ctx =
      progressContext(
        data
      );

    if (!ctx) {
      return [];
    }

    const rows =
      [];

    for (
      const team of
      data.teams ||
      []
    ) {
      const endLoss =
        pointAt(
          team,
          ctx.end
        );

      if (
        !Number.isFinite(
          endLoss
        )
      ) {
        continue;
      }

      let lossKg =
        endLoss;

      if (
        mode ===
        'provisional'
      ) {
        const startLoss =
          pointAt(
            team,
            ctx.provisional_start
          );

        if (
          !Number.isFinite(
            startLoss
          )
        ) {
          continue;
        }

        lossKg =
          round1(
            endLoss -
            startLoss
          );
      }

      rows.push({
        team_id:
          team.team_id,

        team_name:
          team.name ||
          team.team_id ||
          '—',

        team_color:
          team.color ||
          '#999',

        loss_kg:
          lossKg,
      });
    }

    return rows.sort(
      (
        a,
        b
      ) => {
        const diff =
          Number(
            b.loss_kg
          ) -
          Number(
            a.loss_kg
          );

        if (
          diff !==
          0
        ) {
          return diff;
        }

        return String(
          a.team_id ||
          ''
        )
          .localeCompare(
            String(
              b.team_id ||
              ''
            )
          );
      }
    );
  }


  /* ==========================================================
     グラフ下の順位カード
     ========================================================== */

  function buildRankingCard({
    title,
    period,
    note,
    rows,
  }) {
    const card =
      document.createElement(
        'section'
      );

    card.className =
      'club-progress-card';

    const h =
      document.createElement(
        'h4'
      );

    h.className =
      'club-progress-title';

    h.textContent =
      title;

    const p =
      document.createElement(
        'p'
      );

    p.className =
      'club-progress-period';

    p.textContent =
      period;

    card.append(
      h,
      p
    );

    if (note) {
      const n =
        document.createElement(
          'p'
        );

      n.className =
        'club-progress-note';

      n.textContent =
        note;

      card.appendChild(
        n
      );
    }

    if (!rows.length) {
      const empty =
        document.createElement(
          'p'
        );

      empty.className =
        'club-progress-empty';

      empty.textContent =
        '集計できるデータがまだありません';

      card.appendChild(
        empty
      );

      return card;
    }

    const list =
      document.createElement(
        'ol'
      );

    list.className =
      'club-progress-list';

    rows
      .slice(
        0,
        3
      )
      .forEach(
        (
          row,
          index
        ) => {
          const li =
            document.createElement(
              'li'
            );

          li.className =
            'club-progress-row';

          const rank =
            document.createElement(
              'span'
            );

          rank.className =
            'club-progress-rank';

          rank.textContent =
            (
              MEDALS[
                index
              ] ||
              ''
            ) +
            (
              index +
              1
            ) +
            '位';

          const teamWrap =
            document.createElement(
              'span'
            );

          teamWrap.className =
            'club-progress-team-wrap';

          const dot =
            document.createElement(
              'span'
            );

          dot.className =
            'club-progress-team-dot';

          dot.style.background =
            row.team_color ||
            '#999';

          const team =
            document.createElement(
              'span'
            );

          team.className =
            'club-progress-team';

          team.textContent =
            row.team_name;

          teamWrap.append(
            dot,
            team
          );

          const loss =
            document.createElement(
              'strong'
            );

          loss.className =
            'club-progress-loss';

          loss.textContent =
            progressKgText(
              row.loss_kg
            );

          li.append(
            rank,
            teamWrap,
            loss
          );

          list.appendChild(
            li
          );
        }
      );

    card.appendChild(
      list
    );

    return card;
  }


  function renderRankings() {
    const detail =
      document.getElementById(
        'clubChartDetail'
      );

    if (
      !detail ||
      !clubData
    ) {
      return;
    }

    const old =
      document.getElementById(
        'clubProgressRankings'
      );

    if (old) {
      old.remove();
    }

    const wrap =
      document.createElement(
        'div'
      );

    wrap.id =
      'clubProgressRankings';

    wrap.className =
      'club-progress-rankings';

    const ctx =
      progressContext(
        clubData
      );

    if (!ctx) {
      wrap.append(
        buildRankingCard({
          title:
            '🏁 月間の仮順位',

          period:
            '次の公式記録日後に表示します',

          note:
            '',

          rows:
            [],
        }),

        buildRankingCard({
          title:
            '🏆 全期間の減量数',

          period:
            '次の公式記録日後に表示します',

          note:
            '',

          rows:
            [],
        })
      );

      detail.insertAdjacentElement(
        'afterend',
        wrap
      );

      return;
    }

    wrap.append(
      buildRankingCard({
        title:
          '🏁 ' +
          dateText(
            ctx.provisional_start
          ) +
          '〜' +
          dateText(
            ctx.provisional_label_end
          ) +
          '（仮）',

        period:
          '現在の集計基準日：' +
          dateText(
            ctx.end
          ),

        note:
          '正式確定前の途中結果です',

        rows:
          rankedRows(
            clubData,
            'provisional'
          ),
      }),

      buildRankingCard({
        title:
          '🏆 全期間の減量数',

        period:
          dateText(
            ctx.baseline
          ) +
          '〜' +
          dateText(
            ctx.end
          ) +
          ' 時点',

        note:
          '大会開始から現在までの累計です',

        rows:
          rankedRows(
            clubData,
            'all'
          ),
      })
    );

    detail.insertAdjacentElement(
      'afterend',
      wrap
    );
  }


  /* ==========================================================
     SVG
     ========================================================== */

  function svgEl(
    name,
    attrs = {}
  ) {
    const node =
      document.createElementNS(
        SVG_NS,
        name
      );

    for (
      const [
        key,
        value
      ] of
      Object.entries(
        attrs
      )
    ) {
      node.setAttribute(
        key,
        String(
          value
        )
      );
    }

    return node;
  }


  function niceStep(raw) {
    if (
      !Number.isFinite(
        raw
      ) ||
      raw <= 0
    ) {
      return 1;
    }

    const power =
      Math.pow(
        10,
        Math.floor(
          Math.log10(
            raw
          )
        )
      );

    const scaled =
      raw /
      power;

    if (
      scaled <= 1
    ) {
      return power;
    }

    if (
      scaled <= 2
    ) {
      return 2 * power;
    }

    if (
      scaled <= 5
    ) {
      return 5 * power;
    }

    return 10 * power;
  }


  function formatTick(value) {
    const abs =
      Math.abs(
        value
      );

    return (
      abs < 10 &&
      Math.abs(
        value % 1
      ) > 0.001
    )
      ? value.toFixed(1)
      : String(
          Math.round(
            value
          )
        );
  }


  function isOfficialTickYmd(ymd) {
    const p =
      parseYmd(
        ymd
      );

    const day =
      ymdDay(
        ymd
      );

    if (
      !p ||
      day === null
    ) {
      return false;
    }

    return (
      p.day === 1 ||
      new Date(
        day *
        86400000
      )
        .getUTCDay() === 1 ||
      ymd === CAMPAIGN_END
    );
  }


  function officialTicks(
    startYmd,
    endYmd
  ) {
    const start =
      ymdDay(
        startYmd
      );

    const end =
      ymdDay(
        endYmd
      );

    if (
      start === null ||
      end === null
    ) {
      return [];
    }

    const result =
      [];

    for (
      let day =
        start;
      day <= end;
      day++
    ) {
      const ymd =
        dayToYmd(
          day
        );

      if (
        isOfficialTickYmd(
          ymd
        )
      ) {
        result.push(
          ymd
        );
      }
    }

    return result;
  }


  function activeGraphMode() {
    const active =
      document.querySelector(
        '[data-club-chart-mode].is-on'
      );

    return (
      active &&
      active.dataset
        .clubChartMode ===
        'all'
    )
      ? 'all'
      : 'month';
  }


  function graphRange(data) {
    const latest =
      latestOfficialYmd(
        data
      );

    if (!latest) {
      return null;
    }

    if (
      activeGraphMode() ===
      'all'
    ) {
      const start =
        String(
          (
            data &&
            data.baseline_ymd
          ) ||
          CAMPAIGN_START
        );

      return {
        mode:
          'all',

        start,

        end:
          latest,

        data_end:
          latest,

        ticks:
          officialTicks(
            start,
            latest
          ),
      };
    }

    const month =
      currentMonthRange(
        data
      );

    if (!month) {
      return null;
    }

    return {
      mode:
        'month',

      start:
        month.start,

      end:
        month.end,

      data_end:
        month.data_end,

      ticks:
        officialTicks(
          month.start,
          month.end
        ),
    };
  }


  function graphSignature(range) {
    return range
      ? [
          range.mode,
          range.start,
          range.end,
          range.data_end,
        ].join('|')
      : 'none';
  }


  function appendGraphMarker(
    svg,
    range
  ) {
    const marker =
      svgEl(
        'g',
        {
          id:
            'clubProgressGraphMarker',

          'data-signature':
            graphSignature(
              range
            ),

          'aria-hidden':
            'true',
        }
      );

    svg.appendChild(
      marker
    );
  }


  function renderStateIsCurrent() {
    if (!clubData) {
      return true;
    }

    const svg =
      document.getElementById(
        'clubChart'
      );

    const rankings =
      document.getElementById(
        'clubProgressRankings'
      );

    if (
      !svg ||
      !rankings
    ) {
      return false;
    }

    const marker =
      svg.querySelector(
        '#clubProgressGraphMarker'
      );

    if (!marker) {
      return false;
    }

    return (
      marker.getAttribute(
        'data-signature'
      ) ===
      graphSignature(
        graphRange(
          clubData
        )
      )
    );
  }


  /*
   * 全期間は累計値そのまま。
   *
   * 月は月初累計を引いて、
   * 月初=0kgに変換する。
   */
  function graphTeams(range) {
    const teams =
      Array.isArray(
        clubData &&
        clubData.teams
      )
        ? clubData.teams
        : [];

    return teams.map(
      team => {
        let baselineLoss =
          0;

        if (
          range.mode ===
          'month'
        ) {
          baselineLoss =
            pointAt(
              team,
              range.start
            );

          if (
            !Number.isFinite(
              baselineLoss
            )
          ) {
            return {
              ...team,
              visible_points:
                [],
            };
          }
        }

        const points =
          (
            team.points ||
            []
          )
            .filter(
              point =>
                point &&
                point.ymd >=
                  range.start &&
                point.ymd <=
                  range.data_end &&
                Number.isFinite(
                  Number(
                    point.loss_kg
                  )
                )
            )
            .map(
              point => ({
                ...point,

                loss_kg:
                  range.mode ===
                    'month'
                    ? round1(
                        Number(
                          point.loss_kg
                        ) -
                        baselineLoss
                      )
                    : Number(
                        point.loss_kg
                      ),
              })
            );

        return {
          ...team,

          visible_points:
            points,
        };
      }
    );
  }


  /* ==========================================================
     グラフ描画
     ========================================================== */

  function renderAlignedGraph() {
    const svg =
      document.getElementById(
        'clubChart'
      );

    const detail =
      document.getElementById(
        'clubChartDetail'
      );

    const note =
      document.getElementById(
        'clubChartNote'
      );

    if (
      !svg ||
      !clubData
    ) {
      return;
    }

    const range =
      graphRange(
        clubData
      );

    svg.innerHTML =
      '';

    if (!range) {
      const text =
        svgEl(
          'text',
          {
            x:
              180,

            y:
              135,

            'text-anchor':
              'middle',

            class:
              'club-chart-axis-text',
          }
        );

      text.textContent =
        '公式記録日がまだありません';

      svg.appendChild(
        text
      );

      appendGraphMarker(
        svg,
        null
      );

      if (detail) {
        detail.textContent =
          '';
      }

      if (note) {
        note.textContent =
          'グラフと順位は公式記録日に更新します';
      }

      return;
    }

    if (note) {
      note.textContent =
        range.mode ===
          'month'
          ? (
              dateText(
                range.start
              ) +
              '〜' +
              dateText(
                range.end
              ) +
              '・月初を0kgとして表示'
            )
          : (
              dateText(
                range.start
              ) +
              '〜' +
              dateText(
                range.data_end
              ) +
              '・大会開始からの累計'
            );
    }

    const visibleTeams =
      graphTeams(
        range
      );

    const values =
      [];

    for (
      const team of
      visibleTeams
    ) {
      for (
        const point of
        team.visible_points
      ) {
        values.push(
          Number(
            point.loss_kg
          )
        );
      }
    }

    if (!values.length) {
      const text =
        svgEl(
          'text',
          {
            x:
              180,

            y:
              135,

            'text-anchor':
              'middle',

            class:
              'club-chart-axis-text',
          }
        );

      text.textContent =
        '集計できる記録がまだありません';

      svg.appendChild(
        text
      );

      appendGraphMarker(
        svg,
        range
      );

      if (detail) {
        detail.textContent =
          '';
      }

      return;
    }

    const W =
      360;

    const left =
      43;

    const right =
      12;

    const top =
      22;

    const bottom =
      242;

    const plotW =
      W -
      left -
      right;

    const plotH =
      bottom -
      top;

    const rawMin =
      Math.min(
        0,
        ...values
      );

    const rawMax =
      Math.max(
        0,
        ...values
      );

    let yMin;
    let yMax;

    /*
     * 月初直後は全チーム0なので、
     * 0線が中央に見えるようにする。
     */
    if (
      rawMin === 0 &&
      rawMax === 0
    ) {
      yMin =
        -1;

      yMax =
        1;

    } else {
      const baseSpan =
        Math.max(
          1,
          rawMax -
          rawMin
        );

      const step =
        niceStep(
          baseSpan /
          4
        );

      yMin =
        Math.floor(
          rawMin /
          step
        ) *
        step;

      yMax =
        Math.ceil(
          rawMax /
          step
        ) *
        step;

      if (
        yMin ===
        yMax
      ) {
        yMax =
          yMin +
          step;
      }

      if (
        yMax ===
        0
      ) {
        yMax =
          step;
      }
    }

    const startDay =
      ymdDay(
        range.start
      );

    const endDay =
      ymdDay(
        range.end
      );

    const daySpan =
      Math.max(
        1,
        endDay -
        startDay
      );

    const xFor =
      ymd => {
        const d =
          ymdDay(
            ymd
          );

        if (
          d ===
          null
        ) {
          return left;
        }

        return (
          left +
          (
            (
              d -
              startDay
            ) /
            daySpan
          ) *
          plotW
        );
      };

    const yFor =
      value =>
        top +
        (
          (
            yMax -
            value
          ) /
          (
            yMax -
            yMin
          )
        ) *
        plotH;

    const axisTitle =
      svgEl(
        'text',
        {
          x:
            8,

          y:
            12,

          class:
            'club-chart-axis-title',
        }
      );

    axisTitle.textContent =
      '減量kg';

    svg.appendChild(
      axisTitle
    );

    const tickCount =
      4;

    for (
      let i =
        0;
      i <=
        tickCount;
      i++
    ) {
      const value =
        yMin +
        (
          (
            yMax -
            yMin
          ) *
          i /
          tickCount
        );

      const y =
        yFor(
          value
        );

      const line =
        svgEl(
          'line',
          {
            x1:
              left,

            x2:
              W -
              right,

            y1:
              y,

            y2:
              y,

            class:
              Math.abs(
                value
              ) <
                0.0001
                ? 'club-chart-zero'
                : 'club-chart-grid',
          }
        );

      const label =
        svgEl(
          'text',
          {
            x:
              left -
              7,

            y:
              y +
              3,

            'text-anchor':
              'end',

            class:
              'club-chart-axis-text',
          }
        );

      label.textContent =
        formatTick(
          value
        );

      svg.append(
        line,
        label
      );
    }

    for (
      const ymd of
      range.ticks
    ) {
      if (
        ymd <
          range.start ||
        ymd >
          range.end
      ) {
        continue;
      }

      const x =
        xFor(
          ymd
        );

      const tick =
        svgEl(
          'line',
          {
            x1:
              x,

            x2:
              x,

            y1:
              bottom,

            y2:
              bottom +
              4,

            class:
              'club-chart-grid',
          }
        );

      const label =
        svgEl(
          'text',
          {
            x,

            y:
              bottom +
              17,

            'text-anchor':
              'middle',

            class:
              'club-chart-axis-text',
          }
        );

      label.textContent =
        shortDateText(
          ymd
        );

      svg.append(
        tick,
        label
      );
    }

    visibleTeams
      .forEach(
        (
          team,
          teamIndex
        ) => {
          const points =
            team.visible_points;

          if (
            !points.length
          ) {
            return;
          }

          /*
           * 月初0地点でも3色を確認できるよう
           * 少し横にずらす。
           */
          const xOffset =
            (
              teamIndex -
              1
            ) *
            4;

          const pathData =
            points
              .map(
                (
                  point,
                  index
                ) => {
                  const x =
                    xFor(
                      point.ymd
                    ) +
                    xOffset;

                  const y =
                    yFor(
                      Number(
                        point.loss_kg
                      )
                    );

                  return (
                    (
                      index === 0
                        ? 'M'
                        : 'L'
                    ) +
                    x.toFixed(
                      2
                    ) +
                    ',' +
                    y.toFixed(
                      2
                    )
                  );
                }
              )
              .join(
                ' '
              );

          const path =
            svgEl(
              'path',
              {
                d:
                  pathData,

                stroke:
                  team.color ||
                  '#999',

                class:
                  'club-chart-line',
              }
            );

          svg.appendChild(
            path
          );

          for (
            const point of
            points
          ) {
            const x =
              xFor(
                point.ymd
              ) +
              xOffset;

            const y =
              yFor(
                Number(
                  point.loss_kg
                )
              );

            const g =
              svgEl(
                'g',
                {
                  class:
                    'club-chart-point',

                  tabindex:
                    '0',

                  role:
                    'button',

                  'data-team-name':
                    team.name ||
                    '',

                  'data-team-short':
                    team.short ||
                    '',

                  'data-ymd':
                    point.ymd ||
                    '',

                  'data-loss':
                    Number(
                      point.loss_kg
                    ),
                }
              );

            const circle =
              svgEl(
                'circle',
                {
                  cx:
                    x,

                  cy:
                    y,

                  r:
                    8,

                  fill:
                    team.color ||
                    '#999',
                }
              );

            const text =
              svgEl(
                'text',
                {
                  x,
                  y,
                }
              );

            text.textContent =
              team.short ||
              '';

            g.append(
              circle,
              text
            );

            svg.appendChild(
              g
            );
          }
        }
      );

    /*
     * 以前はグラフの点を押した時に
     * #clubChartDetailへ文字を表示していたが、
     * 下のランキングカードと情報が重複するため
     * 画面上では表示しない。
     */
    if (detail) {
      detail.textContent =
        '';
    }

    appendGraphMarker(
      svg,
      range
    );
  }


  /* ==========================================================
     DOM監視
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
            if (rendering) {
              return;
            }

            /*
             * app.jsがランキングを再描画した時も
             * 自動的に2段表示へ整形する。
             */
            formatRankMeta();

            if (
              !renderStateIsCurrent()
            ) {
              scheduleRender(
                0
              );
            }
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
    /*
     * 通常ランキングの整形は
     * 大会パネル表示状態に関係なく行う。
     */
    formatRankMeta();

    if (!clubData) {
      return;
    }

    const panel =
      document.getElementById(
        'clubPanel'
      );

    if (!panel) {
      return;
    }

    rendering =
      true;

    disconnectObserver();

    try {
      renderAlignedGraph();

      renderRankings();

      formatRankMeta();

    } finally {
      rendering =
        false;

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
    if (
      loading ||
      !deviceId()
    ) {
      return;
    }

    loading =
      true;

    try {
      const data =
        await api(
          '/api/weekly-summary?club=1'
        );

      if (
        data &&
        data.eligible === true &&
        data.mode === 'club'
      ) {
        clubData =
          data;

        renderAll();
      }

    } catch (error) {
      if (
        error &&
        (
          error.status === 403 ||
          error.status === 404 ||
          error.message ===
            'club_summary_not_enabled' ||
          error.message ===
            'not_registered'
        )
      ) {
        clubData =
          null;

        const old =
          document.getElementById(
            'clubProgressRankings'
          );

        if (old) {
          old.remove();
        }

        return;
      }

      console.warn(
        'club_progress_load_error',
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


  /* ==========================================================
     起動
     ========================================================== */

  function start() {
    addStyle();

    /*
     * app.js側の初回ランキング描画が
     * すでに終わっているケースにも対応。
     */
    formatRankMeta();

    connectObserver();

    setTimeout(
      () =>
        void refresh(),
      1700
    );

    setTimeout(
      () =>
        void refresh(),
      4600
    );

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
          setTimeout(
            () => {
              formatRankMeta();
              void refresh();
            },
            130
          );

          setTimeout(
            () =>
              scheduleRender(
                0
              ),
            260
          );

          return;
        }

        const rankTab =
          event.target.closest(
            '#rankTabs .tab[data-r]'
          );

        if (rankTab) {
          setTimeout(
            () => {
              formatRankMeta();

              scheduleRender(
                0
              );
            },
            260
          );

          return;
        }

        const graphButton =
          event.target.closest(
            '[data-club-chart-mode]'
          );

        if (graphButton) {
          setTimeout(
            () =>
              scheduleRender(
                0
              ),
            0
          );
        }
      }
    );

    document.addEventListener(
      'visibilitychange',
      () => {
        if (
          document.visibilityState ===
            'visible'
        ) {
          setTimeout(
            () => {
              formatRankMeta();
              void refresh();
            },
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
