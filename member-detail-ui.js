'use strict';

/* ============================================================
   みんやせ / member-detail-ui.js
   ・公開メンバーの体重詳細（スタート日以降）
   ・非公開メンバーは本人を含めて詳細不可
   ・体重グラフ + 入力履歴
   ・自分のチーム / 閲覧中チームの総体重表示
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

  let activeRequest =
    0;

  let lastDetail =
    null;

  let previousOverflow =
    '';


  /* ==========================================================
     小物
     ========================================================== */

  const num =
    value => {

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
    };


  const round1 =
    value =>
      Math.round(
        Number(
          value
        ) *
        10
      ) /
      10;


  const kg =
    value => {

      const n =
        num(
          value
        );

      return n === null
        ? '—'
        : n.toFixed(1) +
          'kg';
    };


  const lossText =
    value => {

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
        n > 0
      ) {

        return (
          '-' +
          Math.abs(
            n
          ).toFixed(1) +
          'kg'
        );
      }

      if (
        n < 0
      ) {

        return (
          '+' +
          Math.abs(
            n
          ).toFixed(1) +
          'kg'
        );
      }

      return '0.0kg';
    };


  const ymdText =
    value => {

      const m =
        /^(\d{4})-(\d{2})-(\d{2})$/
          .exec(
            String(
              value ||
              ''
            )
          );

      return m
        ? (
            Number(
              m[1]
            ) +
            '/' +
            Number(
              m[2]
            ) +
            '/' +
            Number(
              m[3]
            )
          )
        : String(
            value ||
            ''
          );
    };


  const ymdDay =
    value => {

      const m =
        /^(\d{4})-(\d{2})-(\d{2})$/
          .exec(
            String(
              value ||
              ''
            )
          );

      return m
        ? Math.floor(
            Date.UTC(
              Number(
                m[1]
              ),
              Number(
                m[2]
              ) -
              1,
              Number(
                m[3]
              )
            ) /
            86400000
          )
        : null;
    };


  const initial =
    member => {

      const name =
        String(
          member &&
          member.nickname ||
          ''
        )
          .trim();

      return name
        ? [...name][0]
        : '?';
    };


  const iconSrc =
    path => {

      if (!path) {

        return '';
      }

      return /^https?:\/\//i
        .test(
          path
        )
          ? path
          : API +
            path;
    };


  /* ==========================================================
     API
     ========================================================== */

  async function fetchDetail(
    memberId
  ) {

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
          '/api/member-weight-detail?member_id=' +
          encodeURIComponent(
            memberId
          ),
          {
            method:
              'GET',

            headers: {
              'x-device-id':
                deviceId
            },

            cache:
              'no-store'
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


  function errorText(
    error
  ) {

    const code =
      error &&
      error.message
        ? error.message
        : 'unknown_error';

    const map = {

      network_error:
        '通信できませんでした。もう一度お試しください。',

      not_registered:
        'アプリの読み込みが完了していません。',

      member_not_found:
        'このメンバーは現在表示できません。',

      not_watching:
        'このチームは現在閲覧できません。',

      blocked_relation:
        'このメンバーは現在表示できません。',

      weight_private:
        'このメンバーの体重は非公開です。',

      bad_start_ymd:
        'グループのスタート日を確認できませんでした。',

      banned:
        'このアカウントは利用できません。'
    };

    return (
      map[
        code
      ] ||
      '体重記録を読み込めませんでした。'
    );
  }


  /* ==========================================================
     CSS
     ========================================================== */

  function addStyle() {

    if (
      document.getElementById(
        'memberDetailUiStyle'
      )
    ) {

      return;
    }

    const style =
      document.createElement(
        'style'
      );

    style.id =
      'memberDetailUiStyle';

    style.textContent = `
.member-team-weight-summary{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:8px;
  margin-top:10px
}

.member-team-weight-stat{
  min-width:0;
  padding:10px 11px;
  border:1px solid var(--line,#eee5dc);
  border-radius:14px;
  background:rgba(255,255,255,.72)
}

.member-team-weight-stat small{
  display:block;
  margin-bottom:2px;
  color:var(--sub,#7e756d);
  font-size:10px;
  font-weight:700;
  line-height:1.35
}

.member-team-weight-stat b{
  display:block;
  overflow:hidden;
  color:var(--ink,#181614);
  font-size:16px;
  font-variant-numeric:tabular-nums;
  font-weight:900;
  line-height:1.35;
  text-overflow:ellipsis;
  white-space:nowrap
}

.member-team-weight-count{
  grid-column:1/-1;
  color:var(--sub,#7e756d);
  font-size:10px;
  font-weight:700;
  line-height:1.5
}

#rankList>li.member-detail-openable{
  cursor:pointer;
  transition:
    background .14s ease,
    transform .14s ease
}

#rankList>li.member-detail-openable:active{
  background:rgba(239,88,196,.045);
  transform:scale(.995)
}

#rankList>li.member-detail-openable .nm::after{
  content:'  ›';
  color:var(--faint,#b6aca3);
  font-weight:900
}

.member-detail-overlay{
  position:fixed;
  inset:0;
  z-index:1200;
  display:flex;
  align-items:flex-end;
  justify-content:center;
  padding-top:24px;
  background:rgba(34,27,22,.38);
  backdrop-filter:blur(3px)
}

.member-detail-sheet{
  width:100%;
  max-width:640px;
  max-height:calc(
    94vh - env(safe-area-inset-top)
  );
  overflow:auto;
  overscroll-behavior:contain;
  border-radius:28px 28px 0 0;
  background:
    radial-gradient(
      circle at 95% 0%,
      rgba(239,88,196,.10),
      transparent 32%
    ),
    radial-gradient(
      circle at 0% 12%,
      rgba(255,178,79,.13),
      transparent 34%
    ),
    var(--paper,#fffdfa);
  box-shadow:
    0 -18px 54px rgba(50,37,26,.18);
  padding:
    10px 16px
    calc(
      26px + env(safe-area-inset-bottom)
    );
  animation:
    memberDetailIn .2s ease-out both
}

@keyframes memberDetailIn{
  from{
    opacity:0;
    transform:translateY(18px)
  }

  to{
    opacity:1;
    transform:translateY(0)
  }
}

.member-detail-handle{
  width:42px;
  height:5px;
  margin:1px auto 8px;
  border-radius:999px;
  background:#d9d0c7
}

.member-detail-topbar{
  display:flex;
  justify-content:flex-end;
  margin-bottom:2px
}

.member-detail-close{
  display:flex;
  width:36px;
  height:36px;
  align-items:center;
  justify-content:center;
  border:0;
  border-radius:50%;
  background:#f3ede6;
  color:#5d554e;
  font-size:22px;
  line-height:1;
  cursor:pointer
}

.member-detail-profile{
  display:flex;
  gap:12px;
  align-items:center;
  padding:2px 2px 15px
}

.member-detail-avatar{
  display:flex;
  width:58px;
  height:58px;
  flex:0 0 58px;
  align-items:center;
  justify-content:center;
  overflow:hidden;
  border-radius:50%;
  background:#ece7e2;
  color:#a8998f;
  font-size:22px;
  font-weight:900;
  box-shadow:
    0 4px 14px rgba(82,57,35,.09)
}

.member-detail-avatar img{
  width:100%;
  height:100%;
  object-fit:cover;
  display:block
}

.member-detail-name{
  margin:0;
  color:var(--ink,#181614);
  font-size:20px;
  font-weight:900;
  line-height:1.3
}

.member-detail-group{
  margin:3px 0 0;
  color:var(--sub,#7e756d);
  font-size:12px;
  font-weight:600;
  line-height:1.5
}

.member-detail-summary{
  display:grid;
  grid-template-columns:
    repeat(3,minmax(0,1fr));
  gap:8px;
  margin:0 0 14px
}

.member-detail-summary-item{
  min-width:0;
  padding:11px 8px;
  border:
    1px solid var(--line,#eee5dc);
  border-radius:16px;
  background:rgba(255,255,255,.82);
  text-align:center
}

.member-detail-summary-item span{
  display:block;
  color:var(--sub,#7e756d);
  font-size:10px;
  font-weight:700;
  line-height:1.4
}

.member-detail-summary-item b{
  display:block;
  margin-top:3px;
  overflow:hidden;
  color:var(--ink,#181614);
  font-size:16px;
  font-variant-numeric:tabular-nums;
  font-weight:900;
  line-height:1.3;
  text-overflow:ellipsis;
  white-space:nowrap
}

.member-detail-card{
  margin-top:12px;
  padding:14px;
  border:
    1px solid var(--line,#eee5dc);
  border-radius:20px;
  background:rgba(255,255,255,.82);
  box-shadow:
    var(
      --shadow-soft,
      0 5px 16px rgba(82,57,35,.05)
    )
}

.member-detail-card-title{
  margin:0 0 9px;
  color:var(--ink,#181614);
  font-size:14px;
  font-weight:900
}

.member-detail-note{
  margin:-4px 0 10px;
  color:var(--sub,#7e756d);
  font-size:10px;
  font-weight:600;
  line-height:1.5
}

.member-detail-chart-wrap{
  position:relative;
  min-height:232px
}

.member-detail-chart{
  display:block;
  width:100%;
  height:230px
}

.member-detail-empty,
.member-detail-loading,
.member-detail-error{
  padding:34px 12px;
  color:var(--sub,#7e756d);
  font-size:13px;
  font-weight:700;
  line-height:1.7;
  text-align:center
}

.member-detail-error{
  color:var(--bad,#d65247)
}

.member-detail-history{
  list-style:none;
  margin:0;
  padding:0
}

.member-detail-history li{
  display:grid;
  grid-template-columns:1fr auto;
  gap:10px;
  align-items:center;
  padding:10px 2px;
  border-top:
    1px solid var(--line2,#f4ede6)
}

.member-detail-history li:first-child{
  border-top:0
}

.member-detail-history-date{
  color:var(--ink2,#4b433d);
  font-size:13px;
  font-weight:700
}

.member-detail-history-date small{
  display:inline-block;
  margin-left:6px;
  padding:1px 6px;
  border-radius:999px;
  background:#f4ede6;
  color:var(--sub,#7e756d);
  font-size:9px;
  font-weight:800;
  vertical-align:1px
}

.member-detail-history-kg{
  color:var(--ink,#181614);
  font-size:15px;
  font-variant-numeric:tabular-nums;
  font-weight:900
}

@media(min-width:641px){
  .member-detail-sheet{
    margin-bottom:18px;
    border-radius:28px
  }
}

@media(max-width:380px){
  .member-detail-summary{
    gap:6px
  }

  .member-detail-summary-item{
    padding:10px 5px
  }

  .member-detail-summary-item b{
    font-size:14px
  }
}
`;

    document.head.appendChild(
      style
    );
  }


  /* ==========================================================
     チーム総体重
     ========================================================== */

  function teamSummary(
    rows
  ) {

    const visible =
      (
        Array.isArray(
          rows
        )
          ? rows
          : []
      )
        .filter(
          row => {

            if (
              !row ||
              row.weight_hidden ===
                true
            ) {

              return false;
            }

            return (
              num(
                row.start_kg
              ) !==
                null &&
              num(
                row.latest_kg
              ) !==
                null
            );
          }
        );


    let start =
      0;

    let current =
      0;


    for (
      const row of
      visible
    ) {

      start +=
        Number(
          row.start_kg
        );

      current +=
        Number(
          row.latest_kg
        );
    }


    return {
      count:
        visible.length,

      start:
        visible.length
          ? round1(
              start
            )
          : null,

      current:
        visible.length
          ? round1(
              current
            )
          : null
    };
  }


  function renderTeamSummary(
    data
  ) {

    const head =
      document.getElementById(
        'rankHead'
      );

    if (!head) {

      return;
    }


    const old =
      head.querySelector(
        '.member-team-weight-summary'
      );

    if (old) {

      old.remove();
    }


    if (
      !data ||
      !data.group
    ) {

      return;
    }


    const s =
      teamSummary(
        data.rows
      );


    const box =
      document.createElement(
        'div'
      );

    box.className =
      'member-team-weight-summary';

    box.innerHTML = `
      <div class="member-team-weight-stat">
        <small>スタート総体重</small>
        <b>${kg(s.start)}</b>
      </div>

      <div class="member-team-weight-stat">
        <small>現在の総体重</small>
        <b>${kg(s.current)}</b>
      </div>

      <div class="member-team-weight-count">
        集計対象 ${s.count}人（体重公開中・記録ありのみ）
      </div>
    `;


    head.appendChild(
      box
    );
  }


  /* ==========================================================
     詳細シート
     ========================================================== */

  function ensureSheet() {

    let overlay =
      document.getElementById(
        'memberDetailOverlay'
      );

    if (overlay) {

      return overlay;
    }


    overlay =
      document.createElement(
        'div'
      );

    overlay.id =
      'memberDetailOverlay';

    overlay.className =
      'member-detail-overlay';

    overlay.hidden =
      true;

    overlay.innerHTML = `
      <section
        class="member-detail-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memberDetailName"
      >
        <div class="member-detail-handle"></div>

        <div class="member-detail-topbar">
          <button
            class="member-detail-close"
            id="memberDetailClose"
            type="button"
            aria-label="閉じる"
          >×</button>
        </div>

        <div id="memberDetailContent">
          <div class="member-detail-loading">
            読み込み中…
          </div>
        </div>
      </section>
    `;


    document.body.appendChild(
      overlay
    );


    document
      .getElementById(
        'memberDetailClose'
      )
      .addEventListener(
        'click',
        closeDetail
      );


    overlay.addEventListener(
      'click',
      event => {

        if (
          event.target ===
            overlay
        ) {

          closeDetail();
        }
      }
    );


    return overlay;
  }


  function showSheet() {

    const overlay =
      ensureSheet();


    previousOverflow =
      document.body.style.overflow;


    overlay.hidden =
      false;


    document.body.style.overflow =
      'hidden';
  }


  function closeDetail() {

    const overlay =
      document.getElementById(
        'memberDetailOverlay'
      );

    if (!overlay) {

      return;
    }


    activeRequest++;


    lastDetail =
      null;


    overlay.hidden =
      true;


    document.body.style.overflow =
      previousOverflow;
  }


  function setLoading(
    row
  ) {

    const content =
      document.getElementById(
        'memberDetailContent'
      );

    if (!content) {

      return;
    }


    content.innerHTML = `
      <div class="member-detail-profile">

        <div class="member-detail-avatar">
          ${initial(row)}
        </div>

        <div>
          <h2
            class="member-detail-name"
            id="memberDetailName"
          ></h2>

          <p class="member-detail-group">
            体重記録を読み込んでいます…
          </p>
        </div>

      </div>

      <div class="member-detail-loading">
        読み込み中…
      </div>
    `;


    document
      .getElementById(
        'memberDetailName'
      )
      .textContent =
        row.nickname ||
        '名前未設定';
  }


  function setError(
    error
  ) {

    const content =
      document.getElementById(
        'memberDetailContent'
      );

    if (!content) {

      return;
    }


    content.innerHTML =
      '<div class="member-detail-error"></div>';


    content
      .firstElementChild
      .textContent =
        errorText(
          error
        );
  }


  function avatarNode(
    member
  ) {

    const box =
      document.createElement(
        'div'
      );

    box.className =
      'member-detail-avatar';


    if (
      member &&
      member.icon_url
    ) {

      const image =
        document.createElement(
          'img'
        );

      image.src =
        iconSrc(
          member.icon_url
        );

      image.alt =
        '';

      image.onerror =
        () => {

          image.remove();

          box.textContent =
            initial(
              member
            );
        };


      box.appendChild(
        image
      );


    } else {

      box.textContent =
        initial(
          member
        );
    }


    return box;
  }


  /* ==========================================================
     詳細描画
     ========================================================== */

  function renderDetail(
    data
  ) {

    lastDetail =
      data;


    const content =
      document.getElementById(
        'memberDetailContent'
      );

    if (!content) {

      return;
    }


    const member =
      data.member ||
      {};

    const group =
      data.group ||
      {};

    const summary =
      data.summary ||
      {};

    const weights =
      Array.isArray(
        data.weights
      )
        ? data.weights
        : [];


    content.innerHTML =
      '';


    const profile =
      document.createElement(
        'div'
      );

    profile.className =
      'member-detail-profile';


    profile.appendChild(
      avatarNode(
        member
      )
    );


    const text =
      document.createElement(
        'div'
      );


    const name =
      document.createElement(
        'h2'
      );

    name.className =
      'member-detail-name';

    name.id =
      'memberDetailName';

    name.textContent =
      member.nickname ||
      '名前未設定';


    const groupText =
      document.createElement(
        'p'
      );

    groupText.className =
      'member-detail-group';

    groupText.textContent =
      (
        group.name ||
        'グループ'
      ) +
      ' ／ スタート ' +
      ymdText(
        group.start_ymd
      );


    text.append(
      name,
      groupText
    );


    profile.appendChild(
      text
    );


    content.appendChild(
      profile
    );


    const summaryBox =
      document.createElement(
        'div'
      );

    summaryBox.className =
      'member-detail-summary';

    summaryBox.innerHTML = `
      <div class="member-detail-summary-item">
        <span>スタート</span>
        <b>${kg(summary.start_kg)}</b>
      </div>

      <div class="member-detail-summary-item">
        <span>現在</span>
        <b>${kg(summary.latest_kg)}</b>
      </div>

      <div class="member-detail-summary-item">
        <span>減量幅</span>
        <b>${lossText(summary.loss_kg)}</b>
      </div>
    `;


    content.appendChild(
      summaryBox
    );


    const chartCard =
      document.createElement(
        'section'
      );

    chartCard.className =
      'member-detail-card';

    chartCard.innerHTML = `
      <h3 class="member-detail-card-title">
        体重グラフ
      </h3>

      <p class="member-detail-note">
        グループのスタート日以降。記録が空いた区間は破線で表示します。
      </p>

      <div class="member-detail-chart-wrap"></div>
    `;


    const chartWrap =
      chartCard.querySelector(
        '.member-detail-chart-wrap'
      );


    if (
      weights.length
    ) {

      const canvas =
        document.createElement(
          'canvas'
        );

      canvas.className =
        'member-detail-chart';


      chartWrap.appendChild(
        canvas
      );


    } else {

      chartWrap.innerHTML =
        '<div class="member-detail-empty">スタート日以降の体重記録はありません</div>';
    }


    content.appendChild(
      chartCard
    );


    const historyCard =
      document.createElement(
        'section'
      );

    historyCard.className =
      'member-detail-card';

    historyCard.innerHTML =
      '<h3 class="member-detail-card-title">入力履歴</h3>';


    if (
      !weights.length
    ) {

      historyCard.insertAdjacentHTML(
        'beforeend',
        '<div class="member-detail-empty">スタート日以降の入力履歴はありません</div>'
      );


    } else {

      const list =
        document.createElement(
          'ul'
        );

      list.className =
        'member-detail-history';


      const newest =
        [...weights]
          .sort(
            (
              a,
              b
            ) =>
              String(
                b.ymd
              )
                .localeCompare(
                  String(
                    a.ymd
                  )
                )
          );


      const firstYmd =
        weights[0] &&
        weights[0].ymd;


      const lastYmd =
        weights[
          weights.length -
          1
        ] &&
        weights[
          weights.length -
          1
        ].ymd;


      for (
        const row of
        newest
      ) {

        const item =
          document.createElement(
            'li'
          );


        const date =
          document.createElement(
            'div'
          );

        date.className =
          'member-detail-history-date';

        date.textContent =
          ymdText(
            row.ymd
          );


        if (
          row.ymd ===
            lastYmd ||
          row.ymd ===
            firstYmd
        ) {

          const badge =
            document.createElement(
              'small'
            );

          badge.textContent =
            row.ymd ===
              lastYmd
              ? '最新'
              : 'スタート';


          date.appendChild(
            badge
          );
        }


        const value =
          document.createElement(
            'div'
          );

        value.className =
          'member-detail-history-kg';

        value.textContent =
          kg(
            row.kg
          );


        item.append(
          date,
          value
        );


        list.appendChild(
          item
        );
      }


      historyCard.appendChild(
        list
      );
    }


    content.appendChild(
      historyCard
    );


    requestAnimationFrame(
      () =>
        requestAnimationFrame(
          () =>
            drawChart(
              data
            )
        )
    );
  }


  /* ==========================================================
     グラフ
     ========================================================== */

  function drawChart(
    data
  ) {

    const overlay =
      document.getElementById(
        'memberDetailOverlay'
      );

    if (
      !overlay ||
      overlay.hidden
    ) {

      return;
    }


    const canvas =
      overlay.querySelector(
        '.member-detail-chart'
      );

    if (!canvas) {

      return;
    }


    const points =
      (
        Array.isArray(
          data &&
          data.weights
        )
          ? data.weights
          : []
      )
        .map(
          row => ({
            ymd:
              String(
                row.ymd ||
                ''
              ),

            day:
              ymdDay(
                row.ymd
              ),

            kg:
              num(
                row.kg
              )
          })
        )
        .filter(
          point =>
            point.day !==
              null &&
            point.kg !==
              null
        )
        .sort(
          (
            a,
            b
          ) =>
            a.day -
            b.day
        );


    if (
      !points.length
    ) {

      return;
    }


    const ctx =
      canvas.getContext(
        '2d'
      );

    if (!ctx) {

      return;
    }


    const rect =
      canvas.getBoundingClientRect();


    const width =
      Math.max(
        260,
        rect.width ||
        canvas.parentElement.clientWidth ||
        300
      );


    const height =
      230;


    const dpr =
      window.devicePixelRatio ||
      1;


    canvas.width =
      Math.round(
        width *
        dpr
      );


    canvas.height =
      Math.round(
        height *
        dpr
      );


    ctx.setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0
    );


    ctx.clearRect(
      0,
      0,
      width,
      height
    );


    const pad = {
      l:
        42,

      r:
        12,

      t:
        14,

      b:
        28
    };


    const plotW =
      width -
      pad.l -
      pad.r;


    const plotH =
      height -
      pad.t -
      pad.b;


    const values =
      points.map(
        point =>
          point.kg
      );


    let low =
      Math.min(
        ...values
      );


    let high =
      Math.max(
        ...values
      );


    if (
      high -
      low <
      0.5
    ) {

      const mid =
        (
          high +
          low
        ) /
        2;

      low =
        mid -
        0.25;

      high =
        mid +
        0.25;
    }


    const margin =
      (
        high -
        low
      ) *
      0.14;


    low -=
      margin;


    high +=
      margin;


    const groupStart =
      ymdDay(
        data &&
        data.group &&
        data.group.start_ymd
      );


    const from =
      groupStart !==
        null
        ? Math.min(
            groupStart,
            points[0].day
          )
        : points[0].day;


    const to =
      points[
        points.length -
        1
      ].day;


    const span =
      Math.max(
        1,
        to -
        from
      );


    const x =
      day =>
        (
          points.length ===
            1 &&
          from ===
            to
        )
          ? (
              pad.l +
              plotW /
              2
            )
          : (
              pad.l +
              (
                day -
                from
              ) /
              span *
              plotW
            );


    const y =
      value =>
        pad.t +
        (
          high -
          value
        ) /
        (
          high -
          low
        ) *
        plotH;


    ctx.font =
      '10px -apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif';


    ctx.textBaseline =
      'middle';


    ctx.lineWidth =
      1;


    ctx.strokeStyle =
      '#eee5dc';


    ctx.fillStyle =
      '#9a9088';


    ctx.textAlign =
      'right';


    for (
      let i = 0;
      i <= 4;
      i++
    ) {

      const value =
        low +
        (
          high -
          low
        ) *
        i /
        4;


      const py =
        y(
          value
        );


      ctx.beginPath();


      ctx.moveTo(
        pad.l,
        py
      );


      ctx.lineTo(
        width -
        pad.r,
        py
      );


      ctx.stroke();


      ctx.fillText(
        value.toFixed(1),
        pad.l -
        6,
        py
      );
    }


    const labels = [
      {
        day:
          from,

        text:
          ymdText(
            (
              data &&
              data.group &&
              data.group.start_ymd
            ) ||
            points[0].ymd
          )
      }
    ];


    if (
      points.length >
        2 &&
      to !==
        from
    ) {

      const mid =
        points[
          Math.floor(
            points.length /
            2
          )
        ];


      labels.push({
        day:
          mid.day,

        text:
          ymdText(
            mid.ymd
          )
      });
    }


    if (
      to !==
        from
    ) {

      labels.push({
        day:
          to,

        text:
          ymdText(
            points[
              points.length -
              1
            ].ymd
          )
      });
    }


    ctx.textBaseline =
      'top';


    ctx.fillStyle =
      '#9a9088';


    labels.forEach(
      (
        label,
        index
      ) => {

        ctx.textAlign =
          index ===
            0
            ? 'left'
            : (
                index ===
                  labels.length -
                  1
                  ? 'right'
                  : 'center'
              );


        ctx.fillText(
          label.text,
          x(
            label.day
          ),
          height -
          pad.b +
          7
        );
      }
    );


    for (
      let i = 1;
      i < points.length;
      i++
    ) {

      const a =
        points[
          i -
          1
        ];


      const b =
        points[
          i
        ];


      const gap =
        b.day -
        a.day >
        1;


      ctx.save();


      ctx.strokeStyle =
        gap
          ? '#c9b7c2'
          : '#ef58c4';


      ctx.lineWidth =
        2.4;


      ctx.lineCap =
        'round';


      ctx.setLineDash(
        gap
          ? [
              5,
              5
            ]
          : []
      );


      ctx.beginPath();


      ctx.moveTo(
        x(
          a.day
        ),
        y(
          a.kg
        )
      );


      ctx.lineTo(
        x(
          b.day
        ),
        y(
          b.kg
        )
      );


      ctx.stroke();


      ctx.restore();
    }


    for (
      const point of
      points
    ) {

      ctx.beginPath();


      ctx.arc(
        x(
          point.day
        ),
        y(
          point.kg
        ),
        4,
        0,
        Math.PI *
        2
      );


      ctx.fillStyle =
        '#fff';


      ctx.fill();


      ctx.lineWidth =
        2.4;


      ctx.strokeStyle =
        '#ef58c4';


      ctx.stroke();
    }
  }


  /* ==========================================================
     ランキング行
     ========================================================== */

  const canOpen =
    row =>
      !!(
        row &&
        row.member_id &&
        row.weight_hidden !==
          true
      );


  async function openDetail(
    row
  ) {

    if (
      !canOpen(
        row
      )
    ) {

      return;
    }


    addStyle();

    ensureSheet();

    showSheet();

    setLoading(
      row
    );


    const requestId =
      ++activeRequest;


    try {

      const data =
        await fetchDetail(
          row.member_id
        );


      if (
        requestId !==
          activeRequest
      ) {

        return;
      }


      renderDetail(
        data
      );


    } catch (error) {

      if (
        requestId !==
          activeRequest
      ) {

        return;
      }


      setError(
        error
      );


      if (
        error &&
        error.message ===
          'weight_private' &&
        typeof window.loadRanking ===
          'function'
      ) {

        setTimeout(
          () =>
            window.loadRanking(),
          0
        );
      }
    }
  }


  function decorateRows(
    data
  ) {

    const list =
      document.getElementById(
        'rankList'
      );

    if (!list) {

      return;
    }


    const rows =
      Array.isArray(
        data &&
        data.rows
      )
        ? data.rows
        : [];


    const items =
      [
        ...list.children
      ]
        .filter(
          item =>
            !item.classList.contains(
              'empty'
            )
        );


    items.forEach(
      (
        item,
        index
      ) => {

        const row =
          rows[
            index
          ];


        if (
          !row ||
          !canOpen(
            row
          )
        ) {

          return;
        }


        item.classList.add(
          'member-detail-openable'
        );


        item.setAttribute(
          'role',
          'button'
        );


        item.setAttribute(
          'tabindex',
          '0'
        );


        item.setAttribute(
          'aria-label',
          (
            row.nickname ||
            'このメンバー'
          ) +
          'の体重記録を見る'
        );


        item.addEventListener(
          'click',
          event => {

            if (
              event.target.closest(
                'button,a,input,select,textarea'
              )
            ) {

              return;
            }


            openDetail(
              row
            );
          }
        );


        item.addEventListener(
          'keydown',
          event => {

            if (
              (
                event.key !==
                  'Enter' &&
                event.key !==
                  ' '
              ) ||
              event.target !==
                item
            ) {

              return;
            }


            event.preventDefault();


            openDetail(
              row
            );
          }
        );
      }
    );
  }


  /* ==========================================================
     app.js の drawRank を最小拡張
     ========================================================== */

  function patchDrawRank() {

    if (
      typeof window.drawRank !==
        'function'
    ) {

      return false;
    }


    if (
      window.drawRank
        .__memberDetailPatched
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


        renderTeamSummary(
          data
        );


        decorateRows(
          data
        );
      };


    wrapped.__memberDetailPatched =
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

    ensureSheet();


    if (
      !patchDrawRank()
    ) {

      let tries =
        0;


      const timer =
        setInterval(
          () => {

            tries++;


            if (
              patchDrawRank() ||
              tries >=
                20
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
            }
          },
          100
        );


    } else if (
      typeof window.loadRanking ===
        'function'
    ) {

      setTimeout(
        () =>
          window.loadRanking(),
        0
      );
    }


    document.addEventListener(
      'keydown',
      event => {

        if (
          event.key !==
            'Escape'
        ) {

          return;
        }


        const overlay =
          document.getElementById(
            'memberDetailOverlay'
          );


        if (
          overlay &&
          !overlay.hidden
        ) {

          closeDetail();
        }
      }
    );


    window.addEventListener(
      'resize',
      () => {

        if (
          lastDetail
        ) {

          drawChart(
            lastDetail
          );
        }
      },
      {
        passive:
          true
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
          true
      }
    );


  } else {

    start();
  }

})();
