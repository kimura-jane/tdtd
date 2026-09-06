'use strict';

/* ============================================================
   みんやせ / admin-privacy.js

   既存 admin.html に以下を追加する。

   1. グループ一覧の行をタップ可能にする
   2. タップしたグループのユーザーだけ表示する
   3. ユーザー詳細に体重公開設定を追加する
   4. シークレット ON / OFF

   シークレット：
     ・公開ランキングでは実体重を出さない
     ・減量幅だけ表示
     ・外部APIにも実体重を渡さない
   ============================================================ */

(function () {

  'use strict';


  /* ============================================================
     必須要素
     ============================================================ */

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


  if (
    !groupTable ||
    !userModal ||
    !detailBody ||
    !detailId
  ) {

    console.error(
      'admin_privacy_required_element_missing'
    );

    return;
  }


  const privacyState =
    new Map();


  let loadingMemberId =
    null;


  /* ============================================================
     エラー表示
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


  /* ============================================================
     現在のmember_id
     ============================================================ */

  function currentMemberId() {

    const value =
      String(
        detailId.textContent ||
        ''
      )
        .trim()
        .toUpperCase();


    if (
      !/^[0-9A-Z]{6,32}$/
        .test(
          value
        )
    ) {

      return null;
    }


    return value;
  }


  /* ============================================================
     管理画面タブ切替
     ============================================================ */

  function userTabButton() {

    return document
      .querySelector(
        '#adminNav button[data-t="users"]'
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


    /*
     * グループをタップしたら、
     * 他の絞り込み条件はリセットして
     * そのグループ全員を確実に表示する。
     */
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


    /*
     * タブ切替後も指定グループを維持。
     */
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
        USERS.length &&
        typeof renderUsers ===
          'function'
      ) {

        renderUsers();
      }

    } catch {}
  }


  /* ============================================================
     グループ一覧をタップ可能にする
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


    const rows =
      [
        ...groupTable
          .querySelectorAll(
            'tr'
          )
      ]
        .slice(
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


        tr.dataset.groupId =
          String(
            group.id
          );


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
            group.id
          ) +
          ' のメンバーを表示'
        );


        tr.style.cursor =
          'pointer';


        tr.title =
          'タップしてメンバーを見る';
      }
    );
  }


  /*
   * グループ表が書き換わるたびに
   * datasetを付け直す。
   */
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
        true
    }
  );


  groupTable.addEventListener(
    'click',
    event => {

      const tr =
        event.target.closest(
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


      /*
       * 将来ボタン等を追加した場合は
       * その操作を横取りしない。
       */
      if (
        event.target.closest(
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
        event.target.closest(
          'tr[data-group-id]'
        );


      if (!tr) {
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
          シークレットにすると、
          アプリの公開ランキングや外部連携では
          実体重を表示せず、
          減量幅だけを表示します。
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


    return card;
  }


  /* ============================================================
     公開状態描画
     ============================================================ */

  function renderPrivacy(
    memberId,
    hidden
  ) {

    ensurePrivacyCard();


    privacyState.set(
      memberId,
      !!hidden
    );


    const status =
      document.getElementById(
        'uPrivacyStatus'
      );


    const button =
      document.getElementById(
        'btnWeightSecret'
      );


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


      tag.textContent =
        hidden
          ? 'シークレット'
          : '体重公開';


      status.appendChild(
        tag
      );


      const text =
        document.createElement(
          'span'
        );


      text.className =
        'mut';


      text.textContent =
        hidden
          ? '実体重非表示・減量幅のみ'
          : 'グループ設定に従って実体重を表示';


      status.appendChild(
        text
      );
    }


    if (
      button
    ) {

      button.disabled =
        false;


      button.textContent =
        hidden
          ? 'シークレット解除'
          : 'シークレットにする';


      button.className =
        hidden
          ? ''
          : 'pri';
    }
  }


  /* ============================================================
     公開状態取得
     ============================================================ */

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
        '';


      const span =
        document.createElement(
          'span'
        );


      span.className =
        'mut';


      span.textContent =
        '読み込み中…';


      status.appendChild(
        span
      );
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


      /*
       * 通信中に別ユーザーへ切り替わったら
       * 古い結果を表示しない。
       */
      if (
        currentMemberId() !==
          memberId
      ) {

        return;
      }


      const hidden =
        !!(
          data &&
          data.member &&
          data.member.weight_hidden
        );


      renderPrivacy(
        memberId,
        hidden
      );


    } catch (error) {

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
          '';


        const span =
          document.createElement(
            'span'
          );


        span.className =
          'result-bad';


        span.textContent =
          '取得できません';


        status.appendChild(
          span
        );
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


  /* ============================================================
     シークレット切替
     ============================================================ */

  async function changePrivacy() {

    const memberId =
      currentMemberId();


    if (
      !memberId
    ) {

      return;
    }


    const current =
      !!privacyState.get(
        memberId
      );


    const next =
      !current;


    let name =
      memberId;


    try {

      if (
        typeof CURRENT_USER_DATA !==
          'undefined' &&
        CURRENT_USER_DATA
      ) {

        name =
          CURRENT_USER_DATA.nickname ||
          CURRENT_USER_DATA.member_id ||
          memberId;
      }

    } catch {}


    const confirmText =
      next
        ? (
            name +
            ' をシークレットにします。\n\n' +
            '公開ランキングと外部連携では' +
            '実体重を出さず、' +
            '減量幅だけを表示します。\n\n' +
            '実行しますか？'
          )
        : (
            name +
            ' のシークレットを解除します。\n\n' +
            '体重公開グループでは' +
            '実体重が再び表示されます。\n\n' +
            '実行しますか？'
          );


    if (
      !confirm(
        confirmText
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
        '変更中…';


      msg.className =
        'msg ok';
    }


    try {

      const data =
        await api(
          '/api/admin/weight-privacy/' +
          encodeURIComponent(
            memberId
          ),
          {
            method:
              'POST',

            type:
              'application/json',

            body:
              JSON.stringify({
                hidden:
                  next
              })
          }
        );


      const hidden =
        !!(
          data &&
          data.member &&
          data.member.weight_hidden
        );


      renderPrivacy(
        memberId,
        hidden
      );


      if (
        msg
      ) {

        msg.textContent =
          hidden
            ? 'シークレットにしました'
            : 'シークレットを解除しました';


        msg.className =
          'msg ok';
      }


    } catch (error) {

      if (
        button
      ) {

        button.disabled =
          false;
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
    }
  }


  /* ============================================================
     ユーザー詳細を監視
     ============================================================ */

  function detailChanged() {

    if (
      userModal.hidden
    ) {

      return;
    }


    const memberId =
      currentMemberId();


    if (
      !memberId
    ) {

      return;
    }


    ensurePrivacyCard();


    loadPrivacy(
      memberId
    );
  }


  const detailObserver =
    new MutationObserver(
      () => {

        detailChanged();
      }
    );


  detailObserver.observe(
    userModal,
    {
      attributes:
        true,

      attributeFilter:
        [
          'hidden'
        ]
    }
  );


  detailObserver.observe(
    detailId,
    {
      childList:
        true,

      characterData:
        true,

      subtree:
        true
    }
  );


  /*
   * 管理画面がユーザー詳細の中身を
   * 書き換えたタイミングも見る。
   */
  detailObserver.observe(
    detailBody,
    {
      attributes:
        true,

      attributeFilter:
        [
          'hidden'
        ]
    }
  );


  /* ============================================================
     ボタン
     ============================================================ */

  ensurePrivacyCard();


  const privacyButton =
    document.getElementById(
      'btnWeightSecret'
    );


  if (
    privacyButton
  ) {

    privacyButton.addEventListener(
      'click',
      changePrivacy
    );
  }


  /* ============================================================
     初期処理
     ============================================================ */

  decorateGroupRows();

})();
