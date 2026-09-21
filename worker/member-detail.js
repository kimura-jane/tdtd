'use strict';

import {
  json,
  bad,
  round1
} from './lib.js';

import {
  isWeightHidden
} from './weight-privacy.js';


const MEMBER_ID_RE =
  /^[0-9A-Z]{6,32}$/;


/* ============================================================
   member_id
   ============================================================ */

function normalizeMemberId(raw) {

  const id =
    String(
      raw ||
      ''
    )
      .trim()
      .toUpperCase();

  return MEMBER_ID_RE
    .test(id)
      ? id
      : null;
}


/* ============================================================
   アイコン
   ============================================================ */

function iconUrlOf(
  memberId,
  iconVer
) {

  const version =
    Number(
      iconVer ||
      0
    );

  if (
    !memberId ||
    version <= 0
  ) {

    return null;
  }

  return (
    '/i/' +
    memberId +
    '.jpg?v=' +
    version
  );
}


/* ============================================================
   閲覧可能なグループか

   ・自分の所属グループ
   ・「他のチームを見る」に追加済みのグループ

   だけ許可する。
   ============================================================ */

async function canViewGroup(
  env,
  dev,
  groupId
) {

  if (
    !dev ||
    !groupId
  ) {

    return false;
  }

  if (
    dev.group_id ===
      groupId
  ) {

    return true;
  }

  const watched =
    await env.DB
      .prepare(`
        SELECT group_id
        FROM watching
        WHERE
          device_id=?
          AND group_id=?
      `)
      .bind(
        dev.device_id,
        groupId
      )
      .first();

  return !!watched;
}


/* ============================================================
   双方向ブロック確認

   ・自分が相手をブロック
   ・相手が自分をブロック

   どちらでも詳細を返さない。
   ============================================================ */

async function hasBlockedRelation(
  env,
  dev,
  targetMemberId
) {

  if (
    !dev ||
    !targetMemberId ||
    targetMemberId ===
      dev.member_id
  ) {

    return false;
  }


  const own =
    await env.DB
      .prepare(`
        SELECT blocked_member_id
        FROM blocks
        WHERE
          device_id=?
          AND blocked_member_id=?
        LIMIT 1
      `)
      .bind(
        dev.device_id,
        targetMemberId
      )
      .first();


  if (own) {

    return true;
  }


  const reverse =
    await env.DB
      .prepare(`
        SELECT b.blocked_member_id

        FROM blocks b

        JOIN devices d
          ON d.device_id=b.device_id

        WHERE
          d.member_id=?
          AND b.blocked_member_id=?

        LIMIT 1
      `)
      .bind(
        targetMemberId,
        dev.member_id
      )
      .first();


  return !!reverse;
}


/* ============================================================
   対象メンバー
   ============================================================ */

function isMissingGoalPublicColumn(
  error
) {

  const text =
    String(
      error &&
      error.message ||
      error ||
      ''
    )
      .toLowerCase();


  return (
    text.includes(
      'goal_public'
    ) &&
    (
      text.includes(
        'no such column'
      ) ||
      text.includes(
        'does not exist'
      ) ||
      text.includes(
        'unknown column'
      )
    )
  );
}


async function targetMemberQuery(
  env,
  memberId,
  includeGoalPublic
) {

  const goalPublicSelect =
    includeGoalPublic
      ? 'd.goal_public'
      : '0 AS goal_public';


  return await env.DB
    .prepare(`
      SELECT
        d.device_id,
        d.member_id,
        d.nickname,
        d.icon_ver,
        d.group_id,
        d.goal_weight,
        ${goalPublicSelect},

        g.name AS group_name,
        g.start_ymd,
        g.show_weight

      FROM devices d

      JOIN groups g
        ON g.group_id=d.group_id

      WHERE
        d.member_id=?
        AND d.banned=0
    `)
    .bind(
      memberId
    )
    .first();
}


async function targetMember(
  env,
  memberId
) {

  try {

    return await targetMemberQuery(
      env,
      memberId,
      true
    );

  } catch (error) {

    /*
     * D1へgoal_public列を追加する前に
     * このコードだけ先行して反映されても、
     * 既存のメンバー詳細を壊さない。
     */
    if (
      isMissingGoalPublicColumn(
        error
      )
    ) {

      return await targetMemberQuery(
        env,
        memberId,
        false
      );
    }


    throw error;
  }
}


/* ============================================================
   体重履歴

   グループのスタート日以降だけ返す。
   ============================================================ */

async function loadWeights(
  env,
  deviceId,
  startYmd
) {

  const rs =
    await env.DB
      .prepare(`
        SELECT
          ymd,
          kg

        FROM weights

        WHERE
          device_id=?
          AND ymd>=?

        ORDER BY ymd ASC
      `)
      .bind(
        deviceId,
        startYmd
      )
      .all();


  return (
    rs.results ||
    []
  )
    .map(
      row => ({
        ymd:
          String(
            row.ymd
          ),

        kg:
          Number(
            row.kg
          ),
      })
    )
    .filter(
      row =>
        /^\d{4}-\d{2}-\d{2}$/
          .test(
            row.ymd
          ) &&
        Number.isFinite(
          row.kg
        )
    );
}


/* ============================================================
   個人の体重詳細

   GET /api/member-weight-detail?member_id=XXXXXXXXXX

   体重詳細の公開条件
   ------------------------------------------------------------
   ・対象グループ自体が体重公開
   ・対象本人が体重公開
   ・自分のチーム、または閲覧登録した他チーム
   ・双方向ブロック関係ではない

   目標体重の追加条件
   ------------------------------------------------------------
   ・閲覧者と対象者が同じ所属グループ
   ・対象本人が目標体重の公開を明示的にON
   ・目標体重が設定済み

   「他のチームを見る」経由では、
   体重詳細が見られても目標体重は返さない。

   非公開の場合は、
   本人が自分自身を指定しても体重詳細を返さない。
   ============================================================ */

export async function memberWeightDetailRoute(
  req,
  env,
  dev,
  url,
  p,
  m
) {

  if (
    p !==
      '/api/member-weight-detail'
  ) {

    return null;
  }


  if (
    m !==
      'GET'
  ) {

    return bad(
      req,
      'method_not_allowed',
      405
    );
  }


  const memberId =
    normalizeMemberId(
      url.searchParams.get(
        'member_id'
      )
    );


  if (!memberId) {

    return bad(
      req,
      'bad_member_id'
    );
  }


  const target =
    await targetMember(
      env,
      memberId
    );


  if (!target) {

    return bad(
      req,
      'member_not_found',
      404
    );
  }


  /* ----------------------------------------------------------
     自分のチーム or 閲覧登録済みチーム
     ---------------------------------------------------------- */

  const allowed =
    await canViewGroup(
      env,
      dev,
      target.group_id
    );


  if (!allowed) {

    return bad(
      req,
      'not_watching',
      403
    );
  }


  /* ----------------------------------------------------------
     双方向ブロック
     ---------------------------------------------------------- */

  if (
    await hasBlockedRelation(
      env,
      dev,
      memberId
    )
  ) {

    return bad(
      req,
      'blocked_relation',
      403
    );
  }


  /* ----------------------------------------------------------
     体重公開状態

     グループ非公開 または 個人非公開なら
     本人を含めて詳細そのものを返さない。
     ---------------------------------------------------------- */

  const groupPublic =
    Number(
      target.show_weight ||
      0
    ) === 1;


  const hidden =
    !groupPublic ||
    await isWeightHidden(
      env,
      memberId
    );


  if (hidden) {

    return bad(
      req,
      'weight_private',
      403
    );
  }


  /* ----------------------------------------------------------
     目標体重公開状態

     ・同じ所属グループだけ
     ・本人が明示的にgoal_public=1にした場合だけ
     ・他チーム閲覧では返さない
     ・goal_public列がまだ無い場合は0扱い
     ---------------------------------------------------------- */

  const sameGroup =
    !!(
      dev &&
      dev.group_id &&
      target.group_id &&
      dev.group_id ===
        target.group_id
    );


  const goalVisible =
    sameGroup &&
    Number(
      target.goal_public ||
      0
    ) === 1;


  const rawGoal =
    Number(
      target.goal_weight
    );


  const goalKg =
    goalVisible &&
    target.goal_weight !==
      null &&
    target.goal_weight !==
      undefined &&
    Number.isFinite(
      rawGoal
    )
      ? round1(
          rawGoal
        )
      : null;


  /* ----------------------------------------------------------
     スタート日
     ---------------------------------------------------------- */

  const startYmd =
    String(
      target.start_ymd ||
      ''
    );


  if (
    !/^\d{4}-\d{2}-\d{2}$/
      .test(
        startYmd
      )
  ) {

    return bad(
      req,
      'bad_start_ymd',
      500
    );
  }


  /* ----------------------------------------------------------
     履歴
     ---------------------------------------------------------- */

  const weights =
    await loadWeights(
      env,
      target.device_id,
      startYmd
    );


  const first =
    weights.length
      ? weights[0]
      : null;


  const latest =
    weights.length
      ? weights[
          weights.length - 1
        ]
      : null;


  /*
   * ランキングと同じ考え方。
   *
   * 1件しかない場合は、
   * スタート体重と現在体重は表示できるが、
   * 減量幅はまだ確定させない。
   */
  const lossKg =
    first &&
    latest &&
    first.ymd !==
      latest.ymd
      ? round1(
          first.kg -
          latest.kg
        )
      : null;


  return json(
    req,
    {
      ok:
        true,

      member: {
        member_id:
          target.member_id,

        nickname:
          target.nickname ||
          null,

        icon_ver:
          Number(
            target.icon_ver ||
            0
          ),

        icon_url:
          iconUrlOf(
            target.member_id,
            target.icon_ver
          ),

        weight_hidden:
          false,
      },

      group: {
        group_id:
          target.group_id,

        name:
          target.group_name,

        start_ymd:
          startYmd,
      },

      summary: {
        count:
          weights.length,

        start_kg:
          first
            ? first.kg
            : null,

        goal_kg:
          goalKg,

        latest_kg:
          latest
            ? latest.kg
            : null,

        loss_kg:
          lossKg,

        last_ymd:
          latest
            ? latest.ymd
            : null,
      },

      /*
       * グラフ用は昇順。
       * 履歴表示側で逆順にすれば
       * 最新記録を上にできる。
       */
      weights,
    }
  );
}
