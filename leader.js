'use strict';

/* ============================================================
   みんやせ / leader.js
   2026-09-10

   ・オーナー / リーダー権限
   ・個別体重非表示
   ・管理者シークレット固定
   ・本人による「増減量のみ表示」
   ・公開グループ参加前の公開範囲選択
   ・外部WEB連携対象グループの本人同意
   ・ブロック相手を含む管理用メンバー一覧
   ・1日 / 月曜日の体重未入力チェック
   ============================================================ */

(function () {
  'use strict';

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

    ERR.external_not_enabled =
      'このグループでは外部WEB連携を使用していません';

    ERR.bad_consent =
      '外部WEB連携の同意設定が不正です';

    ERR.blocked_relation =
      'ブロック関係にあるため操作できません';

    ERR.bad_missing_kind =
      '確認する日を選び直してください';

    ERR.group_not_started =
      '対象日はグループのスタート日前です';

  } catch {
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


  let externalConsentState =
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


  const groupStartText =
    g =>
      (
        g &&
        g.start_ymd
      ) ||
      '—';


  const groupShowsWeight =
    g =>
      !!(
        g &&
        g.show_weight
      );


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


        renderManageMembersButton(
          null
        );


        renderMissingWeightButton(
          null
        );


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


      renderManageMembersButton(
        g
      );


      renderMissingWeightButton(
        g
      );
    };


  /* ============================================================
     管理用メンバー一覧

     双方向ブロックで通常ランキングから消えていても
     オーナー・リーダーは管理できる。
     ============================================================ */

  function renderManageMembersButton(
    g
  ) {

    const tools =
      document.getElementById(
        'ownerTools'
      );


    if (
      !tools
    ) {

      return;
    }


    let button =
      document.getElementById(
        'manageMembersSafety'
      );


    if (
      !g ||
      !canManage(
        g
      )
    ) {

      if (
        button
      ) {

        button.hidden =
          true;
      }


      return;
    }


    if (
      !button
    ) {

      button =
        document.createElement(
          'button'
        );


      button.id =
        'manageMembersSafety';


      button.type =
        'button';


      button.className =
        'ghost sm';


      button.textContent =
        'メンバー管理';


      const bans =
        document.getElementById(
          'showBans'
        );


      if (
        bans
      ) {

        bans.insertAdjacentElement(
          'beforebegin',
          button
        );

      } else {

        tools.appendChild(
          button
        );
      }


      button.onclick =
        openManageMembers;
    }


    button.hidden =
      false;
  }


  async function openManageMembers() {

    let data;


    try {

      data =
        await api(
          '/api/groups/manage-members'
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


    const rows =
      data.rows ||
      [];


    if (
      !rows.length
    ) {

      await alertSheet(
        'メンバー管理',
        '管理できるメンバーがいません。',
        '閉じる'
      );


      return;
    }


    const items =
      rows.map(
        r => ({

          label:
            (
              r.is_owner
                ? '【オーナー】'
                : r.is_leader
                  ? '【リーダー】'
                  : ''
            ) +

            nameOf(
              r
            ) +

            (
              r.weight_locked
                ? (
                    r.weight_lock_kind ===
                      'self'
                      ? ' ／ 本人設定：増減量のみ'
                      : ' ／ シークレット固定'
                  )
                : r.weight_hidden
                  ? ' ／ 体重非表示'
                  : ''
            )

        })
      );


    const selected =
      await menuSheet(
        'メンバー管理',
        'ブロック状態にかかわらず、オーナー・リーダーは所属メンバーを管理できます。',
        items
      );


    if (
      selected <
        0 ||
      !rows[
        selected
      ]
    ) {

      return;
    }


    await window.memberMenu(
      rows[
        selected
      ],
      {

        group:
          data.group,

        management_only:
          true

      }
    );
  }


  /* ============================================================
     体重未入力チェック
     ============================================================ */

  function renderMissingWeightButton(
    g
  ) {

    const tools =
      document.getElementById(
        'ownerTools'
      );


    if (
      !tools
    ) {

      return;
    }


    let button =
      document.getElementById(
        'missingWeightCheck'
      );


    if (
      !g ||
      !canManage(
        g
      )
    ) {

      if (
        button
      ) {

        button.hidden =
          true;
      }


      return;
    }


    if (
      !button
    ) {

      button =
        document.createElement(
          'button'
        );


      button.id =
        'missingWeightCheck';


      button.type =
        'button';


      button.className =
        'ghost sm';


      button.textContent =
        '未入力チェック';


      const bans =
        document.getElementById(
          'showBans'
        );


      if (
        bans
      ) {

        bans.insertAdjacentElement(
          'beforebegin',
          button
        );

      } else {

        tools.appendChild(
          button
        );
      }


      button.onclick =
        openMissingWeightCheck;
    }


    button.hidden =
      false;
  }


  async function copyPlainText(
    value
  ) {

    const text =
      String(
        value ||
        ''
      );


    if (
      !text
    ) {

      return false;
    }


    try {

      if (
        navigator.clipboard &&
        typeof navigator.clipboard.writeText ===
          'function'
      ) {

        await navigator.clipboard
          .writeText(
            text
          );


        return true;
      }

    } catch {}


    let textarea =
      null;


    try {

      textarea =
        document.createElement(
          'textarea'
        );


      textarea.value =
        text;


      textarea.setAttribute(
        'readonly',
        ''
      );


      textarea.setAttribute(
        'aria-hidden',
        'true'
      );


      textarea.style.position =
        'fixed';


      textarea.style.left =
        '-9999px';


      textarea.style.top =
        '0';


      textarea.style.opacity =
        '0';


      textarea.style.pointerEvents =
        'none';


      document.body.appendChild(
        textarea
      );


      textarea.focus();


      textarea.select();


      if (
        typeof textarea.setSelectionRange ===
          'function'
      ) {

        textarea.setSelectionRange(
          0,
          textarea.value.length
        );
      }


      const copied =
        typeof document.execCommand ===
          'function' &&
        document.execCommand(
          'copy'
        );


      textarea.remove();


      return !!copied;

    } catch {

      if (
        textarea &&
        textarea.parentNode
      ) {

        textarea.parentNode
          .removeChild(
            textarea
          );
      }


      return false;
    }
  }


  async function openMissingWeightCheck() {

    const g =
      cache &&
      cache.group;


    if (
      !g ||
      !canManage(
        g
      )
    ) {

      return;
    }


    const selected =
      await menuSheet(

        '未入力チェック',

        '確認する日を選んでください。対象日に体重を実際に入力していないメンバーだけを確認します。',

        [
          {
            label:
              '今月1日'
          },

          {
            label:
              '今週月曜日'
          }
        ]

      );


    if (
      selected <
        0
    ) {

      return;
    }


    const kind =
      selected ===
        0
        ? 'month_start'
        : 'monday';


    let data;


    try {

      data =
        await api(

          '/api/groups/missing-weights?kind=' +
          encodeURIComponent(
            kind
          )

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


    if (
      !data ||
      data.available ===
        false
    ) {

      await alertSheet(

        '未入力チェック',

        (
          data &&
          data.message
        ) ||
        '対象日はグループのスタート日前です。',

        '閉じる'

      );


      return;
    }


    const text =
      String(
        data.text ||
        ''
      );


    if (
      !text
    ) {

      await alertSheet(
        '未入力チェック',
        '呼びかけ用テキストを作成できませんでした。',
        '閉じる'
      );


      return;
    }


    const missing =
      Number(
        data.missing_count ||
        0
      );


    const action =
      await menuSheet(

        missing > 0
          ? `未入力 ${missing}人`
          : '全員入力済み',

        text,

        [
          {
            label:
              'テキストをコピー'
          }
        ]

      );


    if (
      action !==
        0
    ) {

      return;
    }


    const copied =
      await copyPlainText(
        text
      );


    if (
      copied
    ) {

      await alertSheet(

        'コピーしました',

        'オープンチャットにそのまま貼り付けできます。',

        '閉じる'

      );


      return;
    }


    /*
     * Clipboard API と execCommand の両方が
     * 利用できない環境では、
     * native prompt に全文を出して
     * 長押しコピーできるようにする。
     */
    if (
      typeof window.prompt ===
        'function'
    ) {

      window.prompt(
        'コピーできなかったため、長押しで全文をコピーしてください。',
        text
      );


      return;
    }


    await alertSheet(

      'コピーできませんでした',

      text,

      '閉じる'

    );
  }


  /* ============================================================
     ランキング装飾
     ============================================================ */

  const baseDrawRank =
    window.drawRank;


  window.drawRank =
    function (
      data
    ) {

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


      const targetIsSelf =
        !!r.is_self ||
        !!(
          cache &&
          cache.me &&
          cache.me.member_id ===
            r.member_id
        );


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


      /*
       * 管理一覧の行にはis_rivalが無いので、
       * 通常ランキング由来のときだけライバル操作を出す。
       */
      if (
        !data ||
        !data.management_only
      ) {

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
      }


      /*
       * 本人設定・管理者固定は
       * オーナー / リーダーから解除不可。
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
              )

        });
      }


      if (
        !targetIsSelf
      ) {

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
      }


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
                ? '本人が「非公開（増減量のみ）」を選んでいます。実体重は表示されません。オーナー・リーダーから公開へ変更することはできません。'
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

        await acts[
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
          ? '本人が「非公開（増減量のみ）」を選んでいるため、オーナー・リーダーからは変更できません。'
          : '管理者によってシークレット固定されているため、オーナー・リーダーからは変更できません。';


      await alertSheet(
        '変更できません',
        text,
        '閉じる'
      );


      return;
    }


    const ok =
      await confirmSheet(

        hidden
          ? `${who(r)} の体重を非表示`
          : `${who(r)} の体重を表示`,

        hidden
          ? 'この人の実体重をランキングや公開データから隠します。増減量は引き続き表示されます。'
          : 'この人の実体重を、体重公開グループのランキングに再び表示します。',

        hidden
          ? '非表示にする'
          : '表示に戻す',

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
              !!hidden

          }

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
     リーダー任命 / 解任
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

          }

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
            x

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
     参加時：公開範囲の選択
     ============================================================ */

  async function chooseJoinPrivacy(
    g
  ) {

    /*
     * グループ自体が非公開なら本人選択なし。
     */
    if (
      !groupShowsWeight(
        g
      )
    ) {

      const ok =
        await confirmSheet(

          `${g.name} に参加`,

          (
            `スタート日：${
              groupStartText(
                g
              )
            }\n\n` +

            'このグループは「非公開（増減量のみ）」です。\n' +

            '実際の体重は他のメンバーには表示されません。'
          ),

          '次へ'

        );


      return ok
        ? true
        : null;
    }


    const i =
      await menuSheet(

        `${g.name} に参加`,

        (
          `スタート日：${
            groupStartText(
              g
            )
          }\n\n` +

          'このグループは体重公開グループです。\n' +

          '自分の体重の表示方法を選んでください。\n\n' +

          '非公開を選ぶと、実際の体重は表示せず増減量だけ表示します。'
        ),

        [

          {

            label:
              '非公開（増減量のみ）'

          },

          {

            label:
              '公開（体重＋増減量）'

          }

        ]

      );


    if (
      i <
        0
    ) {

      return null;
    }


    /*
     * 0 = 非公開
     * 1 = 公開
     */
    return i ===
      0;
  }


  /* ============================================================
     参加時：外部WEBへの共有同意
     ============================================================ */

  async function chooseExternalConsent(
    g,
    hidden
  ) {

    if (
      !g.external_enabled
    ) {

      return false;
    }


    const sharedText =
      hidden

        ? (
            '共有される情報：\n' +

            '・メンバーID\n' +

            '・記録日\n' +

            '・保存日時\n' +

            '・増減量\n\n' +

            '実際の体重は外部WEBへ送りません。'
          )

        : (
            '共有される情報：\n' +

            '・メンバーID\n' +

            '・記録日\n' +

            '・保存日時\n' +

            '・体重\n\n' +

            '外部WEB側で週次・月次・累計などを計算します。'
          );


    const i =
      await menuSheet(

        '外部WEBランキングへのデータ共有',

        (
          'このグループは外部WEBランキングと連携しています。\n\n' +

          sharedText +

          '\n\n同意しなくてもグループには参加できます。'
        ),

        [

          {

            label:
              '同意して参加'

          },

          {

            label:
              '同意せず参加'

          }

        ]

      );


    if (
      i <
        0
    ) {

      return null;
    }


    return i ===
      0;
  }


  /* ============================================================
     グループ参加
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


    /*
     * 旧版で常時表示していた公開設定UIを削除。
     */
    const old =
      document.getElementById(
        'joinPrivacyField'
      );


    if (
      old
    ) {

      old.remove();
    }


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


        let preview;


        try {

          preview =
            await api(

              '/api/groups?code=' +
              encodeURIComponent(
                value
              )

            );

        } catch (e) {

          say(
            el.gmsg,
            emsg(
              e
            ),
            false
          );


          return;
        }


        const g =
          preview &&
          preview.group;


        if (
          !g
        ) {

          say(
            el.gmsg,
            'グループ情報を取得できませんでした',
            false
          );


          return;
        }


        const hidden =
          await chooseJoinPrivacy(
            g
          );


        if (
          hidden ===
            null
        ) {

          return;
        }


        const externalConsent =
          await chooseExternalConsent(
            g,
            hidden
          );


        if (
          externalConsent ===
            null
        ) {

          return;
        }


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

                external_consent:
                  externalConsent

              }

            }
          );


          code.value =
            '';


          await loadMe();


          await loadRanking();


          say(
            el.gmsg2,

            hidden
              ? '参加しました（非公開・増減量のみ）'
              : '参加しました（体重公開）',

            true
          );


          await loadSelfPrivacy();


          await loadExternalConsent();

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
     マイページ：本人の体重公開設定
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
            非公開（増減量のみ）
          </span>

        </label>

        <p class="note">
          実際の体重は他のメンバーに表示せず、増減量だけ表示します。
        </p>

        <label class="chk">

          <input
            type="radio"
            name="selfWeightPrivacy"
            id="selfWeightPublic"
            value="public"
          >

          <span>
            公開（体重＋増減量）
          </span>

        </label>

        <p class="note">
          体重公開グループでは、実際の体重と増減量の両方を表示します。
        </p>

        <p
          class="msg"
          id="selfWeightPrivacyMsg"
        ></p>
      `;


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


    const groupPrivate =
      !!(
        cache &&
        cache.group &&
        cache.group.show_weight ===
          false
      );


    const isHidden =
      groupPrivate ||
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
        groupPrivate ||
        adminLocked;
    }


    if (
      publicRadio
    ) {

      publicRadio.checked =
        !isHidden;


      publicRadio.disabled =
        groupPrivate ||
        adminLocked;
    }


    if (
      !msg
    ) {

      return;
    }


    if (
      groupPrivate
    ) {

      msg.textContent =
        'このグループは「非公開（増減量のみ）」固定です。実際の体重は他のメンバーに表示されません。';

    } else if (
      adminLocked
    ) {

      msg.textContent =
        '管理者によって「非公開（増減量のみ）」に固定されています。';

    } else if (
      isHidden
    ) {

      msg.textContent =
        '現在、実際の体重は他のメンバーに表示されません。';

    } else {

      msg.textContent =
        '現在、実際の体重と増減量が表示されます。';
    }


    msg.className =
      'msg';
  }


  async function loadSelfPrivacy() {

    const card =
      installSelfPrivacyCard();


    if (
      !card
    ) {

      return;
    }


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


  async function saveSelfPrivacy(
    hidden
  ) {

    const groupPrivate =
      !!(
        cache &&
        cache.group &&
        cache.group.show_weight ===
          false
      );


    if (
      groupPrivate
    ) {

      await alertSheet(

        '変更できません',

        'このグループは「非公開（増減量のみ）」固定です。',

        '閉じる'

      );


      await loadSelfPrivacy();


      return;
    }


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
                !!hidden

            }

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
            ? '非公開（増減量のみ）に変更しました'
            : '公開（体重＋増減量）に変更しました';


        msg.className =
          'msg';
      }


      await loadRanking();

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


      await loadSelfPrivacy();
    }
  }


  /* ============================================================
     マイページ：外部WEB連携同意
     ============================================================ */

  function installExternalConsentCard() {

    let card =
      document.getElementById(
        'externalConsentCard'
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
      'externalConsentCard';


    card.className =
      'card';


    card.hidden =
      true;


    card.innerHTML =
      `
        <h2 class="h2">
          外部WEBランキングへのデータ共有
        </h2>

        <p class="note">
          このグループは外部WEBランキングと連携しています。
          同意した場合だけデータを送信します。
        </p>

        <label class="chk">

          <input
            type="checkbox"
            id="externalConsentOn"
          >

          <span>
            外部WEBランキングへの共有に同意する
          </span>

        </label>

        <p
          class="note"
          id="externalConsentDetail"
        >
          体重公開の場合は、メンバーID・記録日・保存日時・体重を共有します。
          体重非公開の場合は、実体重を送らず、メンバーID・記録日・保存日時・増減量のみ共有します。
        </p>

        <p
          class="msg"
          id="externalConsentMsg"
        ></p>
      `;


    const privacyCard =
      installSelfPrivacyCard();


    if (
      privacyCard
    ) {

      privacyCard.insertAdjacentElement(
        'afterend',
        card
      );

    } else {

      view.appendChild(
        card
      );
    }


    const input =
      document.getElementById(
        'externalConsentOn'
      );


    if (
      input
    ) {

      input.addEventListener(
        'change',
        () => {

          saveExternalConsent(
            !!input.checked
          );
        }
      );
    }


    return card;
  }


  function renderExternalConsent(
    data
  ) {

    externalConsentState =
      data;


    const card =
      installExternalConsentCard();


    if (
      !card
    ) {

      return;
    }


    const enabled =
      !!(
        data &&
        data.enabled
      );


    card.hidden =
      !enabled;


    if (
      !enabled
    ) {

      return;
    }


    const input =
      document.getElementById(
        'externalConsentOn'
      );


    const msg =
      document.getElementById(
        'externalConsentMsg'
      );


    if (
      input
    ) {

      input.checked =
        !!data.consented;


      input.disabled =
        false;
    }


    if (
      msg
    ) {

      msg.textContent =
        data.consented
          ? '現在、外部WEBランキングへの共有に同意しています。'
          : '現在、外部WEBへのデータ送信は行いません。';


      msg.className =
        'msg';
    }
  }


  async function loadExternalConsent() {

    const card =
      installExternalConsentCard();


    if (
      !card
    ) {

      return;
    }


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
          '/api/me/external-consent'
        );


      renderExternalConsent(
        data
      );

    } catch {

      card.hidden =
        true;
    }
  }


  async function saveExternalConsent(
    consented
  ) {

    const input =
      document.getElementById(
        'externalConsentOn'
      );


    const msg =
      document.getElementById(
        'externalConsentMsg'
      );


    if (
      input
    ) {

      input.disabled =
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
          '/api/me/external-consent',
          {

            method:
              'POST',

            body: {

              consented:
                !!consented

            }

          }
        );


      renderExternalConsent(
        data
      );


      if (
        msg
      ) {

        msg.textContent =
          consented
            ? '外部WEBランキングへの共有に同意しました'
            : '外部WEBランキングへの共有を停止しました';


        msg.className =
          'msg';
      }

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


      await loadExternalConsent();
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


            loadExternalConsent();

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


  installExternalConsentCard();


  try {

    if (
      cache &&
      cache.group
    ) {

      window.renderGroup();
    }

  } catch {}

})();
