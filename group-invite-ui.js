'use strict';

/* ============================================================
   みんやせ / group-invite-ui.js

   管理者から届いたチーム参加依頼を本人が確認するUI。

   ・起動時に pending invite を取得
   ・初期値は安全側
       体重      : 非公開
       目標体重  : 非公開
       外部WEB   : 未同意
   ・「あとで確認」は pending のまま閉じる
   ・記録画面の先頭に確認カードを残す
   ・承認 / 拒否は本人APIだけから行う
   ============================================================ */

(() => {
  const API =
    (
      typeof window !== 'undefined' &&
      window.MINYASE_API_BASE
    ) || '';

  const K_DEV =
    'tsudatsu.device_id.v1';

  const IDS = {
    style:
      'groupInviteStyle',

    card:
      'groupInviteCard',

    cardName:
      'groupInviteCardName',

    cardOpen:
      'groupInviteCardOpen',

    modal:
      'groupInviteModal',

    teamName:
      'groupInviteTeamName',

    privateRadio:
      'groupInviteWeightPrivate',

    publicRadio:
      'groupInviteWeightPublic',

    privateNote:
      'groupInvitePrivateNote',

    goal:
      'groupInviteGoalPublic',

    externalWrap:
      'groupInviteExternalWrap',

    external:
      'groupInviteExternalConsent',

    accept:
      'groupInviteAccept',

    later:
      'groupInviteLater',

    decline:
      'groupInviteDecline',

    msg:
      'groupInviteMsg',
  };

  let currentInvite =
    null;

  let currentKey =
    '';

  let deferred =
    false;

  let busy =
    false;

  let retryTimer =
    null;

  let retryCount =
    0;


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
    ).trim();
  }


  function inviteKey(
    invite
  ) {
    if (!invite) {
      return '';
    }

    return [
      invite.group_id || '',
      Number(
        invite.updated_at ||
        0
      ),
    ].join(':');
  }


  function errorText(
    code
  ) {
    const map = {
      bad_device_id:
        '端末情報を確認できませんでした。',

      not_registered:
        'ユーザー情報の準備中です。',

      banned:
        '現在この機能は利用できません。',

      operator_not_allowed:
        '運営アカウントでは参加依頼を利用できません。',

      invite_not_found:
        'この参加依頼はすでに処理されています。',

      invite_changed:
        '参加依頼の内容が更新されました。参加先と設定をもう一度確認してください。',

      already_in_group:
        'すでにチームへ参加しています。',

      banned_from_group:
        'このチームには参加できません。',

      group_not_found:
        '参加先のチームが見つかりません。',

      group_full:
        'このチームは参加人数の上限に達しています。',

      rate_limited:
        '操作が続いています。少し時間をおいてもう一度お試しください。',

      group_invite_unavailable:
        '参加依頼機能を現在利用できません。',

      network_error:
        '通信できませんでした。通信状態を確認してください。',

      server_error:
        'サーバーエラーが発生しました。',
    };

    return (
      map[code] ||
      '処理できませんでした。もう一度お試しください。'
    );
  }


  async function request(
    path,
    method = 'GET',
    body = undefined
  ) {
    const id =
      deviceId();

    if (!id) {
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
            method,

            headers: {
              'x-device-id':
                id,

              ...(
                body !==
                undefined
                  ? {
                      'content-type':
                        'application/json',
                    }
                  : {}
              ),
            },

            body:
              body !==
              undefined
                ? JSON.stringify(
                    body
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
      data.ok === false
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


  function ensureStyle() {
    if (
      $(
        IDS.style
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        'style'
      );

    style.id =
      IDS.style;

    style.textContent = `
      body.group-invite-modal-open{
        overflow:hidden;
      }

      #${IDS.card}{
        border:
          1px solid
          rgba(239,88,196,.24);

        background:
          linear-gradient(
            145deg,
            #fffdf8 0%,
            #fff5fb 100%
          );
      }

      #${IDS.card}
      .group-invite-card-title{
        margin:0;
        color:var(--ink,#181614);
        font-size:17px;
        font-weight:900;
        line-height:1.45;
      }

      #${IDS.card}
      .group-invite-card-copy{
        margin:
          7px
          0
          13px;

        color:
          var(
            --sub,
            #7e756d
          );

        font-size:12px;
        font-weight:700;
        line-height:1.7;
      }

      #${IDS.cardOpen}{
        width:100%;
      }

      #${IDS.modal}{
        position:fixed;
        inset:0;
        z-index:10050;

        display:flex;
        align-items:center;
        justify-content:center;

        padding:
          max(
            18px,
            env(
              safe-area-inset-top
            )
          )
          16px
          max(
            18px,
            env(
              safe-area-inset-bottom
            )
          );

        background:
          rgba(
            24,
            18,
            22,
            .48
          );

        overscroll-behavior:
          contain;
      }

      #${IDS.modal}[hidden]{
        display:
          none !important;
      }

      #${IDS.modal}
      .group-invite-dialog{
        width:
          min(
            100%,
            520px
          );

        max-height:
          calc(
            100vh -
            36px
          );

        max-height:
          calc(
            100dvh -
            36px
          );

        overflow:auto;

        -webkit-overflow-scrolling:
          touch;

        border-radius:
          22px;

        background:
          #fff;

        box-shadow:
          0
          18px
          60px
          rgba(
            0,
            0,
            0,
            .24
          );

        padding:
          20px
          18px
          18px;
      }

      #${IDS.modal}
      .group-invite-title{
        margin:0;

        color:
          var(
            --ink,
            #181614
          );

        font-size:20px;
        font-weight:900;
        line-height:1.45;
      }

      #${IDS.modal}
      .group-invite-copy{
        margin:
          8px
          0
          18px;

        color:
          var(
            --sub,
            #7e756d
          );

        font-size:13px;
        font-weight:700;
        line-height:1.7;
      }

      #${IDS.modal}
      .group-invite-setting{
        margin:
          0
          0
          14px;

        padding:0;
        border:0;
      }

      #${IDS.modal}
      .group-invite-label{
        display:block;

        margin:
          0
          0
          7px;

        color:
          var(
            --ink,
            #181614
          );

        font-size:13px;
        font-weight:900;
      }

      #${IDS.modal}
      .group-invite-choice{
        display:flex;
        align-items:flex-start;
        gap:9px;

        margin:
          8px
          0;

        color:
          var(
            --ink,
            #181614
          );

        font-size:14px;
        font-weight:700;
        line-height:1.5;
      }

      #${IDS.modal}
      .group-invite-choice
      input{
        flex:
          0
          0
          auto;

        width:18px;
        height:18px;

        margin:
          1px
          0
          0;
      }

      #${IDS.modal}
      .group-invite-note{
        margin:
          5px
          0
          0
          27px;

        color:
          var(
            --sub,
            #7e756d
          );

        font-size:11px;
        line-height:1.6;
      }

      #${IDS.modal}
      .group-invite-actions{
        display:grid;
        gap:9px;

        margin-top:
          18px;
      }

      #${IDS.modal}
      .group-invite-actions
      button{
        width:100%;
        min-height:46px;
      }

      #${IDS.modal}
      .group-invite-decline{
        border:0;
        background:transparent;

        color:
          #8a7f86;

        font:inherit;
        font-size:13px;
        font-weight:800;
      }

      #${IDS.msg}{
        min-height:0;

        margin:
          10px
          0
          0;

        color:
          #b42318;

        font-size:12px;
        font-weight:800;
        line-height:1.6;
      }
    `;

    document.head.appendChild(
      style
    );
  }


  function ensureCard() {
    let card =
      $(
        IDS.card
      );

    if (card) {
      return card;
    }

    const view =
      $(
        'view-log'
      );

    if (!view) {
      return null;
    }

    card =
      document.createElement(
        'section'
      );

    card.className =
      'card';

    card.id =
      IDS.card;

    card.hidden =
      true;

    card.innerHTML = `
      <h2
        class="group-invite-card-title"
      >
        チーム参加の確認があります
      </h2>

      <p
        class="group-invite-card-copy"
      >
        <span
          id="${IDS.cardName}"
        >チーム</span>から参加依頼が届いています。
      </p>

      <button
        class="primary sm"
        id="${IDS.cardOpen}"
        type="button"
      >
        確認する
      </button>
    `;

    view.insertBefore(
      card,
      view.firstChild
    );

    $(
      IDS.cardOpen
    )?.addEventListener(
      'click',
      () => {
        if (
          currentInvite
        ) {
          openModal();
        }
      }
    );

    return card;
  }


  function ensureModal() {
    let modal =
      $(
        IDS.modal
      );

    if (modal) {
      return modal;
    }

    modal =
      document.createElement(
        'div'
      );

    modal.id =
      IDS.modal;

    modal.hidden =
      true;

    modal.setAttribute(
      'role',
      'dialog'
    );

    modal.setAttribute(
      'aria-modal',
      'true'
    );

    modal.setAttribute(
      'aria-labelledby',
      'groupInviteDialogTitle'
    );

    modal.innerHTML = `
      <div
        class="group-invite-dialog"
      >
        <h2
          class="group-invite-title"
          id="groupInviteDialogTitle"
        >
          チームへの参加依頼があります
        </h2>

        <p
          class="group-invite-copy"
        >
          「<strong
            id="${IDS.teamName}"
          >チーム</strong>」への参加依頼が届いています。
        </p>

        <fieldset
          class="group-invite-setting"
        >
          <legend
            class="group-invite-label"
          >
            体重の公開
          </legend>

          <label
            class="group-invite-choice"
          >
            <input
              id="${IDS.privateRadio}"
              type="radio"
              name="groupInviteWeight"
              value="private"
            >

            <span>
              非公開（増減量のみ）
            </span>
          </label>

          <label
            class="group-invite-choice"
          >
            <input
              id="${IDS.publicRadio}"
              type="radio"
              name="groupInviteWeight"
              value="public"
            >

            <span>
              公開（体重＋増減量）
            </span>
          </label>

          <p
            class="group-invite-note"
            id="${IDS.privateNote}"
            hidden
          >
            このチームでは実体重は公開されません。
          </p>
        </fieldset>

        <div
          class="group-invite-setting"
        >
          <span
            class="group-invite-label"
          >
            目標体重
          </span>

          <label
            class="group-invite-choice"
          >
            <input
              id="${IDS.goal}"
              type="checkbox"
            >

            <span>
              チームメイトに公開する
            </span>
          </label>
        </div>

        <div
          class="group-invite-setting"
          id="${IDS.externalWrap}"
          hidden
        >
          <span
            class="group-invite-label"
          >
            外部WEBランキング
          </span>

          <label
            class="group-invite-choice"
          >
            <input
              id="${IDS.external}"
              type="checkbox"
            >

            <span>
              体重データの連携に同意する
            </span>
          </label>
        </div>

        <div
          class="group-invite-actions"
        >
          <button
            class="primary"
            id="${IDS.accept}"
            type="button"
          >
            同意して参加する
          </button>

          <button
            class="ghost"
            id="${IDS.later}"
            type="button"
          >
            あとで確認
          </button>

          <button
            class="group-invite-decline"
            id="${IDS.decline}"
            type="button"
          >
            参加しない
          </button>
        </div>

        <p
          id="${IDS.msg}"
          role="status"
          aria-live="polite"
        ></p>
      </div>
    `;

    document.body.appendChild(
      modal
    );

    $(
      IDS.accept
    )?.addEventListener(
      'click',
      acceptCurrentInvite
    );

    $(
      IDS.later
    )?.addEventListener(
      'click',
      () => {
        if (
          busy
        ) {
          return;
        }

        deferred =
          true;

        closeModal();
      }
    );

    $(
      IDS.decline
    )?.addEventListener(
      'click',
      declineCurrentInvite
    );

    return modal;
  }


  function setMessage(
    text = ''
  ) {
    const el =
      $(
        IDS.msg
      );

    if (el) {
      el.textContent =
        text;
    }
  }


  function setBusy(
    value
  ) {
    busy =
      !!value;

    [
      IDS.accept,
      IDS.later,
      IDS.decline,
      IDS.privateRadio,
      IDS.publicRadio,
      IDS.goal,
      IDS.external,
    ].forEach(
      id => {
        const el =
          $(
            id
          );

        if (el) {
          el.disabled =
            busy;
        }
      }
    );

    const publicRadio =
      $(
        IDS.publicRadio
      );

    if (
      publicRadio &&
      currentInvite &&
      !currentInvite.show_weight
    ) {
      publicRadio.disabled =
        true;
    }
  }


  function clearUi() {
    currentInvite =
      null;

    currentKey =
      '';

    deferred =
      false;

    busy =
      false;

    const card =
      $(
        IDS.card
      );

    if (card) {
      card.hidden =
        true;
    }

    closeModal();
  }


  function applyInvite(
    invite,
    resetChoices
  ) {
    currentInvite =
      invite;

    const teamName =
      String(
        invite.group_name ||
        'チーム'
      );

    const card =
      ensureCard();

    ensureModal();

    if (card) {
      card.hidden =
        false;
    }

    if (
      $(
        IDS.cardName
      )
    ) {
      $(
        IDS.cardName
      ).textContent =
        teamName;
    }

    if (
      $(
        IDS.teamName
      )
    ) {
      $(
        IDS.teamName
      ).textContent =
        teamName;
    }

    const canShowWeight =
      invite.show_weight ===
        true;

    const publicRadio =
      $(
        IDS.publicRadio
      );

    const privateNote =
      $(
        IDS.privateNote
      );

    if (
      publicRadio
    ) {
      publicRadio.disabled =
        !canShowWeight;
    }

    if (
      privateNote
    ) {
      privateNote.hidden =
        canShowWeight;
    }

    const externalWrap =
      $(
        IDS.externalWrap
      );

    if (
      externalWrap
    ) {
      externalWrap.hidden =
        invite.external_enabled !==
          true;
    }

    if (
      resetChoices
    ) {
      const privateRadio =
        $(
          IDS.privateRadio
        );

      const goal =
        $(
          IDS.goal
        );

      const external =
        $(
          IDS.external
        );

      if (
        privateRadio
      ) {
        privateRadio.checked =
          true;
      }

      if (
        publicRadio
      ) {
        publicRadio.checked =
          false;
      }

      if (
        goal
      ) {
        goal.checked =
          false;
      }

      if (
        external
      ) {
        external.checked =
          false;
      }

      setMessage('');
    }
  }


  function openModal() {
    if (
      !currentInvite ||
      busy
    ) {
      return;
    }

    ensureModal();

    /*
     * モーダルを開くたびに安全側へ戻す。
     *
     * 「あとで確認」で一度閉じたあと、
     * 前回選択した公開設定が残ったまま
     * 次の確認へ持ち越されないようにする。
     */
    const privateRadio =
      $(
        IDS.privateRadio
      );

    const publicRadio =
      $(
        IDS.publicRadio
      );

    const goal =
      $(
        IDS.goal
      );

    const external =
      $(
        IDS.external
      );

    if (
      privateRadio
    ) {
      privateRadio.checked =
        true;
    }

    if (
      publicRadio
    ) {
      publicRadio.checked =
        false;
    }

    if (
      goal
    ) {
      goal.checked =
        false;
    }

    if (
      external
    ) {
      external.checked =
        false;
    }

    setMessage('');

    const modal =
      $(
        IDS.modal
      );

    if (!modal) {
      return;
    }

    modal.hidden =
      false;

    document.body.classList.add(
      'group-invite-modal-open'
    );

    requestAnimationFrame(
      () => {
        $(
          IDS.accept
        )?.focus();
      }
    );
  }


  function closeModal() {
    const modal =
      $(
        IDS.modal
      );

    if (
      modal
    ) {
      modal.hidden =
        true;
    }

    document.body.classList.remove(
      'group-invite-modal-open'
    );
  }


  async function refreshAfterInviteStateError(
    code
  ) {
    await loadInvite({
      initial:
        false,

      forceOpen:
        false,
    }).catch(
      () => {}
    );

    /*
     * invite_changed の場合は、
     * loadInvite() が新しい招待内容へ差し替えて
     * 公開設定も安全側へ戻したあとに、
     * 警告文を改めて表示する。
     *
     * applyInvite() / openModal() 内の
     * setMessage('') で警告が消える問題を防ぐ。
     */
    if (
      code ===
        'invite_changed' &&
      currentInvite
    ) {
      setMessage(
        errorText(
          code
        )
      );
    }
  }


  async function acceptCurrentInvite() {
    if (
      !currentInvite ||
      busy
    ) {
      return;
    }

    setBusy(
      true
    );

    setMessage('');

    try {
      const publicRadio =
        $(
          IDS.publicRadio
        );

      const goal =
        $(
          IDS.goal
        );

      const external =
        $(
          IDS.external
        );

      const weightHidden =
        !(
          currentInvite.show_weight ===
            true &&
          publicRadio &&
          publicRadio.checked
        );

      const goalPublic =
        !!(
          goal &&
          goal.checked
        );

      const externalConsent =
        !!(
          currentInvite.external_enabled ===
            true &&
          external &&
          external.checked
        );

      await request(
        '/api/group-invite/accept',
        'POST',
        {
          group_id:
            currentInvite.group_id,

          weight_hidden:
            weightHidden,

          goal_public:
            goalPublic,

          external_consent:
            externalConsent,
        }
      );

      window.location.reload();

    } catch (
      error
    ) {
      const code =
        error &&
        error.message
          ? error.message
          : 'unknown_error';

      setMessage(
        errorText(
          code
        )
      );

      if (
        code ===
          'invite_not_found' ||
        code ===
          'invite_changed' ||
        code ===
          'already_in_group'
      ) {
        await refreshAfterInviteStateError(
          code
        );
      }

    } finally {
      setBusy(
        false
      );
    }
  }


  async function declineCurrentInvite() {
    if (
      !currentInvite ||
      busy
    ) {
      return;
    }

    const teamName =
      String(
        currentInvite.group_name ||
        'このチーム'
      );

    if (
      !window.confirm(
        `「${teamName}」への参加依頼を断りますか？`
      )
    ) {
      return;
    }

    setBusy(
      true
    );

    setMessage('');

    try {
      await request(
        '/api/group-invite/decline',
        'POST',
        {
          group_id:
            currentInvite.group_id,
        }
      );

      clearUi();

    } catch (
      error
    ) {
      const code =
        error &&
        error.message
          ? error.message
          : 'unknown_error';

      setMessage(
        errorText(
          code
        )
      );

      if (
        code ===
          'invite_not_found' ||
        code ===
          'invite_changed' ||
        code ===
          'already_in_group'
      ) {
        await refreshAfterInviteStateError(
          code
        );
      }

    } finally {
      setBusy(
        false
      );
    }
  }


  async function loadInvite({
    initial =
      false,

    forceOpen =
      false,
  } = {}) {
    const data =
      await request(
        '/api/group-invite'
      );

    if (
      !data.invite
    ) {
      clearUi();
      return;
    }

    const nextKey =
      inviteKey(
        data.invite
      );

    const changed =
      nextKey !==
      currentKey;

    if (
      changed
    ) {
      currentKey =
        nextKey;

      deferred =
        false;
    }

    applyInvite(
      data.invite,
      (
        changed ||
        !currentInvite
      )
    );

    if (
      forceOpen ||
      (
        !deferred &&
        (
          initial ||
          changed
        )
      )
    ) {
      openModal();
    }
  }


  function scheduleInitialLoad() {
    clearTimeout(
      retryTimer
    );

    retryTimer =
      setTimeout(
        async () => {
          if (
            !deviceId()
          ) {
            retryCount +=
              1;

            if (
              retryCount <
              40
            ) {
              scheduleInitialLoad();
            }

            return;
          }

          try {
            await loadInvite({
              initial:
                true,
            });

          } catch (
            error
          ) {
            const code =
              error &&
              error.message
                ? error.message
                : 'unknown_error';

            if (
              code ===
                'not_registered' &&
              retryCount <
                40
            ) {
              retryCount +=
                1;

              scheduleInitialLoad();
            }
          }
        },
        250
      );
  }


  function refreshOnResume() {
    if (
      busy ||
      !deviceId()
    ) {
      return;
    }

    loadInvite({
      initial:
        false,

      forceOpen:
        false,
    }).catch(
      () => {}
    );
  }


  function start() {
    ensureStyle();
    ensureCard();
    ensureModal();

    scheduleInitialLoad();

    window.addEventListener(
      'focus',
      refreshOnResume
    );

    document.addEventListener(
      'visibilitychange',
      () => {
        if (
          document.visibilityState ===
            'visible'
        ) {
          refreshOnResume();
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
