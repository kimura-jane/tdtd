'use strict';

import {
  json,
  bad
} from './lib.js';


/* ============================================================
   みんやせ / worker/weight-privacy.js

   ユーザー単位の体重公開制御

   ・hidden=1 の人は実体重を公開しない
   ・管理画面からhiddenにした人は管理者固定（locked）
   ・lockedの人はオーナー / リーダーから解除できない
   ・減量幅は表示する
   ・member_id 単位なのでグループ移動後も設定を維持
   ============================================================ */


const MEMBER_ID_RE =
  /^[0-9A-Z]{6,32}$/;


let tableReady =
  false;


/* ============================================================
   テーブル
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
   * すでに管理画面からシークレット設定済みの人は
   * 初回実行時にそのまま「管理者固定」へ移行する。
   *
   * オーナー / リーダーが設定したhiddenは固定しない。
   */
  await env.DB
    .prepare(`
      INSERT INTO weight_privacy_lock
        (
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


function cleanMemberIds(
  memberIds
) {

  return [
    ...new Set(
      (
        Array.isArray(
          memberIds
        )
          ? memberIds
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
    return null;
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
   hidden / locked 状態
   ============================================================ */

export async function hiddenWeightSet(
  env,
  memberIds
) {

  await ensureWeightPrivacyTable(
    env
  );


  const ids =
    cleanMemberIds(
      memberIds
    );


  if (
    !ids.length
  ) {

    return new Set();
  }


  const ph =
    ids
      .map(
        () => '?'
      )
      .join(
        ','
      );


  /*
   * lockedはhiddenより強い。
   * 万一hiddenとの整合が崩れてもlockedなら必ず隠す。
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
        ...ids,
        ...ids
      )
      .all();


  return new Set(
    (
      rs.results ||
      []
    )
      .map(
        r =>
          String(
            r.member_id
          )
      )
  );
}


async function lockedWeightSet(
  env,
  memberIds
) {

  await ensureWeightPrivacyTable(
    env
  );


  const ids =
    cleanMemberIds(
      memberIds
    );


  if (
    !ids.length
  ) {

    return new Set();
  }


  const ph =
    ids
      .map(
        () => '?'
      )
      .join(
        ','
      );


  const rs =
    await env.DB
      .prepare(`
        SELECT member_id
        FROM weight_privacy_lock
        WHERE
          locked=1
          AND member_id IN (${ph})
      `)
      .bind(
        ...ids
      )
      .all();


  return new Set(
    (
      rs.results ||
      []
    )
      .map(
        r =>
          String(
            r.member_id
          )
      )
  );
}


export async function isWeightHidden(
  env,
  memberId
) {

  const id =
    normalizeMemberId(
      memberId
    );


  if (!id) {
    return false;
  }


  const set =
    await hiddenWeightSet(
      env,
      [
        id
      ]
    );


  return set.has(
    id
  );
}


async function isWeightLocked(
  env,
  memberId
) {

  const id =
    normalizeMemberId(
      memberId
    );


  if (!id) {
    return false;
  }


  const set =
    await lockedWeightSet(
      env,
      [
        id
      ]
    );


  return set.has(
    id
  );
}


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
      INSERT INTO weight_privacy
        (
          member_id,
          hidden,
          updated_at,
          updated_by
        )

      VALUES
        (
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


async function setWeightLocked(
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
      INSERT INTO weight_privacy_lock
        (
          member_id,
          locked,
          updated_at,
          updated_by
        )

      VALUES
        (
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


  return {
    member_id:
      id,

    weight_locked:
      !!locked,

    updated_at:
      now,
  };
}


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


  if (owner) {

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


  if (!leader) {

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
   オーナー / リーダー用API
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


  /*
   * 管理者固定は最優先。
   * 古いクライアントから解除要求が来てもサーバーで拒否する。
   */
  if (
    await isWeightLocked(
      env,
      memberId
    )
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
          result.weight_hidden,

        weight_locked:
          false,

        updated_at:
          result.updated_at,
      },
    }
  );
}


/* ============================================================
   管理者用API
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
   * 全員一覧
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

            CASE
              WHEN COALESCE(wpl.locked, 0)=1 THEN 1
              ELSE COALESCE(wp.hidden, 0)
            END AS weight_hidden,

            COALESCE(
              wpl.locked,
              0
            ) AS weight_locked,

            (
              SELECT COUNT(*)
              FROM weights w
              WHERE
                w.device_id=
                  d.device_id
            ) AS weight_count,

            (
              SELECT MAX(w.ymd)
              FROM weights w
              WHERE
                w.device_id=
                  d.device_id
            ) AS last_weight_ymd

          FROM devices d

          LEFT JOIN groups g
            ON g.group_id=
               d.group_id

          LEFT JOIN weight_privacy wp
            ON wp.member_id=
               d.member_id

          LEFT JOIN weight_privacy_lock wpl
            ON wpl.member_id=
               d.member_id

          ORDER BY
            COALESCE(
              g.name,
              ''
            ),
            COALESCE(
              d.nickname,
              ''
            ),
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
              r => ({
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
              })
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
          g.name AS group_name

        FROM devices d

        LEFT JOIN groups g
          ON g.group_id=
             d.group_id

        WHERE
          d.member_id=?
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


  /*
   * 1人取得
   */
  if (
    m ===
      'GET'
  ) {

    const hidden =
      await isWeightHidden(
        env,
        target.member_id
      );


    const locked =
      await isWeightLocked(
        env,
        target.member_id
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
            hidden,

          weight_locked:
            locked,
        },
      }
    );
  }


  /*
   * 設定変更
   *
   * 管理画面からシークレットONにした場合は
   * 必ず管理者固定もON。
   * 解除した場合は固定も解除して公開へ戻す。
   */
  if (
    m ===
      'POST' ||
    m ===
      'PATCH'
  ) {

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


    if (
      body.hidden
    ) {

      await setWeightHidden(
        env,
        memberId,
        true,
        'admin'
      );


      const lock =
        await setWeightLocked(
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

            updated_at:
              lock.updated_at,
          },
        }
      );
    }


    /*
     * 解除時は先に固定を外してから公開へ戻す。
     */
    await setWeightLocked(
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
            false,

          weight_locked:
            false,

          updated_at:
            result.updated_at,
        },
      }
    );
  }


  return bad(
    req,
    'method_not_allowed',
    405
  );
}


/* ============================================================
   JSONレスポンスを作り直す
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
   ランキングの実体重を隠す
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
    locked
  ] =
    await Promise.all([
      hiddenWeightSet(
        env,
        ids
      ),

      lockedWeightSet(
        env,
        ids
      ),
    ]);


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
      hidden.has(
        id
      );


    row.weight_hidden =
      hide;


    row.weight_locked =
      locked.has(
        id
      );


    if (!hide) {
      continue;
    }


    /*
     * loss は残す。
     * 実体重だけ消す。
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

        row[key] =
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
   日付ビューの実体重を隠す
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
          r.id
      )
      .filter(
        Boolean
      );


  const [
    hidden,
    locked
  ] =
    await Promise.all([
      hiddenWeightSet(
        env,
        ids
      ),

      lockedWeightSet(
        env,
        ids
      ),
    ]);


  let visibleTotal =
    0;

  let hasVisibleWeight =
    false;


  for (
    const row of
    data.members
  ) {

    if (!row) {
      continue;
    }


    const id =
      row.id
        ? String(
            row.id
          )
        : '';


    const hide =
      !!id &&
      hidden.has(
        id
      );


    row.weight_hidden =
      !!hide;


    row.weight_locked =
      !!id &&
      locked.has(
        id
      );


    if (hide) {

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
      s[i];


    if (
      quoted
    ) {

      if (
        c === '"'
      ) {

        if (
          s[i + 1] ===
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
      c === '"'
    ) {

      quoted =
        true;

    } else if (
      c === ','
    ) {

      row.push(
        cur
      );

      cur =
        '';

    } else if (
      c === '\n'
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
      c !== '\r'
    ) {

      cur +=
        c;
    }
  }


  if (
    cur !== '' ||
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
    rows[0]
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

    const headers =
      new Headers(
        response.headers
      );


    headers.delete(
      'content-length'
    );


    return new Response(
      text,
      {
        status:
          response.status,

        headers,
      }
    );
  }


  const ids =
    rows
      .slice(1)
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
    rows.slice(1)
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
   admin.js一般ユーザー向けレスポンス
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
