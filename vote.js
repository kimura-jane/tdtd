'use strict';

/* ============================================================
   みんやせ / vote.js
   月間チーム予想クイズ
   ============================================================ */

(() => {

  const API =
    (
      typeof window !== 'undefined' &&
      window.MINYASE_API_BASE
    ) || '';

  const K_DEV = 'tsudatsu.device_id.v1';

  const ERR = {
    vote_closed: '今月の投票は締め切りました',
    bad_team: 'チームを選んでください',
    bad_device_id: '端末IDを確認できませんでした',
    not_registered: 'アプリの読み込みがまだ完了していません',
    banned: 'このアカウントは利用できません',
    network_error: '通信できませんでした',
    server_error: 'サーバーエラーが発生しました',
  };

  const TEAM_COLOR = {
    tsudamomo: '#d8a91d',
    sakomitsu: '#4f9ec5',
    gotomei: '#58a76a',
  };

  let currentData = null;
  let loadingCurrent = false;
  let loadingHistory = false;


  /* ==========================================================
     API
     ========================================================== */

  function deviceId() {
    return localStorage.getItem(K_DEV) || '';
  }

  async function api(path, options = {}) {

    const did = deviceId();

    if (!did) {
      throw new Error('not_registered');
    }

    let res;

    try {

      res = await fetch(
        API + path,
        {
          method: options.method || 'GET',

          headers: {
            'content-type': 'application/json',
            'x-device-id': did,
          },

          body:
            options.body !== undefined
              ? JSON.stringify(options.body)
              : undefined,

          cache: 'no-store',
        }
      );

    } catch (_) {
      throw new Error('network_error');
    }

    let data = {};

    try {
      data = await res.json();
    } catch {}

    if (!res.ok || data.ok === false) {
      throw new Error(
        data.error ||
        ('http_' + res.status)
      );
    }

    return data;
  }

  function emsg(e) {

    const code =
      e && e.message
        ? e.message
        : 'unknown_error';

    return (
      ERR[code] ||
      'エラー（' + code + '）'
    );
  }


  /* ==========================================================
     日付
     ========================================================== */

  function targetText(ymd) {

    if (!ymd) return '';

    const [y, m, d] =
      ymd.split('-').map(Number);

    return (
      y + '年' +
      m + '月' +
      d + '日'
    );
  }

  function deadlineText(ms) {

    if (!ms) return '';

    return new Date(Number(ms))
      .toLocaleString(
        'ja-JP',
        {
          timeZone: 'Asia/Tokyo',
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }
      );
  }


  /* ==========================================================
     CSS
     ========================================================== */

  function addStyle() {

    if (document.getElementById('voteStyle')) {
      return;
    }

    const s =
      document.createElement('style');

    s.id = 'voteStyle';

    s.textContent = `
      .vote-title{
        margin:0 0 5px;
        font-size:18px;
        font-weight:900;
        letter-spacing:.01em;
      }

      .vote-lead{
        margin:0 0 4px;
        color:#6d665f;
        font-size:13px;
        line-height:1.7;
      }

      .vote-deadline{
        display:inline-block;
        margin:5px 0 15px;
        padding:4px 10px;
        border-radius:999px;
        background:#f3eee7;
        color:#72685f;
        font-size:12px;
        font-weight:700;
      }

      .vote-teams{
        display:grid;
        gap:9px;
        margin:0 0 13px;
      }

      .vote-choice{
        position:relative;
        display:flex;
        align-items:center;
        gap:11px;
        width:100%;
        min-height:58px;
        padding:11px 14px;
        border:2px solid #ece6df;
        border-radius:17px;
        background:#fff;
        cursor:pointer;
        transition:.16s ease;
      }

      .vote-choice input{
        width:20px;
        height:20px;
        flex:0 0 auto;
        margin:0;
      }

      .vote-choice:has(input:checked){
        transform:translateY(-1px);
        box-shadow:0 5px 14px rgba(0,0,0,.06);
      }

      .vote-choice.tsudamomo:has(input:checked){
        border-color:#d8a91d;
        background:#fffaf0;
      }

      .vote-choice.sakomitsu:has(input:checked){
        border-color:#4f9ec5;
        background:#f3faff;
      }

      .vote-choice.gotomei:has(input:checked){
        border-color:#58a76a;
        background:#f4fbf5;
      }

      .vote-team-dot{
        width:12px;
        height:12px;
        border-radius:50%;
        flex:0 0 auto;
      }

      .vote-team-dot.tsudamomo{
        background:#d8a91d;
      }

      .vote-team-dot.sakomitsu{
        background:#4f9ec5;
      }

      .vote-team-dot.gotomei{
        background:#58a76a;
      }

      .vote-team-name{
        flex:1 1 auto;
        font-size:16px;
        font-weight:900;
      }

      .vote-current{
        margin:12px 0 0;
        padding:10px 12px;
        border-radius:12px;
        background:#f8f5f0;
        font-size:13px;
        line-height:1.6;
        white-space:pre-line;
      }

      .vote-status{
        margin:14px 0 0;
        padding:15px;
        border:1px solid #eee6dd;
        border-radius:18px;
        background:linear-gradient(180deg,#fff 0%,#fdfaf6 100%);
      }

      .vote-status-head{
        display:flex;
        align-items:flex-end;
        justify-content:space-between;
        gap:10px;
        margin-bottom:13px;
      }

      .vote-status-title{
        margin:0;
        font-size:15px;
        font-weight:900;
      }

      .vote-status-note{
        margin:0;
        color:#948a80;
        font-size:10px;
        font-weight:700;
        white-space:nowrap;
      }

      .vote-status-body{
        display:grid;
        grid-template-columns:minmax(126px, 42%) 1fr;
        gap:16px;
        align-items:center;
      }

      .vote-donut{
        position:relative;
        width:min(100%, 154px);
        aspect-ratio:1;
        justify-self:center;
        border-radius:50%;
        background:#eee8e1;
        box-shadow:
          0 10px 26px rgba(67,54,43,.08),
          inset 0 0 0 1px rgba(255,255,255,.9);
      }

      .vote-donut::after{
        content:"";
        position:absolute;
        inset:24%;
        border-radius:50%;
        background:#fffdfb;
        box-shadow:
          0 2px 12px rgba(67,54,43,.07),
          inset 0 0 0 1px rgba(238,230,221,.85);
      }

      .vote-donut-center{
        position:absolute;
        z-index:1;
        inset:30%;
        display:flex;
        align-items:center;
        justify-content:center;
        text-align:center;
        color:#746b63;
        font-size:11px;
        font-weight:900;
        line-height:1.35;
      }

      .vote-status-legend{
        display:grid;
        gap:9px;
      }

      .vote-legend-row{
        display:grid;
        grid-template-columns:12px 1fr auto;
        gap:8px;
        align-items:center;
        min-width:0;
      }

      .vote-legend-dot{
        width:10px;
        height:10px;
        border-radius:50%;
      }

      .vote-legend-name{
        overflow:hidden;
        color:#4f4944;
        font-size:13px;
        font-weight:800;
        text-overflow:ellipsis;
        white-space:nowrap;
      }

      .vote-legend-percent{
        color:#2f2b28;
        font-size:16px;
        font-variant-numeric:tabular-nums;
        font-weight:900;
      }

      .vote-msg{
        min-height:1.5em;
        margin:9px 0 0;
        font-size:13px;
      }

      .vote-msg.ok{
        color:#3a8a5f;
      }

      .vote-msg.ng{
        color:#c0392b;
      }

      .vote-web-card{
        overflow:hidden;
        padding:0;
      }

      .vote-web-link{
        display:block;
        overflow:hidden;
        border-radius:inherit;
        background:#fff;
        color:inherit;
        text-decoration:none;
        transition:transform .15s ease, box-shadow .15s ease;
        -webkit-tap-highlight-color:transparent;
      }

      .vote-web-link:active{
        transform:scale(.99);
        box-shadow:0 4px 14px rgba(70,57,45,.05);
      }

      .vote-web-visual{
        position:relative;
        overflow:hidden;
        min-height:118px;
        padding:19px 20px 18px;
        background:
          radial-gradient(circle at 88% 20%, rgba(255,255,255,.74) 0 34px, transparent 35px),
          radial-gradient(circle at 78% 100%, rgba(255,255,255,.34) 0 62px, transparent 63px),
          linear-gradient(135deg,rgba(255,181,78,.34) 0%,rgba(255,111,145,.24) 54%,rgba(216,77,243,.18) 100%);
      }

      .vote-web-kicker{
        position:relative;
        z-index:1;
        margin-bottom:7px;
        color:#a05f7f;
        font-size:10px;
        font-weight:900;
        letter-spacing:.12em;
      }

      .vote-web-title{
        position:relative;
        z-index:1;
        max-width:78%;
        color:#302a25;
        font-size:21px;
        font-weight:900;
        line-height:1.2;
        letter-spacing:.01em;
      }

      .vote-web-badge{
        position:absolute;
        right:18px;
        bottom:16px;
        display:flex;
        width:44px;
        height:44px;
        align-items:center;
        justify-content:center;
        border-radius:15px;
        background:rgba(255,255,255,.84);
        color:#c9489e;
        font-size:22px;
        font-weight:900;
        box-shadow:0 6px 18px rgba(65,88,70,.12);
        backdrop-filter:blur(4px);
      }

      .vote-web-meta{
        display:grid;
        grid-template-columns:1fr auto;
        gap:12px;
        align-items:center;
        padding:13px 15px 14px;
      }

      .vote-web-copy{
        min-width:0;
      }

      .vote-web-copy b{
        display:block;
        margin-bottom:3px;
        color:#35302c;
        font-size:14px;
      }

      .vote-web-copy span{
        display:block;
        overflow:hidden;
        color:#91877e;
        font-size:11px;
        text-overflow:ellipsis;
        white-space:nowrap;
      }

      .vote-web-arrow{
        display:flex;
        width:31px;
        height:31px;
        align-items:center;
        justify-content:center;
        border-radius:50%;
        background:#f3eee7;
        color:#6c6259;
        font-size:17px;
        font-weight:900;
      }

      .vote-score{
        margin:4px 0 4px;
        font-size:15px;
        font-weight:700;
      }

      .vote-score strong{
        font-size:28px;
        line-height:1;
        font-weight:900;
      }

      .vote-rate{
        margin:7px 0 12px;
        color:#777067;
        font-size:12px;
      }

      .vote-history-title{
        margin:16px 0 5px;
        color:#777067;
        font-size:12px;
        font-weight:700;
      }

      .vote-history{
        list-style:none;
        margin:0;
        padding:0;
      }

      .vote-history li{
        display:flex;
        gap:10px;
        align-items:flex-start;
        padding:10px 0;
        border-top:1px solid #eee8e1;
        font-size:13px;
      }

      .vote-history-mark{
        width:26px;
        flex:0 0 26px;
        font-size:18px;
        font-weight:900;
        text-align:center;
      }

      .vote-history-main{
        flex:1 1 auto;
        min-width:0;
      }

      .vote-history-main b{
        display:block;
        font-size:13px;
      }

      .vote-history-main span{
        display:block;
        margin-top:2px;
        color:#807870;
        font-size:12px;
      }

      .vote-pending{
        color:#b37a16;
      }

      .vote-correct{
        color:#328154;
      }

      .vote-wrong{
        color:#bc4b40;
      }

      @media (max-width:390px){
        .vote-status-body{
          grid-template-columns:116px 1fr;
          gap:12px;
        }

        .vote-legend-name{
          font-size:12px;
        }

        .vote-legend-percent{
          font-size:15px;
        }
      }
    `;

    document.head.appendChild(s);
  }


  /* ==========================================================
     トップページ 投票カード
     ========================================================== */

  function buildVoteCard() {

    if (document.getElementById('voteCard')) {
      return;
    }

    const view =
      document.getElementById('view-log');

    if (!view) return;

    const card =
      document.createElement('section');

    card.className = 'card';
    card.id = 'voteCard';

    card.innerHTML = `
      <h2 class="vote-title">
        来月の減量王チームを予想
      </h2>

      <p class="vote-lead" id="voteQuestion">
        読み込み中…
      </p>

      <div class="vote-deadline" id="voteDeadline">
        —
      </div>

      <div class="vote-teams">

        <label class="vote-choice tsudamomo">
          <input
            type="radio"
            name="minyaseVote"
            value="tsudamomo"
          >
          <span class="vote-team-dot tsudamomo"></span>
          <span class="vote-team-name">つだもも</span>
        </label>

        <label class="vote-choice sakomitsu">
          <input
            type="radio"
            name="minyaseVote"
            value="sakomitsu"
          >
          <span class="vote-team-dot sakomitsu"></span>
          <span class="vote-team-name">さこみつ</span>
        </label>

        <label class="vote-choice gotomei">
          <input
            type="radio"
            name="minyaseVote"
            value="gotomei"
          >
          <span class="vote-team-dot gotomei"></span>
          <span class="vote-team-name">ゴトめい</span>
        </label>

      </div>

      <button
        class="primary"
        id="voteSubmit"
        type="button"
      >
        このチームに投票
      </button>

      <div
        class="vote-current"
        id="voteCurrent"
        hidden
      ></div>

      <div
        class="vote-status"
        id="voteStatus"
        hidden
      >
        <div class="vote-status-head">
          <h3 class="vote-status-title">
            現在の投票状況
          </h3>
          <p class="vote-status-note">
            投票済みの人だけ表示
          </p>
        </div>

        <div class="vote-status-body">
          <div
            class="vote-donut"
            id="voteDonut"
            role="img"
            aria-label="現在の投票割合"
          >
            <div class="vote-donut-center">
              投票者内<br>割合
            </div>
          </div>

          <div
            class="vote-status-legend"
            id="voteStatusLegend"
          ></div>
        </div>
      </div>

      <div
        class="vote-msg"
        id="voteMsg"
      ></div>
    `;

    view.appendChild(card);

    document
      .getElementById('voteSubmit')
      .addEventListener(
        'click',
        submitVote
      );
  }


  /* ==========================================================
     グループページ 外部WEBカード
     ========================================================== */

  function buildExternalWebCard() {

    if (
      document.getElementById(
        'voteExternalWebCard'
      )
    ) {
      return;
    }

    const view =
      document.getElementById(
        'view-group'
      );

    if (!view) return;

    const card =
      document.createElement('section');

    card.className =
      'card vote-web-card';

    card.id =
      'voteExternalWebCard';

    card.hidden = true;

    card.innerHTML = `
      <a
        class="vote-web-link"
        id="voteExternalWebLink"
        href="#"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="つだつダイエット部の詳しい情報を見る"
      >
        <div class="vote-web-visual">
          <div class="vote-web-kicker">
            TSUDATSU DIET CLUB
          </div>

          <div class="vote-web-title">
            みんなの減量状況を<br>
            もっと詳しく
          </div>

          <div class="vote-web-badge">
            ↗
          </div>
        </div>

        <div class="vote-web-meta">
          <div class="vote-web-copy">
            <b>今の詳しい情報はこちら</b>
            <span>tsudatsu-diet.vercel.app</span>
          </div>

          <div class="vote-web-arrow">
            ›
          </div>
        </div>
      </a>
    `;

    const first =
      view.firstElementChild;

    if (first) {
      view.insertBefore(
        card,
        first
      );
    } else {
      view.appendChild(card);
    }
  }
     /* ==========================================================
     マイページ 成績カード
     ========================================================== */

  function buildScoreCard() {

    if (document.getElementById('voteScoreCard')) {
      return;
    }

    const view =
      document.getElementById('view-my');

    if (!view) return;

    const card =
      document.createElement('section');

    card.className = 'card';
    card.id = 'voteScoreCard';

    card.innerHTML = `
      <h2 class="h2">
        予想クイズ成績
      </h2>

      <div class="vote-score">
        <strong id="voteScoreTotal">0</strong>問中
        <strong id="voteScoreCorrect">0</strong>問正解
      </div>

      <p
        class="vote-rate"
        id="voteScoreRate"
      >
        結果が確定した問題はまだありません
      </p>

      <div class="vote-history-title">
        予想履歴
      </div>

      <ul
        class="vote-history"
        id="voteHistory"
      ></ul>
    `;

    const first =
      view.querySelector('.card');

    if (first) {
      first.insertAdjacentElement(
        'afterend',
        card
      );
    } else {
      view.appendChild(card);
    }
  }


  /* ==========================================================
     表示
     ========================================================== */

  function setVoteMessage(text, ok) {

    const n =
      document.getElementById('voteMsg');

    if (!n) return;

    n.textContent = text || '';

    n.className =
      'vote-msg ' +
      (ok ? 'ok' : 'ng');
  }


  function renderVoteStatus(data) {

    const box =
      document.getElementById(
        'voteStatus'
      );

    const donut =
      document.getElementById(
        'voteDonut'
      );

    const legend =
      document.getElementById(
        'voteStatusLegend'
      );

    if (
      !box ||
      !donut ||
      !legend
    ) {
      return;
    }

    const rows =
      data &&
      data.voted &&
      data.vote_status &&
      Array.isArray(
        data.vote_status.percentages
      )
        ? data.vote_status.percentages
        : [];

    if (!rows.length) {

      box.hidden = true;
      legend.innerHTML = '';
      donut.style.background =
        '#eee8e1';

      return;
    }

    let cursor = 0;

    const segments = [];

    for (const row of rows) {

      const percent =
        Math.max(
          0,
          Math.min(
            100,
            Number(
              row.percent ||
              0
            )
          )
        );

      const color =
        TEAM_COLOR[
          row.team_id
        ] ||
        '#bbb3aa';

      const start =
        cursor;

      const end =
        cursor +
        percent;

      segments.push(
        color +
        ' ' +
        start +
        '% ' +
        end +
        '%'
      );

      cursor = end;
    }

    donut.style.background =
      'conic-gradient(' +
      segments.join(',') +
      ')';

    donut.setAttribute(
      'aria-label',
      rows
        .map(
          row =>
            row.team_name +
            ' ' +
            row.percent +
            '%'
        )
        .join('、')
    );

    legend.innerHTML = '';

    for (const row of rows) {

      const item =
        document.createElement('div');

      item.className =
        'vote-legend-row';

      const dot =
        document.createElement('span');

      dot.className =
        'vote-legend-dot';

      dot.style.background =
        TEAM_COLOR[
          row.team_id
        ] ||
        '#bbb3aa';


      const name =
        document.createElement('span');

      name.className =
        'vote-legend-name';

      name.textContent =
        row.team_name ||
        '';


      const percent =
        document.createElement('strong');

      percent.className =
        'vote-legend-percent';

      percent.textContent =
        String(
          Number(
            row.percent ||
            0
          )
        ) +
        '%';


      item.append(
        dot,
        name,
        percent
      );

      legend.appendChild(
        item
      );
    }

    box.hidden = false;
  }


  function renderExternalWeb(data) {

    const card =
      document.getElementById(
        'voteExternalWebCard'
      );

    const link =
      document.getElementById(
        'voteExternalWebLink'
      );

    if (
      !card ||
      !link
    ) {
      return;
    }

    const external =
      data &&
      data.external_web;

    const visible =
      !!(
        external &&
        external.visible &&
        typeof external.url ===
          'string' &&
        /^https:\/\//i.test(
          external.url
        )
      );

    if (!visible) {

      card.hidden = true;
      link.removeAttribute(
        'href'
      );

      return;
    }

    link.href =
      external.url;

    card.hidden = false;
  }


  function renderCurrent(data) {

    currentData = data;

    const round = data.round;

    const question =
      document.getElementById('voteQuestion');

    const deadline =
      document.getElementById('voteDeadline');

    const submit =
      document.getElementById('voteSubmit');

    const current =
      document.getElementById('voteCurrent');

    if (question) {
      question.textContent =
        targetText(round.target_date) +
        '時点で、一番減量しているのはどのチーム？';
    }

    if (deadline) {
      deadline.textContent =
        '投票締切：' +
        deadlineText(round.deadline_at);
    }

    const radios =
      [
        ...document.querySelectorAll(
          'input[name="minyaseVote"]'
        )
      ];

    for (const radio of radios) {

      radio.disabled =
        !round.open;

      radio.checked =
        !!(
          data.vote &&
          data.vote.team_id === radio.value
        );
    }

    if (submit) {

      submit.disabled =
        !round.open;

      if (!round.open) {
        submit.textContent =
          '今月の投票は締め切りました';

      } else if (data.vote) {
        submit.textContent =
          '予想を変更する';

      } else {
        submit.textContent =
          'このチームに投票';
      }
    }

    if (current) {

      if (data.vote) {

        current.hidden = false;

        current.textContent =
          '投票済み　あなたの予想：' +
          data.vote.team_name +
          (
            round.open
              ? (
                  '\n※締切（' +
                  deadlineText(
                    round.deadline_at
                  ) +
                  '）までは変更できます'
                )
              : ''
          );

      } else {

        current.hidden = true;
        current.textContent = '';
      }
    }

    renderVoteStatus(
      data
    );

    renderExternalWeb(
      data
    );
  }


  function renderHistory(data) {

    const correct =
      document.getElementById(
        'voteScoreCorrect'
      );

    const total =
      document.getElementById(
        'voteScoreTotal'
      );

    const rate =
      document.getElementById(
        'voteScoreRate'
      );

    const list =
      document.getElementById(
        'voteHistory'
      );

    if (correct) {
      correct.textContent =
        String(data.stats.correct || 0);
    }

    if (total) {
      total.textContent =
        String(data.stats.answered || 0);
    }

    if (rate) {

      if (data.stats.answered) {

        rate.textContent =
          '正解率 ' +
          data.stats.rate +
          '%';

      } else {

        rate.textContent =
          '結果が確定した問題はまだありません';
      }
    }

    if (!list) return;

    list.innerHTML = '';

    /*
     * 全履歴を表示する。
     * slice() は使わない。
     */
    const rows =
      data.history || [];

    if (!rows.length) {

      const li =
        document.createElement('li');

      li.innerHTML = `
        <div class="vote-history-main">
          <span>
            まだ予想履歴がありません
          </span>
        </div>
      `;

      list.appendChild(li);
      return;
    }

    for (const row of rows) {

      const li =
        document.createElement('li');

      let mark = '…';
      let cls = 'vote-pending';
      let detail = '結果待ち';

      if (row.finalized) {

        if (row.correct) {

          mark = '○';
          cls = 'vote-correct';
          detail = '正解';

        } else {

          mark = '×';
          cls = 'vote-wrong';

          detail =
            '不正解　正解：' +
            row.winner_name;
        }
      }

      const markEl =
        document.createElement('div');

      markEl.className =
        'vote-history-mark ' + cls;

      markEl.textContent = mark;


      const main =
        document.createElement('div');

      main.className =
        'vote-history-main';


      const title =
        document.createElement('b');

      title.textContent =
        targetText(row.target_date) +
        '　予想：' +
        row.team_name;


      const sub =
        document.createElement('span');

      sub.className = cls;
      sub.textContent = detail;


      main.append(
        title,
        sub
      );

      li.append(
        markEl,
        main
      );

      list.appendChild(li);
    }
  }


  /* ==========================================================
     読み込み
     ========================================================== */

  async function loadCurrent() {

    if (loadingCurrent) return;

    loadingCurrent = true;

    try {

      const data =
        await api(
          '/api/vote/current'
        );

      renderCurrent(data);

      setVoteMessage(
        '',
        true
      );

    } catch (e) {

      if (
        e.message !==
        'not_registered'
      ) {

        setVoteMessage(
          emsg(e),
          false
        );
      }

    } finally {

      loadingCurrent = false;
    }
  }


  async function loadHistory() {

    if (loadingHistory) return;

    loadingHistory = true;

    try {

      const data =
        await api(
          '/api/vote/history'
        );

      renderHistory(data);

    } catch (_) {
      /*
       * 起動直後はregister前の場合がある。
       */
    } finally {

      loadingHistory = false;
    }
  }


  /* ==========================================================
     投票
     ========================================================== */

  async function submitVote() {

    if (
      !currentData ||
      !currentData.round.open
    ) {

      setVoteMessage(
        '今月の投票は締め切りました',
        false
      );

      return;
    }

    const checked =
      document.querySelector(
        'input[name="minyaseVote"]:checked'
      );

    if (!checked) {

      setVoteMessage(
        '予想するチームを選んでください',
        false
      );

      return;
    }

    const btn =
      document.getElementById(
        'voteSubmit'
      );

    if (btn) {
      btn.disabled = true;
      btn.textContent = '投票中…';
    }

    try {

      const data =
        await api(
          '/api/vote/current',
          {
            method: 'POST',

            body: {
              team_id: checked.value,
            },
          }
        );

      setVoteMessage(
        data.team_name +
        ' に投票しました',
        true
      );

      await loadCurrent();
      await loadHistory();

    } catch (e) {

      setVoteMessage(
        emsg(e),
        false
      );

      await loadCurrent();
    }
  }


  /* ==========================================================
     起動
     ========================================================== */

  function start() {

    addStyle();
    buildVoteCard();
    buildExternalWebCard();
    buildScoreCard();

    /*
     * app.js のregister完了待ち。
     */
    setTimeout(
      () => {
        loadCurrent();
        loadHistory();
      },
      1800
    );

    setTimeout(
      () => {
        loadCurrent();
        loadHistory();
      },
      4500
    );

    /*
     * タブを開いた時に最新状態へ更新。
     */
    document.addEventListener(
      'click',
      e => {

        const btn =
          e.target.closest(
            '.tabbtn[data-v]'
          );

        if (!btn) return;

        if (
          btn.dataset.v === 'log' ||
          btn.dataset.v === 'group'
        ) {

          setTimeout(
            loadCurrent,
            80
          );
        }

        if (btn.dataset.v === 'my') {

          setTimeout(
            loadHistory,
            80
          );
        }
      }
    );
  }


  if (
    document.readyState === 'loading'
  ) {

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
