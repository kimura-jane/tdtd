'use strict';

/* ============================================================
   みんやせ / admin-privacy.js
   2026-09-07

   既存 admin.html に追加する管理補助。

   ・グループ行クリック → そのグループのユーザー一覧
   ・ユーザー詳細 → 体重公開 / シークレット固定
   ・ユーザー詳細 → 公開プロフィール画像の削除
   ・審査・安全タブ
      - 未対応通報件数
      - プロフィール画像の承認待ち一覧
      - 画像のプレビュー / 承認 / 却下
      - 外部WEB連携グループ ON / OFF
      - 削除再試行 / 外部送信キューの状態

   重要：
   ・本人が「非公開（増減量のみ）」を選んだ場合、
     オーナー / リーダーから解除不可。
   ・管理画面からシークレットにすると管理者固定。
   ・管理者は本人設定も含めて解除可能。
   ============================================================ */

(function () {

  'use strict';


  const groupTable =
    document.getElementById(
      'gTbl'
    );


  const userModal =
    document.getElementById(
      'userModal'
    );


  const detailBody =
    document.getElementById(
      'uDetailBody'
    );


  const detailId =
    document.getElementById(
      'uDetailId'
    );


  const adminNav =
    document.getElementById(
      'adminNav'
    );


  if (
    !groupTable ||
    !userModal ||
    !detailBody ||
    !detailId ||
    !adminNav
  ) {

    console.error(
      'admin_privacy_required_element_missing'
    );

    return;
  }


  const privacyState =
    new Map();


  const externalGroupState =
    new Map();


  let loadingMemberId =
    null;


  let safetyLoading =
    false;


  let externalStateLoading =
    false;


  /* ============================================================
     共通
     ============================================================ */

  function errorText(
    error
  ) {

    try {

      if (
        typeof emsg ===
          'function'
      ) {

        return emsg(
          error
        );
      }

    } catch {}


    return (
      error &&
      error.message
    )
      ? String(
          error.message
        )
      : 'エラー';
  }


  function currentMemberId() {

    const value =
      String(
        detailId.textContent ||
        ''
      )
        .trim()
        .toUpperCase();


    return /^[0-9A-Z]{6,32}$/
      .test(
        value
      )
        ? value
        : null;
  }


  function jsonApi(
    path,
    method,
    body
  ) {

    return api(
      path,
      {
        method:
          method ||
          'GET',

        type:
          body ===
            undefined
            ? undefined
            : 'application/json',

        body:
          body ===
            undefined
            ? undefined
            : JSON.stringify(
                body
              ),
      }
    );
  }


  function fmtDateTime(
    ms
  ) {

    const n =
      Number(
        ms ||
        0
      );


    if (!n) {

      return '—';
    }


    try {

      return new Date(
        n
      )
        .toLocaleString(
          'ja-JP',
          {
            timeZone:
              'Asia/Tokyo',
          }
        );

    } catch {

      return String(
        ms
      );
    }
  }


  function userTabButton() {

    return document
      .querySelector(
        '#adminNav button[data-t="users"]'
      );
  }


  function reportTabButton() {

    return document
      .querySelector(
        '#adminNav button[data-t="rep"]'
      );
  }


  /* ============================================================
     グループ → ユーザー一覧
     ============================================================ */

  function openGroupMembers(
    groupId
  ) {

    const groupSelect =
      document.getElementById(
        'uGroup'
      );


    const search =
      document.getElementById(
        'uSearch'
      );


    const state =
      document.getElementById(
        'uState'
      );


    const notify =
      document.getElementById(
        'uNotify'
      );


    const quiz =
      document.getElementById(
        'uQuiz'
      );


    if (
      search
    ) {

      search.value =
        '';
    }


    if (
      state
    ) {

      state.value =
        '';
    }


    if (
      notify
    ) {

      notify.value =
        '';
    }


    if (
      quiz
    ) {

      quiz.value =
        '';
    }


    if (
      groupSelect
    ) {

      groupSelect.value =
        groupId;
    }


    const tab =
      userTabButton();


    if (
      tab
    ) {

      tab.click();
    }


    if (
      groupSelect
    ) {

      groupSelect.value =
        groupId;
    }


    try {

      if (
        typeof USERS !==
          'undefined' &&
        Array.isArray(
          USERS
        ) &&
        typeof renderUsers ===
          'function'
      ) {

        renderUsers();
      }

    } catch {}
  }


  /* ============================================================
     外部WEB連携状態
     ============================================================ */

  async function loadExternalGroupStates() {

    if (
      externalStateLoading
    ) {

      return;
    }


    externalStateLoading =
      true;


    try {

      const data =
        await api(
          '/api/admin/safety/groups'
        );


      externalGroupState
        .clear();


      for (
        const g of
        data.groups ||
        []
      ) {

        externalGroupState
          .set(
            String(
              g.group_id
            ),
            g
          );
      }


      decorateGroupRows();


    } catch {

      /*
       * ログイン前等は
       * 何もしない。
       */

    } finally {

      externalStateLoading =
        false;
    }
  }


  async function toggleExternalGroup(
    groupId,
    next
  ) {

    const item =
      externalGroupState
        .get(
          groupId
        );


    const name =
      item &&
      item.name
        ? item.name
        : groupId;


    if (
      next ===
        false
    ) {

      const ok =
        window.confirm(
          `${name} の外部WEB連携をOFFにします。\n\nこのグループで保存されている外部WEB共有同意と未送信キューも削除されます。\n再度ONにした場合は、各メンバーに改めて同意してもらいます。\n\n実行しますか？`
        );


      if (
        !ok
      ) {

        return;
      }
    }


    try {

      await jsonApi(
        '/api/admin/safety/groups/' +
        encodeURIComponent(
          groupId
        ) +
        '/external',
        'POST',
        {
          enabled:
            !!next,
        }
      );


      await loadExternalGroupStates();


      const safetyPanel =
        document.getElementById(
          'p-safety'
        );


      if (
        safetyPanel &&
        !safetyPanel.hidden
      ) {

        await loadSafety();
      }


    } catch (
      error
    ) {

      window.alert(
        errorText(
          error
        )
      );
    }
  }


  /* ============================================================
     グループ一覧装飾
     ============================================================ */

  function decorateGroupRows() {

    let groups =
      [];


    try {

      if (
        typeof GROUPS !==
          'undefined' &&
        Array.isArray(
          GROUPS
        )
      ) {

        groups =
          GROUPS;
      }

    } catch {}


    if (
      !groups.length
    ) {

      return;
    }


    const allRows =
      [
        ...groupTable
          .querySelectorAll(
            'tr'
          )
      ];


    if (
      !allRows.length
    ) {

      return;
    }


    const head =
      allRows[
        0
      ];


    if (
      !head.querySelector(
        'th[data-external-head]'
      )
    ) {

      const th =
        document.createElement(
          'th'
        );


      th.dataset.externalHead =
        '1';


      th.textContent =
        '外部WEB';


      head.appendChild(
        th
      );
    }


    const rows =
      allRows.slice(
        1
      );


    rows.forEach(
      (
        tr,
        index
      ) => {

        const group =
          groups[
            index
          ];


        if (
          !group ||
          !group.id
        ) {

          return;
        }


        const gid =
          String(
            group.id
          );


        tr.dataset.groupId =
          gid;


        tr.tabIndex =
          0;


        tr.setAttribute(
          'role',
          'button'
        );


        tr.setAttribute(
          'aria-label',
          (
            group.name ||
            gid
          ) +
          ' のメンバーを表示'
        );


        tr.style.cursor =
          'pointer';


        tr.title =
          'タップしてメンバーを見る';


        let td =
          tr.querySelector(
            'td[data-external-cell]'
          );


        if (
          !td
        ) {

          td =
            document.createElement(
              'td'
            );


          td.dataset.externalCell =
            '1';


          tr.appendChild(
            td
          );
        }


        const ext =
          externalGroupState
            .get(
              gid
            );


        const stateKey =
          ext
            ? (
                ext.external_enabled
                  ? (
                      'on:' +
                      String(
                        ext.consented ||
                        0
                      ) +
                      ':' +
                      String(
                        ext.members ||
                        0
                      )
                    )
                  : 'off'
              )
            : 'loading';


        if (
          td.dataset.externalState ===
            stateKey &&
          td.firstElementChild
        ) {

          return;
        }


        td.dataset.externalState =
          stateKey;


        td.innerHTML =
          '';


        const button =
          document.createElement(
            'button'
          );


        button.type =
          'button';


        button.style.whiteSpace =
          'nowrap';


        if (
          !ext
        ) {

          button.textContent =
            '確認…';


          button.disabled =
            true;


        } else {

          button.textContent =
            ext.external_enabled
              ? 'ON'
              : 'OFF';


          button.className =
            ext.external_enabled
              ? 'pri'
              : '';


          button.title =
            ext.external_enabled
              ? (
                  `同意済み ${ext.consented}/${ext.members}人`
                )
              : '外部WEB連携なし';


          button.addEventListener(
            'click',
            async event => {

              event.preventDefault();


              event.stopPropagation();


              await toggleExternalGroup(
                gid,
                !ext.external_enabled
              );
            }
          );
        }


        td.appendChild(
          button
        );
      }
    );
  }


  const groupObserver =
    new MutationObserver(
      () => {

        decorateGroupRows();
      }
    );


  groupObserver.observe(
    groupTable,
    {
      childList:
        true,

      subtree:
        true,
    }
  );


  groupTable.addEventListener(
    'click',
    event => {

      const tr =
        event.target
          .closest(
            'tr[data-group-id]'
          );


      if (
        !tr ||
        !groupTable.contains(
          tr
        )
      ) {

        return;
      }


      if (
        event.target
          .closest(
            'button,a,input,select,textarea'
          )
      ) {

        return;
      }


      openGroupMembers(
        tr.dataset.groupId
      );
    }
  );


  groupTable.addEventListener(
    'keydown',
    event => {

      if (
        event.key !==
          'Enter' &&
        event.key !==
          ' '
      ) {

        return;
      }


      const tr =
        event.target
          .closest(
            'tr[data-group-id]'
          );


      if (
        !tr
      ) {

        return;
      }


      event.preventDefault();


      openGroupMembers(
        tr.dataset.groupId
      );
    }
  );


  /* ============================================================
     体重公開設定カード
     ============================================================ */

  function ensurePrivacyCard() {

    let card =
      document.getElementById(
        'uPrivacyCard'
      );


    if (
      card
    ) {

      return card;
    }


    card =
      document.createElement(
        'div'
      );


    card.id =
      'uPrivacyCard';


    card.className =
      'detail-card';


    card.innerHTML =
      `
        <h3>
          体重の公開設定
        </h3>

        <div
          class="stat-line"
          id="uPrivacyStatus"
        ></div>

        <div class="detail-actions">

          <button
            id="btnWeightSecret"
            type="button"
            disabled
          >
            読み込み中…
          </button>

        </div>

        <div
          class="msg"
          id="uPrivacyMsg"
        ></div>

        <div class="small-note">
          管理画面から「シークレット固定」にすると、
          本人・オーナー・リーダーは解除できません。
          公開ランキングや外部連携では実体重を出さず、
          増減量だけを表示します。
          管理画面では体重履歴を確認できます。
        </div>
      `;


    const weightTable =
      document.getElementById(
        'uWeightSummaryTbl'
      );


    const weightCard =
      weightTable
        ? weightTable.closest(
            '.detail-card'
          )
        : null;


    if (
      weightCard
    ) {

      weightCard.insertAdjacentElement(
        'afterend',
        card
      );

    } else {

      detailBody.appendChild(
        card
      );
    }


    const button =
      card.querySelector(
        '#btnWeightSecret'
      );


    if (
      button
    ) {

      button.addEventListener(
        'click',
        changePrivacy
      );
    }


    return card;
  }


  function renderPrivacy(
    memberId,
    state
  ) {

    ensurePrivacyCard();


    privacyState.set(
      memberId,
      state
    );


    const status =
      document.getElementById(
        'uPrivacyStatus'
      );


    const button =
      document.getElementById(
        'btnWeightSecret'
      );


    const hidden =
      !!state.weight_hidden;


    const locked =
      !!state.weight_locked;


    const kind =
      state.weight_lock_kind ||
      null;


    if (
      status
    ) {

      status.innerHTML =
        '';


      const tag =
        document.createElement(
          'span'
        );


      tag.className =
        hidden
          ? 'tag pv'
          : 'tag';


      if (
        locked &&
        kind ===
          'admin'
      ) {

        tag.textContent =
          'シークレット固定';


      } else if (
        locked &&
        kind ===
          'self'
      ) {

        tag.textContent =
          '本人設定：非公開';


      } else if (
        hidden
      ) {

        tag.textContent =
          '体重非表示';


      } else {

        tag.textContent =
          '体重公開';
      }


      status.appendChild(
        tag
      );


      const text =
        document.createElement(
          'span'
        );


      text.className =
        'mut';


      if (
        locked &&
        kind ===
          'admin'
      ) {

        text.textContent =
          '管理者固定・実体重非表示';


      } else if (
        locked &&
        kind ===
          'self'
      ) {

        text.textContent =
          '本人が非公開を選択・増減量のみ';


      } else if (
        hidden
      ) {

        text.textContent =
          '実体重非表示・増減量のみ';


      } else {

        text.textContent =
          'グループ設定に従って実体重を表示';
      }


      status.appendChild(
        text
      );
    }


    if (
      button
    ) {

      button.disabled =
        false;


      if (
        locked &&
        kind ===
          'admin'
      ) {

        button.textContent =
          'シークレット固定を解除';


        button.className =
          '';


      } else if (
        hidden
      ) {

        button.textContent =
          '公開に戻す';


        button.className =
          '';


      } else {

        button.textContent =
          'シークレット固定にする';


        button.className =
          'pri';
      }
    }
  }


  async function loadPrivacy(
    memberId
  ) {

    if (
      !memberId ||
      loadingMemberId ===
        memberId
    ) {

      return;
    }


    ensurePrivacyCard();


    loadingMemberId =
      memberId;


    const status =
      document.getElementById(
        'uPrivacyStatus'
      );


    const button =
      document.getElementById(
        'btnWeightSecret'
      );


    const msg =
      document.getElementById(
        'uPrivacyMsg'
      );


    if (
      status
    ) {

      status.innerHTML =
        '<span class="mut">読み込み中…</span>';
    }


    if (
      button
    ) {

      button.disabled =
        true;


      button.textContent =
        '読み込み中…';
    }


    if (
      msg
    ) {

      msg.textContent =
        '';


      msg.className =
        'msg';
    }


    try {

      const data =
        await api(
          '/api/admin/weight-privacy/' +
          encodeURIComponent(
            memberId
          )
        );


      if (
        currentMemberId() !==
          memberId
      ) {

        return;
      }


      const member =
        data &&
        data.member
          ? data.member
          : {};


      renderPrivacy(
        memberId,
        {
          weight_hidden:
            !!member.weight_hidden,

          weight_locked:
            !!member.weight_locked,

          weight_lock_kind:
            member.weight_lock_kind ||
            null,
        }
      );


    } catch (
      error
    ) {

      if (
        currentMemberId() !==
          memberId
      ) {

        return;
      }


      if (
        status
      ) {

        status.innerHTML =
          '<span class="result-bad">取得できません</span>';
      }


      if (
        button
      ) {

        button.disabled =
          true;


        button.textContent =
          '取得できません';
      }


      if (
        msg
      ) {

        msg.textContent =
          errorText(
            error
          );


        msg.className =
          'msg ng';
      }


    } finally {

      if (
        loadingMemberId ===
          memberId
      ) {

        loadingMemberId =
          null;
      }
    }
  }


  async function changePrivacy() {

    const memberId =
      currentMemberId();


    if (
      !memberId
    ) {

      return;
    }


    const state =
      privacyState.get(
        memberId
      );


    if (
      !state
    ) {

      await loadPrivacy(
        memberId
      );


      return;
    }


    const currentHidden =
      !!state.weight_hidden;


    const next =
      !currentHidden;


    let message;


    if (
      next
    ) {

      message =
        'このユーザーを管理者シークレット固定にします。\n\n実体重は公開ランキング・外部連携に出なくなり、増減量のみ表示されます。\n本人・オーナー・リーダーは解除できません。\n\n実行しますか？';


    } else if (
      state.weight_lock_kind ===
        'self'
    ) {

      message =
        'このユーザー本人が選択した「非公開（増減量のみ）」を管理者権限で解除し、公開設定に戻します。\n\n実行しますか？';


    } else {

      message =
        'このユーザーのシークレット設定を解除し、公開設定に戻します。\n\n実行しますか？';
    }


    if (
      !window.confirm(
        message
      )
    ) {

      return;
    }


    const button =
      document.getElementById(
        'btnWeightSecret'
      );


    const msg =
      document.getElementById(
        'uPrivacyMsg'
      );


    if (
      button
    ) {

      button.disabled =
        true;
    }


    if (
      msg
    ) {

      msg.textContent =
        '保存中…';


      msg.className =
        'msg';
    }


    try {

      const data =
        await jsonApi(
          '/api/admin/weight-privacy/' +
          encodeURIComponent(
            memberId
          ),
          'POST',
          {
            hidden:
              next,
          }
        );


      if (
        currentMemberId() !==
          memberId
      ) {

        return;
      }


      const member =
        data &&
        data.member
          ? data.member
          : {};


      renderPrivacy(
        memberId,
        {
          weight_hidden:
            !!member.weight_hidden,

          weight_locked:
            !!member.weight_locked,

          weight_lock_kind:
            member.weight_lock_kind ||
            null,
        }
      );


      if (
        msg
      ) {

        msg.textContent =
          next
            ? 'シークレット固定にしました'
            : '公開設定に戻しました';


        msg.className =
          'msg ok';
      }


    } catch (
      error
    ) {

      if (
        msg
      ) {

        msg.textContent =
          errorText(
            error
          );


        msg.className =
          'msg ng';
      }


      await loadPrivacy(
        memberId
      );
    }
  }


  /* ============================================================
     ユーザー詳細：公開プロフィール画像削除
     ============================================================ */

  function ensureIconSafetyCard() {

    let card =
      document.getElementById(
        'uIconSafetyCard'
      );


    if (
      card
    ) {

      return card;
    }


    card =
      document.createElement(
        'div'
      );


    card.id =
      'uIconSafetyCard';


    card.className =
      'detail-card';


    card.innerHTML =
      `
        <h3>
          プロフィール画像の管理
        </h3>

        <div class="detail-actions">

          <button
            id="btnAdminDeleteIcon"
            type="button"
          >
            公開中の画像を削除
          </button>

        </div>

        <div
          class="msg"
          id="uIconSafetyMsg"
        ></div>

        <div class="small-note">
          新しいプロフィール画像は承認されるまで公開されません。
          承認待ち画像の確認・承認・却下は
          「審査・安全」タブから行います。
        </div>
      `;


    const privacy =
      ensurePrivacyCard();


    privacy.insertAdjacentElement(
      'afterend',
      card
    );


    const button =
      card.querySelector(
        '#btnAdminDeleteIcon'
      );


    if (
      button
    ) {

      button.addEventListener(
        'click',
        deleteCurrentUserIcon
      );
    }


    return card;
  }


  async function deleteCurrentUserIcon() {

    const memberId =
      currentMemberId();


    if (
      !memberId
    ) {

      return;
    }


    const ok =
      window.confirm(
        '現在公開されているプロフィール画像と承認待ち画像を削除します。\n\n実行しますか？'
      );


    if (
      !ok
    ) {

      return;
    }


    const msg =
      document.getElementById(
        'uIconSafetyMsg'
      );


    if (
      msg
    ) {

      msg.textContent =
        '削除中…';


      msg.className =
        'msg';
    }


    try {

      await api(
        '/api/admin/safety/icon/' +
        encodeURIComponent(
          memberId
        ),
        {
          method:
            'DELETE',
        }
      );


      if (
        msg
      ) {

        msg.textContent =
          'プロフィール画像を削除しました';


        msg.className =
          'msg ok';
      }


      await loadSafety();


    } catch (
      error
    ) {

      if (
        msg
      ) {

        msg.textContent =
          errorText(
            error
          );


        msg.className =
          'msg ng';
      }
    }
  }


  /* ============================================================
     ユーザー詳細監視
     ============================================================ */

  function refreshCurrentUserExtras() {

    const memberId =
      currentMemberId();


    if (
      !memberId
    ) {

      return;
    }


    ensurePrivacyCard();


    ensureIconSafetyCard();


    loadPrivacy(
      memberId
    );
  }


  const detailObserver =
    new MutationObserver(
      () => {

        refreshCurrentUserExtras();
      }
    );


  detailObserver.observe(
    detailId,
    {
      childList:
        true,

      subtree:
        true,

      characterData:
        true,
    }
  );


  const modalObserver =
    new MutationObserver(
      () => {

        if (
          !userModal.hidden
        ) {

          refreshCurrentUserExtras();
        }
      }
    );


  modalObserver.observe(
    userModal,
    {
      attributes:
        true,

      attributeFilter: [
        'hidden'
      ],
    }
  );


  /* ============================================================
     審査・安全タブ UI
     ============================================================ */

  function ensureSafetyCss() {

    if (
      document.getElementById(
        'adminSafetyCss'
      )
    ) {

      return;
    }


    const style =
      document.createElement(
        'style'
      );


    style.id =
      'adminSafetyCss';


    style.textContent =
      `
        .safety-grid{
          display:grid;
          grid-template-columns:repeat(4,minmax(0,1fr));
          gap:8px;
          margin:10px 0 16px;
        }

        .safety-stat{
          border:1px solid var(--line);
          border-radius:9px;
          padding:10px;
          background:#fcfaf7;
        }

        .safety-stat b{
          display:block;
          font-size:22px;
        }

        .safety-stat span{
          color:var(--mut);
          font-size:11px;
        }

        .safety-sub{
          margin:18px 0 8px;
          padding-top:12px;
          border-top:1px solid var(--line);
        }

        .safety-actions{
          display:flex;
          gap:5px;
          flex-wrap:wrap;
        }

        .safety-preview{
          position:fixed;
          inset:0;
          z-index:9999;
          display:flex;
          align-items:center;
          justify-content:center;
          padding:20px;
          background:rgba(0,0,0,.72);
        }

        .safety-preview[hidden]{
          display:none;
        }

        .safety-preview-card{
          width:min(92vw,440px);
          padding:16px;
          border-radius:12px;
          background:#fff;
        }

        .safety-preview-card img{
          display:block;
          width:min(100%,360px);
          aspect-ratio:1/1;
          object-fit:cover;
          margin:0 auto 12px;
          border-radius:12px;
          background:#eee;
        }

        @media(max-width:700px){

          .safety-grid{
            grid-template-columns:repeat(2,minmax(0,1fr));
          }
        }
      `;


    document.head
      .appendChild(
        style
      );
  }


  function ensureSafetyPanel() {

    ensureSafetyCss();


    let navButton =
      document.getElementById(
        'navSafety'
      );


    if (
      !navButton
    ) {

      navButton =
        document.createElement(
          'button'
        );


      navButton.id =
        'navSafety';


      navButton.type =
        'button';


      navButton.dataset.t =
        'safety';


      navButton.textContent =
        '審査・安全';


      adminNav.appendChild(
        navButton
      );


      navButton.addEventListener(
        'click',
        event => {

          event.preventDefault();


          showSafetyPanel();
        }
      );
    }


    let panel =
      document.getElementById(
        'p-safety'
      );


    if (
      !panel
    ) {

      panel =
        document.createElement(
          'section'
        );


      panel.id =
        'p-safety';


      panel.className =
        'panel';


      panel.hidden =
        true;


      panel.innerHTML =
        `
          <h2>
            審査・安全
          </h2>

          <div class="row">

            <button
              id="btnSafetyReload"
              type="button"
            >
              最新状態を読み込む
            </button>

            <button
              id="btnOpenReports"
              type="button"
            >
              通報タブを開く
            </button>

          </div>

          <div
            class="msg"
            id="safetyMsg"
          ></div>

          <div
            class="safety-grid"
            id="safetySummary"
          ></div>

          <h3 class="safety-sub">
            プロフィール画像・承認待ち
          </h3>

          <p class="mut">
            新規・差し替え画像は、ここで承認するまで公開されません。
            既存の承認済み画像がある場合は承認まで既存画像を表示し、
            初回画像の場合はデフォルト表示のままです。
          </p>

          <table
            id="safetyIconTbl"
          ></table>

          <h3 class="safety-sub">
            外部WEB連携グループ
          </h3>

          <p class="mut">
            ONのグループだけが外部WEB連携対象です。
            さらに各メンバー本人の同意がある場合だけ送信します。
            OFFにすると保存済み同意と未送信キューを削除します。
          </p>

          <table
            id="safetyGroupTbl"
          ></table>
        `;


      const app =
        document.getElementById(
          'app'
        );


      app.appendChild(
        panel
      );


      panel
        .querySelector(
          '#btnSafetyReload'
        )
        .addEventListener(
          'click',
          loadSafety
        );


      panel
        .querySelector(
          '#btnOpenReports'
        )
        .addEventListener(
          'click',
          () => {

            const b =
              reportTabButton();


            if (
              b
            ) {

              b.click();
            }
          }
        );


      panel
        .querySelector(
          '#safetyIconTbl'
        )
        .addEventListener(
          'click',
          onSafetyIconAction
        );


      panel
        .querySelector(
          '#safetyGroupTbl'
        )
        .addEventListener(
          'click',
          onSafetyGroupAction
        );
    }


    ensurePreview();


    return panel;
  }


  function ensurePreview() {

    let ov =
      document.getElementById(
        'safetyPreview'
      );


    if (
      ov
    ) {

      return ov;
    }


    ov =
      document.createElement(
        'div'
      );


    ov.id =
      'safetyPreview';


    ov.className =
      'safety-preview';


    ov.hidden =
      true;


    ov.innerHTML =
      `
        <div class="safety-preview-card">

          <h3
            id="safetyPreviewTitle"
          >
            承認待ち画像
          </h3>

          <img
            id="safetyPreviewImg"
            alt="承認待ちプロフィール画像"
          >

          <div class="row">

            <button
              id="btnSafetyPreviewClose"
              type="button"
            >
              閉じる
            </button>

          </div>

        </div>
      `;


    document.body
      .appendChild(
        ov
      );


    ov
      .querySelector(
        '#btnSafetyPreviewClose'
      )
      .addEventListener(
        'click',
        () => {

          ov.hidden =
            true;


          document.body
            .classList
            .remove(
              'modal-open'
            );
        }
      );


    ov.addEventListener(
      'click',
      event => {

        if (
          event.target ===
            ov
        ) {

          ov.hidden =
            true;


          document.body
            .classList
            .remove(
              'modal-open'
            );
        }
      }
    );


    return ov;
  }


  function showSafetyPanel() {

    const panel =
      ensureSafetyPanel();


    for (
      const p of
      document.querySelectorAll(
        '.panel'
      )
    ) {

      p.hidden =
        p !==
        panel;
    }


    for (
      const b of
      adminNav.querySelectorAll(
        'button[data-t]'
      )
    ) {

      b.classList.toggle(
        'on',
        b.id ===
          'navSafety'
      );
    }


    panel.hidden =
      false;


    loadSafety();
  }


  adminNav.addEventListener(
    'click',
    event => {

      const button =
        event.target.closest(
          'button[data-t]'
        );


      if (
        !button ||
        button.id ===
          'navSafety'
      ) {

        return;
      }


      const panel =
        document.getElementById(
          'p-safety'
        );


      if (
        panel
      ) {

        panel.hidden =
          true;
      }


      const safety =
        document.getElementById(
          'navSafety'
        );


      if (
        safety
      ) {

        safety.classList.remove(
          'on'
        );
      }
    }
  );


  /* ============================================================
     審査・安全 読み込み
     ============================================================ */

  function renderSafetySummary(
    data
  ) {

    const box =
      document.getElementById(
        'safetySummary'
      );


    if (
      !box
    ) {

      return;
    }


    const configured =
      !!data
        .external_sender_configured;


    box.innerHTML =
      `
        <div class="safety-stat">

          <b>
            ${Number(
              data.pending_icons ||
              0
            )}
          </b>

          <span>
            承認待ち画像
          </span>

        </div>


        <div class="safety-stat">

          <b>
            ${Number(
              data.unhandled_reports ||
              0
            )}
          </b>

          <span>
            未対応通報
          </span>

        </div>


        <div class="safety-stat">

          <b>
            ${Number(
              data.cleanup_jobs ||
              0
            )}
          </b>

          <span>
            削除再試行
          </span>

        </div>


        <div class="safety-stat">

          <b>
            ${Number(
              data.external_queue ||
              0
            )}
          </b>

          <span>
            外部送信待ち
          </span>

        </div>


        <div
          class="safety-stat"
          style="grid-column:1/-1"
        >

          <b
            style="font-size:14px"
          >
            ${
              configured
                ? '外部WEB送信設定：設定済み'
                : '外部WEB送信設定：未設定'
            }
          </b>

          <span>
            ${
              configured
                ? 'URL・認証ヘッダー・認証値が設定されています。'
                : '相手から受信用API情報が来るまでは実データを送信しません。'
            }
          </span>

        </div>
      `;
  }


  function renderPendingIcons(
    items
  ) {

    const table =
      document.getElementById(
        'safetyIconTbl'
      );


    if (
      !table
    ) {

      return;
    }


    if (
      !items.length
    ) {

      table.innerHTML =
        `
          <tr>

            <th>
              状態
            </th>

          </tr>

          <tr>

            <td class="mut">
              承認待ち画像はありません。
            </td>

          </tr>
        `;


      return;
    }


    table.innerHTML =
      `
        <tr>

          <th>
            ユーザー
          </th>

          <th>
            グループ
          </th>

          <th>
            アップロード
          </th>

          <th class="n">
            容量
          </th>

          <th>
            操作
          </th>

        </tr>
      `;


    for (
      const item of
      items
    ) {

      const tr =
        document.createElement(
          'tr'
        );


      const user =
        document.createElement(
          'td'
        );


      const strong =
        document.createElement(
          'strong'
        );


      strong.textContent =
        item.nickname ||
        item.member_id;


      user.appendChild(
        strong
      );


      user.appendChild(
        document.createElement(
          'br'
        )
      );


      const mid =
        document.createElement(
          'span'
        );


      mid.className =
        'mut';


      mid.textContent =
        item.member_id;


      user.appendChild(
        mid
      );


      const group =
        document.createElement(
          'td'
        );


      group.textContent =
        item.group_name ||
        item.group_id ||
        '未所属';


      const time =
        document.createElement(
          'td'
        );


      time.textContent =
        fmtDateTime(
          item.uploaded_at
        );


      const size =
        document.createElement(
          'td'
        );


      size.className =
        'n';


      size.textContent =
        (
          Number(
            item.bytes ||
            0
          ) /
          1024
        )
          .toFixed(
            1
          ) +
        'KB';


      const action =
        document.createElement(
          'td'
        );


      const wrap =
        document.createElement(
          'div'
        );


      wrap.className =
        'safety-actions';


      for (
        const spec of
        [
          [
            'preview',
            '確認',
            ''
          ],
          [
            'approve',
            '承認',
            'pri'
          ],
          [
            'reject',
            '却下',
            ''
          ],
        ]
      ) {

        const b =
          document.createElement(
            'button'
          );


        b.type =
          'button';


        b.dataset.iconAction =
          spec[
            0
          ];


        b.dataset.memberId =
          item.member_id;


        b.dataset.memberName =
          item.nickname ||
          item.member_id;


        b.textContent =
          spec[
            1
          ];


        b.className =
          spec[
            2
          ];


        wrap.appendChild(
          b
        );
      }


      action.appendChild(
        wrap
      );


      tr.append(
        user,
        group,
        time,
        size,
        action
      );


      table.appendChild(
        tr
      );
    }
  }


  function renderSafetyGroups(
    groups
  ) {

    const table =
      document.getElementById(
        'safetyGroupTbl'
      );


    if (
      !table
    ) {

      return;
    }


    table.innerHTML =
      `
        <tr>

          <th>
            グループ
          </th>

          <th>
            スタート日
          </th>

          <th>
            体重表示
          </th>

          <th class="n">
            同意
          </th>

          <th>
            外部WEB
          </th>

        </tr>
      `;


    for (
      const g of
      groups
    ) {

      const tr =
        document.createElement(
          'tr'
        );


      const name =
        document.createElement(
          'td'
        );


      const strong =
        document.createElement(
          'strong'
        );


      strong.textContent =
        g.name ||
        g.group_id;


      name.appendChild(
        strong
      );


      name.appendChild(
        document.createElement(
          'br'
        )
      );


      const gid =
        document.createElement(
          'span'
        );


      gid.className =
        'mut';


      gid.textContent =
        g.group_id;


      name.appendChild(
        gid
      );


      const start =
        document.createElement(
          'td'
        );


      start.textContent =
        g.start_ymd ||
        '—';


      const weight =
        document.createElement(
          'td'
        );


      weight.textContent =
        g.show_weight
          ? '公開グループ'
          : '増減量のみ';


      const consent =
        document.createElement(
          'td'
        );


      consent.className =
        'n';


      consent.textContent =
        `${Number(
          g.consented ||
          0
        )}/${Number(
          g.members ||
          0
        )}`;


      const ext =
        document.createElement(
          'td'
        );


      const button =
        document.createElement(
          'button'
        );


      button.type =
        'button';


      button.dataset.groupExternal =
        g.group_id;


      button.dataset.enabled =
        g.external_enabled
          ? '1'
          : '0';


      button.textContent =
        g.external_enabled
          ? 'ON'
          : 'OFF';


      button.className =
        g.external_enabled
          ? 'pri'
          : '';


      ext.appendChild(
        button
      );


      tr.append(
        name,
        start,
        weight,
        consent,
        ext
      );


      table.appendChild(
        tr
      );
    }
  }


  async function loadSafety() {

    if (
      safetyLoading
    ) {

      return;
    }


    safetyLoading =
      true;


    const msg =
      document.getElementById(
        'safetyMsg'
      );


    if (
      msg
    ) {

      msg.textContent =
        '読み込み中…';


      msg.className =
        'msg';
    }


    try {

      const [
        summary,
        icons,
        groups
      ] =
        await Promise.all([
          api(
            '/api/admin/safety/summary'
          ),
          api(
            '/api/admin/safety/icon-pending'
          ),
          api(
            '/api/admin/safety/groups'
          ),
        ]);


      renderSafetySummary(
        summary
      );


      renderPendingIcons(
        icons.items ||
        []
      );


      renderSafetyGroups(
        groups.groups ||
        []
      );


      externalGroupState
        .clear();


      for (
        const g of
        groups.groups ||
        []
      ) {

        externalGroupState.set(
          String(
            g.group_id
          ),
          g
        );
      }


      decorateGroupRows();


      if (
        msg
      ) {

        msg.textContent =
          '最新状態を読み込みました';


        msg.className =
          'msg ok';
      }


    } catch (
      error
    ) {

      if (
        msg
      ) {

        msg.textContent =
          errorText(
            error
          );


        msg.className =
          'msg ng';
      }


    } finally {

      safetyLoading =
        false;
    }
  }


  /* ============================================================
     画像審査アクション
     ============================================================ */

  async function previewPendingIcon(
    memberId,
    name
  ) {

    try {

      const data =
        await api(
          '/api/admin/safety/icon-pending/' +
          encodeURIComponent(
            memberId
          ) +
          '/image'
        );


      const ov =
        ensurePreview();


      const title =
        ov.querySelector(
          '#safetyPreviewTitle'
        );


      const img =
        ov.querySelector(
          '#safetyPreviewImg'
        );


      title.textContent =
        `承認待ち画像：${name}`;


      img.src =
        data.data_url;


      ov.hidden =
        false;


      document.body
        .classList
        .add(
          'modal-open'
        );


    } catch (
      error
    ) {

      window.alert(
        errorText(
          error
        )
      );
    }
  }


  async function approvePendingIcon(
    memberId,
    name
  ) {

    const ok =
      window.confirm(
        `${name} のプロフィール画像を公開承認します。\n\n実行しますか？`
      );


    if (
      !ok
    ) {

      return;
    }


    try {

      await api(
        '/api/admin/safety/icon-pending/' +
        encodeURIComponent(
          memberId
        ) +
        '/approve',
        {
          method:
            'POST',
        }
      );


      await loadSafety();


    } catch (
      error
    ) {

      window.alert(
        errorText(
          error
        )
      );
    }
  }


  async function rejectPendingIcon(
    memberId,
    name
  ) {

    const ok =
      window.confirm(
        `${name} の承認待ちプロフィール画像を却下して削除します。\n\n現在すでに承認済みの画像がある場合、その画像は残ります。\n\n実行しますか？`
      );


    if (
      !ok
    ) {

      return;
    }


    try {

      await api(
        '/api/admin/safety/icon-pending/' +
        encodeURIComponent(
          memberId
        ) +
        '/reject',
        {
          method:
            'POST',
        }
      );


      await loadSafety();


    } catch (
      error
    ) {

      window.alert(
        errorText(
          error
        )
      );
    }
  }


  async function onSafetyIconAction(
    event
  ) {

    const button =
      event.target.closest(
        'button[data-icon-action]'
      );


    if (
      !button
    ) {

      return;
    }


    const memberId =
      button.dataset.memberId;


    const name =
      button.dataset.memberName ||
      memberId;


    const action =
      button.dataset.iconAction;


    if (
      action ===
        'preview'
    ) {

      await previewPendingIcon(
        memberId,
        name
      );


      return;
    }


    if (
      action ===
        'approve'
    ) {

      await approvePendingIcon(
        memberId,
        name
      );


      return;
    }


    if (
      action ===
        'reject'
    ) {

      await rejectPendingIcon(
        memberId,
        name
      );
    }
  }


  /* ============================================================
     外部WEBグループアクション
     ============================================================ */

  async function onSafetyGroupAction(
    event
  ) {

    const button =
      event.target.closest(
        'button[data-group-external]'
      );


    if (
      !button
    ) {

      return;
    }


    const gid =
      button.dataset.groupExternal;


    const enabled =
      button.dataset.enabled ===
        '1';


    await toggleExternalGroup(
      gid,
      !enabled
    );
  }


  /* ============================================================
     既存ボタンとの連携
     ============================================================ */

  const btnGroups =
    document.getElementById(
      'btnGroups'
    );


  if (
    btnGroups
  ) {

    btnGroups.addEventListener(
      'click',
      () => {

        setTimeout(
          loadExternalGroupStates,
          300
        );
      }
    );
  }


  const btnLogin =
    document.getElementById(
      'btnLogin'
    );


  if (
    btnLogin
  ) {

    btnLogin.addEventListener(
      'click',
      () => {

        setTimeout(
          () => {

            loadExternalGroupStates();

          },
          500
        );
      }
    );
  }


  /* ============================================================
     初期化
     ============================================================ */

  ensureSafetyPanel();


  ensurePrivacyCard();


  ensureIconSafetyCard();


  decorateGroupRows();


  setTimeout(
    loadExternalGroupStates,
    300
  );

})();
