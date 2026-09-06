'use strict';

/* ============================================================
   みんやせ / admin-privacy.js

   既存の管理画面へ
   「個別体重シークレット」を追加する。

   管理画面
     ↓
   グループをタップ
     ↓
   そのグループのメンバー一覧
     ↓
   メンバーをタップ
     ↓
   シークレット ON / OFF

   シークレット時：
     ・実体重は非表示
     ・減量幅は表示
   ============================================================ */

(function () {

  if (
    typeof api !==
      'function' ||
    typeof openUserDetail !==
      'function'
  ) {

    return;
  }


  /* ============================================================
     エラー表示
     ============================================================ */

  function errorText(
    e
  ) {

    try {

      return emsg(
        e
      );

    } catch {

      return (
        e &&
        e.message
      )
        ? e.message
        : 'エラー';
    }
  }


  /* ============================================================
     グループ → メンバー一覧
     ============================================================ */

  function openGroupMembers(
    groupId
  ) {

    const select =
      document.getElementById(
        'uGroup'
      );


    /*
     * 先にグループを指定しておく。
     *
     * USERS未取得の場合も、
     * ユーザータブを開いたあとloadUsers()が
     * この条件を使って描画する。
     */
    if (
      select
    ) {

      select.value =
        groupId;
    }


    const tab =
      document.querySelector(
        '#adminNav button[data-t="users"]'
      );


    if (
      tab
    ) {

      tab.click();
    }


    /*
     * タブ切替でselectが変化していないことを
     * 念のため再確認。
     */
    if (
      select
    ) {

      select.value =
        groupId;
    }


    /*
     * USERSがすでにある場合は
     * その場で絞り込み。
     */
    try {

      if (
        USERS &&
        USERS.length
      ) {

        renderUsers();
      }

    } catch {}
  }


  /* ============================================================
     グループ表をタップ可能にする
     ============================================================ */

  function decorateGroupRows() {

    const table =
      document.getElementById(
        'gTbl'
      );


    if (
      !table
    ) {

      return;
    }


    let groups =
      [];


    try {

      groups =
        GROUPS || [];

    } catch {

      groups =
        [];
    }


    if (
      !groups.length
    ) {

      return;
    }


    const rows =
      [
        ...table
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


        tr.style.cursor =
          'pointer';


        tr.title =
          'メンバーを見る';


        tr.onclick =
          e => {

            /*
             * 今後ボタン等が追加されても
             * その操作を邪魔しない。
             */
            if (
              e.target.closest(
                'button,a,input,select,textarea'
              )
            ) {

              return;
            }


            openGroupMembers(
              group.id
            );
          };
      }
    );
  }


  const groupTable =
    document.getElementById(
      'gTbl'
    );


  if (
    groupTable
  ) {

    /*
     * loadGroups()で表が作り直されるたびに
     * クリック処理を付け直す。
     */
    const observer =
      new MutationObserver(
        () => {

          decorateGroupRows();
        }
      );


    observer.observe(
      groupTable,
      {
        childList:
          true,

        subtree:
          true
      }
    );
  }


  /* ============================================================
     ユーザー詳細へ公開設定カードを追加
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


    const grid =
      document.getElementById(
        'uDetailBody'
      );


    if (
      !grid
    ) {

      return null;
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
          体重公開グループでも実体重は表示せず、
          減量幅だけを表示します。
        </div>
      `;


    /*
     * 「体重」カードのすぐ後ろへ追加。
     */
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
      weightCard &&
      weightCard.nextSibling
    ) {

      grid.insertBefore(
        card,
        weightCard.nextSibling
      );

    } else {

      grid.appendChild(
        card
      );
    }


    return card;
  }


  /* ============================================================
     状態表示
     ============================================================ */

  function renderPrivacy(
    memberId,
    hidden
  ) {

    ensurePrivacyCard();


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


      if (
        hidden
      ) {

        const note =
          document.createElement(
            'span'
          );


        note.className =
          'mut';


        note.textContent =
          '実体重非表示・変化量のみ';


        status.appendChild(
          note
        );
      }
    }


    if (
      button
    ) {

      button.disabled =
        false;


      button.className =
        hidden
          ? ''
          : 'pri';


      button.textContent =
        hidden
          ? 'シークレット解除'
          : 'シークレットにする';


      button.onclick =
        () => {

          changePrivacy(
            memberId,
            !hidden
          );
        };
    }


    if (
      msg
    ) {

      msg.textContent =
        '';


      msg.className =
        'msg';
    }
  }


  /* ============================================================
     状態取得
     ============================================================ */

  async function loadPrivacy(
    memberId
  ) {

    ensurePrivacyCard();


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


      button.textContent =
        '読み込み中…';
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
       * 別ユーザーへ切り替わっていたら
       * 古いレスポンスを描画しない。
       */
      try {

        if (
          CURRENT_USER !==
          memberId
        ) {

          return;
        }

      } catch {}


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


    } catch (e) {

      if (
        msg
      ) {

        msg.textContent =
          errorText(
            e
          );


        msg.className =
          'msg ng';
      }


      if (
        button
      ) {

        button.disabled =
          true;


        button.textContent =
          '取得できません';
      }
    }
  }


  /* ============================================================
     ON / OFF
     ============================================================ */

  async function changePrivacy(
    memberId,
    hidden
  ) {

    let user =
      null;


    try {

      user =
        CURRENT_USER_DATA;

    } catch {}


    const name =
      user &&
      (
        user.nickname ||
        user.member_id
      )
        ? (
            user.nickname ||
            user.member_id
          )
        : memberId;


    const text =
      hidden
        ? (
            name +
            ' をシークレットにします。\n\n' +
            '実体重は表示されず、' +
            '減量幅だけ表示されます。\n\n' +
            '実行しますか？'
          )
        : (
            name +
            ' のシークレットを解除します。\n\n' +
            '体重公開グループでは' +
            '実体重が表示されます。\n\n' +
            '実行しますか？'
          );


    if (
      !confirm(
        text
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
                  !!hidden
              })
          }
        );


      const next =
        !!(
          data &&
          data.member &&
          data.member.weight_hidden
        );


      renderPrivacy(
        memberId,
        next
      );


      if (
        msg
      ) {

        msg.textContent =
          next
            ? 'シークレットにしました'
            : 'シークレットを解除しました';


        msg.className =
          'msg ok';
      }


    } catch (e) {

      if (
        msg
      ) {

        msg.textContent =
          errorText(
            e
          );


        msg.className =
          'msg ng';
      }


      if (
        button
      ) {

        button.disabled =
          false;
      }
    }
  }


  /* ============================================================
     既存ユーザー詳細を拡張
     ============================================================ */

  const originalOpenUserDetail =
    openUserDetail;


  window.openUserDetail =
    async function (
      memberId
    ) {

      /*
       * まず既存管理画面のユーザー詳細を
       * そのまま表示。
       */
      await originalOpenUserDetail(
        memberId
      );


      try {

        if (
          CURRENT_USER !==
          memberId
        ) {

          return;
        }

      } catch {}


      /*
       * その後、公開設定だけ追加取得。
       */
      await loadPrivacy(
        memberId
      );
    };


  /*
   * すでにグループ一覧が表示済みの場合。
   */
  decorateGroupRows();

})();
