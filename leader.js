'use strict';

/* ============================================================
   みんやせ / leader.js
   2026-09-04 リーダー権限（1グループ最大5人）

   ・app.js と style.css は一切変更しない
   ・app.js のトップレベル関数を上書きして、リーダー用の
     表示と操作だけを足す（tsuda-fx.js と同じ方式）
   ・index.html に増やしたのは #manageLeaders ボタン1個だけ

   権限のまとめ
     オーナー … 全部できる（解散・リーダーの任命／解任を含む）
     リーダー … 解散とリーダーの任命／解任以外は全部できる
                （名前変更・スタート日・除名・除名リスト・参加コード）
                オーナーと他のリーダーは除名できない
     メンバー … 参加コードも管理ボタンも見えない
   ============================================================ */

(function () {

  /* ===== エラー文言を追加（ERR は app.js のトップレベル const） ===== */
  try {
    ERR.not_leader          = 'オーナーとリーダーだけが操作できます';
    ERR.cannot_kick_owner   = 'オーナーは除名できません';
    ERR.cannot_kick_leader  = 'リーダーを外せるのはオーナーだけです';
    ERR.leader_limit        = 'リーダーは5人までです';
    ERR.already_leader      = 'その人はすでにリーダーです';
    ERR.owner_is_not_leader = 'オーナーはリーダーに任命できません';
  } catch (e) {
    /* app.js が読めていない場合は何もしない */
    return;
  }

  const LEADER_MAX_FALLBACK = 5;

  const btnLeaders  = document.getElementById('manageLeaders');
  const btnDissolve = document.getElementById('dissolveGroup');

  /* サーバーが古い（can_manage を返さない）ときは
     オーナーだけが管理できる従来の動きに落ちる */
  function canManage(g) {
    return !!(g && (g.can_manage || g.is_owner));
  }

  function leaderMax(g) {
    return (g && g.leader_max) || LEADER_MAX_FALLBACK;
  }

  function canAppoint(g) {
    if (!g || !g.is_owner) return false;
    const n = g.leader_count == null ? 0 : Number(g.leader_count);
    return n < leaderMax(g);
  }

  const nameOf = x => (x && (x.nickname || x.member_id)) || '—';

  /* ============================================================
     グループカードの描画を差し替える
     ・参加コードはオーナーとリーダーに見せる
     ・#ownerTools はオーナーとリーダーに見せる
     ・#dissolveGroup はオーナーだけに見せる
     ============================================================ */
  const baseRenderGroup = window.renderGroup;

  window.renderGroup = function () {
    baseRenderGroup();

    const g = cache.group;

    if (!g) {
      if (btnLeaders) btnLeaders.hidden = true;
      return;
    }

    const manage = canManage(g);

    el.gCodeBox.hidden = !manage;

    if (manage) {
      el.gCode.textContent = fmtCode(g.code || g.group_id);
    }

    el.ownerTools.hidden = !manage;

    if (btnDissolve) {
      btnDissolve.hidden = !g.is_owner;
    }

    if (btnLeaders) {
      btnLeaders.hidden = !manage;

      btnLeaders.textContent = g.is_owner
        ? `リーダー（${g.leader_count == null ? 0 : g.leader_count}/${leaderMax(g)}）`
        : 'リーダー一覧';
    }

    /* オーナー以外（リーダーも）は「抜ける」を出す */
    el.memberTools.hidden = !!g.is_owner;
  };

  /* ============================================================
     ランキングに「オーナー」「リーダー」の印を足す
     ・元の drawRank を呼んだあとに、行の順番どおりに印を付ける
     ============================================================ */
  const baseDrawRank = window.drawRank;

  window.drawRank = function (data) {
    baseDrawRank(data);

    const rows = (data && data.rows) || [];
    const lis  = el.rankList.children;

    for (let i = 0; i < rows.length && i < lis.length; i++) {
      const nm = lis[i].querySelector('.nm');
      if (!nm) continue;

      if (rows[i].is_owner) {
        nm.appendChild(badge('オーナー'));
      } else if (rows[i].is_leader) {
        nm.appendChild(badge('リーダー'));
      }
    }
  };

  /* ============================================================
     メンバーの「⋯」メニューを差し替える
     ============================================================ */
  window.memberMenu = async function (r, data) {
    const g = data && data.group;

    const mine     = !!(g && g.is_mine !== false);
    const manage   = mine && canManage(g);
    const iAmOwner = mine && !!(g && g.is_owner);

    const ids = (g && g.leader_ids) || [];

    const targetIsOwner  = !!r.is_owner;
    const targetIsLeader = !!r.is_leader || ids.indexOf(r.member_id) >= 0;

    const acts = [];

    acts.push(
      r.is_rival
        ? { label: 'ライバルから外す', run: () => rivalDel(r) }
        : { label: 'ライバルに追加',   run: () => rivalAdd(r) }
    );

    acts.push({ label: 'この人を通報する',     run: () => doReport(r) });
    acts.push({ label: 'この人をブロックする', run: () => doBlock(r), danger: true });

    /* リーダーの任命・解任はオーナーだけ */
    if (iAmOwner && !targetIsOwner) {
      if (targetIsLeader) {
        acts.push({ label: 'リーダーを解任する', run: () => leaderRemove(r) });
      } else if (canAppoint(g)) {
        acts.push({ label: 'リーダーに任命する', run: () => leaderAppoint(r) });
      }
    }

    /* 除名。オーナーは対象外。リーダーを外せるのはオーナーだけ */
    if (manage && !targetIsOwner && (iAmOwner || !targetIsLeader)) {
      acts.push({ label: 'グループから除名する', run: () => doKick(r), danger: true });
    }

    const i = await menuSheet(
      who(r),
      '通報された内容は開発者が確認します。ブロックすると、その人はランキングに表示されなくなります。',
      acts
    );

    if (i >= 0 && acts[i]) {
      acts[i].run();
    }
  };

  /* ============================================================
     任命 / 解任
     ============================================================ */
  async function leaderAppoint(r) {
    const ok = await confirmSheet(
      `${who(r)} をリーダーに`,
      'リーダーは、グループ名の変更・スタート日の変更・メンバーの除名・除名リストの操作ができるようになります。解散はできません。',
      '任命する'
    );

    if (!ok) return;

    try {
      await api('/api/groups/leaders', {
        method: 'POST',
        body: { member_id: r.member_id },
      });

      await loadMe();
      loadRanking();

      say(el.rmsg, `${who(r)} をリーダーにしました`, true);

    } catch (e) {
      say(el.rmsg, emsg(e), false);
    }
  }

  async function leaderRemove(r) {
    const ok = await confirmSheet(
      `${who(r)} を解任`,
      'リーダーの権限だけを外します。グループには残ります。',
      '解任する',
      true
    );

    if (!ok) return;

    try {
      await api(
        '/api/groups/leaders/' + encodeURIComponent(r.member_id),
        { method: 'DELETE' }
      );

      await loadMe();
      loadRanking();

      say(el.rmsg, `${who(r)} を解任しました`, true);

    } catch (e) {
      say(el.rmsg, emsg(e), false);
    }
  }

  /* ============================================================
     「リーダー」ボタン
     ・オーナー → 一覧から解任、または候補から任命
     ・リーダー → 一覧の確認だけ
     ============================================================ */
  async function openLeaders() {
    let d;

    try {
      d = await api('/api/groups/leaders');
    } catch (e) {
      say(el.gmsg2, emsg(e), false);
      return;
    }

    const leaders = d.leaders || [];
    const max     = d.leader_max || LEADER_MAX_FALLBACK;

    if (!d.is_owner) {
      await alertSheet(
        `リーダー（${leaders.length}/${max}）`,
        leaders.length
          ? leaders.map(nameOf).join('、')
          : 'リーダーはまだ任命されていません。',
        '閉じる'
      );
      return;
    }

    const items = leaders.map(x => ({
      label: '解任：' + nameOf(x),
      danger: true,
      kind: 'del',
      t: x,
    }));

    if (leaders.length < max) {
      items.push({ label: '＋ リーダーを任命する', kind: 'add' });
    }

    const i = await menuSheet(
      `リーダー（${leaders.length}/${max}）`,
      `リーダーは解散以外の操作ができます。${max}人まで任命できます。`,
      items
    );

    if (i < 0 || !items[i]) return;

    if (items[i].kind === 'del') {
      await leaderRemove(items[i].t);
      return;
    }

    await appointFromList(d.candidates || []);
  }

  async function appointFromList(candidates) {
    if (!candidates.length) {
      say(el.gmsg2, '任命できるメンバーがいません', false);
      return;
    }

    const i = await menuSheet(
      'リーダーに任命',
      'グループのメンバーから選んでください。',
      candidates.map(x => ({ label: nameOf(x) }))
    );

    if (i < 0 || !candidates[i]) return;

    await leaderAppoint(candidates[i]);
  }

  if (btnLeaders) {
    btnLeaders.onclick = openLeaders;
  }

  /* app.js の起動処理がすでに走り終わっていた場合の作り直し */
  try {
    if (cache && cache.group) window.renderGroup();
  } catch (e) { /* noop */ }

})();
