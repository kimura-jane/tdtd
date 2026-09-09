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


/* ============================================================
   管理画面：テストデータ整理
   2026-09-09

   ・ユーザー登録日の期間絞り込み
   ・表示中ユーザーの複数選択 / 一括削除
   ・ユーザー詳細から個別削除
   ・グループ一覧からグループ削除

   重要：
   ・削除は ADMIN_TOKEN 必須の管理APIのみ。
   ・ユーザー削除は本人用 DELETE /api/me と同じ削除処理を再利用。
   ・グループ削除ではユーザー本人と体重記録は残し、未所属に戻す。
   ============================================================ */

(function () {

  'use strict';


  const userPanel =
    document.getElementById(
      'p-users'
    );

  const userTable =
    document.getElementById(
      'uTbl'
    );

  const userMsg =
    document.getElementById(
      'uMsg'
    );

  const groupTable =
    document.getElementById(
      'gTbl'
    );

  const detailBody =
    document.getElementById(
      'uDetailBody'
    );


  if (
    !userPanel ||
    !userTable ||
    !userMsg ||
    !groupTable ||
    !detailBody ||
    typeof renderUsers !==
      'function'
  ) {

    console.error(
      'admin_cleanup_required_element_missing'
    );

    return;
  }


  const selectedUsers =
    new Set();

  let deleting =
    false;


  /* ============================================================
     CSS
     ============================================================ */

  function ensureCleanupCss() {

    if (
      document.getElementById(
        'adminCleanupCss'
      )
    ) {

      return;
    }


    const style =
      document.createElement(
        'style'
      );

    style.id =
      'adminCleanupCss';

    style.textContent =
      `
        .cleanup-box{
          margin-top:12px;
          padding:10px;
          border:1px solid var(--line);
          border-radius:9px;
          background:#fffaf8;
        }

        .cleanup-filter-grid{
          display:grid;
          grid-template-columns:repeat(2,minmax(150px,1fr));
          gap:8px;
        }

        .cleanup-actions{
          display:flex;
          flex-wrap:wrap;
          gap:8px;
          align-items:center;
          margin-top:10px;
        }

        .cleanup-actions button{
          flex:0 0 auto;
        }

        .cleanup-count{
          color:var(--mut);
          font-size:12px;
        }

        button.cleanup-danger{
          border-color:var(--bad);
          color:var(--bad);
          font-weight:700;
        }

        button.cleanup-danger.strong{
          background:var(--bad);
          color:#fff;
        }

        .cleanup-check{
          width:auto;
          margin:0;
          transform:scale(1.1);
        }

        .cleanup-delete-cell button{
          padding:5px 9px;
          white-space:nowrap;
        }

        @media(max-width:700px){
          .cleanup-filter-grid{
            grid-template-columns:1fr;
          }
        }
      `;

    document.head
      .appendChild(
        style
      );
  }


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


  function jstYmd(
    value
  ) {

    const n =
      Number(
        value ||
        0
      );

    if (!n) {

      return null;
    }


    try {

      return new Date(
        n +
        9 * 3600000
      )
        .toISOString()
        .slice(
          0,
          10
        );

    } catch {

      return null;
    }
  }


  function createdDateMatches(
    user
  ) {

    const from =
      document.getElementById(
        'cleanupCreatedFrom'
      );

    const to =
      document.getElementById(
        'cleanupCreatedTo'
      );


    const fromYmd =
      from
        ? from.value
        : '';

    const toYmd =
      to
        ? to.value
        : '';


    if (
      !fromYmd &&
      !toYmd
    ) {

      return true;
    }


    const ymd =
      jstYmd(
        user &&
        user.created_at
      );


    if (!ymd) {

      return false;
    }


    if (
      fromYmd &&
      ymd < fromYmd
    ) {

      return false;
    }


    if (
      toYmd &&
      ymd > toYmd
    ) {

      return false;
    }


    return true;
  }


  function allUsers() {

    try {

      return (
        typeof USERS !==
          'undefined' &&
        Array.isArray(
          USERS
        )
      )
        ? USERS
        : [];

    } catch {

      return [];
    }
  }


  function visibleUsers() {

    const q =
      String(
        document.getElementById(
          'uSearch'
        )?.value ||
        ''
      )
        .trim()
        .normalize(
          'NFKC'
        )
        .toLocaleLowerCase(
          'ja'
        );

    const group =
      document.getElementById(
        'uGroup'
      )?.value ||
      '';

    const state =
      document.getElementById(
        'uState'
      )?.value ||
      '';

    const notify =
      document.getElementById(
        'uNotify'
      )?.value ||
      '';

    const quiz =
      document.getElementById(
        'uQuiz'
      )?.value ||
      '';


    let rows =
      allUsers()
        .filter(
          user => {

            if (
              !createdDateMatches(
                user
              )
            ) {

              return false;
            }


            if (q) {

              const hay =
                [
                  user.nickname,
                  user.member_id,
                  user.group_name,
                ]
                  .filter(Boolean)
                  .join(' ')
                  .normalize(
                    'NFKC'
                  )
                  .toLocaleLowerCase(
                    'ja'
                  );

              if (
                !hay.includes(q)
              ) {

                return false;
              }
            }


            if (
              group &&
              user.group_id !==
                group
            ) {

              return false;
            }


            if (
              state &&
              user.status !==
                state
            ) {

              return false;
            }


            if (
              notify ===
                'on' &&
              !user.notify_on
            ) {

              return false;
            }


            if (
              notify ===
                'off' &&
              user.notify_on
            ) {

              return false;
            }


            if (
              notify ===
                'push' &&
              !user.push_registered
            ) {

              return false;
            }


            if (
              notify ===
                'no_push' &&
              user.push_registered
            ) {

              return false;
            }


            if (
              quiz ===
                'answered' &&
              Number(
                user.quiz_answered ||
                0
              ) <= 0
            ) {

              return false;
            }


            if (
              quiz ===
                'none' &&
              Number(
                user.quiz_answered ||
                0
              ) > 0
            ) {

              return false;
            }


            return true;
          }
        );


    try {

      rows =
        [
          ...rows
        ]
          .sort(
            (
              a,
              b
            ) =>
              compareUserValues(
                userSortValue(
                  a,
                  USER_SORT.key
                ),
                userSortValue(
                  b,
                  USER_SORT.key
                )
              ) *
              USER_SORT.dir
          );

    } catch {}


    return rows;
  }


  function pruneSelection() {

    const ids =
      new Set(
        allUsers()
          .map(
            user =>
              user.member_id
          )
      );


    for (
      const memberId of
      [
        ...selectedUsers
      ]
    ) {

      if (
        !ids.has(
          memberId
        )
      ) {

        selectedUsers.delete(
          memberId
        );
      }
    }
  }


  /* ============================================================
     ユーザー整理UI
     ============================================================ */

  function ensureUserCleanupControls() {

    if (
      document.getElementById(
        'userCleanupBox'
      )
    ) {

      return;
    }


    const box =
      document.createElement(
        'div'
      );

    box.id =
      'userCleanupBox';

    box.className =
      'cleanup-box';

    box.innerHTML =
      `
        <div class="cleanup-filter-grid">

          <div>
            <label for="cleanupCreatedFrom">
              登録日（開始・JST）
            </label>
            <input
              id="cleanupCreatedFrom"
              type="date"
            >
          </div>

          <div>
            <label for="cleanupCreatedTo">
              登録日（終了・JST）
            </label>
            <input
              id="cleanupCreatedTo"
              type="date"
            >
          </div>

        </div>

        <div class="cleanup-actions">

          <button
            id="btnCleanupSelectVisible"
            type="button"
          >
            表示中を選択
          </button>

          <button
            id="btnCleanupClear"
            type="button"
          >
            選択解除
          </button>

          <button
            id="btnCleanupDeleteSelected"
            class="cleanup-danger strong"
            type="button"
            disabled
          >
            選択したユーザーを削除
          </button>

          <span
            class="cleanup-count"
            id="cleanupSelectedCount"
          >
            0人選択
          </span>

        </div>

        <div class="small-note">
          登録日はJSTで絞り込みます。削除対象は自動判定しません。
          日付で候補を絞ったうえで、実際に消すユーザーを選択してください。
        </div>
      `;


    const columns =
      userPanel.querySelector(
        '.user-columns'
      );


    if (
      columns
    ) {

      columns.insertAdjacentElement(
        'beforebegin',
        box
      );

    } else {

      userPanel.appendChild(
        box
      );
    }


    for (
      const id of
      [
        'cleanupCreatedFrom',
        'cleanupCreatedTo',
      ]
    ) {

      document
        .getElementById(
          id
        )
        .addEventListener(
          'change',
          () =>
            renderUsers()
        );
    }


    document
      .getElementById(
        'btnCleanupSelectVisible'
      )
      .addEventListener(
        'click',
        () => {

          for (
            const user of
            visibleUsers()
          ) {

            selectedUsers.add(
              user.member_id
            );
          }

          decorateUserTable();
        }
      );


    document
      .getElementById(
        'btnCleanupClear'
      )
      .addEventListener(
        'click',
        () => {

          selectedUsers.clear();

          decorateUserTable();
        }
      );


    document
      .getElementById(
        'btnCleanupDeleteSelected'
      )
      .addEventListener(
        'click',
        deleteSelectedUsers
      );
  }


  function ensureCreatedAtColumn() {

    try {

      if (
        Array.isArray(
          USER_COLS
        ) &&
        !USER_COLS.includes(
          'created_at'
        )
      ) {

        USER_COLS.push(
          'created_at'
        );

        sessionStorage.setItem(
          K_USER_COLS,
          JSON.stringify(
            USER_COLS
          )
        );


        const input =
          document.querySelector(
            '#uCols input[value="created_at"]'
          );

        if (input) {

          input.checked =
            true;
        }
      }

    } catch {}
  }


  const originalRenderUsers =
    renderUsers;


  renderUsers =
    function cleanupAwareRenderUsers() {

      ensureUserCleanupControls();

      ensureCreatedAtColumn();


      let original =
        null;

      let changed =
        false;


      try {

        original =
          USERS;

        const filtered =
          original.filter(
            createdDateMatches
          );

        USERS =
          filtered;

        changed =
          true;

        originalRenderUsers();

      } finally {

        if (changed) {

          USERS =
            original;
        }
      }


      pruneSelection();

      decorateUserTable();
    };


  /*
   * admin.html 側で oninput / onchange に旧 renderUsers の
   * 関数オブジェクトが直接代入済みなので、ここで新しい
   * 日付フィルタ対応版へ付け直す。
   */
  const userFilterBindings = [
    ['uSearch', 'oninput'],
    ['uGroup', 'onchange'],
    ['uState', 'onchange'],
    ['uNotify', 'onchange'],
    ['uQuiz', 'onchange'],
  ];


  for (
    const [
      id,
      prop
    ] of
    userFilterBindings
  ) {

    const node =
      document.getElementById(
        id
      );

    if (node) {

      node[prop] =
        renderUsers;
    }
  }


  function decorateUserTable() {

    const rows =
      visibleUsers();


    const trs =
      [
        ...userTable
          .querySelectorAll(
            'tr'
          )
      ];


    if (
      !trs.length
    ) {

      updateSelectionStatus(
        rows
      );

      return;
    }


    const head =
      trs[0];


    if (
      !head.querySelector(
        'th[data-cleanup-select-head]'
      )
    ) {

      const th =
        document.createElement(
          'th'
        );

      th.dataset.cleanupSelectHead =
        '1';

      th.textContent =
        '選択';

      head.insertBefore(
        th,
        head.firstChild
      );
    }


    if (
      !rows.length
    ) {

      const empty =
        trs[1];

      if (
        empty &&
        empty.firstElementChild
      ) {

        empty.firstElementChild.colSpan =
          Math.max(
            1,
            Number(
              empty.firstElementChild.colSpan ||
              1
            ) +
            1
          );
      }

      updateSelectionStatus(
        rows
      );

      return;
    }


    const bodyRows =
      trs.slice(
        1
      );


    rows.forEach(
      (
        user,
        index
      ) => {

        const tr =
          bodyRows[
            index
          ];

        if (!tr) {

          return;
        }


        tr.dataset.cleanupMemberId =
          user.member_id;


        let td =
          tr.querySelector(
            'td[data-cleanup-select-cell]'
          );


        if (!td) {

          td =
            document.createElement(
              'td'
            );

          td.dataset.cleanupSelectCell =
            '1';

          tr.insertBefore(
            td,
            tr.firstChild
          );
        }


        td.innerHTML =
          '';


        const input =
          document.createElement(
            'input'
          );

        input.type =
          'checkbox';

        input.className =
          'cleanup-check';

        input.checked =
          selectedUsers.has(
            user.member_id
          );

        input.setAttribute(
          'aria-label',
          (
            user.nickname ||
            '名前未設定'
          ) +
          ' を削除対象として選択'
        );


        input.addEventListener(
          'click',
          event => {

            event.stopPropagation();
          }
        );

        input.addEventListener(
          'keydown',
          event => {

            event.stopPropagation();
          }
        );

        input.addEventListener(
          'change',
          () => {

            if (
              input.checked
            ) {

              selectedUsers.add(
                user.member_id
              );

            } else {

              selectedUsers.delete(
                user.member_id
              );
            }

            updateSelectionStatus(
              rows
            );
          }
        );


        td.appendChild(
          input
        );
      }
    );


    updateSelectionStatus(
      rows
    );
  }


  function updateSelectionStatus(
    rows =
      visibleUsers()
  ) {

    const count =
      document.getElementById(
        'cleanupSelectedCount'
      );

    const button =
      document.getElementById(
        'btnCleanupDeleteSelected'
      );


    if (count) {

      count.textContent =
        selectedUsers.size +
        '人選択';
    }


    if (button) {

      button.disabled =
        deleting ||
        selectedUsers.size ===
          0;
    }


    if (userMsg) {

      userMsg.textContent =
        rows.length +
        '人表示 / 全' +
        allUsers().length +
        '人' +
        (
          selectedUsers.size
            ? (
                ' ／ ' +
                selectedUsers.size +
                '人選択'
              )
            : ''
        );

      userMsg.className =
        'msg ok';
    }
  }


  async function deleteMembers(
    memberIds,
    {
      single = false
    } = {}
  ) {

    if (
      deleting ||
      !memberIds.length
    ) {

      return;
    }


    const map =
      new Map(
        allUsers()
          .map(
            user => [
              user.member_id,
              user,
            ]
          )
      );


    const users =
      memberIds
        .map(
          id =>
            map.get(id) ||
            {
              member_id:
                id,

              nickname:
                null,
            }
        );


    const sample =
      users
        .slice(
          0,
          8
        )
        .map(
          user =>
            '・' +
            (
              user.nickname ||
              '名前未設定'
            ) +
            ' (' +
            user.member_id +
            ')'
        )
        .join('\n');


    const more =
      users.length > 8
        ? (
            '\nほか ' +
            (
              users.length -
              8
            ) +
            '人'
          )
        : '';


    const ok =
      window.confirm(
        (
          single
            ? 'このユーザーを完全に削除します。'
            : users.length +
              '人のユーザーを完全に削除します。'
        ) +
        '\n\n' +
        sample +
        more +
        '\n\n体重記録・ライバル・ブロック・投票・Push・公開設定・外部連携同意・プロフィール画像等の関連データも削除されます。' +
        '\n対象ユーザーが通常グループのオーナーの場合、その所有グループも解散します。' +
        '\n\nこの操作は元に戻せません。続行しますか？'
      );


    if (!ok) {

      return;
    }


    const typed =
      window.prompt(
        '最終確認です。実行する場合は「削除」と入力してください。'
      );


    if (
      typed !==
        '削除'
    ) {

      return;
    }


    deleting =
      true;

    updateSelectionStatus();


    if (userMsg) {

      userMsg.textContent =
        '削除中… 0 / ' +
        memberIds.length;

      userMsg.className =
        'msg';
    }


    const succeeded =
      [];

    const failed =
      [];


    for (
      let i = 0;
      i < memberIds.length;
      i++
    ) {

      const memberId =
        memberIds[i];


      try {

        await jsonApi(
          '/api/admin/users/' +
          encodeURIComponent(
            memberId
          ),
          'DELETE',
          {
            confirm_member_id:
              memberId,
          }
        );

        succeeded.push(
          memberId
        );

        selectedUsers.delete(
          memberId
        );

      } catch (
        error
      ) {

        failed.push(
          {
            member_id:
              memberId,

            error:
              errorText(
                error
              ),
          }
        );
      }


      if (userMsg) {

        userMsg.textContent =
          '削除中… ' +
          (
            i +
            1
          ) +
          ' / ' +
          memberIds.length;
      }
    }


    deleting =
      false;


    try {

      if (
        typeof CURRENT_USER !==
          'undefined' &&
        succeeded.includes(
          CURRENT_USER
        ) &&
        typeof closeUserDetail ===
          'function'
      ) {

        closeUserDetail();
      }

    } catch {}


    try {

      if (
        typeof loadGroups ===
          'function'
      ) {

        await loadGroups();
      }

      if (
        typeof loadUsers ===
          'function'
      ) {

        await loadUsers();
      }

    } catch (
      error
    ) {

      failed.push(
        {
          member_id:
            '再読み込み',

          error:
            errorText(
              error
            ),
        }
      );
    }


    try {

      if (
        typeof loadExternalGroupStates ===
          'function'
      ) {

        await loadExternalGroupStates();
      }

    } catch {}


    const failText =
      failed.length
        ? (
            '\n失敗：\n' +
            failed
              .map(
                item =>
                  item.member_id +
                  '：' +
                  item.error
              )
              .join('\n')
          )
        : '';


    if (userMsg) {

      userMsg.textContent =
        succeeded.length +
        '人を削除しました。' +
        (
          failed.length
            ? (
                ' ' +
                failed.length +
                '件失敗。'
              )
            : ''
        ) +
        failText;

      userMsg.className =
        'msg ' +
        (
          failed.length
            ? 'ng'
            : 'ok'
        );
    }


  }


  async function deleteSelectedUsers() {

    await deleteMembers(
      [
        ...selectedUsers
      ]
    );
  }


  /* ============================================================
     ユーザー詳細：個別削除
     ============================================================ */

  function ensureUserDeleteCard() {

    let card =
      document.getElementById(
        'uAdminDeleteCard'
      );

    if (card) {

      return card;
    }


    card =
      document.createElement(
        'div'
      );

    card.id =
      'uAdminDeleteCard';

    card.className =
      'detail-card full';

    card.innerHTML =
      `
        <h3>
          管理者：ユーザー削除
        </h3>

        <div class="detail-actions">
          <button
            id="btnAdminDeleteUser"
            class="cleanup-danger strong"
            type="button"
          >
            このユーザーを削除
          </button>
        </div>

        <div class="small-note">
          テストアカウント等を完全削除するための管理機能です。
          通常の利用者を誤って削除しないでください。
        </div>
      `;


    detailBody.appendChild(
      card
    );


    card
      .querySelector(
        '#btnAdminDeleteUser'
      )
      .addEventListener(
        'click',
        async () => {

          let memberId =
            null;

          try {

            memberId =
              CURRENT_USER ||
              null;

          } catch {}


          if (!memberId) {

            memberId =
              String(
                document.getElementById(
                  'uDetailId'
                )?.textContent ||
                ''
              )
                .trim()
                .toUpperCase();
          }


          if (
            !/^[0-9A-Z]{6,32}$/
              .test(
                memberId ||
                ''
              )
          ) {

            return;
          }


          await deleteMembers(
            [
              memberId
            ],
            {
              single:
                true,
            }
          );
        }
      );


    return card;
  }


  /* ============================================================
     グループ削除
     ============================================================ */

  function groupsArray() {

    try {

      return (
        typeof GROUPS !==
          'undefined' &&
        Array.isArray(
          GROUPS
        )
      )
        ? GROUPS
        : [];

    } catch {

      return [];
    }
  }


  function decorateGroupDelete() {

    const groups =
      groupsArray();

    const trs =
      [
        ...groupTable
          .querySelectorAll(
            'tr'
          )
      ];


    if (
      !trs.length
    ) {

      return;
    }


    const head =
      trs[0];


    if (
      !head.querySelector(
        'th[data-cleanup-group-head]'
      )
    ) {

      const th =
        document.createElement(
          'th'
        );

      th.dataset.cleanupGroupHead =
        '1';

      th.textContent =
        '削除';

      head.appendChild(
        th
      );
    }


    trs
      .slice(
        1
      )
      .forEach(
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


          let td =
            tr.querySelector(
              'td[data-cleanup-group-cell]'
            );

          if (!td) {

            td =
              document.createElement(
                'td'
              );

            td.dataset.cleanupGroupCell =
              '1';

            td.className =
              'cleanup-delete-cell';

            tr.appendChild(
              td
            );
          }


          if (
            td.dataset.cleanupGroupId ===
              group.id &&
            td.firstElementChild
          ) {

            return;
          }


          td.dataset.cleanupGroupId =
            group.id;

          td.innerHTML =
            '';


          const button =
            document.createElement(
              'button'
            );

          button.type =
            'button';

          button.className =
            'cleanup-danger';

          button.textContent =
            '削除';

          button.title =
            'グループを解散して削除';


          button.addEventListener(
            'click',
            async event => {

              event.preventDefault();

              event.stopPropagation();

              await deleteGroup(
                group
              );
            }
          );


          td.appendChild(
            button
          );
        }
      );
  }


  async function deleteGroup(
    group
  ) {

    if (
      deleting ||
      !group ||
      !group.id
    ) {

      return;
    }


    const name =
      group.name ||
      group.id;

    const code =
      group.code ||
      group.id;


    const ok =
      window.confirm(
        'グループ「' +
        name +
        '」を解散して削除します。\n\n' +
        'コード：' +
        code +
        '\n人数：' +
        Number(
          group.members ||
          0
        ) +
        '人\n\n' +
        'メンバーのアカウントと体重記録は削除しません。所属だけ解除して未所属に戻します。\n' +
        'リーダー・グループBAN・閲覧登録・外部WEB連携設定等のグループ関連情報は削除します。\n\n' +
        'この操作は元に戻せません。続行しますか？'
      );


    if (!ok) {

      return;
    }


    const typed =
      window.prompt(
        '最終確認です。表示されているグループコードを入力してください。\n' +
        code
      );


    if (
      !typed ||
      String(typed)
        .normalize('NFKC')
        .replace(
          /[\s\u3000_\-\u2010-\u2015\u2212\uff0d]/g,
          ''
        )
        .toUpperCase() !==
        String(group.id)
          .toUpperCase()
    ) {

      return;
    }


    deleting =
      true;


    try {

      await jsonApi(
        '/api/admin/users/groups/' +
        encodeURIComponent(
          group.id
        ),
        'DELETE',
        {
          confirm_group_id:
            typed,
        }
      );


      if (
        typeof loadGroups ===
          'function'
      ) {

        await loadGroups();
      }


      if (
        typeof loadUsers ===
          'function'
      ) {

        await loadUsers();
      }


      try {

        if (
          typeof loadExternalGroupStates ===
            'function'
        ) {

          await loadExternalGroupStates();
        }

      } catch {}


      window.alert(
        'グループ「' +
        name +
        '」を削除しました。\nメンバーのアカウントと体重記録は残っています。'
      );


    } catch (
      error
    ) {

      window.alert(
        errorText(
          error
        )
      );

    } finally {

      deleting =
        false;

      decorateGroupDelete();
    }
  }


  const groupCleanupObserver =
    new MutationObserver(
      decorateGroupDelete
    );

  groupCleanupObserver.observe(
    groupTable,
    {
      childList:
        true,

      subtree:
        true,
    }
  );


  /* ============================================================
     エラーメッセージ追加
     ============================================================ */

  try {

    if (
      typeof ERR ===
        'object' &&
      ERR
    ) {

      ERR.confirm_required =
        '削除確認情報が一致しません';

      ERR.operator_delete_not_allowed =
        '運営アカウントはこの管理削除から消せません';

      ERR.delete_failed =
        'ユーザー削除に失敗しました';
    }

  } catch {}


  /* ============================================================
     初期化
     ============================================================ */

  ensureCleanupCss();

  ensureUserCleanupControls();

  ensureCreatedAtColumn();

  ensureUserDeleteCard();

  decorateGroupDelete();


  /*
   * 既にユーザー一覧が読み込まれている場合にも反映する。
   */
  try {

    if (
      allUsers().length
    ) {

      renderUsers();
    }

  } catch {}

})();
