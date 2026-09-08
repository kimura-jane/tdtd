'use strict';

import {
  INACTIVE_DAYS,
  json,
  bad,
  todayYmdJST,
  isYmd,
  ymdToDay,
  round1,
  normGroupName,
  normalizeCode,
  fmtCode,
  genCode,
  rateOk,
  isBanned,
} from './lib.js';

/* ============================================================
   みんやせ / worker/operator.js
   運営専用グループ管理

   ・OPERATOR_MEMBER_ID は Cloudflare 環境変数で管理
   ・運営者は通常グループの参加者にはしない
   ・管理グループ数に上限は設けない
   ・運営グループの owner_id は内部固定値で保持する
   ・通常ユーザー用 owner / leader API とは分離する
   ============================================================ */

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MEMBER_ID_RE = /^[0-9A-Z]{6,32}$/;
const OPERATOR_OWNER_ID = '__MINYASE_OPERATOR__';
const LEADER_MAX = 5;

async function readBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

function operatorMemberId(env) {
  const id = String((env && env.OPERATOR_MEMBER_ID) || '')
    .trim()
    .toUpperCase();

  return MEMBER_ID_RE.test(id)
    ? id
    : null;
}

export function isOperatorMember(
  env,
  memberId
) {
  const configured =
    operatorMemberId(env);

  const actual =
    String(memberId || '')
      .trim()
      .toUpperCase();

  return !!(
    configured &&
    actual &&
    configured === actual
  );
}

async function deviceFromRequest(
  req,
  env,
  {
    allowBanned = false
  } = {}
) {
  const deviceId =
    String(
      req.headers.get(
        'x-device-id'
      ) || ''
    ).trim();

  if (
    !DEVICE_ID_RE.test(
      deviceId
    )
  ) {
    return {
      error:
        bad(
          req,
          'bad_device_id'
        )
    };
  }

  const dev =
    await env.DB
      .prepare(
        'SELECT * FROM devices WHERE device_id=?'
      )
      .bind(
        deviceId
      )
      .first();

  if (!dev) {
    return {
      error:
        bad(
          req,
          'not_registered',
          404
        )
    };
  }

  if (
    Number(
      dev.banned || 0
    ) === 1 &&
    !allowBanned
  ) {
    return {
      error:
        bad(
          req,
          'banned',
          403
        )
    };
  }

  return {
    dev
  };
}

export async function isOperatorRequest(
  req,
  env
) {
  const member =
    await deviceFromRequest(
      req,
      env,
      {
        allowBanned: true
      }
    );

  return !!(
    member.dev &&
    isOperatorMember(
      env,
      member.dev.member_id
    )
  );
}

async function requireOperator(
  req,
  env
) {
  const member =
    await deviceFromRequest(
      req,
      env
    );

  if (
    member.error
  ) {
    return member;
  }

  if (
    !isOperatorMember(
      env,
      member.dev.member_id
    )
  ) {
    return {
      error:
        bad(
          req,
          'operator_only',
          403
        )
    };
  }

  return member;
}

function noSuchTable(
  error
) {
  const text =
    String(
      (
        error &&
        error.message
      ) ||
      error ||
      ''
    )
      .toLowerCase();

  return (
    text.includes(
      'no such table'
    ) ||
    text.includes(
      'does not exist'
    )
  );
}

async function optionalRun(
  env,
  sql,
  ...values
) {
  try {
    await env.DB
      .prepare(sql)
      .bind(
        ...values
      )
      .run();

  } catch (error) {

    if (
      noSuchTable(
        error
      )
    ) {
      return;
    }

    throw error;
  }
}

async function optionalFirst(
  env,
  sql,
  ...values
) {
  try {
    return await env.DB
      .prepare(sql)
      .bind(
        ...values
      )
      .first();

  } catch (error) {

    if (
      noSuchTable(
        error
      )
    ) {
      return null;
    }

    throw error;
  }
}


/* ============================================================
   運営アカウントを通常参加者から完全分離

   既存の体重履歴そのものは削除しない。
   group_id=NULL にすることで人数・ランキング・集計から外す。
   投票、外部連携、Push、通常参加用の閲覧・ライバル状態は削除する。
   ============================================================ */

async function activateOperator(
  env,
  dev
) {
  await env.DB.batch([

    env.DB
      .prepare(`
        UPDATE groups
        SET owner_id=?
        WHERE
          owner_id=?
          OR owner_id=?
      `)
      .bind(
        OPERATOR_OWNER_ID,
        dev.member_id,
        dev.device_id
      ),

    env.DB
      .prepare(`
        UPDATE devices
        SET
          group_id=NULL,
          joined_at=NULL,
          notify_on=0
        WHERE device_id=?
      `)
      .bind(
        dev.device_id
      ),
  ]);

  await optionalRun(
    env,
    `
      DELETE FROM group_leaders
      WHERE member_id=?
    `,
    dev.member_id
  );

  await optionalRun(
    env,
    `
      DELETE FROM vote_predictions
      WHERE member_id=?
    `,
    dev.member_id
  );

  await optionalRun(
    env,
    `
      DELETE FROM external_consent
      WHERE member_id=?
    `,
    dev.member_id
  );

  await optionalRun(
    env,
    `
      DELETE FROM external_queue
      WHERE member_id=?
    `,
    dev.member_id
  );

  await optionalRun(
    env,
    `
      DELETE FROM push_subscriptions
      WHERE member_id=?
    `,
    dev.member_id
  );

  await optionalRun(
    env,
    `
      DELETE FROM watching
      WHERE device_id=?
    `,
    dev.device_id
  );

  await optionalRun(
    env,
    `
      DELETE FROM rivals
      WHERE device_id=?
    `,
    dev.device_id
  );

  await optionalRun(
    env,
    `
      DELETE FROM rivals
      WHERE rival_member_id=?
    `,
    dev.member_id
  );

  dev.group_id =
    null;

  dev.joined_at =
    null;

  dev.notify_on =
    0;
}


/* ============================================================
   グループ所有確認
   ============================================================ */

async function ownedGroup(
  env,
  rawGroupId
) {
  const groupId =
    normalizeCode(
      rawGroupId
    );

  if (
    !groupId
  ) {
    return {
      error:
        'bad_code'
    };
  }

  const group =
    await env.DB
      .prepare(`
        SELECT *
        FROM groups
        WHERE
          group_id=?
          AND owner_id=?
      `)
      .bind(
        groupId,
        OPERATOR_OWNER_ID
      )
      .first();

  if (
    !group
  ) {
    return {
      error:
        'group_not_found'
    };
  }

  return {
    group
  };
}

async function groupExternalEnabled(
  env,
  groupId
) {
  const row =
    await optionalFirst(
      env,
      `
        SELECT enabled
        FROM group_external
        WHERE group_id=?
      `,
      groupId
    );

  return (
    Number(
      (
        row &&
        row.enabled
      ) ||
      0
    ) === 1
  );
}

async function groupLeaderCount(
  env,
  groupId
) {
  const row =
    await optionalFirst(
      env,
      `
        SELECT COUNT(*) AS n
        FROM group_leaders
        WHERE group_id=?
      `,
      groupId
    );

  return Number(
    (
      row &&
      row.n
    ) ||
    0
  );
}

async function groupMemberCount(
  env,
  groupId
) {
  const row =
    await env.DB
      .prepare(`
        SELECT COUNT(*) AS n
        FROM devices
        WHERE
          group_id=?
          AND banned=0
      `)
      .bind(
        groupId
      )
      .first();

  return Number(
    (
      row &&
      row.n
    ) ||
    0
  );
}

async function groupJson(
  env,
  group
) {
  return {
    group_id:
      group.group_id,

    code:
      fmtCode(
        group.group_id
      ),

    name:
      group.name,

    start_ymd:
      group.start_ymd,

    show_weight:
      Number(
        group.show_weight
      ) === 1,

    max_members:
      Number(
        group.max_members ||
        100
      ),

    members:
      await groupMemberCount(
        env,
        group.group_id
      ),

    leader_count:
      await groupLeaderCount(
        env,
        group.group_id
      ),

    leader_max:
      LEADER_MAX,

    external_enabled:
      await groupExternalEnabled(
        env,
        group.group_id
      ),

    created_at:
      group.created_at ||
      null,
  };
}


/* ============================================================
   status
   ============================================================ */

async function statusRoute(
  req,
  env
) {
  const member =
    await deviceFromRequest(
      req,
      env
    );

  if (
    member.error
  ) {
    return member.error;
  }

  if (
    !isOperatorMember(
      env,
      member.dev.member_id
    )
  ) {
    return json(
      req,
      {
        ok:
          true,

        operator:
          false,
      }
    );
  }

  await activateOperator(
    env,
    member.dev
  );

  const count =
    await env.DB
      .prepare(`
        SELECT COUNT(*) AS n
        FROM groups
        WHERE owner_id=?
      `)
      .bind(
        OPERATOR_OWNER_ID
      )
      .first();

  return json(
    req,
    {
      ok:
        true,

      operator:
        true,

      member_id:
        member.dev.member_id,

      group_count:
        Number(
          (
            count &&
            count.n
          ) ||
          0
        ),

      participant:
        false,
    }
  );
}


/* ============================================================
   グループ一覧
   ============================================================ */

async function listGroups(
  req,
  env
) {
  const rs =
    await env.DB
      .prepare(`
        SELECT *
        FROM groups
        WHERE owner_id=?
        ORDER BY
          created_at ASC,
          group_id ASC
      `)
      .bind(
        OPERATOR_OWNER_ID
      )
      .all();

  const groups =
    [];

  for (
    const group of
    rs.results ||
    []
  ) {
    groups.push(
      await groupJson(
        env,
        group
      )
    );
  }

  return json(
    req,
    {
      ok:
        true,

      count:
        groups.length,

      groups,
    }
  );
}


/* ============================================================
   グループ作成
   ============================================================ */

async function createGroup(
  req,
  env,
  dev
) {
  if (
    !await rateOk(
      env,
      'operator-create:' +
      dev.device_id
    )
  ) {
    return bad(
      req,
      'rate_limited',
      429
    );
  }

  const body =
    await readBody(
      req
    );

  const name =
    normGroupName(
      body.name
    );

  if (
    !name
  ) {
    return bad(
      req,
      isBanned(
        body.name
      )
        ? 'ng_word'
        : 'bad_name'
    );
  }

  const start =
    body.start_ymd ===
      undefined ||
    body.start_ymd ===
      null ||
    body.start_ymd ===
      ''
      ? todayYmdJST()
      : String(
          body.start_ymd
        );

  if (
    !isYmd(
      start
    )
  ) {
    return bad(
      req,
      'bad_ymd'
    );
  }

  if (
    start >
    todayYmdJST()
  ) {
    return bad(
      req,
      'future_ymd'
    );
  }

  const showWeight =
    body.show_weight ===
      undefined ||
    body.show_weight ===
      null
      ? 1
      : (
          body.show_weight
            ? 1
            : 0
        );

  let groupId =
    null;

  for (
    let i = 0;
    i < 16;
    i++
  ) {
    const candidate =
      genCode();

    const exists =
      await env.DB
        .prepare(`
          SELECT group_id
          FROM groups
          WHERE group_id=?
        `)
        .bind(
          candidate
        )
        .first();

    if (
      !exists
    ) {
      groupId =
        candidate;

      break;
    }
  }

  if (
    !groupId
  ) {
    return bad(
      req,
      'code_alloc_failed',
      500
    );
  }

  await env.DB
    .prepare(`
      INSERT INTO groups (
        group_id,
        name,
        owner_id,
        show_weight,
        start_ymd,
        max_members,
        created_at
      )
      VALUES (
        ?,
        ?,
        ?,
        ?,
        ?,
        100,
        ?
      )
    `)
    .bind(
      groupId,
      name,
      OPERATOR_OWNER_ID,
      showWeight,
      start,
      Date.now()
    )
    .run();

  const group =
    await env.DB
      .prepare(`
        SELECT *
        FROM groups
        WHERE group_id=?
      `)
      .bind(
        groupId
      )
      .first();

  return json(
    req,
    {
      ok:
        true,

      group:
        await groupJson(
          env,
          group
        ),
    },
    201
  );
}


/* ============================================================
   グループ詳細
   ============================================================ */

async function getGroup(
  req,
  env,
  rawGroupId
) {
  const owned =
    await ownedGroup(
      env,
      rawGroupId
    );

  if (
    owned.error
  ) {
    return bad(
      req,
      owned.error,
      owned.error ===
        'group_not_found'
        ? 404
        : 400
    );
  }

  return json(
    req,
    {
      ok:
        true,

      group:
        await groupJson(
          env,
          owned.group
        ),
    }
  );
}


/* ============================================================
   グループ変更
   ============================================================ */

async function patchGroup(
  req,
  env,
  rawGroupId
) {
  const owned =
    await ownedGroup(
      env,
      rawGroupId
    );

  if (
    owned.error
  ) {
    return bad(
      req,
      owned.error,
      owned.error ===
        'group_not_found'
        ? 404
        : 400
    );
  }

  const body =
    await readBody(
      req
    );

  if (
    'show_weight' in body
  ) {
    return bad(
      req,
      'show_weight_locked'
    );
  }

  const sets =
    [];

  const values =
    [];

  if (
    'name' in body
  ) {
    const name =
      normGroupName(
        body.name
      );

    if (
      !name
    ) {
      return bad(
        req,
        isBanned(
          body.name
        )
          ? 'ng_word'
          : 'bad_name'
      );
    }

    sets.push(
      'name=?'
    );

    values.push(
      name
    );
  }

  if (
    'start_ymd' in body
  ) {
    const start =
      String(
        body.start_ymd ||
        ''
      );

    if (
      !isYmd(
        start
      )
    ) {
      return bad(
        req,
        'bad_ymd'
      );
    }

    if (
      start >
      todayYmdJST()
    ) {
      return bad(
        req,
        'future_ymd'
      );
    }

    sets.push(
      'start_ymd=?'
    );

    values.push(
      start
    );
  }

  if (
    !sets.length
  ) {
    return bad(
      req,
      'nothing_to_update'
    );
  }

  values.push(
    owned.group.group_id,
    OPERATOR_OWNER_ID
  );

  await env.DB
    .prepare(`
      UPDATE groups
      SET ${sets.join(',')}
      WHERE
        group_id=?
        AND owner_id=?
    `)
    .bind(
      ...values
    )
    .run();

  return await getGroup(
    req,
    env,
    owned.group.group_id
  );
}


/* ============================================================
   メンバー一覧・ランキング
   ============================================================ */

function memberIconUrl(
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

function normalizeMemberId(
  raw
) {
  const value =
    String(
      raw ||
      ''
    )
      .trim()
      .toUpperCase();

  return MEMBER_ID_RE.test(
    value
  )
    ? value
    : null;
}

async function memberRowsForGroup(
  env,
  group
) {
  const start =
    group.start_ymd ||
    '1900-01-01';

  const rs =
    await env.DB
      .prepare(`
        SELECT
          d.device_id,
          d.member_id,
          d.nickname,
          d.icon_ver,
          d.joined_at,

          (
            SELECT w.ymd
            FROM weights w
            WHERE
              w.device_id=d.device_id
              AND w.ymd>=?
            ORDER BY w.ymd ASC
            LIMIT 1
          ) AS first_ymd,

          (
            SELECT w.kg
            FROM weights w
            WHERE
              w.device_id=d.device_id
              AND w.ymd>=?
            ORDER BY w.ymd ASC
            LIMIT 1
          ) AS first_kg,

          (
            SELECT w.ymd
            FROM weights w
            WHERE
              w.device_id=d.device_id
              AND w.ymd>=?
            ORDER BY w.ymd DESC
            LIMIT 1
          ) AS last_ymd,

          (
            SELECT w.kg
            FROM weights w
            WHERE
              w.device_id=d.device_id
              AND w.ymd>=?
            ORDER BY w.ymd DESC
            LIMIT 1
          ) AS last_kg

        FROM devices d

        WHERE
          d.group_id=?
          AND d.banned=0

        ORDER BY
          d.joined_at ASC,
          d.member_id ASC
      `)
      .bind(
        start,
        start,
        start,
        start,
        group.group_id
      )
      .all();

  const todayDay =
    ymdToDay(
      todayYmdJST()
    );

  const leaders =
    new Set();

  try {
    const lr =
      await env.DB
        .prepare(`
          SELECT member_id
          FROM group_leaders
          WHERE group_id=?
        `)
        .bind(
          group.group_id
        )
        .all();

    for (
      const row of
      lr.results ||
      []
    ) {
      if (
        row.member_id
      ) {
        leaders.add(
          String(
            row.member_id
          )
        );
      }
    }

  } catch {}

  const rows =
    (
      rs.results ||
      []
    )
      .map(
        row => {

          const firstKg =
            row.first_kg ===
              null ||
            row.first_kg ===
              undefined
              ? null
              : Number(
                  row.first_kg
                );

          const lastKg =
            row.last_kg ===
              null ||
            row.last_kg ===
              undefined
              ? null
              : Number(
                  row.last_kg
                );

          const hasPair =
            !!(
              row.first_ymd &&
              row.last_ymd &&
              row.first_ymd !==
                row.last_ymd &&
              Number.isFinite(
                firstKg
              ) &&
              Number.isFinite(
                lastKg
              )
            );

          const loss =
            hasPair
              ? round1(
                  firstKg -
                  lastKg
                )
              : null;

          const idleDays =
            row.last_ymd
              ? (
                  todayDay -
                  ymdToDay(
                    row.last_ymd
                  )
                )
              : null;

          return {
            member_id:
              row.member_id,

            nickname:
              row.nickname ||
              null,

            icon_ver:
              Number(
                row.icon_ver ||
                0
              ),

            icon_url:
              memberIconUrl(
                row.member_id,
                row.icon_ver
              ),

            joined_at:
              row.joined_at ||
              null,

            loss,

            start_ymd:
              row.first_ymd ||
              null,

            last_ymd:
              row.last_ymd ||
              null,

            idle_days:
              idleDays,

            inactive:
              idleDays ===
                null
                ? true
                : (
                    idleDays >=
                    INACTIVE_DAYS
                  ),

            is_leader:
              leaders.has(
                row.member_id
              ),

            rank:
              null,
          };
        }
      );

  const ranked =
    rows
      .filter(
        row =>
          row.loss !==
          null
      )
      .sort(
        (
          a,
          b
        ) => {

          if (
            b.loss !==
            a.loss
          ) {
            return (
              b.loss -
              a.loss
            );
          }

          return String(
            a.member_id
          )
            .localeCompare(
              String(
                b.member_id
              )
            );
        }
      );

  let previousLoss =
    null;

  let previousRank =
    0;

  for (
    let i = 0;
    i <
      ranked.length;
    i++
  ) {
    const row =
      ranked[i];

    if (
      previousLoss ===
        null ||
      row.loss !==
        previousLoss
    ) {
      previousRank =
        i +
        1;

      previousLoss =
        row.loss;
    }

    row.rank =
      previousRank;
  }

  rows.sort(
    (
      a,
      b
    ) => {

      if (
        a.rank !==
          null &&
        b.rank !==
          null
      ) {
        return (
          a.rank -
          b.rank
        );
      }

      if (
        a.rank !==
        null
      ) {
        return -1;
      }

      if (
        b.rank !==
        null
      ) {
        return 1;
      }

      return String(
        a.nickname ||
        a.member_id
      )
        .localeCompare(
          String(
            b.nickname ||
            b.member_id
          ),
          'ja'
        );
    }
  );

  const losses =
    rows
      .filter(
        row =>
          row.loss !==
          null
      )
      .map(
        row =>
          row.loss
      );

  const totalLoss =
    losses.length
      ? round1(
          losses.reduce(
            (
              total,
              value
            ) =>
              total +
              value,
            0
          )
        )
      : 0;

  const avgLoss =
    losses.length
      ? round1(
          totalLoss /
          losses.length
        )
      : null;

  return {
    rows,

    summary: {
      members:
        rows.length,

      counted:
        losses.length,

      total_loss:
        totalLoss,

      avg_loss:
        avgLoss,
    },
  };
}

async function listMembers(
  req,
  env,
  rawGroupId
) {
  const owned =
    await ownedGroup(
      env,
      rawGroupId
    );

  if (
    owned.error
  ) {
    return bad(
      req,
      owned.error,
      owned.error ===
        'group_not_found'
        ? 404
        : 400
    );
  }

  const built =
    await memberRowsForGroup(
      env,
      owned.group
    );

  return json(
    req,
    {
      ok:
        true,

      group:
        await groupJson(
          env,
          owned.group
        ),

      summary:
        built.summary,

      rows:
        built.rows,
    }
  );
}


/* ============================================================
   メンバー除名
   ============================================================ */

async function kickMember(
  req,
  env,
  rawGroupId
) {
  const owned =
    await ownedGroup(
      env,
      rawGroupId
    );

  if (
    owned.error
  ) {
    return bad(
      req,
      owned.error,
      owned.error ===
        'group_not_found'
        ? 404
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

  if (
    !memberId
  ) {
    return bad(
      req,
      'bad_member_id'
    );
  }

  const target =
    await env.DB
      .prepare(`
        SELECT
          device_id,
          member_id,
          nickname,
          group_id,
          banned
        FROM devices
        WHERE member_id=?
      `)
      .bind(
        memberId
      )
      .first();

  if (
    !target ||
    target.group_id !==
      owned.group.group_id
  ) {
    return bad(
      req,
      'not_in_group',
      404
    );
  }

  if (
    Number(
      target.banned ||
      0
    ) === 1
  ) {
    return bad(
      req,
      'banned',
      403
    );
  }

  const now =
    Date.now();

  await env.DB.batch([

    env.DB
      .prepare(`
        UPDATE devices
        SET
          group_id=NULL,
          joined_at=NULL
        WHERE
          member_id=?
          AND group_id=?
      `)
      .bind(
        memberId,
        owned.group.group_id
      ),

    env.DB
      .prepare(`
        INSERT OR IGNORE INTO group_bans (
          group_id,
          member_id,
          by_admin,
          created_at
        )
        VALUES (
          ?,
          ?,
          1,
          ?
        )
      `)
      .bind(
        owned.group.group_id,
        memberId,
        now
      ),
  ]);

  await optionalRun(
    env,
    `
      DELETE FROM group_leaders
      WHERE
        group_id=?
        AND member_id=?
    `,
    owned.group.group_id,
    memberId
  );

  await optionalRun(
    env,
    `
      DELETE FROM external_consent
      WHERE
        group_id=?
        AND member_id=?
    `,
    owned.group.group_id,
    memberId
  );

  await optionalRun(
    env,
    `
      DELETE FROM external_queue
      WHERE
        group_id=?
        AND member_id=?
    `,
    owned.group.group_id,
    memberId
  );

  return json(
    req,
    {
      ok:
        true,

      member_id:
        memberId,

      nickname:
        target.nickname ||
        null,

      kicked:
        true,
    }
  );
}


/* ============================================================
   除名リスト
   ============================================================ */

async function listBans(
  req,
  env,
  rawGroupId
) {
  const owned =
    await ownedGroup(
      env,
      rawGroupId
    );

  if (
    owned.error
  ) {
    return bad(
      req,
      owned.error,
      owned.error ===
        'group_not_found'
        ? 404
        : 400
    );
  }

  const rs =
    await env.DB
      .prepare(`
        SELECT
          b.member_id,
          b.created_at,
          d.nickname,
          d.icon_ver

        FROM group_bans b

        LEFT JOIN devices d
          ON d.member_id=b.member_id

        WHERE b.group_id=?

        ORDER BY
          b.created_at DESC,
          b.member_id ASC
      `)
      .bind(
        owned.group.group_id
      )
      .all();

  const bans =
    (
      rs.results ||
      []
    )
      .map(
        row => ({
          member_id:
            row.member_id,

          nickname:
            row.nickname ||
            null,

          icon_ver:
            Number(
              row.icon_ver ||
              0
            ),

          icon_url:
            memberIconUrl(
              row.member_id,
              row.icon_ver
            ),

          created_at:
            row.created_at ||
            null,
        })
      );

  return json(
    req,
    {
      ok:
        true,

      group_id:
        owned.group.group_id,

      bans,
    }
  );
}


/* ============================================================
   除名解除
   ============================================================ */

async function unbanMember(
  req,
  env,
  rawGroupId
) {
  const owned =
    await ownedGroup(
      env,
      rawGroupId
    );

  if (
    owned.error
  ) {
    return bad(
      req,
      owned.error,
      owned.error ===
        'group_not_found'
        ? 404
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

  if (
    !memberId
  ) {
    return bad(
      req,
      'bad_member_id'
    );
  }

  await env.DB
    .prepare(`
      DELETE FROM group_bans
      WHERE
        group_id=?
        AND member_id=?
    `)
    .bind(
      owned.group.group_id,
      memberId
    )
    .run();

  return json(
    req,
    {
      ok:
        true,

      member_id:
        memberId,

      unbanned:
        true,
    }
  );
}


/* ============================================================
   リーダー管理
   ============================================================ */

async function listLeaders(
  req,
  env,
  rawGroupId
) {
  const owned =
    await ownedGroup(
      env,
      rawGroupId
    );

  if (
    owned.error
  ) {
    return bad(
      req,
      owned.error,
      owned.error ===
        'group_not_found'
        ? 404
        : 400
    );
  }

  let rows =
    [];

  try {
    const rs =
      await env.DB
        .prepare(`
          SELECT
            l.member_id,
            l.created_at,
            d.nickname,
            d.icon_ver,
            d.group_id

          FROM group_leaders l

          LEFT JOIN devices d
            ON d.member_id=l.member_id

          WHERE l.group_id=?

          ORDER BY
            l.created_at ASC,
            l.member_id ASC
        `)
        .bind(
          owned.group.group_id
        )
        .all();

    rows =
      rs.results ||
      [];

  } catch (error) {

    if (
      !noSuchTable(
        error
      )
    ) {
      throw error;
    }
  }

  const members =
    await env.DB
      .prepare(`
        SELECT
          member_id,
          nickname,
          icon_ver
        FROM devices
        WHERE
          group_id=?
          AND banned=0
        ORDER BY
          joined_at ASC,
          member_id ASC
      `)
      .bind(
        owned.group.group_id
      )
      .all();

  const leaderIds =
    new Set(
      rows.map(
        row =>
          row.member_id
      )
    );

  const leaders =
    rows.map(
      row => ({
        member_id:
          row.member_id,

        nickname:
          row.nickname ||
          null,

        icon_ver:
          Number(
            row.icon_ver ||
            0
          ),

        icon_url:
          memberIconUrl(
            row.member_id,
            row.icon_ver
          ),

        created_at:
          row.created_at ||
          null,

        in_group:
          row.group_id ===
          owned.group.group_id,
      })
    );

  const candidates =
    (
      members.results ||
      []
    )
      .filter(
        row =>
          !leaderIds.has(
            row.member_id
          )
      )
      .map(
        row => ({
          member_id:
            row.member_id,

          nickname:
            row.nickname ||
            null,

          icon_ver:
            Number(
              row.icon_ver ||
              0
            ),

          icon_url:
            memberIconUrl(
              row.member_id,
              row.icon_ver
            ),
        })
      );

  return json(
    req,
    {
      ok:
        true,

      group_id:
        owned.group.group_id,

      leader_max:
        LEADER_MAX,

      leader_count:
        leaders.length,

      leaders,

      candidates,
    }
  );
}

async function addLeader(
  req,
  env,
  rawGroupId
) {
  const owned =
    await ownedGroup(
      env,
      rawGroupId
    );

  if (
    owned.error
  ) {
    return bad(
      req,
      owned.error,
      owned.error ===
        'group_not_found'
        ? 404
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

  if (
    !memberId
  ) {
    return bad(
      req,
      'bad_member_id'
    );
  }

  const target =
    await env.DB
      .prepare(`
        SELECT
          member_id,
          group_id,
          banned
        FROM devices
        WHERE member_id=?
      `)
      .bind(
        memberId
      )
      .first();

  if (
    !target ||
    target.group_id !==
      owned.group.group_id
  ) {
    return bad(
      req,
      'not_in_group',
      404
    );
  }

  if (
    Number(
      target.banned ||
      0
    ) === 1
  ) {
    return bad(
      req,
      'banned',
      403
    );
  }

  await env.DB
    .prepare(`
      CREATE TABLE IF NOT EXISTS group_leaders (
        group_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (
          group_id,
          member_id
        )
      )
    `)
    .run();

  const existing =
    await env.DB
      .prepare(`
        SELECT member_id
        FROM group_leaders
        WHERE
          group_id=?
          AND member_id=?
      `)
      .bind(
        owned.group.group_id,
        memberId
      )
      .first();

  if (
    existing
  ) {
    return bad(
      req,
      'already_leader'
    );
  }

  const count =
    await env.DB
      .prepare(`
        SELECT COUNT(*) AS n
        FROM group_leaders
        WHERE group_id=?
      `)
      .bind(
        owned.group.group_id
      )
      .first();

  if (
    Number(
      (
        count &&
        count.n
      ) ||
      0
    ) >=
    LEADER_MAX
  ) {
    return bad(
      req,
      'leader_limit'
    );
  }

  await env.DB
    .prepare(`
      INSERT INTO group_leaders (
        group_id,
        member_id,
        created_at
      )
      VALUES (
        ?,
        ?,
        ?
      )
    `)
    .bind(
      owned.group.group_id,
      memberId,
      Date.now()
    )
    .run();

  return await listLeaders(
    req,
    env,
    owned.group.group_id
  );
}

async function removeLeader(
  req,
  env,
  rawGroupId,
  rawMemberId
) {
  const owned =
    await ownedGroup(
      env,
      rawGroupId
    );

  if (
    owned.error
  ) {
    return bad(
      req,
      owned.error,
      owned.error ===
        'group_not_found'
        ? 404
        : 400
    );
  }

  const memberId =
    normalizeMemberId(
      rawMemberId
    );

  if (
    !memberId
  ) {
    return bad(
      req,
      'bad_member_id'
    );
  }

  await optionalRun(
    env,
    `
      DELETE FROM group_leaders
      WHERE
        group_id=?
        AND member_id=?
    `,
    owned.group.group_id,
    memberId
  );

  return await listLeaders(
    req,
    env,
    owned.group.group_id
  );
}


/* ============================================================
   グループ解散
   ============================================================ */

async function dissolveGroup(
  req,
  env,
  rawGroupId
) {
  const owned =
    await ownedGroup(
      env,
      rawGroupId
    );

  if (
    owned.error
  ) {
    return bad(
      req,
      owned.error,
      owned.error ===
        'group_not_found'
        ? 404
        : 400
    );
  }

  const groupId =
    owned.group.group_id;

  await optionalRun(
    env,
    `
      DELETE FROM group_leaders
      WHERE group_id=?
    `,
    groupId
  );

  await optionalRun(
    env,
    `
      DELETE FROM group_external
      WHERE group_id=?
    `,
    groupId
  );

  await optionalRun(
    env,
    `
      DELETE FROM external_consent
      WHERE group_id=?
    `,
    groupId
  );

  await optionalRun(
    env,
    `
      DELETE FROM external_queue
      WHERE group_id=?
    `,
    groupId
  );

  await env.DB.batch([

    env.DB
      .prepare(`
        UPDATE devices
        SET
          group_id=NULL,
          joined_at=NULL
        WHERE group_id=?
      `)
      .bind(
        groupId
      ),

    env.DB
      .prepare(`
        DELETE FROM group_bans
        WHERE group_id=?
      `)
      .bind(
        groupId
      ),

    env.DB
      .prepare(`
        DELETE FROM watching
        WHERE group_id=?
      `)
      .bind(
        groupId
      ),

    env.DB
      .prepare(`
        DELETE FROM groups
        WHERE
          group_id=?
          AND owner_id=?
      `)
      .bind(
        groupId,
        OPERATOR_OWNER_ID
      ),
  ]);

  return json(
    req,
    {
      ok:
        true,

      group_id:
        groupId,

      dissolved:
        true,
    }
  );
}


/* ============================================================
   運営者の通常参加機能を禁止
   ============================================================ */

export async function operatorParticipationGuard(
  req,
  env,
  pathname,
  method
) {
  const operator =
    await isOperatorRequest(
      req,
      env
    );

  if (
    !operator
  ) {
    return null;
  }

  const p =
    String(
      pathname ||
      ''
    )
      .replace(
        /\/+$/,
        ''
      );

  const m =
    String(
      method ||
      req.method ||
      'GET'
    )
      .toUpperCase();

  if (
    p ===
      '/api/weights' ||
    p.startsWith(
      '/api/weights/'
    )
  ) {
    return bad(
      req,
      'operator_not_allowed',
      403
    );
  }

  if (
    p ===
      '/api/vote' ||
    p.startsWith(
      '/api/vote/'
    )
  ) {
    return bad(
      req,
      'operator_not_allowed',
      403
    );
  }

  const normalGroupMutation =
    (
      p ===
        '/api/groups' &&
      [
        'POST',
        'PATCH',
        'DELETE'
      ]
        .includes(m)
    ) ||
    (
      p ===
        '/api/groups/create' &&
      m ===
        'POST'
    ) ||
    (
      p ===
        '/api/groups/join' &&
      m ===
        'POST'
    ) ||
    (
      p ===
        '/api/groups/leave' &&
      m ===
        'POST'
    ) ||
    (
      p ===
        '/api/groups/rename' &&
      m ===
        'POST'
    ) ||
    (
      p ===
        '/api/groups/start' &&
      m ===
        'POST'
    ) ||
    (
      p ===
        '/api/groups/kick' &&
      m ===
        'POST'
    ) ||
    (
      p ===
        '/api/groups/unban' &&
      m ===
        'POST'
    ) ||
    (
      p ===
        '/api/groups/dissolve' &&
      m ===
        'POST'
    ) ||
    (
      p ===
        '/api/groups/leaders' &&
      [
        'POST',
        'DELETE'
      ]
        .includes(m)
    ) ||
    (
      p.startsWith(
        '/api/groups/leaders/'
      ) &&
      m ===
        'DELETE'
    );

  if (
    normalGroupMutation
  ) {
    return bad(
      req,
      'operator_not_allowed',
      403
    );
  }

  if (
    p ===
      '/api/rivals' ||
    p.startsWith(
      '/api/rivals/'
    )
  ) {
    return bad(
      req,
      'operator_not_allowed',
      403
    );
  }

  if (
    p ===
      '/api/watching' ||
    p.startsWith(
      '/api/watching/'
    )
  ) {
    return bad(
      req,
      'operator_not_allowed',
      403
    );
  }

  return null;
}


/* ============================================================
   運営API ルーティング
   ============================================================ */

export async function operatorRoute(
  req,
  env,
  url
) {
  const p =
    url.pathname
      .replace(
        /\/+$/,
        ''
      );

  const m =
    req.method;

  if (
    p ===
      '/api/operator/status' &&
    m ===
      'GET'
  ) {
    return await statusRoute(
      req,
      env
    );
  }

  const member =
    await requireOperator(
      req,
      env
    );

  if (
    member.error
  ) {
    return member.error;
  }

  await activateOperator(
    env,
    member.dev
  );

  if (
    p ===
      '/api/operator/groups'
  ) {

    if (
      m ===
        'GET'
    ) {
      return await listGroups(
        req,
        env
      );
    }

    if (
      m ===
        'POST'
    ) {
      return await createGroup(
        req,
        env,
        member.dev
      );
    }

    return bad(
      req,
      'method_not_allowed',
      405
    );
  }

  const groupMatch =
    /^\/api\/operator\/groups\/([0-9A-Z]{8})$/
      .exec(
        p
      );

  if (
    groupMatch
  ) {
    const groupId =
      groupMatch[1];

    if (
      m ===
        'GET'
    ) {
      return await getGroup(
        req,
        env,
        groupId
      );
    }

    if (
      m ===
        'PATCH'
    ) {
      return await patchGroup(
        req,
        env,
        groupId
      );
    }

    if (
      m ===
        'DELETE'
    ) {
      return await dissolveGroup(
        req,
        env,
        groupId
      );
    }

    return bad(
      req,
      'method_not_allowed',
      405
    );
  }

  const membersMatch =
    /^\/api\/operator\/groups\/([0-9A-Z]{8})\/members$/
      .exec(
        p
      );

  if (
    membersMatch
  ) {

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

    return await listMembers(
      req,
      env,
      membersMatch[1]
    );
  }

  const kickMatch =
    /^\/api\/operator\/groups\/([0-9A-Z]{8})\/kick$/
      .exec(
        p
      );

  if (
    kickMatch
  ) {

    if (
      m !==
        'POST'
    ) {
      return bad(
        req,
        'method_not_allowed',
        405
      );
    }

    return await kickMember(
      req,
      env,
      kickMatch[1]
    );
  }

  const bansMatch =
    /^\/api\/operator\/groups\/([0-9A-Z]{8})\/bans$/
      .exec(
        p
      );

  if (
    bansMatch
  ) {

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

    return await listBans(
      req,
      env,
      bansMatch[1]
    );
  }

  const unbanMatch =
    /^\/api\/operator\/groups\/([0-9A-Z]{8})\/unban$/
      .exec(
        p
      );

  if (
    unbanMatch
  ) {

    if (
      m !==
        'POST'
    ) {
      return bad(
        req,
        'method_not_allowed',
        405
      );
    }

    return await unbanMember(
      req,
      env,
      unbanMatch[1]
    );
  }

  const leadersMatch =
    /^\/api\/operator\/groups\/([0-9A-Z]{8})\/leaders$/
      .exec(
        p
      );

  if (
    leadersMatch
  ) {

    if (
      m ===
        'GET'
    ) {
      return await listLeaders(
        req,
        env,
        leadersMatch[1]
      );
    }

    if (
      m ===
        'POST'
    ) {
      return await addLeader(
        req,
        env,
        leadersMatch[1]
      );
    }

    return bad(
      req,
      'method_not_allowed',
      405
    );
  }

  const leaderDeleteMatch =
    /^\/api\/operator\/groups\/([0-9A-Z]{8})\/leaders\/([0-9A-Z]{6,32})$/
      .exec(
        p
      );

  if (
    leaderDeleteMatch
  ) {

    if (
      m !==
        'DELETE'
    ) {
      return bad(
        req,
        'method_not_allowed',
        405
      );
    }

    return await removeLeader(
      req,
      env,
      leaderDeleteMatch[1],
      leaderDeleteMatch[2]
    );
  }

  return bad(
    req,
    'not_found',
    404
  );
}
