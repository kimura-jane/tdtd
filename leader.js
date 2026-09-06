'use strict';

/* ============================================================
   みんやせ / leader.js
   2026-09-06

   ・リーダー権限
   ・個別体重非表示
   ・管理者シークレット固定
   ・本人による「増減量のみ表示」
   ・グループ参加時の体重公開選択

   権限
   ------------------------------------------------------------
   通常公開
     本人           → 非公開に変更可
     オーナー       → 非公開に変更可
     リーダー       → 非公開に変更可
     管理者         → 変更可

   本人が増減量のみ
     本人           → 公開へ戻せる
     オーナー       → 解除不可
     リーダー       → 解除不可
     管理者         → 解除可

   オーナー / リーダーが非公開
     本人           → 公開へ戻せる
     オーナー       → 解除可
     リーダー       → 解除可
     管理者         → 解除可

   管理者シークレット固定
     本人           → 解除不可
     オーナー       → 解除不可
     リーダー       → 解除不可
     管理者         → 解除可
   ============================================================ */

(function () {

  /* ============================================================
     エラー文言
     ============================================================ */

  try {

    ERR.not_leader =
      'オーナーとリーダーだけが操作できます';

    ERR.cannot_kick_owner =
      'オーナーは除名できません';

    ERR.cannot_kick_leader =
      'リーダーを外せるのはオーナーだけです';

    ERR.leader_limit =
      'リーダーは5人までです';

    ERR.already_leader =
      'その人はすでにリーダーです';

    ERR.owner_is_not_leader =
      'オーナーはリーダーに任命できません';

    ERR.bad_hidden =
      '体重公開設定の値が不正です';

    ERR.weight_privacy_locked =
      'この体重公開設定は変更できません';

  } catch (e) {

    return;
  }


  const LEADER_MAX_FALLBACK =
    5;


  const btnLeaders =
    document.getElementById(
      'manageLeaders'
    );


  const btnDissolve =
    document.getElementById(
      'dissolveGroup'
    );


  let selfPrivacyState =
    null;


/* ============================================================
   共通
   ============================================================ */

  function canManage(g) {

    return !!(
      g &&
      (
        g.can_manage ||
        g.is_owner
      )
    );
  }


  function leaderMax(g) {

    return (
      g &&
      g.leader_max
    ) ||
    LEADER_MAX_FALLBACK;
  }


  function canAppoint(g) {

    if (
      !g ||
      !g.is_owner
    ) {

      return false;
    }


    const n =
      g.leader_count ==
        null
        ? 0
        : Number(
            g.leader_count
          );


    return n <
      leaderMax(
        g
      );
  }


  const nameOf =
    x =>
      (
        x &&
        (
          x.nickname ||
          x.member_id
        )
      ) ||
      '—';


/* ============================================================
   グループカード
   ============================================================ */

  const baseRenderGroup =
    window.renderGroup;


  window.renderGroup =
    function () {

      baseRenderGroup();


      const g =
        cache.group;


      if (!g) {

        if (
          btnLeaders
        ) {

          btnLeaders.hidden =
            true;
        }


        return;
      }


      const manage =
        canManage(
          g
        );


      el.gCodeBox.hidden =
        !manage;


      if (
        manage
      ) {

        el.gCode.textContent =
          fmtCode(
            g.code ||
            g.group_id
          );
      }


      el.ownerTools.hidden =
        !manage;


      if (
        btnDissolve
      ) {

        btnDissolve.hidden =
          !g.is_owner;
      }


      if (
        btnLeaders
      ) {

        btnLeaders.hidden =
          !manage;


        btnLeaders.textContent =
          g.is_owner
            ? (
                `リーダー（${
                  g.leader_count ==
                    null
                    ? 0
                    : g.leader_count
                }/${
                  leaderMax(
                    g
                  )
                }）`
              )
            : 'リーダー一覧';
      }


      el.memberTools.hidden =
        !!g.is_owner;
    };


/* ============================================================
   ランキング装飾
   ============================================================ */

  const baseDrawRank =
    window.drawRank;


  window.drawRank =
    function (data) {

      baseDrawRank(
        data
      );


      const rows =
        (
          data &&
          data.rows
        ) ||
        [];


      const lis =
        el.rankList.children;


      const manage =
        !!(
          data &&
          data.group &&
          canManage(
            data.group
          )
        );


      for (
        let i = 0;
        i < rows.length &&
        i < lis.length;
        i++
      ) {

        const row =
          rows[
            i
          ];


        const nm =
          lis[
            i
          ]
            .querySelector(
              '.nm'
            );


        if (
          !nm
        ) {

          continue;
        }


        if (
          row.is_owner
        ) {

          nm.appendChild(
            badge(
              'オーナー'
            )
          );

        } else if (
          row.is_leader
        ) {

          nm.appendChild(
            badge(
              'リーダー'
            )
          );
        }


        if (
          manage &&
          row.weight_locked
        ) {

          nm.appendChild(
            badge(
              row.weight_lock_kind ===
                'self'
                ? '本人設定：増減量のみ'
                : 'シークレット固定'
            )
          );

        } else if (
          manage &&
          row.weight_hidden
        ) {

          nm.appendChild(
            badge(
              '体重非表示'
            )
          );
        }
      }
    };


/* ============================================================
   メンバー「⋯」
   ============================================================ */

  window.memberMenu =
    async function (
      r,
      data
    ) {

      const g =
        data &&
        data.group;


      const mine =
        !!(
          g &&
          g.is_mine !==
            false
        );


      const manage =
        mine &&
        canManage(
          g
        );


      const iAmOwner =
        mine &&
        !!(
          g &&
          g.is_owner
        );


      const ids =
        (
          g &&
          g.leader_ids
        ) ||
        [];


      const targetIsOwner =
        !!r.is_owner;


      const targetIsLeader =
        !!r.is_leader ||
        ids.indexOf(
          r.member_id
        ) >=
          0;


      const acts =
        [];


      acts.push(
        r.is_rival
          ? {
              label:
                'ライバルから外す',

              run:
                () =>
                  rivalDel(
                    r
                  )
            }
          : {
              label:
                'ライバルに追加',

              run:
                () =>
                  rivalAdd(
                    r
                  )
            }
      );


      /*
       * 本人設定・管理者固定されている人は
       * オーナー / リーダーから変更不可。
       */
      if (
        manage &&
        !r.weight_locked
      ) {

        acts.push({
          label:
            r.weight_hidden
              ? '体重を表示に戻す'
              : '体重を非表示にする',

          run:
            () =>
              changeWeightPrivacy(
                r,
                !r.weight_hidden
              ),
        });
      }


      acts.push({
        label:
          'この人を通報する',

        run:
          () =>
            doReport(
              r
            )
      });


      acts.push({
        label:
          'この人をブロックする',

        run:
          () =>
            doBlock(
              r
            ),

        danger:
          true
      });


      /* ========================================================
         リーダー任命 / 解任
         ======================================================== */

      if (
        iAmOwner &&
        !targetIsOwner
      ) {

        if (
          targetIsLeader
        ) {

          acts.push({
            label:
              'リーダーを解任する',

            run:
              () =>
                leaderRemove(
                  r
                )
          });

        } else if (
          canAppoint(
            g
          )
        ) {

          acts.push({
            label:
              'リーダーに任命する',

            run:
              () =>
                leaderAppoint(
                  r
                )
          });
        }
      }


      /* ========================================================
         除名
         ======================================================== */

      if (
        manage &&
        !targetIsOwner &&
        (
          iAmOwner ||
          !targetIsLeader
        )
      ) {

        acts.push({
          label:
            'グループから除名する',

          run:
            () =>
              doKick(
                r
              ),

          danger:
            true
        });
      }


      const note =
        r.weight_locked
          ? (
              r.weight_lock_kind ===
                'self'
                ? '本人が「増減量のみ表示」を選んでいます。実体重は表示されません。オーナー・リーダーから公開へ変更することはできません。'
                : 'このメンバーの体重は管理者によってシークレット固定されています。実体重は表示されず、増減量だけが表示されます。固定の解除は管理者だけができます。'
            )
          : '体重非表示にすると実体重は表示されず、増減量だけが表示されます。通報された内容は開発者が確認します。';


      const i =
        await menuSheet(
          who(
            r
          ),
          note,
          acts
        );


      if (
        i >=
          0 &&
        acts[
          i
        ]
      ) {

        acts[
          i
        ].run();
      }
    };


/* ============================================================
   オーナー / リーダーによる体重公開設定
   ============================================================ */

  async function changeWeightPrivacy(
    r,
    hidden
  ) {

    if (
      r.weight_locked
    ) {

      const text =
        r.weight_lock_kind ===
          'self'
          ? '本人が「増減量のみ表示」を選んでいるため、オーナー・リーダーからは変更できません。'
          : '管理者によってシークレット固定されているため、オーナー・リーダーからは変更できません。';


      await alertSheet(
        '変更できません',
        text,
        '閉じる'
      );


      return;
    }


    const title =
      hidden
        ? `${who(r)} の体重を非表示`
        : `${who(r)} の体重を表示`;


    const message =
      hidden
        ? 'この人の実体重をランキングや公開データから隠します。増減量は引き続き表示されます。'
        : 'この人の実体重を、体重公開グループのランキングに再び表示します。';


    const button =
      hidden
        ? '非表示にする'
        : '表示に戻す';


    const ok =
      await confirmSheet(
        title,
        message,
        button,
        hidden
          ? true
          : false
      );


    if (
      !ok
    ) {

      return;
    }


    try {

      await api(
        '/api/groups/weight-privacy',
        {
          method:
            'POST',

          body: {
            member_id:
              r.member_id,

            hidden:
              !!hidden,
          },
        }
      );


      r.weight_hidden =
        !!hidden;


      await loadRanking();


      say(
        el.rmsg,
        hidden
          ? `${who(r)} の体重を非表示にしました`
          : `${who(r)} の体重を表示に戻しました`,
        true
      );

    } catch (e) {

      say(
        el.rmsg,
        emsg(
          e
        ),
        false
      );
    }
  }


/* ============================================================
   リーダー任命
   ============================================================ */

  async function leaderAppoint(
    r
  ) {

    const ok =
      await confirmSheet(
        `${who(r)} をリーダーに`,
        'リーダーは、グループ名の変更・スタート日の変更・メンバーの除名・除名リストの操作・個別の体重公開設定ができるようになります。解散はできません。',
        '任命する'
      );


    if (
      !ok
    ) {

      return;
    }


    try {

      await api(
        '/api/groups/leaders',
        {
          method:
            'POST',

          body: {
            member_id:
              r.member_id
          },
        }
      );


      await loadMe();


      loadRanking();


      say(
        el.rmsg,
        `${who(r)} をリーダーにしました`,
        true
      );

    } catch (e) {

      say(
        el.rmsg,
        emsg(
          e
        ),
        false
      );
    }
  }


/* ============================================================
   リーダー解任
   ============================================================ */

  async function leaderRemove(
    r
  ) {

    const ok =
      await confirmSheet(
        `${who(r)} を解任`,
        'リーダーの権限だけを外します。グループには残ります。',
        '解任する',
        true
      );


    if (
      !ok
    ) {

      return;
    }


    try {

      await api(
        '/api/groups/leaders/' +
        encodeURIComponent(
          r.member_id
        ),
        {
          method:
            'DELETE'
        }
      );


      await loadMe();


      loadRanking();


      say(
        el.rmsg,
        `${who(r)} を解任しました`,
        true
      );

    } catch (e) {

      say(
        el.rmsg,
        emsg(
          e
        ),
        false
      );
    }
  }


/* ============================================================
   リーダー一覧
   ============================================================ */

  async function openLeaders() {

    let d;


    try {

      d =
        await api(
          '/api/groups/leaders'
        );

    } catch (e) {

      say(
        el.gmsg2,
        emsg(
          e
        ),
        false
      );


      return;
    }


    const leaders =
      d.leaders ||
      [];


    const max =
      d.leader_max ||
      LEADER_MAX_FALLBACK;


    if (
      !d.is_owner
    ) {

      await alertSheet(
        `リーダー（${leaders.length}/${max}）`,
        leaders.length
          ? leaders
              .map(
                nameOf
              )
              .join(
                '、'
              )
          : 'リーダーはまだ任命されていません。',
        '閉じる'
      );


      return;
    }


    const items =
      leaders.map(
        x => ({
          label:
            '解任：' +
            nameOf(
              x
            ),

          danger:
            true,

          kind:
            'del',

          t:
            x,
        })
      );


    if (
      leaders.length <
        max
    ) {

      items.push({
        label:
          '＋ リーダーを任命する',

        kind:
          'add'
      });
    }


    const i =
      await menuSheet(
        `リーダー（${leaders.length}/${max}）`,
        `リーダーは解散以外の操作と個別の体重公開設定ができます。${max}人まで任命できます。`,
        items
      );


    if (
      i <
        0 ||
      !items[
        i
      ]
    ) {

      return;
    }


    if (
      items[
        i
      ].kind ===
        'del'
    ) {

      await leaderRemove(
        items[
          i
        ].t
      );


      return;
    }


    await appointFromList(
      d.candidates ||
      []
    );
  }


/* ============================================================
   リーダー候補
   ============================================================ */

  async function appointFromList(
    candidates
  ) {

    if (
      !candidates.length
    ) {

      say(
        el.gmsg2,
        '任命できるメンバーがいません',
        false
      );


      return;
    }


    const i =
      await menuSheet(
        'リーダーに任命',
        'グループのメンバーから選んでください。',
        candidates.map(
          x => ({
            label:
              nameOf(
                x
              )
          })
        )
      );


    if (
      i <
        0 ||
      !candidates[
        i
      ]
    ) {

      return;
    }


    await leaderAppoint(
      candidates[
        i
      ]
    );
  }


  if (
    btnLeaders
  ) {

    btnLeaders.onclick =
      openLeaders;
  }


/* ============================================================
   グループ参加時の体重公開設定
   ============================================================ */

  function installJoinPrivacy() {

    const box =
      document.getElementById(
        'noGroupBox'
      );


    const code =
      document.getElementById(
        'joinCode'
      );


    const button =
      document.getElementById(
        'doJoin'
      );


    if (
      !box ||
      !code ||
      !button
    ) {

      return;
    }


    if (
      document.getElementById(
        'joinPrivacyField'
      )
    ) {

      return;
    }


    const field =
      document.createElement(
        'div'
      );


    field.id =
      'joinPrivacyField';


    field.className =
      'field';


    field.innerHTML =
      `
        <div class="lbl">
          グループでの体重表示
        </div>

        <label class="chk">
          <input
            type="radio"
            name="joinWeightPrivacy"
            value="hidden"
            checked
          >

          <span>
            体重は公開しない
          </span>
        </label>

        <p class="note">
          実際の体重は表示せず、
          増減量だけ表示します。
        </p>

        <label class="chk">
          <input
            type="radio"
            name="joinWeightPrivacy"
            value="public"
          >

          <span>
            体重を公開する
          </span>
        </label>

        <p class="note">
          体重公開グループでは、
          実際の体重と増減量の両方を表示します。
          グループ自体が体重非公開の場合は、
          どちらを選んでも実体重は表示されません。
        </p>
      `;


    const joinRow =
      code.closest(
        '.past-row'
      );


    if (
      joinRow
    ) {

      joinRow.insertAdjacentElement(
        'beforebegin',
        field
      );

    } else {

      box.appendChild(
        field
      );
    }


    /*
     * app.jsの参加ボタン処理を上書きする。
     *
     * 初期値は非公開。
     */
    button.onclick =
      async () => {

        const value =
          code.value
            .trim();


        if (
          !value
        ) {

          say(
            el.gmsg,
            'コードを入力してください',
            false
          );


          return;
        }


        const selected =
          document.querySelector(
            'input[name="joinWeightPrivacy"]:checked'
          );


        const hidden =
          !selected ||
          selected.value ===
            'hidden';


        try {

          await api(
            '/api/groups/join',
            {
              method:
                'POST',

              body: {
                code:
                  value,

                weight_hidden:
                  hidden,
              },
            }
          );


          code.value =
            '';


          /*
           * 次回表示時も初期値を
           * 「体重非公開」に戻す。
           */
          const hiddenRadio =
            document.querySelector(
              'input[name="joinWeightPrivacy"][value="hidden"]'
            );


          if (
            hiddenRadio
          ) {

            hiddenRadio.checked =
              true;
          }


          await loadMe();


          loadRanking();


          say(
            el.gmsg2,
            '参加しました',
            true
          );


          await loadSelfPrivacy();

        } catch (e) {

          say(
            el.gmsg,
            emsg(
              e
            ),
            false
          );
        }
      };
  }


/* ============================================================
   マイページ
   ============================================================ */

  function installSelfPrivacyCard() {

    let card =
      document.getElementById(
        'selfWeightPrivacyCard'
      );


    if (
      card
    ) {

      return card;
    }


    const view =
      document.getElementById(
        'view-my'
      );


    if (
      !view
    ) {

      return null;
    }


    card =
      document.createElement(
        'section'
      );


    card.id =
      'selfWeightPrivacyCard';


    card.className =
      'card';


    card.hidden =
      true;


    card.innerHTML =
      `
        <h2 class="h2">
          グループでの体重表示
        </h2>

        <label class="chk">

          <input
            type="radio"
            name="selfWeightPrivacy"
            id="selfWeightHidden"
            value="hidden"
          >

          <span>
            増減量のみ表示
          </span>

        </label>

        <p class="note">
          実際の体重は他のメンバーに表示せず、
          増減量だけ表示します。
        </p>

        <label class="chk">

          <input
            type="radio"
            name="selfWeightPrivacy"
            id="selfWeightPublic"
            value="public"
          >

          <span>
            体重を公開
          </span>

        </label>

        <p class="note">
          体重公開グループでは、
          実際の体重と増減量の両方を表示します。
        </p>

        <p
          class="msg"
          id="selfWeightPrivacyMsg"
        ></p>
      `;


    /*
     * 通知設定カードの直前に入れる。
     */
    const notify =
      document.getElementById(
        'notifyOn'
      );


    const notifyCard =
      notify
        ? notify.closest(
            'section.card'
          )
        : null;


    if (
      notifyCard
    ) {

      notifyCard.insertAdjacentElement(
        'beforebegin',
        card
      );

    } else {

      view.appendChild(
        card
      );
    }


    const hidden =
      document.getElementById(
        'selfWeightHidden'
      );


    const publicRadio =
      document.getElementById(
        'selfWeightPublic'
      );


    if (
      hidden
    ) {

      hidden.addEventListener(
        'change',
        () => {

          if (
            hidden.checked
          ) {

            saveSelfPrivacy(
              true
            );
          }
        }
      );
    }


    if (
      publicRadio
    ) {

      publicRadio.addEventListener(
        'change',
        () => {

          if (
            publicRadio.checked
          ) {

            saveSelfPrivacy(
              false
            );
          }
        }
      );
    }


    return card;
  }


/* ============================================================
   本人設定表示
   ============================================================ */

  function renderSelfPrivacy(
    data
  ) {

    selfPrivacyState =
      data;


    const card =
      installSelfPrivacyCard();


    if (
      !card
    ) {

      return;
    }


    const hidden =
      document.getElementById(
        'selfWeightHidden'
      );


    const publicRadio =
      document.getElementById(
        'selfWeightPublic'
      );


    const msg =
      document.getElementById(
        'selfWeightPrivacyMsg'
      );


    card.hidden =
      false;


    const isHidden =
      !!(
        data &&
        data.weight_hidden
      );


    const adminLocked =
      !!(
        data &&
        data.weight_locked &&
        data.weight_lock_kind ===
          'admin'
      );


    if (
      hidden
    ) {

      hidden.checked =
        isHidden;


      hidden.disabled =
        adminLocked;
    }


    if (
      publicRadio
    ) {

      publicRadio.checked =
        !isHidden;


      publicRadio.disabled =
        adminLocked;
    }


    if (
      msg
    ) {

      if (
        adminLocked
      ) {

        msg.textContent =
          '管理者によって「増減量のみ表示」に固定されています。';


        msg.className =
          'msg';

      } else if (
        isHidden
      ) {

        msg.textContent =
          '現在、実際の体重は他のメンバーに表示されません。';


        msg.className =
          'msg';

      } else {

        msg.textContent =
          '現在、体重公開グループでは実際の体重も表示されます。';


        msg.className =
          'msg';
      }
    }
  }


/* ============================================================
   本人設定取得
   ============================================================ */

  async function loadSelfPrivacy() {

    const card =
      installSelfPrivacyCard();


    if (
      !card
    ) {

      return;
    }


    /*
     * 未所属なら設定カードを隠す。
     */
    if (
      !cache ||
      !cache.me ||
      !cache.me.in_group
    ) {

      card.hidden =
        true;


      return;
    }


    try {

      const data =
        await api(
          '/api/me/weight-privacy'
        );


      renderSelfPrivacy(
        data
      );

    } catch (e) {

      if (
        e &&
        e.message ===
          'not_in_group'
      ) {

        card.hidden =
          true;


        return;
      }


      const msg =
        document.getElementById(
          'selfWeightPrivacyMsg'
        );


      if (
        msg
      ) {

        msg.textContent =
          emsg(
            e
          );


        msg.className =
          'msg';
      }
    }
  }


/* ============================================================
   本人設定保存
   ============================================================ */

  async function saveSelfPrivacy(
    hidden
  ) {

    const msg =
      document.getElementById(
        'selfWeightPrivacyMsg'
      );


    const hiddenRadio =
      document.getElementById(
        'selfWeightHidden'
      );


    const publicRadio =
      document.getElementById(
        'selfWeightPublic'
      );


    if (
      hiddenRadio
    ) {

      hiddenRadio.disabled =
        true;
    }


    if (
      publicRadio
    ) {

      publicRadio.disabled =
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
        await api(
          '/api/me/weight-privacy',
          {
            method:
              'POST',

            body: {
              hidden:
                !!hidden,
            },
          }
        );


      renderSelfPrivacy(
        data
      );


      if (
        msg
      ) {

        msg.textContent =
          hidden
            ? '増減量のみ表示に変更しました'
            : '体重を公開する設定に変更しました';


        msg.className =
          'msg';
      }


      /*
       * 自分のランキング表示も更新。
       */
      loadRanking();

    } catch (e) {

      if (
        msg
      ) {

        msg.textContent =
          emsg(
            e
          );


        msg.className =
          'msg';
      }


      /*
       * 保存に失敗したらサーバー状態を再取得。
       */
      await loadSelfPrivacy();
    }
  }


/* ============================================================
   マイページを開いたとき
   ============================================================ */

  const myTab =
    document.querySelector(
      '.tabbtn[data-v="my"]'
    );


  if (
    myTab
  ) {

    myTab.addEventListener(
      'click',
      () => {

        setTimeout(
          () => {

            loadSelfPrivacy();

          },
          0
        );
      }
    );
  }


/* ============================================================
   初期処理
   ============================================================ */

  installJoinPrivacy();


  installSelfPrivacyCard();


  try {

    if (
      cache &&
      cache.group
    ) {

      window.renderGroup();
    }

  } catch (e) {}


})();
