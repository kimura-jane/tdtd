'use strict';

/* ============================================================
   みんやせ / club-progress-ui.js

   つだつダイエット部 追加表示
   ------------------------------------------------------------
   1. 通常ランキングを縦にコンパクト化
   2. 大会グラフの終点を直近月曜日に統一
   3. グラフ下に
      ・全期間ランキング
      ・当月途中経過ランキング
      を表示

   ※既存API /api/weekly-summary?club=1 のデータだけを使う。
   ※D1変更なし。
   ※既存 club-ui.js / weekly-summary.js は変更しない。
   ============================================================ */

(() => {
  const API =
    (typeof window !== 'undefined' && window.MINYASE_API_BASE) || '';

  const DEVICE_KEY =
    'tsudatsu.device_id.v1';

  const CAMPAIGN_START =
    '2026-09-01';

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


  function isMondayYmd(ymd) {
    const day = ymdDay(ymd);
    if (day === null) return false;

    return new Date(day * 86400000)
      .getUTCDay() === 1;
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


  function monthLabel(ymd) {
    const p = parseYmd(ymd);

    return p
      ? p.month + '月途中経過'
      : '今月途中経過';
  }


  function progressKgText(lossKg) {
    const loss = Number(lossKg);
    if (!Number.isFinite(loss)) return '—';

    const change =
      Math.round((-loss) * 10) / 10;

    if (Object.is(change, -0) || change === 0) {
      return '0.0kg';
    }

    return (
      (change > 0 ? '+' : '') +
      change.toFixed(1) +
      'kg'
    );
  }


  function detailLossText(lossKg) {
    const n = Number(lossKg);
    if (!Number.isFinite(n)) return '—';

    if (n < 0) {
      return Math.abs(n).toFixed(1) + 'kg増量';
    }

    return n.toFixed(1) + 'kg減量';
  }


  /* ==========================================================
     CSS
     ========================================================== */

  function addStyle() {
    if (document.getElementById('clubProgressUiStyle')) return;

    const style = document.createElement('style');
    style.id = 'clubProgressUiStyle';

    style.textContent = `
#rankList.rank > li:not(.empty){
  gap:8px;
  padding:8px 0
}

#rankList.rank > li.self{
  margin:4px -4px;
  padding:9px 8px 9px 12px;
  border-radius:16px
}

#rankList.rank > li.self::before{
  top:8px;
  bottom:8px;
  width:4px
}

#rankList.rank .no{
  width:28px;
  flex-basis:28px;
  font-size:12px
}

#rankList.rank .no.top{
  height:28px;
  line-height:28px
}

#rankList.rank .nm{
  font-size:13.5px;
  line-height:1.25
}

#rankList.rank .sb{
  margin-top:1px;
  font-size:10px;
  line-height:1.3
}

#rankList.rank .ls{
  font-size:16px;
  line-height:1.2
}

#rankList.rank .ls.none{
  font-size:12px
}

#rankList.rank .kebab{
  width:24px;
  flex-basis:24px;
  padding:2px;
  font-size:16px
}

.club-progress-rankings{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:8px;
  margin-top:10px
}

.club-progress-card{
  min-width:0;
  padding:11px 10px;
  border:1px solid var(--line2,#f4ede6);
  border-radius:15px;
  background:#fff
}

.club-progress-title{
  margin:0;
  color:var(--ink,#181614);
  font-size:12px;
  font-weight:900;
  line-height:1.35
}

.club-progress-period{
  margin:2px 0 7px;
  color:var(--sub,#7e756d);
  font-size:9px;
  font-weight:700;
  line-height:1.35
}

.club-progress-list{
  list-style:none;
  margin:0;
  padding:0
}

.club-progress-row{
  display:grid;
  grid-template-columns:20px minmax(0,1fr) auto;
  gap:5px;
  align-items:center;
  min-width:0;
  padding:5px 0;
  border-top:1px solid var(--line2,#f4ede6)
}

.club-progress-row:first-child{
  border-top:0
}

.club-progress-medal{
  font-size:13px;
  line-height:1;
  text-align:center
}

.club-progress-team{
  overflow:hidden;
  min-width:0;
  color:var(--ink2,#4b433d);
  font-size:10px;
  font-weight:900;
  text-overflow:ellipsis;
  white-space:nowrap
}

.club-progress-loss{
  color:var(--ink,#181614);
  font-size:10px;
  font-variant-numeric:tabular-nums;
  font-weight:900;
  white-space:nowrap
}

.club-progress-empty{
  margin:0;
  padding:5px 0 1px;
  color:var(--sub,#7e756d);
  font-size:10px;
  font-weight:700;
  line-height:1.45
}

@media(max-width:380px){
  #rankList.rank > li:not(.empty){
    gap:6px;
    padding:7px 0
  }

  #rankList.rank .nm{
    font-size:13px
  }

  #rankList.rank .ls{
    font-size:15px
  }

  .club-progress-rankings{
    gap:6px
  }

  .club-progress-card{
    padding:10px 8px
  }

  .club-progress-row{
    grid-template-columns:18px minmax(0,1fr) auto;
    gap:4px
  }

  .club-progress-team,
  .club-progress-loss{
    font-size:9px
  }
}
`;

    document.head.appendChild(style);
  }


  /* ==========================================================
     API
     ========================================================== */

  async function api(path) {
    const did = deviceId();

    if (!did) {
      throw new Error('not_registered');
    }

    let response;

    try {
      response =
        await fetch(
          API + path,
          {
            method: 'GET',
            headers: {
              'x-device-id': did,
            },
            cache: 'no-store',
          }
        );
    } catch (_) {
      throw new Error('network_error');
    }

    let data = {};

    try {
      data = await response.json();
    } catch {}

    if (!response.ok || data.ok === false) {
      const error =
        new Error(
          data.error ||
          'http_' + response.status
        );

      error.status = response.status;
      throw error;
    }

    return data;
  }


  /* ==========================================================
     直近月曜日
     ========================================================== */

  function allPointDates(data) {
    const dates = new Set();

    for (const team of (data && data.teams) || []) {
      for (const point of team.points || []) {
        if (point && point.ymd) {
          dates.add(String(point.ymd));
        }
      }
    }

    return [...dates].sort();
  }


  function latestMondayYmd(data) {
    const today =
      String((data && data.today_ymd) || '');

    const mondays =
      allPointDates(data)
        .filter(
          ymd =>
            ymd >= CAMPAIGN_START &&
            (!today || ymd <= today) &&
            isMondayYmd(ymd)
        )
        .sort();

    return mondays.length
      ? mondays[mondays.length - 1]
      : null;
  }


  function progressContext(data) {
    const end = latestMondayYmd(data);
    if (!end) return null;

    const monthStart = monthStartYmd(end);
    if (!monthStart) return null;

    return {
      end,
      month_start: monthStart,
      baseline:
        String(
          (data && data.baseline_ymd) ||
          CAMPAIGN_START
        ),
    };
  }


  /* ==========================================================
     チーム順位計算
     ========================================================== */

  function pointAt(team, ymd) {
    const point =
      (team && team.points || [])
        .find(
          row =>
            row &&
            row.ymd === ymd
        );

    if (!point) return null;

    const value = Number(point.loss_kg);

    return Number.isFinite(value)
      ? value
      : null;
  }


  function rankedRows(data, mode) {
    const ctx = progressContext(data);
    if (!ctx) return [];

    const rows = [];

    for (const team of data.teams || []) {
      const endLoss = pointAt(team, ctx.end);

      if (!Number.isFinite(endLoss)) continue;

      let lossKg = endLoss;

      if (mode === 'month') {
        const startLoss =
          pointAt(
            team,
            ctx.month_start
          );

        if (!Number.isFinite(startLoss)) continue;

        lossKg =
          Math.round(
            (endLoss - startLoss) * 10
          ) / 10;
      }

      rows.push({
        team_id: team.team_id,
        team_name:
          team.name ||
          team.team_id ||
          '—',
        loss_kg: lossKg,
      });
    }

    return rows.sort(
      (a, b) => {
        const diff =
          Number(b.loss_kg) -
          Number(a.loss_kg);

        if (diff !== 0) return diff;

        return String(a.team_id || '')
          .localeCompare(
            String(b.team_id || '')
          );
      }
    );
  }


  /* ==========================================================
     数字ランキング表示
     ========================================================== */

  function buildRankingCard(title, period, rows) {
    const card = document.createElement('section');
    card.className = 'club-progress-card';

    const h = document.createElement('h4');
    h.className = 'club-progress-title';
    h.textContent = title;

    const p = document.createElement('p');
    p.className = 'club-progress-period';
    p.textContent = period;

    card.append(h, p);

    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'club-progress-empty';
      empty.textContent = '月曜集計後に表示します';
      card.appendChild(empty);
      return card;
    }

    const list = document.createElement('ol');
    list.className = 'club-progress-list';

    rows
      .slice(0, 3)
      .forEach(
        (row, index) => {
          const li = document.createElement('li');
          li.className = 'club-progress-row';

          const medal = document.createElement('span');
          medal.className = 'club-progress-medal';
          medal.textContent = MEDALS[index] || String(index + 1);

          const team = document.createElement('span');
          team.className = 'club-progress-team';
          team.textContent = row.team_name;

          const loss = document.createElement('strong');
          loss.className = 'club-progress-loss';
          loss.textContent = progressKgText(row.loss_kg);

          li.append(medal, team, loss);
          list.appendChild(li);
        }
      );

    card.appendChild(list);
    return card;
  }


  function renderRankings() {
    const detail =
      document.getElementById('clubChartDetail');

    if (!detail || !clubData) return;

    const old =
      document.getElementById('clubProgressRankings');

    if (old) old.remove();

    const wrap = document.createElement('div');
    wrap.id = 'clubProgressRankings';
    wrap.className = 'club-progress-rankings';

    const ctx = progressContext(clubData);

    if (!ctx) {
      wrap.append(
        buildRankingCard(
          '🏆 全期間',
          '次の月曜集計後に更新',
          []
        ),
        buildRankingCard(
          '🔥 今月途中経過',
          '次の月曜集計後に更新',
          []
        )
      );

      detail.insertAdjacentElement('afterend', wrap);
      return;
    }

    const allRows = rankedRows(clubData, 'all');
    const monthRows = rankedRows(clubData, 'month');

    wrap.append(
      buildRankingCard(
        '🏆 全期間',
        shortDateText(ctx.baseline) +
          '〜' +
          shortDateText(ctx.end),
        allRows
      ),
      buildRankingCard(
        '🔥 ' + monthLabel(ctx.end),
        shortDateText(ctx.month_start) +
          '〜' +
          shortDateText(ctx.end),
        monthRows
      )
    );

    detail.insertAdjacentElement('afterend', wrap);
  }


  /* ==========================================================
     SVG
     ========================================================== */

  function svgEl(name, attrs = {}) {
    const node =
      document.createElementNS(
        SVG_NS,
        name
      );

    for (const [key, value] of Object.entries(attrs)) {
      node.setAttribute(key, String(value));
    }

    return node;
  }


  function niceStep(raw) {
    if (!Number.isFinite(raw) || raw <= 0) return 1;

    const power =
      Math.pow(
        10,
        Math.floor(Math.log10(raw))
      );

    const scaled = raw / power;

    if (scaled <= 1) return 1 * power;
    if (scaled <= 2) return 2 * power;
    if (scaled <= 5) return 5 * power;

    return 10 * power;
  }


  function formatTick(value) {
    const abs = Math.abs(value);

    return (
      abs < 10 &&
      Math.abs(value % 1) > 0.001
    )
      ? value.toFixed(1)
      : String(Math.round(value));
  }


  function mondayTicks(startYmd, endYmd) {
    const start = ymdDay(startYmd);
    const end = ymdDay(endYmd);

    if (start === null || end === null) return [];

    const result = [];

    for (let day = start; day <= end; day++) {
      const d = new Date(day * 86400000);

      if (d.getUTCDay() === 1) {
        result.push(dayToYmd(day));
      }
    }

    return result;
  }


  function monthStartTicks(startYmd, endYmd) {
    const start = ymdDay(startYmd);
    const end = ymdDay(endYmd);

    if (start === null || end === null) return [];

    const result = [];

    for (let day = start; day <= end; day++) {
      const ymd = dayToYmd(day);

      if (/^\d{4}-\d{2}-01$/.test(ymd)) {
        result.push(ymd);
      }
    }

    if (
      endYmd &&
      !result.includes(endYmd) &&
      endYmd !== startYmd
    ) {
      result.push(endYmd);
    }

    return [...new Set(result)].sort();
  }


  function activeGraphMode() {
    const active =
      document.querySelector(
        '[data-club-chart-mode].is-on'
      );

    return (
      active &&
      active.dataset.clubChartMode === 'all'
    )
      ? 'all'
      : 'month';
  }


  function graphRange(data) {
    const ctx = progressContext(data);
    if (!ctx) return null;

    if (activeGraphMode() === 'all') {
      return {
        mode: 'all',
        start: ctx.baseline,
        end: ctx.end,
        ticks:
          monthStartTicks(
            ctx.baseline,
            ctx.end
          ),
      };
    }

    return {
      mode: 'month',
      start: ctx.month_start,
      end: ctx.end,
      ticks:
        mondayTicks(
          ctx.month_start,
          ctx.end
        ),
    };
  }


  /*
   * monthly-results-ui.js との再描画ループ防止用。
   *
   * 既存 club-ui.js がグラフを描き直すと
   * SVG内部のこのマーカーが消える。
   *
   * 一方、正式結果カードを追加・削除しただけなら
   * マーカーは残るため、不要な再描画を行わない。
   */
  function graphSignature(range) {
    return range
      ? [
          range.mode,
          range.start,
          range.end,
        ].join('|')
      : 'none';
  }


  function appendGraphMarker(svg, range) {
    const marker =
      svgEl(
        'g',
        {
          id: 'clubProgressGraphMarker',
          'data-signature': graphSignature(range),
          'aria-hidden': 'true',
        }
      );

    svg.appendChild(marker);
  }


  function renderStateIsCurrent() {
    if (!clubData) return true;

    const svg =
      document.getElementById('clubChart');

    const rankings =
      document.getElementById('clubProgressRankings');

    if (!svg || !rankings) return false;

    const marker =
      svg.querySelector('#clubProgressGraphMarker');

    if (!marker) return false;

    const expected =
      graphSignature(
        graphRange(clubData)
      );

    return (
      marker.getAttribute('data-signature') ===
      expected
    );
  }


  /* ==========================================================
     グラフ描画
     ========================================================== */

  function renderAlignedGraph() {
    const svg =
      document.getElementById('clubChart');

    const detail =
      document.getElementById('clubChartDetail');

    const note =
      document.getElementById('clubChartNote');

    if (!svg || !clubData) return;

    const range = graphRange(clubData);

    svg.innerHTML = '';

    if (!range) {
      const text =
        svgEl(
          'text',
          {
            x: 180,
            y: 135,
            'text-anchor': 'middle',
            class: 'club-chart-axis-text',
          }
        );

      text.textContent =
        '月曜集計がまだありません';

      svg.appendChild(text);
      appendGraphMarker(svg, null);

      if (detail) {
        detail.textContent =
          '最初の月曜集計後に推移を表示します。';
      }

      if (note) {
        note.textContent =
          'グラフと順位は毎週月曜日に更新します';
      }

      return;
    }

    if (note) {
      note.textContent =
        range.mode === 'month'
          ? (
              monthLabel(range.end) +
              '・' +
              shortDateText(range.start) +
              '〜' +
              shortDateText(range.end)
            )
          : (
              '全期間・' +
              shortDateText(range.start) +
              '〜' +
              shortDateText(range.end)
            );
    }

    const teams =
      Array.isArray(clubData.teams)
        ? clubData.teams
        : [];

    const visibleTeams =
      teams.map(
        team => ({
          ...team,
          visible_points:
            (team.points || [])
              .filter(
                point =>
                  point &&
                  point.ymd >= range.start &&
                  point.ymd <= range.end &&
                  Number.isFinite(
                    Number(point.loss_kg)
                  )
              ),
        })
      );

    const values = [];

    for (const team of visibleTeams) {
      for (const point of team.visible_points) {
        values.push(Number(point.loss_kg));
      }
    }

    if (!values.length) {
      const text =
        svgEl(
          'text',
          {
            x: 180,
            y: 135,
            'text-anchor': 'middle',
            class: 'club-chart-axis-text',
          }
        );

      text.textContent =
        '集計できる記録がまだありません';

      svg.appendChild(text);
      appendGraphMarker(svg, range);

      if (detail) {
        detail.textContent =
          '集計できる記録がまだありません。';
      }

      return;
    }

    const W = 360;
    const left = 43;
    const right = 12;
    const top = 22;
    const bottom = 242;

    const plotW = W - left - right;
    const plotH = bottom - top;

    const rawMin = Math.min(0, ...values);
    const rawMax = Math.max(0, ...values);

    const baseSpan =
      Math.max(
        1,
        rawMax - rawMin
      );

    const step =
      niceStep(baseSpan / 4);

    let yMin =
      Math.floor(rawMin / step) * step;

    let yMax =
      Math.ceil(rawMax / step) * step;

    if (yMin === yMax) {
      yMax = yMin + step;
    }

    if (yMax === 0) {
      yMax = step;
    }

    const startDay = ymdDay(range.start);
    const endDay = ymdDay(range.end);

    const daySpan =
      Math.max(
        1,
        endDay - startDay
      );

    const xFor =
      ymd => {
        const d = ymdDay(ymd);
        if (d === null) return left;

        return (
          left +
          ((d - startDay) / daySpan) *
          plotW
        );
      };

    const yFor =
      value =>
        top +
        ((yMax - value) /
          (yMax - yMin)) *
        plotH;

    const title =
      svgEl(
        'text',
        {
          x: 8,
          y: 12,
          class: 'club-chart-axis-title',
        }
      );

    title.textContent = '減量kg';
    svg.appendChild(title);

    const tickCount = 4;

    for (let i = 0; i <= tickCount; i++) {
      const value =
        yMin +
        ((yMax - yMin) * i / tickCount);

      const y = yFor(value);

      const line =
        svgEl(
          'line',
          {
            x1: left,
            x2: W - right,
            y1: y,
            y2: y,
            class:
              Math.abs(value) < 0.0001
                ? 'club-chart-zero'
                : 'club-chart-grid',
          }
        );

      const label =
        svgEl(
          'text',
          {
            x: left - 7,
            y: y + 3,
            'text-anchor': 'end',
            class: 'club-chart-axis-text',
          }
        );

      label.textContent = formatTick(value);
      svg.append(line, label);
    }

    for (const ymd of range.ticks) {
      if (ymd < range.start || ymd > range.end) continue;

      const x = xFor(ymd);

      const tick =
        svgEl(
          'line',
          {
            x1: x,
            x2: x,
            y1: bottom,
            y2: bottom + 4,
            class: 'club-chart-grid',
          }
        );

      const label =
        svgEl(
          'text',
          {
            x,
            y: bottom + 17,
            'text-anchor': 'middle',
            class: 'club-chart-axis-text',
          }
        );

      label.textContent = shortDateText(ymd);
      svg.append(tick, label);
    }

    visibleTeams.forEach(
      (team, teamIndex) => {
        const points = team.visible_points;
        if (!points.length) return;

        const xOffset =
          (teamIndex - 1) * 4;

        const pathData =
          points
            .map(
              (point, index) => {
                const x =
                  xFor(point.ymd) + xOffset;

                const y =
                  yFor(Number(point.loss_kg));

                return (
                  (index === 0 ? 'M' : 'L') +
                  x.toFixed(2) +
                  ',' +
                  y.toFixed(2)
                );
              }
            )
            .join(' ');

        const path =
          svgEl(
            'path',
            {
              d: pathData,
              stroke: team.color || '#999',
              class: 'club-chart-line',
            }
          );

        svg.appendChild(path);

        for (const point of points) {
          const x =
            xFor(point.ymd) + xOffset;

          const y =
            yFor(Number(point.loss_kg));

          const g =
            svgEl(
              'g',
              {
                class: 'club-chart-point',
                tabindex: '0',
                role: 'button',
                'data-team-name': team.name || '',
                'data-team-short': team.short || '',
                'data-ymd': point.ymd || '',
                'data-loss': Number(point.loss_kg),
              }
            );

          const circle =
            svgEl(
              'circle',
              {
                cx: x,
                cy: y,
                r: 8,
                fill: team.color || '#999',
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

          text.textContent = team.short || '';

          g.append(circle, text);
          svg.appendChild(g);
        }
      }
    );

    const pointHandler =
      node => {
        if (!detail) return;

        detail.textContent =
          dateText(node.dataset.ymd) +
          '　' +
          node.dataset.teamName +
          '　' +
          detailLossText(node.dataset.loss);
      };

    svg
      .querySelectorAll('.club-chart-point')
      .forEach(
        node => {
          node.addEventListener(
            'click',
            () => pointHandler(node)
          );

          node.addEventListener(
            'keydown',
            event => {
              if (
                event.key === 'Enter' ||
                event.key === ' '
              ) {
                event.preventDefault();
                pointHandler(node);
              }
            }
          );
        }
      );

    if (detail) {
      const parts = [];

      for (const team of visibleTeams) {
        const point =
          team.visible_points
            .find(
              row =>
                row.ymd === range.end
            );

        if (
          point &&
          Number.isFinite(
            Number(point.loss_kg)
          )
        ) {
          parts.push(
            (team.short || team.name) +
            ' ' +
            detailLossText(point.loss_kg)
          );
        }
      }

      detail.textContent =
        dateText(range.end) +
        (
          parts.length
            ? '　' + parts.join(' ／ ')
            : ''
        );
    }

    appendGraphMarker(svg, range);
  }


  /* ==========================================================
     DOM監視
     ========================================================== */

  function disconnectObserver() {
    if (observer) observer.disconnect();
  }


  function connectObserver() {
    /*
     * rankBox は index.html に最初から存在する。
     * clubPanelそのものではなく親を監視することで、
     * club-ui.js が初めて clubPanel を作るケースにも対応。
     */
    const rankBox =
      document.getElementById('rankBox');

    if (!rankBox) return;

    if (!observer) {
      observer =
        new MutationObserver(
          () => {
            /*
             * monthly-results-ui.js が
             * 正式結果カードを差し込んだだけなら、
             * グラフマーカーと数字ランキングは残っている。
             *
             * その場合は再描画しない。
             *
             * club-ui.js がpanelやグラフを描き直した場合だけ
             * マーカーまたはランキングが消えるため再描画する。
             */
            if (
              !rendering &&
              !renderStateIsCurrent()
            ) {
              scheduleRender(0);
            }
          }
        );
    }

    observer.observe(
      rankBox,
      {
        childList: true,
        subtree: true,
      }
    );
  }


  function renderAll() {
    if (!clubData) return;

    const panel =
      document.getElementById('clubPanel');

    if (!panel) return;

    rendering = true;
    disconnectObserver();

    try {
      renderAlignedGraph();
      renderRankings();
    } finally {
      rendering = false;
      connectObserver();
    }
  }


  function scheduleRender(delay = 0) {
    if (renderTimer) {
      clearTimeout(renderTimer);
    }

    renderTimer =
      setTimeout(
        () => {
          renderTimer = null;
          renderAll();
        },
        delay
      );
  }


  /* ==========================================================
     データ取得
     ========================================================== */

  async function refresh() {
    if (loading) return;
    if (!deviceId()) return;

    loading = true;

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
        clubData = data;
        renderAll();
      }
    } catch (error) {
      if (
        error &&
        (
          error.status === 403 ||
          error.status === 404 ||
          error.message === 'club_summary_not_enabled' ||
          error.message === 'not_registered'
        )
      ) {
        clubData = null;

        const old =
          document.getElementById('clubProgressRankings');

        if (old) old.remove();
        return;
      }

      console.warn(
        'club_progress_load_error',
        error && error.message
          ? error.message
          : error
      );
    } finally {
      loading = false;
    }
  }


  /* ==========================================================
     起動
     ========================================================== */

  function start() {
    addStyle();
    connectObserver();

    setTimeout(
      () => void refresh(),
      1700
    );

    setTimeout(
      () => void refresh(),
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
          mainTab.dataset.v === 'group'
        ) {
          setTimeout(
            () => void refresh(),
            130
          );

          setTimeout(
            () => scheduleRender(0),
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
            () => scheduleRender(0),
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
            () => scheduleRender(0),
            0
          );
        }
      }
    );

    document.addEventListener(
      'visibilitychange',
      () => {
        if (
          document.visibilityState === 'visible'
        ) {
          setTimeout(
            () => void refresh(),
            150
          );
        }
      }
    );
  }


  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      start,
      {
        once: true,
      }
    );
  } else {
    start();
  }
})();
