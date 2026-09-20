/* ============================================================
   つだつダイエット部 / 大会表示
   ------------------------------------------------------------
   対象5グループ所属者だけ、ランキングの「ライバル」を
   「つだつダイエット部」に置き換える。

   表示：
   ・次の公式記録 / 投票締切
   ・3チーム累計減量推移
   ・累計 / 週間 減量TOP5
   ・月曜 / 毎月1日の未入力者
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

  const SVG_NS =
    'http://www.w3.org/2000/svg';

  let clubEnabled = false;
  let clubData = null;
  let voteData = null;
  let loadingClub = false;
  let loadingVote = false;
  let topMode = 'cumulative';


  function deviceId() {
    return localStorage.getItem(K_DEV) || '';
  }


  async function api(path) {

    const did = deviceId();

    if (!did) {
      throw new Error('not_registered');
    }

    let response;

    try {
      response = await fetch(
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
      const error = new Error(
        data.error ||
        ('http_' + response.status)
      );
      error.status = response.status;
      throw error;
    }

    return data;
  }


  function pad2(value) {
    return String(value).padStart(2, '0');
  }


  function parseYmd(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
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
      Date.UTC(p.year, p.month - 1, p.day) /
      86400000
    );
  }


  function dateText(ymd, withWeekday = false) {
    const p = parseYmd(ymd);
    if (!p) return String(ymd || '—');

    let text =
      p.month + '月' +
      p.day + '日';

    if (withWeekday) {
      const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
      const dow = new Date(
        Date.UTC(
          p.year,
          p.month - 1,
          p.day
        )
      ).getUTCDay();
      text += '（' + weekdays[dow] + '）';
    }

    return text;
  }


  function shortDateText(ymd) {
    const p = parseYmd(ymd);
    return p
      ? p.month + '/' + p.day
      : String(ymd || '');
  }


  function lossText(value) {
    const n = Number(value);

    if (!Number.isFinite(n)) {
      return '—';
    }

    if (n < 0) {
      return Math.abs(n).toFixed(1) + 'kg増量';
    }

    return n.toFixed(1) + 'kg減量';
  }


  function daysToDeadline(deadlineAt, todayYmd) {
    const ms = Number(deadlineAt);

    if (!Number.isFinite(ms)) {
      return null;
    }

    const d = new Date(ms + 9 * 60 * 60 * 1000);
    const deadlineYmd =
      d.getUTCFullYear() + '-' +
      pad2(d.getUTCMonth() + 1) + '-' +
      pad2(d.getUTCDate());

    const from = ymdDay(todayYmd);
    const to = ymdDay(deadlineYmd);

    if (from === null || to === null) {
      return null;
    }

    return to - from;
  }


  function deadlineText(deadlineAt) {
    const ms = Number(deadlineAt);

    if (!Number.isFinite(ms)) {
      return '—';
    }

    const d = new Date(ms + 9 * 60 * 60 * 1000);

    return (
      (d.getUTCMonth() + 1) + '月' +
      d.getUTCDate() + '日 ' +
      pad2(d.getUTCHours()) + ':' +
      pad2(d.getUTCMinutes())
    );
  }


  function addStyle() {

    if (document.getElementById('clubUiStyle')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'clubUiStyle';
    style.textContent = `
#rankTabs .club-rank-tab{
  font-size:11px;
  letter-spacing:-.03em
}

#clubPanel{
  margin-top:14px
}

.club-shell{
  display:grid;
  gap:14px
}

.club-countdowns{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:9px
}

.club-countdown{
  min-width:0;
  padding:12px 11px;
  border:1px solid var(--line2,#f4ede6);
  border-radius:16px;
  background:linear-gradient(180deg,#fff 0%,#fffafc 100%);
  box-shadow:0 4px 14px rgba(82,57,35,.045)
}

.club-countdown-label{
  display:block;
  margin-bottom:4px;
  color:var(--sub,#7e756d);
  font-size:10px;
  font-weight:800;
  line-height:1.35
}

.club-countdown-value{
  display:block;
  color:var(--ink,#181614);
  font-size:19px;
  font-variant-numeric:tabular-nums;
  font-weight:900;
  line-height:1.25;
  white-space:nowrap
}

.club-countdown-sub{
  display:block;
  margin-top:4px;
  color:var(--sub,#7e756d);
  font-size:10px;
  font-weight:700;
  line-height:1.4
}

.club-section{
  padding:14px;
  border:1px solid var(--line,#eee5dc);
  border-radius:19px;
  background:
    radial-gradient(circle at 100% 0%,rgba(239,88,196,.07),transparent 34%),
    rgba(255,255,255,.86);
  box-shadow:0 5px 18px rgba(82,57,35,.045)
}

.club-section-head{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:10px;
  margin-bottom:10px
}

.club-section-title{
  margin:0;
  color:var(--ink,#181614);
  font-size:16px;
  font-weight:900;
  line-height:1.35
}

.club-section-note{
  margin:3px 0 0;
  color:var(--sub,#7e756d);
  font-size:10px;
  font-weight:700;
  line-height:1.45
}

.club-team-legend{
  display:flex;
  flex-wrap:wrap;
  gap:7px;
  margin-bottom:8px
}

.club-team-legend-item{
  display:inline-flex;
  align-items:center;
  gap:5px;
  min-width:0;
  padding:5px 8px;
  border:1px solid var(--line2,#f4ede6);
  border-radius:999px;
  background:#fff;
  color:var(--ink2,#4b433d);
  font-size:10px;
  font-weight:800
}

.club-team-dot{
  display:inline-flex;
  width:18px;
  height:18px;
  flex:0 0 18px;
  align-items:center;
  justify-content:center;
  border-radius:50%;
  color:#fff;
  font-size:10px;
  font-weight:900;
  line-height:1
}

.club-chart-wrap{
  overflow:hidden;
  width:100%;
  border:1px solid var(--line2,#f4ede6);
  border-radius:16px;
  background:#fff
}

.club-chart{
  display:block;
  width:100%;
  height:auto;
  min-height:250px
}

.club-chart-grid{
  stroke:#eee8e1;
  stroke-width:1
}

.club-chart-zero{
  stroke:#c9bfb6;
  stroke-width:1.2
}

.club-chart-axis-text{
  fill:#8b8178;
  font-size:9px;
  font-weight:700
}

.club-chart-axis-title{
  fill:#6f665f;
  font-size:9px;
  font-weight:900
}

.club-chart-line{
  fill:none;
  stroke-width:3;
  stroke-linecap:round;
  stroke-linejoin:round
}

.club-chart-point{
  cursor:pointer;
  outline:none
}

.club-chart-point circle{
  stroke:#fff;
  stroke-width:2;
  filter:drop-shadow(0 1px 2px rgba(60,45,35,.14))
}

.club-chart-point text{
  fill:#fff;
  font-size:8px;
  font-weight:900;
  pointer-events:none;
  text-anchor:middle;
  dominant-baseline:central
}

.club-chart-detail{
  min-height:33px;
  margin-top:8px;
  padding:8px 10px;
  border-radius:12px;
  background:#f8f5f0;
  color:var(--ink2,#4b433d);
  font-size:11px;
  font-weight:800;
  line-height:1.5
}

.club-top-switch{
  display:flex;
  gap:4px;
  padding:4px;
  border-radius:14px;
  background:#f4efe9
}

.club-top-switch button{
  min-height:30px;
  padding:5px 9px;
  border:0;
  border-radius:11px;
  background:transparent;
  color:#81776e;
  font-size:10px;
  font-weight:900;
  cursor:pointer
}

.club-top-switch button.is-on{
  background:#fff;
  color:var(--ink,#181614);
  box-shadow:0 2px 8px rgba(70,50,35,.07)
}

.club-top-date{
  margin:0 0 7px;
  color:var(--sub,#7e756d);
  font-size:10px;
  font-weight:700
}

.club-top-list{
  list-style:none;
  margin:0;
  padding:0
}

.club-top-row{
  display:grid;
  grid-template-columns:27px 24px minmax(0,1fr) auto;
  gap:8px;
  align-items:center;
  min-width:0;
  padding:9px 0;
  border-top:1px solid var(--line2,#f4ede6)
}

.club-top-row:first-child{
  border-top:0
}

.club-top-rank{
  display:flex;
  width:25px;
  height:25px;
  align-items:center;
  justify-content:center;
  border-radius:50%;
  background:#f3eee7;
  color:#665e57;
  font-size:11px;
  font-weight:900
}

.club-top-team{
  display:flex;
  width:22px;
  height:22px;
  align-items:center;
  justify-content:center;
  border-radius:50%;
  color:#fff;
  font-size:10px;
  font-weight:900
}

.club-top-name{
  overflow:hidden;
  min-width:0;
  color:var(--ink,#181614);
  font-size:13px;
  font-weight:900;
  text-overflow:ellipsis;
  white-space:nowrap
}

.club-top-loss{
  color:var(--ink2,#4b433d);
  font-size:12px;
  font-variant-numeric:tabular-nums;
  font-weight:900;
  white-space:nowrap
}

.club-empty{
  padding:12px 0 2px;
  color:var(--sub,#7e756d);
  font-size:11px;
  font-weight:700
}

.club-missing-wrap{
  display:grid;
  gap:10px
}

.club-missing-section{
  padding:13px 14px;
  border:1px solid rgba(239,88,196,.16);
  border-radius:17px;
  background:linear-gradient(180deg,#fff 0%,#fff9fc 100%)
}

.club-missing-head{
  display:flex;
  align-items:baseline;
  justify-content:space-between;
  gap:10px;
  margin-bottom:8px
}

.club-missing-title{
  margin:0;
  color:var(--ink,#181614);
  font-size:14px;
  font-weight:900
}

.club-missing-count{
  color:#b94c91;
  font-size:11px;
  font-weight:900;
  white-space:nowrap
}

.club-missing-note{
  margin:-3px 0 9px;
  color:var(--sub,#7e756d);
  font-size:9px;
  font-weight:700
}

.club-missing-members{
  display:flex;
  flex-wrap:wrap;
  gap:6px
}

.club-missing-member{
  display:inline-flex;
  align-items:center;
  gap:5px;
  max-width:100%;
  padding:6px 8px;
  border:1px solid var(--line2,#f4ede6);
  border-radius:999px;
  background:#fff;
  color:var(--ink2,#4b433d);
  font-size:11px;
  font-weight:800
}

.club-missing-member .club-team-dot{
  width:17px;
  height:17px;
  flex-basis:17px;
  font-size:9px
}

@media(max-width:380px){
  #rankTabs .club-rank-tab{
    font-size:10px
  }

  .club-countdown{
    padding:10px 9px
  }

  .club-countdown-value{
    font-size:17px
  }

  .club-section{
    padding:12px
  }

  .club-top-row{
    grid-template-columns:25px 22px minmax(0,1fr) auto;
    gap:6px
  }

  .club-top-name{
    font-size:12px
  }

  .club-top-loss{
    font-size:11px
  }
}
`;

    document.head.appendChild(style);
  }


  function rankDom() {
    return {
      box: document.getElementById('rankBox'),
      tabs: document.getElementById('rankTabs'),
      watchNav: document.getElementById('watchNav'),
      head: document.getElementById('rankHead'),
      list: document.getElementById('rankList'),
      msg: document.getElementById('rmsg'),
      club: document.getElementById('clubPanel'),
    };
  }


  function ensurePanel() {

    const dom = rankDom();

    if (!dom.box || !dom.tabs) {
      return null;
    }

    let panel = dom.club;

    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'clubPanel';
      panel.hidden = true;
      dom.tabs.insertAdjacentElement('afterend', panel);
    }

    return panel;
  }


  function rivalTab() {
    return document.querySelector(
      '#rankTabs .tab[data-r="rival"]'
    );
  }


  function setClubMode(enabled) {

    clubEnabled = !!enabled;

    const tab = rivalTab();

    if (tab) {
      tab.textContent = clubEnabled
        ? 'つだつダイエット部'
        : 'ライバル';

      tab.classList.toggle(
        'club-rank-tab',
        clubEnabled
      );
    }

    if (!clubEnabled) {
      hideClubPanel();
    }
  }


  function isClubTabActive() {
    const tab = rivalTab();
    return !!(
      clubEnabled &&
      tab &&
      tab.classList.contains('is-on')
    );
  }


  function hideClubPanel() {

    const dom = rankDom();

    if (dom.club) {
      dom.club.hidden = true;
    }

    if (dom.head) {
      dom.head.hidden = false;
    }

    if (dom.list) {
      dom.list.hidden = false;
    }

    if (dom.msg) {
      dom.msg.hidden = false;
    }

    document
      .querySelectorAll(
        '.weekly-summary-current, .weekly-summary-history'
      )
      .forEach(node => {
        node.hidden = false;
      });
  }


  function showClubPanel() {

    if (!clubEnabled) {
      return;
    }

    const panel = ensurePanel();
    const dom = rankDom();

    if (!panel || !dom.tabs) {
      return;
    }

    if (dom.box) {
      dom.box.hidden = false;
    }

    [...dom.tabs.children].forEach(
      tab => {
        tab.classList.toggle(
          'is-on',
          tab.dataset.r === 'rival'
        );
      }
    );

    if (dom.watchNav) {
      dom.watchNav.hidden = true;
    }

    if (dom.head) {
      dom.head.hidden = true;
    }

    if (dom.list) {
      dom.list.hidden = true;
    }

    if (dom.msg) {
      dom.msg.hidden = true;
    }

    document
      .querySelectorAll(
        '.weekly-summary-current, .weekly-summary-history'
      )
      .forEach(node => {
        node.hidden = true;
      });

    panel.hidden = false;

    renderClub();
  }
    function countdownMarkup() {

    let officialValue = '—';
    let officialSub = '公式記録日を確認中';

    if (clubData && clubData.next_official_ymd) {
      const days = Number(clubData.next_official_days);

      officialValue =
        Number.isFinite(days) && days === 0
          ? '今日'
          : Number.isFinite(days)
            ? 'あと' + days + '日'
            : '—';

      officialSub =
        dateText(
          clubData.next_official_ymd,
          true
        );
    } else if (
      clubData &&
      clubData.today_ymd > clubData.campaign_end_ymd
    ) {
      officialValue = '終了';
      officialSub = '大会期間は終了しました';
    }

    let voteValue = '—';
    let voteSub = '投票締切を確認中';

    if (
      voteData &&
      voteData.round
    ) {
      const round = voteData.round;
      const days = daysToDeadline(
        round.deadline_at,
        clubData && clubData.today_ymd
      );

      if (round.open) {
        voteValue =
          days === 0
            ? '今日23:59まで'
            : Number.isFinite(days)
              ? 'あと' + days + '日'
              : '受付中';
      } else {
        voteValue = '締切済み';
      }

      voteSub =
        '締切 ' +
        deadlineText(
          round.deadline_at
        );
    }

    return `
      <div class="club-countdowns">
        <div class="club-countdown">
          <span class="club-countdown-label">次の公式記録</span>
          <strong class="club-countdown-value">${officialValue}</strong>
          <span class="club-countdown-sub">${officialSub}</span>
        </div>

        <div class="club-countdown">
          <span class="club-countdown-label">投票締切</span>
          <strong class="club-countdown-value">${voteValue}</strong>
          <span class="club-countdown-sub">${voteSub}</span>
        </div>
      </div>
    `;
  }


  function svgEl(name, attrs = {}) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) {
      node.setAttribute(key, String(value));
    }
    return node;
  }


  function niceStep(raw) {

    if (!Number.isFinite(raw) || raw <= 0) {
      return 1;
    }

    const power = Math.pow(
      10,
      Math.floor(
        Math.log10(raw)
      )
    );

    const scaled = raw / power;

    if (scaled <= 1) return 1 * power;
    if (scaled <= 2) return 2 * power;
    if (scaled <= 5) return 5 * power;
    return 10 * power;
  }


  function formatTick(value) {
    const abs = Math.abs(value);
    return abs < 10 && Math.abs(value % 1) > 0.001
      ? value.toFixed(1)
      : String(Math.round(value));
  }


  function renderTeamLegend() {

    const legend = document.getElementById('clubTeamLegend');

    if (!legend || !clubData) {
      return;
    }

    legend.innerHTML = '';

    for (const team of clubData.teams || []) {
      const item = document.createElement('div');
      item.className = 'club-team-legend-item';

      const dot = document.createElement('span');
      dot.className = 'club-team-dot';
      dot.style.background = team.color || '#aaa';
      dot.textContent = team.short || '';

      const name = document.createElement('span');
      name.textContent = team.name || '';

      item.append(dot, name);
      legend.appendChild(item);
    }
  }


  function renderGraph() {

    const svg = document.getElementById('clubChart');
    const detail = document.getElementById('clubChartDetail');

    if (!svg || !clubData) {
      return;
    }

    svg.innerHTML = '';

    const teams = Array.isArray(clubData.teams)
      ? clubData.teams
      : [];

    const values = [];

    for (const team of teams) {
      for (const point of team.points || []) {
        const value = Number(point.loss_kg);
        if (Number.isFinite(value)) {
          values.push(value);
        }
      }
    }

    if (!values.length) {
      const text = svgEl('text', {
        x: 180,
        y: 135,
        'text-anchor': 'middle',
        class: 'club-chart-axis-text',
      });
      text.textContent = '公式記録がまだありません';
      svg.appendChild(text);

      if (detail) {
        detail.textContent = '記録が反映されるとここに推移が表示されます。';
      }
      return;
    }

    const W = 360;
    const H = 285;
    const left = 43;
    const right = 12;
    const top = 22;
    const bottom = 242;
    const plotW = W - left - right;
    const plotH = bottom - top;

    const rawMin = Math.min(0, ...values);
    const rawMax = Math.max(0, ...values);
    const baseSpan = Math.max(1, rawMax - rawMin);
    const step = niceStep(baseSpan / 4);

    let yMin = Math.floor(rawMin / step) * step;
    let yMax = Math.ceil(rawMax / step) * step;

    if (yMin === yMax) {
      yMax = yMin + step;
    }

    if (yMax === 0) {
      yMax = step;
    }

    const startDay = ymdDay('2026-09-01');
    const endDay = ymdDay('2026-12-31');
    const daySpan = endDay - startDay;

    const xFor = ymd => {
      const d = ymdDay(ymd);
      if (d === null || !daySpan) return left;
      return left + ((d - startDay) / daySpan) * plotW;
    };

    const yFor = value =>
      top +
      ((yMax - value) / (yMax - yMin)) *
      plotH;

    const title = svgEl('text', {
      x: 8,
      y: 12,
      class: 'club-chart-axis-title',
    });
    title.textContent = '減量kg';
    svg.appendChild(title);

    const tickCount = 4;

    for (let i = 0; i <= tickCount; i++) {
      const value = yMin + ((yMax - yMin) * i / tickCount);
      const y = yFor(value);

      const line = svgEl('line', {
        x1: left,
        x2: W - right,
        y1: y,
        y2: y,
        class: Math.abs(value) < 0.0001
          ? 'club-chart-zero'
          : 'club-chart-grid',
      });

      const label = svgEl('text', {
        x: left - 7,
        y: y + 3,
        'text-anchor': 'end',
        class: 'club-chart-axis-text',
      });
      label.textContent = formatTick(value);

      svg.append(line, label);
    }

    const xTicks = [
      '2026-09-01',
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
      '2026-12-31',
    ];

    for (const ymd of xTicks) {
      const x = xFor(ymd);

      const tick = svgEl('line', {
        x1: x,
        x2: x,
        y1: bottom,
        y2: bottom + 4,
        class: 'club-chart-grid',
      });

      const label = svgEl('text', {
        x,
        y: bottom + 17,
        'text-anchor': 'middle',
        class: 'club-chart-axis-text',
      });
      label.textContent = shortDateText(ymd);

      svg.append(tick, label);
    }

    teams.forEach(
      (team, teamIndex) => {

        const points = (team.points || [])
          .filter(point => Number.isFinite(Number(point.loss_kg)));

        if (!points.length) {
          return;
        }

        const xOffset = (teamIndex - 1) * 4;

        const pathData = points
          .map(
            (point, index) => {
              const x = xFor(point.ymd) + xOffset;
              const y = yFor(Number(point.loss_kg));
              return (index === 0 ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2);
            }
          )
          .join(' ');

        const path = svgEl('path', {
          d: pathData,
          stroke: team.color || '#999',
          class: 'club-chart-line',
        });

        svg.appendChild(path);

        for (const point of points) {
          const x = xFor(point.ymd) + xOffset;
          const y = yFor(Number(point.loss_kg));

          const g = svgEl('g', {
            class: 'club-chart-point',
            tabindex: '0',
            role: 'button',
            'data-team-name': team.name || '',
            'data-team-short': team.short || '',
            'data-ymd': point.ymd || '',
            'data-loss': Number(point.loss_kg),
          });

          const circle = svgEl('circle', {
            cx: x,
            cy: y,
            r: 8,
            fill: team.color || '#999',
          });

          const text = svgEl('text', {
            x,
            y,
          });
          text.textContent = team.short || '';

          g.append(circle, text);
          svg.appendChild(g);
        }
      }
    );

    const pointHandler = node => {
      if (!detail) return;

      detail.textContent =
        dateText(node.dataset.ymd) + '　' +
        node.dataset.teamName + '　' +
        lossText(node.dataset.loss);
    };

    svg.querySelectorAll('.club-chart-point')
      .forEach(
        node => {
          node.addEventListener('click', () => pointHandler(node));
          node.addEventListener(
            'keydown',
            event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                pointHandler(node);
              }
            }
          );
        }
      );

    if (detail) {
      const latestYmd =
        clubData.official_ymds &&
        clubData.official_ymds.length
          ? clubData.official_ymds[
              clubData.official_ymds.length - 1
            ]
          : null;

      if (latestYmd) {
        const parts = [];

        for (const team of teams) {
          const point = (team.points || [])
            .find(row => row.ymd === latestYmd);

          if (point && Number.isFinite(Number(point.loss_kg))) {
            parts.push(
              (team.short || team.name) + ' ' +
              lossText(point.loss_kg)
            );
          }
        }

        detail.textContent =
          dateText(latestYmd) + '　' +
          parts.join(' ／ ');
      } else {
        detail.textContent = '公式記録をタップすると詳細を確認できます。';
      }
    }
  }


  function renderTop5() {

    const list = document.getElementById('clubTopList');
    const date = document.getElementById('clubTopDate');

    if (!list || !date || !clubData || !clubData.top5) {
      return;
    }

    const top = clubData.top5;
    const rows = topMode === 'weekly'
      ? (top.weekly || [])
      : (top.cumulative || []);

    document.querySelectorAll('[data-club-top-mode]')
      .forEach(
        button => {
          button.classList.toggle(
            'is-on',
            button.dataset.clubTopMode === topMode
          );
        }
      );

    if (topMode === 'weekly') {
      date.textContent =
        top.week_from_ymd && top.weekly_ymd
          ? shortDateText(top.week_from_ymd) +
            ' → ' +
            shortDateText(top.weekly_ymd)
          : '週間集計はまだありません';
    } else {
      date.textContent =
        top.official_ymd
          ? dateText(top.official_ymd) + '時点'
          : '集計はまだありません';
    }

    list.innerHTML = '';

    if (!rows.length) {
      const empty = document.createElement('li');
      empty.className = 'club-empty';
      empty.textContent = '集計できる記録がまだありません';
      list.appendChild(empty);
      return;
    }

    rows.forEach(
      (row, index) => {
        const li = document.createElement('li');
        li.className = 'club-top-row';

        const rank = document.createElement('span');
        rank.className = 'club-top-rank';
        rank.textContent = String(index + 1);

        const team = document.createElement('span');
        team.className = 'club-top-team';
        team.style.background = row.team_color || '#aaa';
        team.textContent = row.team_short || '';

        const name = document.createElement('span');
        name.className = 'club-top-name';
        name.textContent = row.nickname || '名前未設定';

        const loss = document.createElement('strong');
        loss.className = 'club-top-loss';
        loss.textContent = lossText(row.loss_kg);

        li.append(rank, team, name, loss);
        list.appendChild(li);
      }
    );
  }
    function renderMissing() {

    const wrap = document.getElementById('clubMissingWrap');

    if (!wrap || !clubData) {
      return;
    }

    wrap.innerHTML = '';

    const rows = Array.isArray(clubData.missing)
      ? [...clubData.missing]
      : [];

    rows.sort(
      (a, b) =>
        String(b.ymd || '').localeCompare(
          String(a.ymd || '')
        )
    );

    for (const row of rows) {
      const section = document.createElement('section');
      section.className = 'club-missing-section';

      const head = document.createElement('div');
      head.className = 'club-missing-head';

      const title = document.createElement('h3');
      title.className = 'club-missing-title';
      title.textContent = dateText(row.ymd) + ' 未入力者';

      const count = document.createElement('span');
      count.className = 'club-missing-count';
      count.textContent = Number(row.missing_count || 0) + '人';

      head.append(title, count);

      const note = document.createElement('p');
      note.className = 'club-missing-note';
      note.textContent = row.kind === 'month_start'
        ? '毎月1日の公式記録です。全員が入力するまで表示します。'
        : '月曜日の公式記録です。次の月曜日まで表示します。';

      const members = document.createElement('div');
      members.className = 'club-missing-members';

      for (const member of row.members || []) {
        const chip = document.createElement('span');
        chip.className = 'club-missing-member';

        const team = document.createElement('span');
        team.className = 'club-team-dot';
        team.style.background = member.team_color || '#aaa';
        team.textContent = member.team_short || '';

        const name = document.createElement('span');
        name.textContent = member.nickname || '名前未設定';

        chip.append(team, name);
        members.appendChild(chip);
      }

      section.append(head, note, members);
      wrap.appendChild(section);
    }
  }


  function renderClub() {

    const panel = ensurePanel();

    if (!panel || !clubEnabled) {
      return;
    }

    panel.innerHTML = `
      <div class="club-shell">
        ${countdownMarkup()}

        <section class="club-section">
          <div class="club-section-head">
            <div>
              <h3 class="club-section-title">3チーム減量推移</h3>
              <p class="club-section-note">9/1を0kgとして、公式記録日の累計減量を表示</p>
            </div>
          </div>

          <div class="club-team-legend" id="clubTeamLegend"></div>

          <div class="club-chart-wrap">
            <svg
              class="club-chart"
              id="clubChart"
              viewBox="0 0 360 285"
              role="img"
              aria-label="3チームの減量推移"
            ></svg>
          </div>

          <div class="club-chart-detail" id="clubChartDetail">
            公式記録をタップすると詳細を確認できます。
          </div>
        </section>

        <section class="club-section">
          <div class="club-section-head">
            <div>
              <h3 class="club-section-title">減量TOP5</h3>
            </div>

            <div class="club-top-switch" role="tablist" aria-label="TOP5の表示切り替え">
              <button
                type="button"
                data-club-top-mode="cumulative"
                class="is-on"
              >累計</button>
              <button
                type="button"
                data-club-top-mode="weekly"
              >週間</button>
            </div>
          </div>

          <p class="club-top-date" id="clubTopDate"></p>
          <ol class="club-top-list" id="clubTopList"></ol>
        </section>

        <div class="club-missing-wrap" id="clubMissingWrap"></div>
      </div>
    `;

    renderTeamLegend();
    renderGraph();
    renderTop5();
    renderMissing();
  }


  async function loadVote() {

    if (loadingVote) {
      return;
    }

    loadingVote = true;

    try {
      voteData = await api('/api/vote/current');
    } catch (_) {
      voteData = null;
    } finally {
      loadingVote = false;
    }

    if (isClubTabActive()) {
      renderClub();
    }
  }


  async function loadClub() {

    if (loadingClub) {
      return;
    }

    loadingClub = true;

    try {
      const data = await api('/api/weekly-summary?club=1');

      if (
        data &&
        data.eligible === true &&
        data.mode === 'club'
      ) {
        clubData = data;
        setClubMode(true);

        if (isClubTabActive()) {
          showClubPanel();
        }

        void loadVote();
      } else {
        clubData = null;
        voteData = null;
        setClubMode(false);
      }

    } catch (error) {

      if (
        error &&
        (
          error.status === 403 ||
          error.status === 404 ||
          error.message === 'club_summary_not_enabled'
        )
      ) {
        clubData = null;
        voteData = null;
        setClubMode(false);
      }

    } finally {
      loadingClub = false;
    }
  }


  function handleCaptureClick(event) {

    const rankTab = event.target.closest(
      '#rankTabs .tab[data-r]'
    );

    if (rankTab && clubEnabled) {

      if (rankTab.dataset.r === 'rival') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        showClubPanel();
        void loadClub();
        return;
      }

      hideClubPanel();
      return;
    }

    const mainTab = event.target.closest(
      '.tabbtn[data-v]'
    );

    if (
      mainTab &&
      mainTab.dataset.v === 'group'
    ) {
      setTimeout(
        () => {
          void loadClub();

          if (isClubTabActive()) {
            showClubPanel();
          }
        },
        100
      );
    }
  }


  function handlePanelClick(event) {

    const button = event.target.closest(
      '[data-club-top-mode]'
    );

    if (!button) {
      return;
    }

    const mode = button.dataset.clubTopMode;

    if (
      mode !== 'cumulative' &&
      mode !== 'weekly'
    ) {
      return;
    }

    topMode = mode;
    renderTop5();
  }


  function start() {

    addStyle();
    ensurePanel();

    document.addEventListener(
      'click',
      handleCaptureClick,
      true
    );

    document.addEventListener(
      'click',
      handlePanelClick
    );

    setTimeout(
      () => void loadClub(),
      1600
    );

    setTimeout(
      () => void loadClub(),
      4300
    );
  }


  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      start,
      { once: true }
    );
  } else {
    start();
  }

})();
