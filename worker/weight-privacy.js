'use strict';

import {
  json,
  bad
} from './lib.js';


/* ============================================================
   みんやせ / worker/weight-privacy.js
   2026-09-07

   個人単位の体重公開設定

   公開状態
   --------------------------------
   通常
     実体重 + 増減量

   本人非公開
     増減量のみ
     本人 + 管理者だけ解除可能

   管理者固定
     増減量のみ
     管理者だけ解除可能

   オーナー / リーダー非公開
     増減量のみ
     オーナー / リーダーが解除可能

   グループ自体が体重非公開
     全員強制で増減量のみ
     本人 / オーナー / リーダーから公開不可

   ============================================================ */


const MEMBER_ID_RE =
  /^[0-9A-Z]{6,32}$/;


let tableReady =
  false;


/* ============================================================
   DB
   ============================================================ */

export async function ensureWeightPrivacyTable(
  env
) {

  if (
    tableReady
  ) {

    return;
  }


  await env.DB
    .prepare(`
      CREATE TABLE IF NOT EXISTS weight_privacy (
        member_id TEXT PRIMARY KEY,
        hidden INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL,
        updated_by TEXT
      )
    `)
    .run();


  /*
   * locked=1 の場合、
   * オーナー / リーダーから変更できない。
   *
   * updated_by:
   *   admin
   *   admin-migration
   *   self
   */
  await env.DB
    .prepare(`
      CREATE TABLE IF NOT EXISTS weight_privacy_lock (
        member_id TEXT PRIMARY KEY,
        locked INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL,
        updated_by TEXT
      )
    `)
    .run();


  /*
   * 既に管理画面からシークレットにしていた人を
   * 管理者固定へ移行。
   */
  await env.DB
    .prepare(`
      INSERT INTO weight_privacy_lock (
        member_id,
        locked,
        updated_at,
        updated_by
      )

      SELECT
        member_id,
        1,
        updated_at,
        'admin-migration'

      FROM weight_privacy

      WHERE
        hidden=1
        AND updated_by='admin'

      ON CONFLICT(member_id)
      DO UPDATE SET
        locked=1,
        updated_at=excluded.updated_at,
        updated_by=excluded.updated_by
    `)
    .run();


  tableReady =
    true;
}


/* ============================================================
   小物
   ============================================================ */

function normalizeMemberId(
  raw
) {

  const id =
    String(
      raw ||
      ''
    )
      .trim()
      .toUpperCase();


  return MEMBER_ID_RE
    .test(
      id
    )
      ? id
      : null;
}


function cleanIds(
  values
) {

  return [
    ...new Set(
      (
        Array.isArray(
          values
        )
          ? values
          : []
      )
        .map(
          normalizeMemberId
        )
        .filter(
          Boolean
        )
    )
  ];
}


async function readBody(
  req
) {

  try {

    const b =
      await req.json();


    return (
      b &&
      typeof b ===
        'object'
    )
      ? b
      : {};

  } catch {

    return {};
  }
}


function safeEqual(
  a,
  b
) {

  const x =
    String(
      a ||
      ''
    );

  const y =
    String(
      b ||
      ''
    );


  if (
    !x ||
    x.length !==
      y.length
  ) {

    return false;
  }


  let diff =
    0;


  for (
    let i = 0;
    i < x.length;
    i++
  ) {

    diff |=
      x.charCodeAt(
        i
      ) ^
      y.charCodeAt(
        i
      );
  }


  return diff ===
    0;
}


function adminOk(
  req,
  env
) {

  const want =
    String(
      env.ADMIN_TOKEN ||
      ''
    )
      .trim();


  if (!want) {

    return false;
  }


  const auth =
    String(
      req.headers.get(
        'authorization'
      ) ||
      ''
    )
      .trim();


  const m =
    /^Bearer\s+(.+)$/i
      .exec(
        auth
      );


  const got =
    m
      ? m[1].trim()
      : String(
          req.headers.get(
            'x-admin-token'
          ) ||
          ''
        )
          .trim();


  return safeEqual(
    got,
    want
  );
}


/* ============================================================
   グループ設定
   ============================================================ */

async function groupForDevice(
  env,
  dev
) {

  if (
    !dev ||
    !dev.group_id
  ) {

    return null;
  }


  return await env.DB
    .prepare(`
      SELECT
        group_id,
        name,
        show_weight,
        start_ymd,
        owner_id

      FROM groups

      WHERE group_id=?
    `)
    .bind(
      dev.group_id
    )
    .first();
}


function groupAllowsWeightPublic(
  group
) {

  return !!(
    group &&
    Number(
      group.show_weight ||
      0
    ) === 1
  );
}


/* ============================================================
   状態取得
   ============================================================ */

async function privacyState(
  env,
  memberId
) {

  await ensureWeightPrivacyTable(
    env
  );


  const id =
    normalizeMemberId(
      memberId
    );


  if (!id) {

    return {
      member_id:
        null,

      weight_hidden:
        false,

      weight_locked:
        false,

      weight_lock_kind:
        null,

      hidden_by:
        null,
    };
  }


  const row =
    await env.DB
      .prepare(`
        SELECT

          COALESCE(
            (
              SELECT hidden
              FROM weight_privacy
              WHERE member_id=?
            ),
            0
          ) AS hidden,

          (
            SELECT updated_by
            FROM weight_privacy
            WHERE member_id=?
          ) AS hidden_by,

          COALESCE(
            (
              SELECT locked
              FROM weight_privacy_lock
              WHERE member_id=?
            ),
            0
          ) AS locked,

          (
            SELECT updated_by
            FROM weight_privacy_lock
            WHERE member_id=?
          ) AS lock_by
      `)
      .bind(
        id,
        id,
        id,
        id
      )
      .first();


  const locked =
    Number(
      row &&
      row.locked ||
      0
    ) ===
      1;


  const lockBy =
    row &&
    row.lock_by
      ? String(
          row.lock_by
        )
      : null;


  let lockKind =
    null;


  if (
    locked
  ) {

    if (
      lockBy ===
        'self'
    ) {

      lockKind =
        'self';

    } else if (
      lockBy &&
      lockBy.startsWith(
        'admin'
      )
    ) {

      lockKind =
        'admin';

    } else {

      lockKind =
        'other';
    }
  }


  return {
    member_id:
      id,

    weight_hidden:
      Number(
        row &&
        row.hidden ||
        0
      ) ===
        1 ||
      locked,

    weight_locked:
      locked,

    weight_lock_kind:
      lockKind,

    hidden_by:
      row &&
      row.hidden_by
        ? String(
            row.hidden_by
          )
        : null,
  };
}


/* ============================================================
   一括状態

   D1は1クエリ100パラメータ上限。

   hiddenWeightSet:
     同じIDをUNIONの両側へbindするため
     50件 × 2 = 100パラメータで分割。

   lockMap:
     IDを1回だけbindするため
     100件ずつ分割。
   ============================================================ */

export async function hiddenWeightSet(
  env,
  memberIds
) {

  await ensureWeightPrivacyTable(
    env
  );


  const ids =
    cleanIds(
      memberIds
    );


  const hidden =
    new Set();


  if (
    !ids.length
  ) {

    return hidden;
  }


  const CHUNK_SIZE =
    50;


  for (
    let offset = 0;
    offset < ids.length;
    offset += CHUNK_SIZE
  ) {

    const chunk =
      ids.slice(
        offset,
        offset + CHUNK_SIZE
      );


    const ph =
      chunk
        .map(
          () => '?'
        )
        .join(
          ','
        );


    /*
     * lockがあればhidden列の状態に関係なく
     * 必ず非公開扱い。
     */
    const rs =
      await env.DB
        .prepare(`
          SELECT member_id

          FROM weight_privacy

          WHERE
            hidden=1
            AND member_id IN (${ph})

          UNION

          SELECT member_id

          FROM weight_privacy_lock

          WHERE
            locked=1
            AND member_id IN (${ph})
        `)
        .bind(
          ...chunk,
          ...chunk
        )
        .all();


    for (
      const row of
      (
        rs.results ||
        []
      )
    ) {

      hidden.add(
        String(
          row.member_id
        )
      );
    }
  }


  return hidden;
}


async function lockMap(
  env,
  memberIds
) {

  await ensureWeightPrivacyTable(
    env
  );


  const ids =
    cleanIds(
      memberIds
    );


  const map =
    new Map();


  if (
    !ids.length
  ) {

    return map;
  }


  const CHUNK_SIZE =
    100;


  for (
    let offset = 0;
    offset < ids.length;
    offset += CHUNK_SIZE
  ) {

    const chunk =
      ids.slice(
        offset,
        offset + CHUNK_SIZE
      );


    const ph =
      chunk
        .map(
          () => '?'
        )
        .join(
          ','
        );


    const rs =
      await env.DB
        .prepare(`
          SELECT
            member_id,
            locked,
            updated_by

          FROM weight_privacy_lock

          WHERE
            locked=1
            AND member_id IN (${ph})
        `)
        .bind(
          ...chunk
        )
        .all();


    for (
      const r of
      (
        rs.results ||
        []
      )
    ) {

      const by =
        r.updated_by
          ? String(
              r.updated_by
            )
          : '';


      let kind =
        'other';


      if (
        by ===
          'self'
      ) {

        kind =
          'self';

      } else if (
        by.startsWith(
          'admin'
        )
      ) {

        kind =
          'admin';
      }


      map.set(
        String(
          r.member_id
        ),
        kind
      );
    }
  }


  return map;
}


export async function isWeightHidden(
  env,
  memberId
) {

  const state =
    await privacyState(
      env,
      memberId
    );


  return state.weight_hidden;
}


/* ============================================================
   保存
   ============================================================ */

export async function setWeightHidden(
  env,
  memberId,
  hidden,
  actor
) {

  await ensureWeightPrivacyTable(
    env
  );


  const id =
    normalizeMemberId(
      memberId
    );


  if (!id) {

    throw new Error(
      'bad_member_id'
    );
  }


  const now =
    Date.now();


  await env.DB
    .prepare(`
      INSERT INTO weight_privacy (
        member_id,
        hidden,
        updated_at,
        updated_by
      )

      VALUES (
        ?,
        ?,
        ?,
        ?
      )

      ON CONFLICT(member_id)
      DO UPDATE SET
        hidden=excluded.hidden,
        updated_at=excluded.updated_at,
        updated_by=excluded.updated_by
    `)
    .bind(
      id,
      hidden
        ? 1
        : 0,
      now,
      actor ||
        null
    )
    .run();


  return {
    member_id:
      id,

    weight_hidden:
      !!hidden,

    updated_at:
      now,
  };
}


async function setWeightLock(
  env,
  memberId,
  locked,
  actor
) {

  await ensureWeightPrivacyTable(
    env
  );


  const id =
    normalizeMemberId(
      memberId
    );


  if (!id) {

    throw new Error(
      'bad_member_id'
    );
  }


  const now =
    Date.now();


  await env.DB
    .prepare(`
      INSERT INTO weight_privacy_lock (
        member_id,
        locked,
        updated_at,
        updated_by
      )

      VALUES (
        ?,
        ?,
        ?,
        ?
      )

      ON CONFLICT(member_id)
      DO UPDATE SET
        locked=excluded.locked,
        updated_at=excluded.updated_at,
        updated_by=excluded.updated_by
    `)
    .bind(
      id,
      locked
        ? 1
        : 0,
      now,
      actor ||
        null
    )
    .run();


  return now;
}


/* ============================================================
   本人設定
   ============================================================ */

async function setSelfPrivacy(
  env,
  memberId,
  hidden
) {

  const id =
    normalizeMemberId(
      memberId
    );


  if (!id) {

    return {
      error:
        'bad_member_id',
    };
  }


  const before =
    await privacyState(
      env,
      id
    );


  /*
   * 管理者固定は本人でも解除不可。
   */
  if (
    before.weight_locked &&
    before.weight_lock_kind ===
      'admin'
  ) {

    return {
      error:
        'weight_privacy_locked',
    };
  }


  if (
    hidden
  ) {

    await setWeightHidden(
      env,
      id,
      true,
      'self'
    );


    await setWeightLock(
      env,
      id,
      true,
      'self'
    );

  } else {

    /*
     * 本人自身が設定したlockのみ解除可能。
     *
     * 管理者その他のlockは解除させない。
     */
    if (
      before.weight_locked &&
      before.weight_lock_kind !==
        'self'
    ) {

      return {
        error:
          'weight_privacy_locked',
      };
    }


    await setWeightLock(
      env,
      id,
      false,
      'self'
    );


    await setWeightHidden(
      env,
      id,
      false,
      'self'
    );
  }


  return {
    state:
      await privacyState(
        env,
        id
      ),
  };
}


/* ============================================================
   本人用API
   ============================================================ */

export async function selfWeightPrivacyRoute(
  req,
  env,
  dev,
  p,
  m
) {

  if (
    p !==
      '/api/me/weight-privacy'
  ) {

    return null;
  }


  if (
    !dev.group_id
  ) {

    return bad(
      req,
      'not_in_group'
    );
  }


  const group =
    await groupForDevice(
      env,
      dev
    );


  if (
    !group
  ) {

    return bad(
      req,
      'group_not_found',
      404
    );
  }


  const groupPublic =
    groupAllowsWeightPublic(
      group
    );


  if (
    m ===
      'GET'
  ) {

    const state =
      await privacyState(
        env,
        dev.member_id
      );


    /*
     * グループ自体が非公開なら、
     * 個人設定にかかわらずeffective hidden=true。
     */
    return json(
      req,
      {
        ok:
          true,

        weight_hidden:
          !groupPublic ||
          state.weight_hidden,

        weight_locked:
          state.weight_locked,

        weight_lock_kind:
          state.weight_lock_kind,

        group_show_weight:
          groupPublic,

        group_weight_private:
          !groupPublic,
      }
    );
  }


  if (
    m !==
      'POST' &&
    m !==
      'PATCH'
  ) {

    return bad(
      req,
      'method_not_allowed',
      405
    );
  }


  const body =
    await readBody(
      req
    );


  if (
    typeof body.hidden !==
      'boolean'
  ) {

    return bad(
      req,
      'bad_hidden'
    );
  }


  /*
   * 最重要：
   *
   * グループ自体が体重非公開の場合は、
   * UIを改造したりAPIを直接叩いたりしても
   * 「公開」に変更させない。
   */
  if (
    !groupPublic &&
    body.hidden ===
      false
  ) {

    return bad(
      req,
      'group_weight_private',
      403
    );
  }


  const result =
    await setSelfPrivacy(
      env,
      dev.member_id,
      body.hidden
    );


  if (
    result.error
  ) {

    return bad(
      req,
      result.error,
      result.error ===
        'weight_privacy_locked'
        ? 403
        : 400
    );
  }


  return json(
    req,
    {
      ok:
        true,

      weight_hidden:
        !groupPublic ||
        result.state.weight_hidden,

      weight_locked:
        result.state.weight_locked,

      weight_lock_kind:
        result.state.weight_lock_kind,

      group_show_weight:
        groupPublic,

      group_weight_private:
        !groupPublic,
    }
  );
}


/* ============================================================
   削除
   ============================================================ */

export async function cleanupWeightPrivacyForMember(
  env,
  memberId
) {

  const id =
    normalizeMemberId(
      memberId
    );


  if (!id) {

    return;
  }


  try {

    await ensureWeightPrivacyTable(
      env
    );


    await env.DB.batch([

      env.DB
        .prepare(`
          DELETE FROM weight_privacy
          WHERE member_id=?
        `)
        .bind(
          id
        ),

      env.DB
        .prepare(`
          DELETE FROM weight_privacy_lock
          WHERE member_id=?
        `)
        .bind(
          id
        ),
    ]);


  } catch (e) {

    console.warn(
      'weight_privacy_cleanup_failed',
      id,
      (
        e &&
        e.message
      ) ||
      e
    );
  }
}


/* ============================================================
   オーナー / リーダー権限
   ============================================================ */

async function canManageGroup(
  env,
  dev
) {

  if (
    !dev ||
    !dev.group_id
  ) {

    return {
      ok:
        false,

      error:
        'not_in_group',
    };
  }


  const group =
    await env.DB
      .prepare(`
        SELECT *
        FROM groups
        WHERE group_id=?
      `)
      .bind(
        dev.group_id
      )
      .first();


  if (!group) {

    return {
      ok:
        false,

      error:
        'group_not_found',
    };
  }


  const owner =
    group.owner_id ===
      dev.member_id ||
    group.owner_id ===
      dev.device_id;


  if (
    owner
  ) {

    return {
      ok:
        true,

      group,

      owner:
        true,

      leader:
        false,
    };
  }


  let leader =
    false;


  try {

    const row =
      await env.DB
        .prepare(`
          SELECT member_id
          FROM group_leaders
          WHERE
            group_id=?
            AND member_id=?
        `)
        .bind(
          group.group_id,
          dev.member_id
        )
        .first();


    leader =
      !!row;

  } catch {

    leader =
      false;
  }


  if (
    !leader
  ) {

    return {
      ok:
        false,

      error:
        'not_leader',
    };
  }


  return {
    ok:
      true,

    group,

    owner:
      false,

    leader:
      true,
  };
}


/* ============================================================
   オーナー / リーダー用
   ============================================================ */

export async function memberWeightPrivacyRoute(
  req,
  env,
  dev,
  p,
  m
) {

  if (
    p !==
      '/api/groups/weight-privacy'
  ) {

    return null;
  }


  if (
    m !==
      'POST' &&
    m !==
      'PATCH'
  ) {

    return bad(
      req,
      'method_not_allowed',
      405
    );
  }


  const permission =
    await canManageGroup(
      env,
      dev
    );


  if (
    !permission.ok
  ) {

    return bad(
      req,
      permission.error,
      permission.error ===
        'not_leader'
        ? 403
        : 400
    );
  }


  const body =
    await readBody(
      req
    );


  const memberId =
    normalizeMemberId(
      body.member_id
    );


  if (!memberId) {

    return bad(
      req,
      'bad_member_id'
    );
  }


  if (
    typeof body.hidden !==
      'boolean'
  ) {

    return bad(
      req,
      'bad_hidden'
    );
  }


  /*
   * グループ自体が体重非公開なら、
   * オーナー / リーダーがAPIを直接叩いても
   * 「公開」にできない。
   */
  if (
    !groupAllowsWeightPublic(
      permission.group
    ) &&
    body.hidden ===
      false
  ) {

    return bad(
      req,
      'group_weight_private',
      403
    );
  }


  const target =
    await env.DB
      .prepare(`
        SELECT
          member_id,
          nickname,
          group_id

        FROM devices

        WHERE
          member_id=?
          AND banned=0
      `)
      .bind(
        memberId
      )
      .first();


  if (!target) {

    return bad(
      req,
      'member_not_found',
      404
    );
  }


  if (
    target.group_id !==
      permission.group.group_id
  ) {

    return bad(
      req,
      'not_in_group',
      403
    );
  }


  const state =
    await privacyState(
      env,
      memberId
    );


  /*
   * 本人設定または管理者固定は
   * オーナー / リーダーから変更不可。
   */
  if (
    state.weight_locked
  ) {

    return bad(
      req,
      'weight_privacy_locked',
      403
    );
  }


  const result =
    await setWeightHidden(
      env,
      memberId,
      body.hidden,
      dev.member_id
    );


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

        weight_hidden:
          !groupAllowsWeightPublic(
            permission.group
          ) ||
          result.weight_hidden,

        weight_locked:
          false,

        weight_lock_kind:
          null,

        updated_at:
          result.updated_at,
      },
    }
  );
}


/* ============================================================
   管理者用
   ============================================================ */

export async function adminWeightPrivacyRoute(
  req,
  env,
  url,
  p,
  m
) {

  if (
    !env.ADMIN_TOKEN
  ) {

    return bad(
      req,
      'no_admin_token',
      503
    );
  }


  if (
    !adminOk(
      req,
      env
    )
  ) {

    return bad(
      req,
      'unauthorized',
      401
    );
  }


  await ensureWeightPrivacyTable(
    env
  );


  /*
   * 一覧
   */
  if (
    p ===
      '/api/admin/weight-privacy' &&
    m ===
      'GET'
  ) {

    const rs =
      await env.DB
        .prepare(`
          SELECT
            d.member_id,
            d.nickname,
            d.group_id,
            d.banned,
            g.name AS group_name,
            g.show_weight AS group_show_weight,

            CASE
              WHEN COALESCE(g.show_weight,0)=0
                THEN 1

              WHEN COALESCE(wpl.locked,0)=1
                THEN 1

              ELSE COALESCE(wp.hidden,0)
            END AS weight_hidden,

            COALESCE(
              wpl.locked,
              0
            ) AS weight_locked,

            wpl.updated_by AS weight_lock_by,

            (
              SELECT COUNT(*)
              FROM weights w
              WHERE w.device_id=d.device_id
            ) AS weight_count,

            (
              SELECT MAX(w.ymd)
              FROM weights w
              WHERE w.device_id=d.device_id
            ) AS last_weight_ymd

          FROM devices d

          LEFT JOIN groups g
            ON g.group_id=d.group_id

          LEFT JOIN weight_privacy wp
            ON wp.member_id=d.member_id

          LEFT JOIN weight_privacy_lock wpl
            ON wpl.member_id=d.member_id

          ORDER BY
            COALESCE(g.name,''),
            COALESCE(d.nickname,''),
            d.member_id
        `)
        .all();


    return json(
      req,
      {
        ok:
          true,

        users:
          (
            rs.results ||
            []
          )
            .map(
              r => {

                const lockBy =
                  r.weight_lock_by
                    ? String(
                        r.weight_lock_by
                      )
                    : null;


                let lockKind =
                  null;


                if (
                  Number(
                    r.weight_locked ||
                    0
                  ) ===
                    1
                ) {

                  lockKind =
                    lockBy ===
                      'self'
                      ? 'self'
                      : 'admin';
                }


                return {
                  member_id:
                    r.member_id,

                  nickname:
                    r.nickname ||
                    null,

                  group_id:
                    r.group_id ||
                    null,

                  group_name:
                    r.group_name ||
                    null,

                  group_show_weight:
                    r.group_id
                      ? Number(
                          r.group_show_weight ||
                          0
                        ) ===
                          1
                      : null,

                  weight_hidden:
                    Number(
                      r.weight_hidden ||
                      0
                    ) ===
                      1,

                  weight_locked:
                    Number(
                      r.weight_locked ||
                      0
                    ) ===
                      1,

                  weight_lock_kind:
                    lockKind,

                  weight_count:
                    Number(
                      r.weight_count ||
                      0
                    ),

                  last_weight_ymd:
                    r.last_weight_ymd ||
                    null,

                  banned:
                    Number(
                      r.banned ||
                      0
                    ) ===
                      1,
                };
              }
            ),
      }
    );
  }


  const prefix =
    '/api/admin/weight-privacy/';


  if (
    !p.startsWith(
      prefix
    )
  ) {

    return bad(
      req,
      'not_found',
      404
    );
  }


  const memberId =
    normalizeMemberId(
      p.slice(
        prefix.length
      )
    );


  if (!memberId) {

    return bad(
      req,
      'bad_member_id'
    );
  }


  const target =
    await env.DB
      .prepare(`
        SELECT
          d.member_id,
          d.nickname,
          d.group_id,
          g.name AS group_name,
          g.show_weight AS group_show_weight

        FROM devices d

        LEFT JOIN groups g
          ON g.group_id=d.group_id

        WHERE d.member_id=?
      `)
      .bind(
        memberId
      )
      .first();


  if (!target) {

    return bad(
      req,
      'member_not_found',
      404
    );
  }


  if (
    m ===
      'GET'
  ) {

    const state =
      await privacyState(
        env,
        memberId
      );


    const groupPublic =
      target.group_id
        ? Number(
            target.group_show_weight ||
            0
          ) ===
            1
        : true;


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

          group_id:
            target.group_id ||
            null,

          group_name:
            target.group_name ||
            null,

          group_show_weight:
            target.group_id
              ? groupPublic
              : null,

          weight_hidden:
            !groupPublic ||
            state.weight_hidden,

          weight_locked:
            state.weight_locked,

          weight_lock_kind:
            state.weight_lock_kind,
        },
      }
    );
  }


  if (
    m !==
      'POST' &&
    m !==
      'PATCH'
  ) {

    return bad(
      req,
      'method_not_allowed',
      405
    );
  }


  const body =
    await readBody(
      req
    );


  if (
    typeof body.hidden !==
      'boolean'
  ) {

    return bad(
      req,
      'bad_hidden'
    );
  }


  /*
   * 管理画面でシークレットON
   * → 管理者固定
   */
  if (
    body.hidden
  ) {

    await setWeightHidden(
      env,
      memberId,
      true,
      'admin'
    );


    const now =
      await setWeightLock(
        env,
        memberId,
        true,
        'admin'
      );


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

          group_id:
            target.group_id ||
            null,

          group_name:
            target.group_name ||
            null,

          weight_hidden:
            true,

          weight_locked:
            true,

          weight_lock_kind:
            'admin',

          updated_at:
            now,
        },
      }
    );
  }


  /*
   * 管理者は本人設定も含めて解除可能。
   *
   * ただしグループ自体が非公開なら、
   * effectiveな表示状態は引き続き非公開。
   *
   * これは「個人シークレット固定の解除」であり、
   * グループ自体のshow_weightを変更する処理ではない。
   */
  await setWeightLock(
    env,
    memberId,
    false,
    'admin'
  );


  const result =
    await setWeightHidden(
      env,
      memberId,
      false,
      'admin'
    );


  const groupPublic =
    target.group_id
      ? Number(
          target.group_show_weight ||
          0
        ) ===
          1
      : true;


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

        group_id:
          target.group_id ||
          null,

        group_name:
          target.group_name ||
          null,

        weight_hidden:
          !groupPublic ||
          result.weight_hidden,

        weight_locked:
          false,

        weight_lock_kind:
          null,

        updated_at:
          result.updated_at,
      },
    }
  );
}


/* ============================================================
   JSONレスポンス処理
   ============================================================ */

async function jsonResponseData(
  response
) {

  if (
    !response ||
    !response.ok
  ) {

    return null;
  }


  const type =
    String(
      response.headers.get(
        'content-type'
      ) ||
      ''
    )
      .toLowerCase();


  if (
    !type.includes(
      'application/json'
    )
  ) {

    return null;
  }


  try {

    return await response.json();

  } catch {

    return null;
  }
}


function rebuiltJsonResponse(
  response,
  data
) {

  const headers =
    new Headers(
      response.headers
    );


  headers.delete(
    'content-length'
  );


  headers.set(
    'content-type',
    'application/json; charset=utf-8'
  );


  headers.set(
    'cache-control',
    'no-store'
  );


  return new Response(
    JSON.stringify(
      data
    ),
    {
      status:
        response.status,

      statusText:
        response.statusText,

      headers,
    }
  );
}


/* ============================================================
   ランキング
   ============================================================ */

export async function filterRankingWeightPrivacy(
  response,
  env
) {

  const data =
    await jsonResponseData(
      response
    );


  if (
    !data ||
    !Array.isArray(
      data.rows
    )
  ) {

    return response;
  }


  const ids =
    data.rows
      .map(
        r =>
          r &&
          r.member_id
      )
      .filter(
        Boolean
      );


  const [
    hidden,
    locks
  ] =
    await Promise.all([

      hiddenWeightSet(
        env,
        ids
      ),

      lockMap(
        env,
        ids
      ),
    ]);


  /*
   * グループ自体が体重非公開なら
   * 個人設定に関係なく全員hide。
   */
  const groupPublic =
    !data.group ||
    data.group.show_weight !==
      false;


  for (
    const row of
    data.rows
  ) {

    if (
      !row ||
      !row.member_id
    ) {

      continue;
    }


    const id =
      String(
        row.member_id
      );


    const hide =
      !groupPublic ||
      hidden.has(
        id
      );


    const lockKind =
      locks.get(
        id
      ) ||
      null;


    row.weight_hidden =
      hide;


    row.weight_locked =
      !!lockKind;


    row.weight_lock_kind =
      lockKind;


    if (
      !hide
    ) {

      continue;
    }


    /*
     * lossは残す。
     */
    for (
      const key of
      [
        'start_kg',
        'latest_kg',
        'kg',
        'weight',
        'start_weight',
        'current_weight',
        'latest_weight',
      ]
    ) {

      if (
        Object.prototype
          .hasOwnProperty
          .call(
            row,
            key
          )
      ) {

        row[
          key
        ] =
          null;
      }
    }
  }


  return rebuiltJsonResponse(
    response,
    data
  );
}


/* ============================================================
   日付ビュー
   ============================================================ */

async function filterDayResponse(
  response,
  env
) {

  const data =
    await jsonResponseData(
      response
    );


  if (
    !data ||
    !Array.isArray(
      data.members
    )
  ) {

    return response;
  }


  const ids =
    data.members
      .map(
        r =>
          r &&
          (
            r.id ||
            r.member_id
          )
      )
      .filter(
        Boolean
      );


  const [
    hidden,
    locks
  ] =
    await Promise.all([

      hiddenWeightSet(
        env,
        ids
      ),

      lockMap(
        env,
        ids
      ),
    ]);


  const groupPublic =
    !data.group ||
    data.group.show_weight !==
      false;


  let visibleTotal =
    0;

  let hasVisibleWeight =
    false;


  for (
    const row of
    data.members
  ) {

    if (
      !row
    ) {

      continue;
    }


    const id =
      row.id ||
      row.member_id
        ? String(
            row.id ||
            row.member_id
          )
        : '';


    const hide =
      !groupPublic ||
      (
        !!id &&
        hidden.has(
          id
        )
      );


    const lockKind =
      id
        ? locks.get(
            id
          ) ||
          null
        : null;


    row.weight_hidden =
      hide;


    row.weight_locked =
      !!lockKind;


    row.weight_lock_kind =
      lockKind;


    if (
      hide
    ) {

      row.weight =
        null;

      continue;
    }


    if (
      row.weight !==
        null &&
      row.weight !==
        undefined &&
      Number.isFinite(
        Number(
          row.weight
        )
      )
    ) {

      visibleTotal +=
        Number(
          row.weight
        );


      hasVisibleWeight =
        true;
    }
  }


  data.total =
    hasVisibleWeight
      ? Math.round(
          visibleTotal *
          10
        ) /
        10
      : null;


  return rebuiltJsonResponse(
    response,
    data
  );
}


/* ============================================================
   CSV
   ============================================================ */

function parseCsv(
  text
) {

  const s =
    String(
      text ||
      ''
    )
      .replace(
        /^\uFEFF/,
        ''
      );


  const rows =
    [];

  let row =
    [];

  let cur =
    '';

  let quoted =
    false;


  for (
    let i = 0;
    i < s.length;
    i++
  ) {

    const c =
      s[
        i
      ];


    if (
      quoted
    ) {

      if (
        c ===
          '"'
      ) {

        if (
          s[
            i + 1
          ] ===
            '"'
        ) {

          cur +=
            '"';

          i++;

        } else {

          quoted =
            false;
        }

      } else {

        cur +=
          c;
      }


      continue;
    }


    if (
      c ===
        '"'
    ) {

      quoted =
        true;

    } else if (
      c ===
        ','
    ) {

      row.push(
        cur
      );

      cur =
        '';

    } else if (
      c ===
        '\n'
    ) {

      row.push(
        cur
      );

      rows.push(
        row
      );

      row =
        [];

      cur =
        '';

    } else if (
      c !==
        '\r'
    ) {

      cur +=
        c;
    }
  }


  if (
    cur !==
      '' ||
    row.length
  ) {

    row.push(
      cur
    );

    rows.push(
      row
    );
  }


  return rows;
}


function csvCell(
  value
) {

  const s =
    value ===
      null ||
    value ===
      undefined
      ? ''
      : String(
          value
        );


  return /[",\r\n]/
    .test(
      s
    )
      ? '"' +
        s.replace(
          /"/g,
          '""'
        ) +
        '"'
      : s;
}


async function filterCsvResponse(
  response,
  env
) {

  if (
    !response ||
    !response.ok
  ) {

    return response;
  }


  const text =
    await response.text();


  const rows =
    parseCsv(
      text
    );


  if (
    rows.length <
      2
  ) {

    return new Response(
      text,
      response
    );
  }


  const head =
    rows[
      0
    ]
      .map(
        v =>
          String(
            v ||
            ''
          )
            .trim()
            .toLowerCase()
      );


  const memberIndex =
    head.indexOf(
      'member_id'
    );


  const weightIndex =
    head.indexOf(
      'weight_kg'
    );


  if (
    memberIndex <
      0 ||
    weightIndex <
      0
  ) {

    return new Response(
      text,
      response
    );
  }


  const ids =
    rows
      .slice(
        1
      )
      .map(
        row =>
          normalizeMemberId(
            row[
              memberIndex
            ]
          )
      )
      .filter(
        Boolean
      );


  const hidden =
    await hiddenWeightSet(
      env,
      ids
    );


  for (
    const row of
    rows.slice(
      1
    )
  ) {

    const id =
      normalizeMemberId(
        row[
          memberIndex
        ]
      );


    if (
      id &&
      hidden.has(
        id
      )
    ) {

      row[
        weightIndex
      ] =
        '';
    }
  }


  const out =
    '\uFEFF' +
    rows
      .map(
        row =>
          row
            .map(
              csvCell
            )
            .join(
              ','
            )
      )
      .join(
        '\r\n'
      );


  const headers =
    new Headers(
      response.headers
    );


  headers.delete(
    'content-length'
  );


  return new Response(
    out,
    {
      status:
        response.status,

      statusText:
        response.statusText,

      headers,
    }
  );
}


/* ============================================================
   一般ユーザー向けレスポンス
   ============================================================ */

export async function filterMemberWeightPrivacy(
  p,
  response,
  env
) {

  if (
    p ===
      '/api/group/day'
  ) {

    return await filterDayResponse(
      response,
      env
    );
  }


  if (
    p ===
      '/api/export'
  ) {

    return await filterCsvResponse(
      response,
      env
    );
  }


  return response;
}
