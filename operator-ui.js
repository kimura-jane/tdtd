'use strict';

/* ============================================================
   みんやせ / operator-ui.js
   運営アカウント専用UI
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

  const K_DELETED =
    'minyase.deleted.v1';

  const ERR = {
    bad_device_id:
      '端末IDを確認できませんでした',

    not_registered:
      'アプリの読み込みがまだ完了していません',

    banned:
      'このアカウントは利用できません',

    operator_only:
      '運営アカウントではありません',

    operator_not_allowed:
      '運営アカウントではこの操作はできません',

    group_not_found:
      'グループが見つかりません',

    bad_code:
      'グループコードが不正です',

    bad_name:
      'グループ名を入力してください',

    ng_word:
      'この表現は登録できません',

    bad_ymd:
      '日付が不正です',

    future_ymd:
      '未来の日付は設定できません',

    show_weight_locked:
      '体重公開設定は作成後に変更できません',

    nothing_to_update:
      '変更点がありません',

    rate_limited:
      '操作が多すぎます。少し待ってからお試しください',

    bad_member_id:
      'メンバーIDが不正です',

    not_in_group:
      'このグループのメンバーではありません',

    already_leader:
      'すでにリーダーです',

    leader_limit:
      'リーダーは5人までです',

    server_error:
      'サーバーエラーが発生しました',

    network_error:
      '通信できませんでした',
  };


  let active =
    false;

  let selectedGroupId =
    null;

  let busy =
    false;

  let observer =
    null;


  /* ==========================================================
     小物
     ========================================================== */

  const $ =
    id =>
      document.getElementById(
        id
      );


  function deviceId() {

    return (
      localStorage.getItem(
        K_DEV
      ) ||
      ''
    );
  }


  function deleted() {

    return (
      localStorage.getItem(
        K_DELETED
      ) ===
      '1'
    );
  }


  function sleep(ms) {

    return new Promise(
      resolve =>
        setTimeout(
          resolve,
          ms
        )
    );
  }


  function emsg(e) {

    const code =
      e &&
      e.message
        ? e.message
        : 'unknown_error';


    return (
      ERR[
        code
      ] ||
      (
        'エラー（' +
        code +
        '）'
      )
    );
  }


  function fmtCode(raw) {

    const value =
      String(
        raw ||
        ''
      )
        .toUpperCase()
        .replace(
          /[^0-9A-Z]/g,
          ''
        );


    return (
      value.length ===
        8
    )
      ? (
          value.slice(
            0,
            4
          ) +
          '-' +
          value.slice(4)
        )
      : (
          String(
            raw ||
            '—'
          )
        );
  }


  function fmtDate(ymd) {

    if (
      !/^\d{4}-\d{2}-\d{2}$/
        .test(
          String(
            ymd ||
            ''
          )
        )
    ) {

      return '—';
    }


    const [
      year,
      month,
      day
    ] =
      String(
        ymd
      )
        .split('-')
        .map(
          Number
        );


    return (
      `${year}年` +
      `${month}月` +
      `${day}日`
    );
  }


  function signLoss(value) {

    if (
      value ===
        null ||
      value ===
        undefined
    ) {

      return '—';
    }


    const n =
      Number(
        value
      );


    if (
      !Number.isFinite(
        n
      )
    ) {

      return '—';
    }


    if (
      n >
      0
    ) {

      return (
        '−' +
        Math.abs(
          n
        )
          .toFixed(1) +
        'kg'
      );
    }


    if (
      n <
      0
    ) {

      return (
        '+' +
        Math.abs(
          n
        )
          .toFixed(1) +
        'kg'
      );
    }


    return '±0.0kg';
  }


  function node(
    tag,
    className,
    text
  ) {

    const element =
      document.createElement(
        tag
      );


    if (
      className
    ) {

      element.className =
        className;
    }


    if (
      text !==
        undefined &&
      text !==
        null
    ) {

      element.textContent =
        String(
          text
        );
    }


    return element;
  }


  function setMessage(
    text,
    ok = false
  ) {

    const message =
      $('opMsg');


    if (
      !message
    ) {

      return;
    }


    message.textContent =
      text ||
      '';


    message.className =
      'op-msg ' +
      (
        ok
          ? 'ok'
          : 'ng'
      );
  }


  function todayJst() {

    return new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone:
          'Asia/Tokyo',

        year:
          'numeric',

        month:
          '2-digit',

        day:
          '2-digit',
      }
    )
      .format(
        new Date()
      );
  }


  async function askConfirm(
    title,
    text,
    danger = false
  ) {

    if (
      typeof window.confirmSheet ===
        'function'
    ) {

      return await window.confirmSheet(
        title,
        text,
        danger
          ? '実行する'
          : 'OK',
        danger
      );
    }


    return window.confirm(
      title +
      '\n\n' +
      text
    );
  }


  async function showAlert(
    title,
    text
  ) {

    if (
      typeof window.alertSheet ===
        'function'
    ) {

      await window.alertSheet(
        title,
        text
      );

      return;
    }


    window.alert(
      title +
      '\n\n' +
      text
    );
  }


  /* ==========================================================
     API
     ========================================================== */

  async function api(
    path,
    options = {}
  ) {

    const did =
      deviceId();


    if (
      !did
    ) {

      throw new Error(
        'not_registered'
      );
    }


    let response;


    try {

      response =
        await fetch(
          API +
          path,
          {
            method:
              options.method ||
              'GET',

            headers: {
              'content-type':
                'application/json',

              'x-device-id':
                did,
            },

            body:
              options.body !==
                undefined
                ? JSON.stringify(
                    options.body
                  )
                : undefined,

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
        (
          'http_' +
          response.status
        )
      );
    }


    return data;
  }


  /* ==========================================================
     運営者判定
     ========================================================== */

  async function detectOperator() {

    if (
      deleted()
    ) {

      return false;
    }


    for (
      let i = 0;
      i < 20;
      i++
    ) {

      if (
        deleted()
      ) {

        return false;
      }


      if (
        !deviceId()
      ) {

        await sleep(
          200
        );

        continue;
      }


      try {

        const data =
          await api(
            '/api/operator/status'
          );


        return !!data.operator;


      } catch (e) {

        if (
          e.message ===
            'not_registered'
        ) {

          await sleep(
            250
          );

          continue;
        }


        if (
          e.message ===
            'network_error'
        ) {

          await sleep(
            400
          );

          continue;
        }


        return false;
      }
    }


    return false;
  }


  /* ==========================================================
     CSS
     ========================================================== */

  function addStyle() {

    if (
      $('operatorUiStyle')
    ) {

      return;
    }


    const style =
      node(
        'style'
      );


    style.id =
      'operatorUiStyle';


    style.textContent = `
      .op-head{
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:12px;
        margin-bottom:14px;
      }

      .op-kicker{
        margin:0 0 3px;
        color:#8a8178;
        font-size:11px;
        font-weight:800;
        letter-spacing:.08em;
      }

      .op-count{
        margin:3px 0 0;
        color:#716961;
        font-size:13px;
      }

      .op-form{
        display:grid;
        gap:12px;
      }

      .op-form-row{
        display:grid;
        gap:6px;
      }

      .op-form-row label{
        color:#70685f;
        font-size:12px;
        font-weight:800;
      }

      .op-form-row input{
        width:100%;
      }

      .op-check{
        display:flex;
        gap:9px;
        align-items:flex-start;
        color:#5d5650;
        font-size:13px;
        line-height:1.6;
      }

      .op-check input{
        width:20px;
        height:20px;
        flex:0 0 auto;
        margin-top:1px;
      }

      .op-msg{
        min-height:1.4em;
        margin:10px 0 0;
        font-size:13px;
      }

      .op-msg.ok{
        color:#31815a;
      }

      .op-msg.ng{
        color:#bd473d;
      }

      .op-list{
        display:grid;
        gap:10px;
      }

      .op-group{
        padding:14px;
        border:1px solid #eee7df;
        border-radius:16px;
        background:#fff;
      }

      .op-group-top{
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:12px;
      }

      .op-group-name{
        margin:0;
        font-size:16px;
        font-weight:900;
        line-height:1.4;
      }

      .op-group-code{
        margin-top:3px;
        color:#7f766e;
        font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
        font-size:12px;
      }

      .op-meta{
        display:flex;
        flex-wrap:wrap;
        gap:6px;
        margin-top:11px;
      }

      .op-pill{
        display:inline-flex;
        align-items:center;
        min-height:26px;
        padding:3px 9px;
        border-radius:999px;
        background:#f5f1ec;
        color:#6d655e;
        font-size:11px;
        font-weight:700;
      }

      .op-pill.on{
        background:#eef8f2;
        color:#337b55;
      }

      .op-detail-head{
        display:flex;
        align-items:center;
        gap:10px;
        margin-bottom:12px;
      }

      .op-detail-title{
        flex:1 1 auto;
        min-width:0;
        margin:0;
        font-size:19px;
        font-weight:900;
      }

      .op-summary{
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:8px;
        margin:12px 0;
      }

      .op-stat{
        padding:11px;
        border-radius:14px;
        background:#f8f5f1;
      }

      .op-stat small{
        display:block;
        color:#887f76;
        font-size:10px;
        font-weight:800;
      }

      .op-stat strong{
        display:block;
        margin-top:3px;
        font-size:18px;
        font-weight:900;
      }

      .op-section-title{
        margin:20px 0 9px;
        font-size:14px;
        font-weight:900;
      }

      .op-member{
        padding:12px 0;
        border-top:1px solid #eee8e1;
      }

      .op-member:first-child{
        border-top:0;
      }

      .op-member-main{
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:10px;
      }

      .op-member-name{
        font-size:14px;
        font-weight:900;
      }

      .op-member-sub{
        margin-top:3px;
        color:#817970;
        font-size:11px;
        line-height:1.6;
      }

      .op-member-actions{
        display:flex;
        flex-wrap:wrap;
        gap:6px;
        margin-top:9px;
      }

      .op-empty{
        padding:18px 4px;
        color:#8a8179;
        font-size:13px;
        text-align:center;
      }

      .op-code-row{
        display:flex;
        align-items:center;
        gap:8px;
        flex-wrap:wrap;
      }

      .op-code-large{
        font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
        font-size:18px;
        font-weight:900;
        letter-spacing:.05em;
      }

      .op-danger-zone{
        margin-top:22px;
        padding-top:16px;
        border-top:1px solid #eee6de;
      }
    `;


    document.head.appendChild(
      style
    );
  }


  /* ==========================================================
     通常参加UIを隠す
     ========================================================== */

  function hideNodeById(id) {

    const element =
      $(id);


    if (
      element
    ) {

      element.style.display =
        'none';
    }
  }


  function removeVoteUi() {

    const voteCard =
      $('voteCard');

    const scoreCard =
      $('voteScoreCard');


    if (
      voteCard
    ) {

      voteCard.remove();
    }


    if (
      scoreCard
    ) {

      scoreCard.remove();
    }
  }


  function applyOperatorShell() {

    document.body.classList.add(
      'operator-mode'
    );


    hideNodeById(
      'view-log'
    );

    hideNodeById(
      'rankBox'
    );

    hideNodeById(
      'myGroupBox'
    );

    hideNodeById(
      'watchAddBox'
    );

    hideNodeById(
      'noGroupBox'
    );


    const logTab =
      document.querySelector(
        '.tabbtn[data-v="log"]'
      );


    if (
      logTab
    ) {

      logTab.style.display =
        'none';
    }


    const groupTab =
      document.querySelector(
        '.tabbtn[data-v="group"]'
      );


    if (
      groupTab
    ) {

      const label =
        groupTab.querySelector(
          'span'
        );


      if (
        label
      ) {

        label.textContent =
          'グループ管理';
      }
    }


    /*
     * 目標体重だけ隠す。
     * プロフィール・アイコン・ニックネームは残す。
     */
    const goalInput =
      $('goalInput');


    if (
      goalInput
    ) {

      const field =
        goalInput.closest(
          '.field'
        );


      if (
        field
      ) {

        field.style.display =
          'none';
      }
    }


    /*
     * 通知カードを隠す。
     */
    const notifyOn =
      $('notifyOn');


    if (
      notifyOn
    ) {

      const card =
        notifyOn.closest(
          '.card'
        );


      if (
        card
      ) {

        card.style.display =
          'none';
      }
    }


    /*
     * ライバル・参加者機能なので
     * ブロック一覧も運営画面では出さない。
     */
    const blockList =
      $('blockList');


    if (
      blockList
    ) {

      const card =
        blockList.closest(
          '.card'
        );


      if (
        card
      ) {

        card.style.display =
          'none';
      }
    }


    /*
     * 運営アカウント削除時、
     * 運営グループそのものは残ることを明記する。
     */
    const deleteAll =
      $('deleteAll');


    if (
      deleteAll
    ) {

      const card =
        deleteAll.closest(
          '.card'
        );


      if (
        card &&
        !$('opDeleteNote')
      ) {

        const note =
          node(
            'p',
            'note',
            '運営アカウントの利用データを削除しても、運営中のグループと参加者のデータは解散・削除されません。再び運営する場合は運営者設定の更新が必要です。'
          );


        note.id =
          'opDeleteNote';


        deleteAll.insertAdjacentElement(
          'beforebegin',
          note
        );
      }
    }


    removeVoteUi();


    /*
     * vote.js が後からカードを生成しても
     * 即座に削除する。
     */
    if (
      !observer
    ) {

      observer =
        new MutationObserver(
          () => {

            if (
              active
            ) {

              removeVoteUi();
            }
          }
        );


      observer.observe(
        document.body,
        {
          childList:
            true,

          subtree:
            true,
        }
      );
    }


    /*
     * 初期表示をグループ管理へ。
     */
    if (
      groupTab
    ) {

      groupTab.click();


      setTimeout(
        () => {

          const title =
            $('hdTitle');


          if (
            title
          ) {

            title.textContent =
              'グループ管理';
          }
        },
        0
      );
    }


    /*
     * app.js のタブ処理が
     * タイトルを「グループ」に戻すため上書き。
     */
    document.addEventListener(
      'click',
      event => {

        if (
          !active
        ) {

          return;
        }


        const tab =
          event.target.closest(
            '.tabbtn[data-v]'
          );


        if (
          !tab
        ) {

          return;
        }


        if (
          tab.dataset.v ===
            'group'
        ) {

          setTimeout(
            () => {

              const title =
                $('hdTitle');


              if (
                title
              ) {

                title.textContent =
                  'グループ管理';
              }
            },
            0
          );
        }
      },
      true
    );
  }


  /* ==========================================================
     運営パネル
     ========================================================== */

  function ensurePanel() {

    let panel =
      $('operatorPanel');


    if (
      panel
    ) {

      return panel;
    }


    const view =
      $('view-group');


    if (
      !view
    ) {

      return null;
    }


    panel =
      node(
        'section',
        'card'
      );


    panel.id =
      'operatorPanel';


    panel.innerHTML = `
      <div id="opListView">

        <div class="op-head">

          <div>

            <p class="op-kicker">
              OPERATOR
            </p>

            <h2
              class="h2"
              style="margin:0;"
            >
              運営グループ
            </h2>

            <p
              class="op-count"
              id="opCount"
            >
              読み込み中…
            </p>

          </div>

          <button
            class="ghost sm"
            id="opRefresh"
            type="button"
          >
            更新
          </button>

        </div>


        <details id="opCreateBox">

          <summary
            style="font-weight:900;cursor:pointer;"
          >
            ＋ 新しいグループを作る
          </summary>


          <div
            class="op-form"
            style="margin-top:14px;"
          >

            <div class="op-form-row">

              <label for="opCreateName">
                グループ名
              </label>

              <input
                id="opCreateName"
                type="text"
                maxlength="24"
                placeholder="チームA"
              >

            </div>


            <div class="op-form-row">

              <label for="opCreateStart">
                スタート日
              </label>

              <input
                id="opCreateStart"
                type="date"
              >

            </div>


            <label class="op-check">

              <input
                id="opCreateShowWeight"
                type="checkbox"
                checked
              >

              <span>
                参加者が体重を公開できるグループにする
              </span>

            </label>


            <p
              class="note"
              style="margin:0;"
            >
              運営アカウント自身は
              メンバー数・ランキング・合計・平均には入りません。
              作成できるグループ数に上限はありません。
            </p>


            <button
              class="primary"
              id="opCreate"
              type="button"
            >
              グループを作成
            </button>

          </div>

        </details>


        <p
          class="op-msg"
          id="opMsg"
        ></p>


        <div
          class="op-list"
          id="opGroups"
        ></div>

      </div>


      <div
        id="opDetailView"
        hidden
      ></div>
    `;


    view.prepend(
      panel
    );


    const start =
      $('opCreateStart');


    if (
      start
    ) {

      start.value =
        todayJst();

      start.max =
        todayJst();
    }


    $('opRefresh').onclick =
      () =>
        loadGroups();


    $('opCreate').onclick =
      () =>
        createGroup();


    return panel;
  }


  /* ==========================================================
     グループ一覧
     ========================================================== */

  function groupCard(group) {

    const card =
      node(
        'div',
        'op-group'
      );


    const top =
      node(
        'div',
        'op-group-top'
      );


    const main =
      node(
        'div'
      );


    const name =
      node(
        'p',
        'op-group-name',
        group.name ||
        '名称未設定'
      );


    const code =
      node(
        'div',
        'op-group-code',
        fmtCode(
          group.code ||
          group.group_id
        )
      );


    const manage =
      node(
        'button',
        'ghost sm',
        '管理'
      );


    manage.type =
      'button';


    manage.onclick =
      () =>
        openGroup(
          group.group_id
        );


    main.append(
      name,
      code
    );


    top.append(
      main,
      manage
    );


    const meta =
      node(
        'div',
        'op-meta'
      );


    meta.append(
      node(
        'span',
        'op-pill',
        `メンバー ${Number(group.members || 0)}人`
      ),

      node(
        'span',
        'op-pill',
        `リーダー ${Number(group.leader_count || 0)}人`
      ),

      node(
        'span',
        'op-pill',
        fmtDate(
          group.start_ymd
        )
      ),

      node(
        'span',
        'op-pill',
        group.show_weight
          ? '体重公開可'
          : '増減量のみ'
      ),

      node(
        'span',
        'op-pill' +
        (
          group.external_enabled
            ? ' on'
            : ''
        ),
        group.external_enabled
          ? '外部WEB連携 ON'
          : '外部WEB連携 OFF'
      )
    );


    card.append(
      top,
      meta
    );


    return card;
  }


  async function loadGroups() {

    if (
      !active ||
      busy
    ) {

      return;
    }


    busy =
      true;


    setMessage(
      '読み込み中…',
      true
    );


    try {

      const data =
        await api(
          '/api/operator/groups'
        );


      const groups =
        data.groups ||
        [];


      const count =
        $('opCount');

      const list =
        $('opGroups');


      if (
        count
      ) {

        count.textContent =
          `管理中 ${groups.length}グループ`;
      }


      if (
        list
      ) {

        list.innerHTML =
          '';


        if (
          !groups.length
        ) {

          list.appendChild(
            node(
              'div',
              'op-empty',
              'まだ運営グループはありません'
            )
          );


        } else {

          for (
            const group of
            groups
          ) {

            list.appendChild(
              groupCard(
                group
              )
            );
          }
        }
      }


      setMessage(
        '',
        true
      );


    } catch (e) {

      setMessage(
        emsg(e),
        false
      );


    } finally {

      busy =
        false;
    }
  }


  async function loadGroupsAfterUnlock() {

    const previous =
      busy;


    busy =
      false;


    try {

      await loadGroups();


    } finally {

      busy =
        previous;
    }
  }


  /* ==========================================================
     グループ作成
     ========================================================== */

  async function createGroup() {

    if (
      busy
    ) {

      return;
    }


    const name =
      String(
        $('opCreateName').value ||
        ''
      )
        .trim();


    const start =
      String(
        $('opCreateStart').value ||
        ''
      )
        .trim();


    if (
      !name
    ) {

      setMessage(
        'グループ名を入力してください',
        false
      );

      return;
    }


    if (
      !/^\d{4}-\d{2}-\d{2}$/
        .test(
          start
        )
    ) {

      setMessage(
        'スタート日を選んでください',
        false
      );

      return;
    }


    busy =
      true;


    $('opCreate').disabled =
      true;


    setMessage(
      '作成中…',
      true
    );


    try {

      await api(
        '/api/operator/groups',
        {
          method:
            'POST',

          body: {
            name,

            start_ymd:
              start,

            show_weight:
              !!$('opCreateShowWeight')
                .checked,
          },
        }
      );


      $('opCreateName').value =
        '';

      $('opCreateStart').value =
        todayJst();

      $('opCreateShowWeight').checked =
        true;


      const box =
        $('opCreateBox');


      if (
        box
      ) {

        box.open =
          false;
      }


      await loadGroupsAfterUnlock();


      setMessage(
        'グループを作成しました',
        true
      );


    } catch (e) {

      setMessage(
        emsg(e),
        false
      );


    } finally {

      busy =
        false;

      $('opCreate').disabled =
        false;
    }
  }


  /* ==========================================================
     グループ詳細
     ========================================================== */

  async function openGroup(groupId) {

    selectedGroupId =
      groupId;


    const listView =
      $('opListView');

    const detail =
      $('opDetailView');


    if (
      !detail ||
      !listView
    ) {

      return;
    }


    listView.hidden =
      true;

    detail.hidden =
      false;


    detail.innerHTML =
      '<div class="op-empty">読み込み中…</div>';


    try {

      const [
        groupData,
        memberData,
        banData
      ] =
        await Promise.all([
          api(
            '/api/operator/groups/' +
            encodeURIComponent(
              groupId
            )
          ),

          api(
            '/api/operator/groups/' +
            encodeURIComponent(
              groupId
            ) +
            '/members'
          ),

          api(
            '/api/operator/groups/' +
            encodeURIComponent(
              groupId
            ) +
            '/bans'
          ),
        ]);


      if (
        selectedGroupId !==
          groupId
      ) {

        return;
      }


      renderDetail(
        groupData.group,
        memberData,
        banData.bans ||
        []
      );


    } catch (e) {

      detail.innerHTML =
        '';


      const back =
        node(
          'button',
          'ghost sm',
          '← 戻る'
        );


      back.type =
        'button';


      back.onclick =
        closeDetail;


      detail.append(
        back,

        node(
          'div',
          'op-empty',
          emsg(e)
        )
      );
    }
  }


  function closeDetail() {

    selectedGroupId =
      null;


    const listView =
      $('opListView');

    const detail =
      $('opDetailView');


    if (
      listView
    ) {

      listView.hidden =
        false;
    }


    if (
      detail
    ) {

      detail.hidden =
        true;

      detail.innerHTML =
        '';
    }


    loadGroups();
  }


  function stat(
    label,
    value
  ) {

    const box =
      node(
        'div',
        'op-stat'
      );


    box.append(
      node(
        'small',
        '',
        label
      ),

      node(
        'strong',
        '',
        value
      )
    );


    return box;
  }


  function renderDetail(
    group,
    memberData,
    bans
  ) {

    const detail =
      $('opDetailView');


    if (
      !detail
    ) {

      return;
    }


    detail.innerHTML =
      '';


    const head =
      node(
        'div',
        'op-detail-head'
      );


    const back =
      node(
        'button',
        'ghost sm',
        '← 戻る'
      );


    const title =
      node(
        'h2',
        'op-detail-title',
        group.name
      );


    const refresh =
      node(
        'button',
        'ghost sm',
        '更新'
      );


    back.type =
      'button';

    refresh.type =
      'button';


    back.onclick =
      closeDetail;


    refresh.onclick =
      () =>
        openGroup(
          group.group_id
        );


    head.append(
      back,
      title,
      refresh
    );


    const codeRow =
      node(
        'div',
        'op-code-row'
      );


    const code =
      node(
        'div',
        'op-code-large',
        fmtCode(
          group.code ||
          group.group_id
        )
      );


    const copy =
      node(
        'button',
        'ghost sm',
        'コードをコピー'
      );


    copy.type =
      'button';


    copy.onclick =
      () =>
        copyCode(
          group.code ||
          group.group_id,
          copy
        );


    codeRow.append(
      code,
      copy
    );


    const meta =
      node(
        'div',
        'op-meta'
      );


    meta.append(
      node(
        'span',
        'op-pill',
        fmtDate(
          group.start_ymd
        )
      ),

      node(
        'span',
        'op-pill',
        group.show_weight
          ? '体重公開可'
          : '増減量のみ'
      ),

      node(
        'span',
        'op-pill' +
        (
          group.external_enabled
            ? ' on'
            : ''
        ),
        group.external_enabled
          ? '外部WEB連携 ON'
          : '外部WEB連携 OFF'
      )
    );


    const summary =
      node(
        'div',
        'op-summary'
      );


    const stats =
      memberData.summary ||
      {};


    summary.append(
      stat(
        'メンバー',
        `${Number(stats.members || 0)}人`
      ),

      stat(
        '集計対象',
        `${Number(stats.counted || 0)}人`
      ),

      stat(
        '合計減量',
        signLoss(
          stats.total_loss
        )
      ),

      stat(
        '1人平均',
        stats.avg_loss ===
          null ||
        stats.avg_loss ===
          undefined
          ? '—'
          : signLoss(
              stats.avg_loss
            )
      )
    );


    const editTitle =
      node(
        'h3',
        'op-section-title',
        'グループ設定'
      );


    const edit =
      buildEditForm(
        group
      );


    const memberTitle =
      node(
        'h3',
        'op-section-title',
        `メンバー ${Number(stats.members || 0)}人`
      );


    const members =
      node(
        'div'
      );


    const rows =
      memberData.rows ||
      [];


    if (
      !rows.length
    ) {

      members.appendChild(
        node(
          'div',
          'op-empty',
          'まだメンバーはいません'
        )
      );


    } else {

      for (
        const row of
        rows
      ) {

        members.appendChild(
          memberRow(
            group,
            row
          )
        );
      }
    }


    const banTitle =
      node(
        'h3',
        'op-section-title',
        `除名リスト ${bans.length}人`
      );


    const banList =
      node(
        'div'
      );


    if (
      !bans.length
    ) {

      banList.appendChild(
        node(
          'div',
          'op-empty',
          '除名した人はいません'
        )
      );


    } else {

      for (
        const row of
        bans
      ) {

        banList.appendChild(
          banRow(
            group,
            row
          )
        );
      }
    }


    const danger =
      node(
        'div',
        'op-danger-zone'
      );


    const dissolve =
      node(
        'button',
        'danger',
        'このグループを解散'
      );


    dissolve.type =
      'button';


    dissolve.onclick =
      () =>
        dissolveGroup(
          group
        );


    danger.append(
      node(
        'p',
        'note',
        '解散すると参加者全員がグループ無しになります。各参加者の個人の体重記録は残ります。'
      ),

      dissolve
    );


    detail.append(
      head,
      codeRow,
      meta,
      summary,
      editTitle,
      edit,
      memberTitle,
      members,
      banTitle,
      banList,
      danger
    );
  }


  /* ==========================================================
     グループ設定
     ========================================================== */

  function buildEditForm(group) {

    const wrap =
      node(
        'div',
        'op-form'
      );


    const nameRow =
      node(
        'div',
        'op-form-row'
      );


    const nameLabel =
      node(
        'label',
        '',
        'グループ名'
      );


    const nameInput =
      node(
        'input'
      );


    nameInput.type =
      'text';

    nameInput.maxLength =
      24;

    nameInput.value =
      group.name ||
      '';


    nameRow.append(
      nameLabel,
      nameInput
    );


    const startRow =
      node(
        'div',
        'op-form-row'
      );


    const startLabel =
      node(
        'label',
        '',
        'スタート日'
      );


    const startInput =
      node(
        'input'
      );


    startInput.type =
      'date';

    startInput.max =
      todayJst();

    startInput.value =
      group.start_ymd ||
      todayJst();


    startRow.append(
      startLabel,
      startInput
    );


    const save =
      node(
        'button',
        'ghost sm',
        '設定を保存'
      );


    save.type =
      'button';


    save.onclick =
      async () => {

        const name =
          String(
            nameInput.value ||
            ''
          )
            .trim();


        const start =
          String(
            startInput.value ||
            ''
          )
            .trim();


        if (
          !name
        ) {

          await showAlert(
            '入力エラー',
            'グループ名を入力してください'
          );

          return;
        }


        if (
          !/^\d{4}-\d{2}-\d{2}$/
            .test(
              start
            )
        ) {

          await showAlert(
            '入力エラー',
            'スタート日を選んでください'
          );

          return;
        }


        save.disabled =
          true;


        try {

          await api(
            '/api/operator/groups/' +
            encodeURIComponent(
              group.group_id
            ),
            {
              method:
                'PATCH',

              body: {
                name,

                start_ymd:
                  start,
              },
            }
          );


          await openGroup(
            group.group_id
          );


        } catch (e) {

          await showAlert(
            '保存できませんでした',
            emsg(e)
          );


        } finally {

          save.disabled =
            false;
        }
      };


    wrap.append(
      nameRow,
      startRow,

      node(
        'p',
        'note',
        '体重公開設定は作成後に変更できません。スタート日より前の体重はグループ共有対象になりません。'
      ),

      save
    );


    return wrap;
  }


  /* ==========================================================
     メンバー管理
     ========================================================== */

  function memberRow(
    group,
    row
  ) {

    const wrap =
      node(
        'div',
        'op-member'
      );


    const main =
      node(
        'div',
        'op-member-main'
      );


    const left =
      node(
        'div'
      );


    const displayName =
      row.nickname ||
      row.member_id ||
      '名前未設定';


    const name =
      node(
        'div',
        'op-member-name',
        displayName
      );


    if (
      row.is_leader
    ) {

      const badge =
        node(
          'span',
          'op-pill on',
          'リーダー'
        );


      badge.style.marginLeft =
        '6px';


      name.appendChild(
        badge
      );
    }


    const parts =
      [];


    if (
      row.rank
    ) {

      parts.push(
        `${row.rank}位`
      );
    }


    parts.push(
      `増減 ${signLoss(row.loss)}`
    );


    if (
      row.last_ymd
    ) {

      parts.push(
        `最終 ${fmtDate(row.last_ymd)}`
      );


    } else {

      parts.push(
        '記録なし'
      );
    }


    if (
      row.inactive
    ) {

      parts.push(
        'おやすみ中'
      );
    }


    const sub =
      node(
        'div',
        'op-member-sub',
        parts.join(
          ' ／ '
        )
      );


    left.append(
      name,
      sub
    );


    main.append(
      left
    );


    const actions =
      node(
        'div',
        'op-member-actions'
      );


    const leader =
      node(
        'button',
        'ghost sm',
        row.is_leader
          ? 'リーダー解除'
          : 'リーダー任命'
      );


    leader.type =
      'button';


    leader.onclick =
      () =>
        toggleLeader(
          group,
          row
        );


    const kick =
      node(
        'button',
        'danger sm',
        '除名'
      );


    kick.type =
      'button';


    kick.onclick =
      () =>
        kickMember(
          group,
          row
        );


    actions.append(
      leader,
      kick
    );


    wrap.append(
      main,
      actions
    );


    return wrap;
  }


  async function toggleLeader(
    group,
    row
  ) {

    const label =
      row.nickname ||
      row.member_id;


    const ok =
      await askConfirm(
        row.is_leader
          ? 'リーダー解除'
          : 'リーダー任命',

        row.is_leader
          ? `${label} のリーダー権限を解除します。`
          : `${label} をリーダーに任命します。`
      );


    if (
      !ok
    ) {

      return;
    }


    try {

      if (
        row.is_leader
      ) {

        await api(
          '/api/operator/groups/' +
          encodeURIComponent(
            group.group_id
          ) +
          '/leaders/' +
          encodeURIComponent(
            row.member_id
          ),
          {
            method:
              'DELETE',
          }
        );


      } else {

        await api(
          '/api/operator/groups/' +
          encodeURIComponent(
            group.group_id
          ) +
          '/leaders',
          {
            method:
              'POST',

            body: {
              member_id:
                row.member_id,
            },
          }
        );
      }


      await openGroup(
        group.group_id
      );


    } catch (e) {

      await showAlert(
        '操作できませんでした',
        emsg(e)
      );
    }
  }


  async function kickMember(
    group,
    row
  ) {

    const label =
      row.nickname ||
      row.member_id;


    const ok =
      await askConfirm(
        'メンバーを除名',
        `${label} をグループから除名します。同じコードでは再参加できなくなります。`,
        true
      );


    if (
      !ok
    ) {

      return;
    }


    try {

      await api(
        '/api/operator/groups/' +
        encodeURIComponent(
          group.group_id
        ) +
        '/kick',
        {
          method:
            'POST',

          body: {
            member_id:
              row.member_id,
          },
        }
      );


      await openGroup(
        group.group_id
      );


    } catch (e) {

      await showAlert(
        '除名できませんでした',
        emsg(e)
      );
    }
  }


  /* ==========================================================
     除名解除
     ========================================================== */

  function banRow(
    group,
    row
  ) {

    const wrap =
      node(
        'div',
        'op-member'
      );


    const main =
      node(
        'div',
        'op-member-main'
      );


    const left =
      node(
        'div'
      );


    const label =
      row.nickname ||
      row.member_id ||
      '名前未設定';


    left.append(
      node(
        'div',
        'op-member-name',
        label
      ),

      node(
        'div',
        'op-member-sub',
        row.member_id ||
        ''
      )
    );


    const restore =
      node(
        'button',
        'ghost sm',
        '再参加を許可'
      );


    restore.type =
      'button';


    restore.onclick =
      () =>
        unbanMember(
          group,
          row
        );


    main.append(
      left,
      restore
    );


    wrap.append(
      main
    );


    return wrap;
  }


  async function unbanMember(
    group,
    row
  ) {

    const label =
      row.nickname ||
      row.member_id;


    const ok =
      await askConfirm(
        '再参加を許可',
        `${label} が同じ参加コードで再参加できるようにします。`
      );


    if (
      !ok
    ) {

      return;
    }


    try {

      await api(
        '/api/operator/groups/' +
        encodeURIComponent(
          group.group_id
        ) +
        '/unban',
        {
          method:
            'POST',

          body: {
            member_id:
              row.member_id,
          },
        }
      );


      await openGroup(
        group.group_id
      );


    } catch (e) {

      await showAlert(
        '操作できませんでした',
        emsg(e)
      );
    }
  }


  /* ==========================================================
     コピー
     ========================================================== */

  async function copyCode(
    raw,
    button
  ) {

    const code =
      fmtCode(
        raw
      );


    try {

      await navigator.clipboard
        .writeText(
          code
        );


      if (
        button
      ) {

        const before =
          button.textContent;


        button.textContent =
          'コピーしました';


        setTimeout(
          () => {

            button.textContent =
              before;
          },
          1200
        );
      }


    } catch {

      await showAlert(
        '参加コード',
        code
      );
    }
  }


  /* ==========================================================
     解散
     ========================================================== */

  async function dissolveGroup(
    group
  ) {

    const first =
      await askConfirm(
        'グループを解散',
        `${group.name} を解散します。参加者全員がグループ無しになります。個人の体重記録は残ります。`,
        true
      );


    if (
      !first
    ) {

      return;
    }


    const second =
      await askConfirm(
        '最終確認',
        'この操作は取り消せません。本当に解散しますか？',
        true
      );


    if (
      !second
    ) {

      return;
    }


    try {

      await api(
        '/api/operator/groups/' +
        encodeURIComponent(
          group.group_id
        ),
        {
          method:
            'DELETE',
        }
      );


      closeDetail();


      setMessage(
        'グループを解散しました',
        true
      );


    } catch (e) {

      await showAlert(
        '解散できませんでした',
        emsg(e)
      );
    }
  }


  /* ==========================================================
     起動
     ========================================================== */

  async function start() {

    if (
      deleted()
    ) {

      return;
    }


    const isOperator =
      await detectOperator();


    window.MINYASE_OPERATOR =
      !!isOperator;


    window.dispatchEvent(
      new CustomEvent(
        'minyase:operator',
        {
          detail: {
            operator:
              !!isOperator,
          },
        }
      )
    );


    if (
      !isOperator
    ) {

      return;
    }


    active =
      true;


    addStyle();

    applyOperatorShell();


    if (
      !ensurePanel()
    ) {

      return;
    }


    await loadGroups();
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
