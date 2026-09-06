'use strict';

/* ============================================================
   みんやせ / leader.js
   2026-09-06 リーダー権限 + 個別体重非表示

   ・app.js と style.css は変更しない
   ・app.js のトップレベル関数を上書きして、
     リーダー用表示と操作を追加
   ・体重公開グループでも個別ユーザーを
     「変化量だけ表示」にできる

   権限
     オーナー … 全部できる
     リーダー … 解散とリーダー任命／解任以外
                + 個別体重表示設定
     メンバー … 管理操作なし
   ============================================================ */

(function () {

  /* ===== エラー文言 ===== */
  try {
    ERR.not_leader          = 'オーナーとリーダーだけが操作できます';
    ERR.cannot_kick_owner   = 'オーナーは除名できません';
    ERR.cannot_kick_leader  = 'リーダーを外せるのはオーナーだけです';
    ERR.leader_limit        = 'リーダーは5人までです';
    ERR.already_leader      = 'その人はすでにリーダーです';
    ERR.owner_is_not_leader = 'オーナーはリーダーに任命できません';
    ERR.bad_hidden          = '体重公開設定の値が不正です';
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
                  leaderMax(g)
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

        const nm =
          lis[i]
            .querySelector(
              '.nm'
            );


        if (!nm) {
          continue;
        }


        if (
          rows[i].is_owner
        ) {

          nm.appendChild(
            badge(
              'オーナー'
            )
          );

        } else if (
          rows[i].is_leader
        ) {

          nm.appendChild(
            badge(
              'リーダー'
            )
          );
        }


        if (
          manage &&
          rows[i].weight_hidden
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
       * オーナー / リーダーだけ
       */
      if (
        manage
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


      /* リーダー任命 / 解任 */
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


      /* 除名 */
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


      const i =
        await menuSheet(
          who(
            r
          ),
          '体重非表示にすると実体重は表示されず、減量幅だけが表示されます。通報された内容は開発者が確認します。',
          acts
        );


      if (
        i >= 0 &&
        acts[i]
      ) {

        acts[i].run();
      }
    };


  /* ============================================================
     体重公開設定
     ============================================================ */

  async function changeWeightPrivacy(
    r,
    hidden
  ) {

    const title =
      hidden
        ? `${who(r)} の体重を非表示`
        : `${who(r)} の体重を表示`;


    const message =
      hidden
        ? 'この人の実体重をランキングや公開データから隠します。減量幅は引き続き表示されます。'
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


    if (!ok) {
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
     任命 / 解任
     ============================================================ */

  async function leaderAppoint(r) {

    const ok =
      await confirmSheet(
        `${who(r)} をリーダーに`,
        'リーダーは、グループ名の変更・スタート日の変更・メンバーの除名・除名リストの操作・個別の体重公開設定ができるようになります。解散はできません。',
        '任命する'
      );


    if (!ok) {
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


  async function leaderRemove(r) {

    const ok =
      await confirmSheet(
        `${who(r)} を解任`,
        'リーダーの権限だけを外します。グループには残ります。',
        '解任する',
        true
      );


    if (!ok) {
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
      i < 0 ||
      !items[i]
    ) {
      return;
    }


    if (
      items[i].kind ===
        'del'
    ) {

      await leaderRemove(
        items[i].t
      );

      return;
    }


    await appointFromList(
      d.candidates ||
      []
    );
  }


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
      i < 0 ||
      !candidates[i]
    ) {
      return;
    }


    await leaderAppoint(
      candidates[i]
    );
  }


  if (
    btnLeaders
  ) {

    btnLeaders.onclick =
      openLeaders;
  }


  try {

    if (
      cache &&
      cache.group
    ) {

      window.renderGroup();
    }

  } catch (e) {}
})();
