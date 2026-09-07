'use strict';

import {
  json,
  bad,
  normalizeCode,
  rateOk,
  round1,
  isYmd
} from './lib.js';


const DEVICE_ID_RE =
  /^[A-Za-z0-9_-]{8,64}$/;

const MEMBER_ID_RE =
  /^[0-9A-Z]{6,32}$/;

const ICON_MAX_BYTES =
  300 * 1024;

const ICON_PREFIX =
  'icon/';

const PENDING_ICON_PREFIX =
  'pending-icon/';

let tablesReady =
  false;


/* ============================================================
   共通
   ============================================================ */

function iconKey(memberId) {

  return (
    ICON_PREFIX +
    memberId +
    '.jpg'
  );
}


function pendingIconKey(memberId) {

  return (
    PENDING_ICON_PREFIX +
    memberId +
    '.jpg'
  );
}


function safeEqual(a, b) {

  const x =
    String(a || '');

  const y =
    String(b || '');

  if (
    !x ||
    x.length !== y.length
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
      x.charCodeAt(i) ^
      y.charCodeAt(i);
  }

  return diff === 0;
}


async function readJson(req) {

  try {

    const body =
      await req.json();

    return (
      body &&
      typeof body ===
        'object'
    )
      ? body
      : {};

  } catch {

    return {};
  }
}


async function responseJson(response) {

  if (!response) {

    return null;
  }

  try {

    return await response
      .clone()
      .json();

  } catch {

    return null;
  }
}


function rebuildJson(
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


/*
 * 通常APIではBANユーザーを拒否。
 *
 * アカウント削除に必要なcontext取得時のみ
 * allowBanned=true で読み取りを許可する。
 */
async function currentDevice(
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
      ) ||
      ''
    )
      .trim();

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
        ),
    };
  }

  const dev =
    await env.DB
      .prepare(`
        SELECT *
        FROM devices
        WHERE device_id=?
      `)
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
        ),
    };
  }

  if (
    Number(
      dev.banned ||
      0
    ) === 1 &&
    !allowBanned
  ) {

    return {
      error:
        bad(
          req,
          'banned',
          403
        ),
    };
  }

  return {
    dev,
  };
}


/* ============================================================
   DB
   ============================================================ */

export async function ensureSafetyTables(
  env
) {

  if (
    tablesReady
  ) {

    return;
  }

  await env.DB.batch([

    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS icon_pending (
        member_id TEXT PRIMARY KEY,
        object_key TEXT NOT NULL,
        uploaded_at INTEGER NOT NULL,
        bytes INTEGER NOT NULL DEFAULT 0
      )
    `),

    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS group_external (
        group_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )
    `),

    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS external_consent (
        member_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        consented INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (
          member_id,
          group_id
        )
      )
    `),

    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS external_queue (
        member_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        measurement_date TEXT NOT NULL,
        payload TEXT NOT NULL,
        queued_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_at INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        PRIMARY KEY (
          member_id,
          group_id,
          measurement_date
        )
      )
    `),

    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS cleanup_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        member_id TEXT,
        group_id TEXT,
        payload TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_at INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL
      )
    `),

    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS weight_privacy (
        member_id TEXT PRIMARY KEY,
        hidden INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL,
        updated_by TEXT
      )
    `),

    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS weight_privacy_lock (
        member_id TEXT PRIMARY KEY,
        locked INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL,
        updated_by TEXT
      )
    `),
  ]);

  tablesReady =
    true;
}


/* ============================================================
   管理者認証
   ============================================================ */

async function adminToken(env) {

  const fromEnv =
    String(
      env.ADMIN_TOKEN ||
      ''
    )
      .trim();

  if (
    fromEnv
  ) {

    return fromEnv;
  }

  try {

    const row =
      await env.DB
        .prepare(`
          SELECT v
          FROM app_config
          WHERE k='admin_token'
        `)
        .first();

    return String(
      row &&
      row.v ||
      ''
    )
      .trim();

  } catch {

    return '';
  }
}


async function adminAuthorized(
  req,
  env
) {

  const want =
    await adminToken(
      env
    );

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

  const match =
    /^Bearer\s+(.+)$/i
      .exec(
        auth
      );

  const got =
    match
      ? match[1].trim()
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
   外部WEB グループ設定
   ============================================================ */

async function groupExternalEnabled(
  env,
  groupId
) {

  if (
    !groupId
  ) {

    return false;
  }

  await ensureSafetyTables(
    env
  );

  const row =
    await env.DB
      .prepare(`
        SELECT enabled
        FROM group_external
        WHERE group_id=?
      `)
      .bind(
        groupId
      )
      .first();

  return (
    Number(
      row &&
      row.enabled ||
      0
    ) === 1
  );
}


async function externalConsentValue(
  env,
  memberId,
  groupId
) {

  if (
    !memberId ||
    !groupId
  ) {

    return false;
  }

  await ensureSafetyTables(
    env
  );

  const row =
    await env.DB
      .prepare(`
        SELECT consented
        FROM external_consent
        WHERE
          member_id=?
          AND group_id=?
      `)
      .bind(
        memberId,
        groupId
      )
      .first();

  return (
    Number(
      row &&
      row.consented ||
      0
    ) === 1
  );
}


/* ============================================================
   リーダー
   ============================================================ */

async function leaderIds(
  env,
  groupId
) {

  if (
    !groupId
  ) {

    return [];
  }

  try {

    const rs =
      await env.DB
        .prepare(`
          SELECT member_id
          FROM group_leaders
          WHERE group_id=?
        `)
        .bind(
          groupId
        )
        .all();

    return (
      rs.results ||
      []
    )
      .map(
        row =>
          row.member_id
      );

  } catch {

    return [];
  }
}


async function groupView(
  env,
  group,
  dev
) {

  if (
    !group ||
    !dev
  ) {

    return null;
  }

  const count =
    await env.DB
      .prepare(`
        SELECT COUNT(*) AS n
        FROM devices
        WHERE
          group_id=?
          AND banned=0
      `)
      .bind(
        group.group_id
      )
      .first();

  const owner =
    group.owner_id ===
      dev.member_id ||
    group.owner_id ===
      dev.device_id;

  const leaders =
    await leaderIds(
      env,
      group.group_id
    );

  const leader =
    !owner &&
    leaders.includes(
      dev.member_id
    );

  const canManage =
    owner ||
    leader;

  return {
    group_id:
      group.group_id,

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
      Number(
        count &&
        count.n ||
        0
      ),

    is_owner:
      owner,

    is_leader:
      leader,

    can_manage:
      canManage,

    leader_count:
      leaders.length,

    leader_max:
      5,

    code:
      canManage
        ? group.group_id
        : null,

    external_enabled:
      await groupExternalEnabled(
        env,
        group.group_id
      ),
  };
}


/* ============================================================
   グループ参加時のprivacy
   ============================================================ */

async function adminLocked(
  env,
  memberId
) {

  const row =
    await env.DB
      .prepare(`
        SELECT
          locked,
          updated_by
        FROM weight_privacy_lock
        WHERE member_id=?
      `)
      .bind(
        memberId
      )
      .first();

  return !!(
    row &&
    Number(
      row.locked ||
      0
    ) === 1 &&
    String(
      row.updated_by ||
      ''
    )
      .startsWith(
        'admin'
      )
  );
}


async function joinStatements(
  env,
  dev,
  group,
  {
    hidden,
    externalConsent
  }
) {

  const now =
    Date.now();

  const statements = [

    env.DB
      .prepare(`
        UPDATE devices
        SET
          group_id=?,
          joined_at=?
        WHERE device_id=?
      `)
      .bind(
        group.group_id,
        now,
        dev.device_id
      ),

    env.DB
      .prepare(`
        DELETE FROM watching
        WHERE
          device_id=?
          AND group_id=?
      `)
      .bind(
        dev.device_id,
        group.group_id
      ),
  ];

  /*
   * 管理者シークレット固定だけは
   * 参加画面の本人選択で解除させない。
   */
  const locked =
    await adminLocked(
      env,
      dev.member_id
    );

  if (
    !locked
  ) {

    statements.push(

      env.DB
        .prepare(`
          INSERT INTO weight_privacy (
            member_id,
            hidden,
            updated_at,
            updated_by
          )
          VALUES (?,?,?,'self')

          ON CONFLICT(member_id)
          DO UPDATE SET
            hidden=excluded.hidden,
            updated_at=excluded.updated_at,
            updated_by='self'
        `)
        .bind(
          dev.member_id,
          hidden
            ? 1
            : 0,
          now
        ),

      env.DB
        .prepare(`
          INSERT INTO weight_privacy_lock (
            member_id,
            locked,
            updated_at,
            updated_by
          )
          VALUES (?,?,?,'self')

          ON CONFLICT(member_id)
          DO UPDATE SET
            locked=excluded.locked,
            updated_at=excluded.updated_at,
            updated_by='self'
        `)
        .bind(
          dev.member_id,
          hidden
            ? 1
            : 0,
          now
        )
    );
  }

  const externalEnabled =
    await groupExternalEnabled(
      env,
      group.group_id
    );

  /*
   * 同意はmember_id + group_id単位。
   * 外部対象でないグループなら必ず0。
   */
  statements.push(

    env.DB
      .prepare(`
        INSERT INTO external_consent (
          member_id,
          group_id,
          consented,
          updated_at
        )
        VALUES (?,?,?,?)

        ON CONFLICT(member_id,group_id)
        DO UPDATE SET
          consented=excluded.consented,
          updated_at=excluded.updated_at
      `)
      .bind(
        dev.member_id,
        group.group_id,
        externalEnabled &&
        externalConsent
          ? 1
          : 0,
        now
      )
  );

  return statements;
}


/* ============================================================
   安全なグループ参加

   membership / privacy / consent を
   同じD1 batchで確定する。
   ============================================================ */

export async function joinGroupSafely(
  req,
  env
) {

  await ensureSafetyTables(
    env
  );

  const member =
    await currentDevice(
      req,
      env
    );

  if (
    member.error
  ) {

    return member.error;
  }

  const dev =
    member.dev;

  if (
    dev.group_id
  ) {

    return bad(
      req,
      'already_in_group'
    );
  }

  if (
    !await rateOk(
      env,
      'join:' +
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
    await readJson(
      req
    );

  const groupId =
    normalizeCode(
      body.code
    );

  if (
    !groupId
  ) {

    return bad(
      req,
      'bad_code'
    );
  }

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

  if (
    !group
  ) {

    return bad(
      req,
      'group_not_found',
      404
    );
  }

  const ban =
    await env.DB
      .prepare(`
        SELECT member_id
        FROM group_bans
        WHERE
          group_id=?
          AND member_id=?
      `)
      .bind(
        groupId,
        dev.member_id
      )
      .first();

  if (
    ban
  ) {

    return bad(
      req,
      'banned_from_group',
      403
    );
  }

  const count =
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

  if (
    Number(
      count &&
      count.n ||
      0
    ) >=
    Number(
      group.max_members ||
      100
    )
  ) {

    return bad(
      req,
      'group_full'
    );
  }

  /*
   * 非公開グループなら必ずhidden。
   *
   * 公開グループでも、
   * 古いクライアント等がweight_hiddenを送らない場合は
   * 安全側のhidden=true。
   */
  const groupShowsWeight =
    Number(
      group.show_weight
    ) === 1;

  const hidden =
    !groupShowsWeight ||
    body.weight_hidden !==
      false;

  const statements =
    await joinStatements(
      env,
      dev,
      group,
      {
        hidden,

        externalConsent:
          body.external_consent ===
            true,
      }
    );

  await env.DB.batch(
    statements
  );

  const fresh =
    await env.DB
      .prepare(`
        SELECT *
        FROM devices
        WHERE device_id=?
      `)
      .bind(
        dev.device_id
      )
      .first();

  return json(
    req,
    {
      ok:
        true,

      group:
        await groupView(
          env,
          group,
          fresh
        ),

      weight_hidden:
        hidden,

      external_consent:
        await externalConsentValue(
          env,
          dev.member_id,
          group.group_id
        ),
    }
  );
}


/* ============================================================
   参加前プレビュー
   ============================================================ */

export async function augmentGroupPreview(
  req,
  env,
  response
) {

  const data =
    await responseJson(
      response
    );

  if (
    !data ||
    !data.group ||
    !data.group.group_id
  ) {

    return response;
  }

  data.group.external_enabled =
    await groupExternalEnabled(
      env,
      data.group.group_id
    );

  return rebuildJson(
    response,
    data
  );
}


/* ============================================================
   本人：外部WEB同意
   ============================================================ */

export async function externalConsentRoute(
  req,
  env
) {

  await ensureSafetyTables(
    env
  );

  const member =
    await currentDevice(
      req,
      env
    );

  if (
    member.error
  ) {

    return member.error;
  }

  const dev =
    member.dev;

  if (
    !dev.group_id
  ) {

    return bad(
      req,
      'not_in_group'
    );
  }

  const enabled =
    await groupExternalEnabled(
      env,
      dev.group_id
    );

  if (
    req.method ===
      'GET'
  ) {

    return json(
      req,
      {
        ok:
          true,

        enabled,

        consented:
          enabled
            ? await externalConsentValue(
                env,
                dev.member_id,
                dev.group_id
              )
            : false,
      }
    );
  }

  if (
    req.method !==
      'POST' &&
    req.method !==
      'PATCH'
  ) {

    return bad(
      req,
      'method_not_allowed',
      405
    );
  }

  if (
    !enabled
  ) {

    return bad(
      req,
      'external_not_enabled'
    );
  }

  const body =
    await readJson(
      req
    );

  if (
    typeof body.consented !==
      'boolean'
  ) {

    return bad(
      req,
      'bad_consent'
    );
  }

  await env.DB
    .prepare(`
      INSERT INTO external_consent (
        member_id,
        group_id,
        consented,
        updated_at
      )
      VALUES (?,?,?,?)

      ON CONFLICT(member_id,group_id)
      DO UPDATE SET
        consented=excluded.consented,
        updated_at=excluded.updated_at
    `)
    .bind(
      dev.member_id,
      dev.group_id,
      body.consented
        ? 1
        : 0,
      Date.now()
    )
    .run();

  /*
   * 同意撤回時は
   * まだ送っていないキューを消す。
   */
  if (
    !body.consented
  ) {

    await env.DB
      .prepare(`
        DELETE FROM external_queue
        WHERE
          member_id=?
          AND group_id=?
      `)
      .bind(
        dev.member_id,
        dev.group_id
      )
      .run();
  }

  return json(
    req,
    {
      ok:
        true,

      enabled:
        true,

      consented:
        body.consented,
    }
  );
}


/* ============================================================
   プロフィール画像
   ============================================================ */

async function pendingIcon(
  env,
  memberId
) {

  await ensureSafetyTables(
    env
  );

  return await env.DB
    .prepare(`
      SELECT *
      FROM icon_pending
      WHERE member_id=?
    `)
    .bind(
      memberId
    )
    .first();
}


export async function memberIconRoute(
  req,
  env
) {

  const member =
    await currentDevice(
      req,
      env
    );

  if (
    member.error
  ) {

    return member.error;
  }

  const dev =
    member.dev;

  await ensureSafetyTables(
    env
  );

  if (
    req.method ===
      'GET'
  ) {

    const pending =
      await pendingIcon(
        env,
        dev.member_id
      );

    const version =
      Number(
        dev.icon_ver ||
        0
      );

    return json(
      req,
      {
        ok:
          true,

        icon_ver:
          version,

        icon_url:
          version > 0
            ? (
                '/i/' +
                dev.member_id +
                '.jpg?v=' +
                version
              )
            : null,

        pending:
          !!pending,

        pending_at:
          pending
            ? Number(
                pending.uploaded_at
              )
            : null,

        max_bytes:
          ICON_MAX_BYTES,
      }
    );
  }

  if (
    req.method ===
      'POST' ||
    req.method ===
      'PUT'
  ) {

    if (
      !await rateOk(
        env,
        'icon:' +
        dev.device_id
      )
    ) {

      return bad(
        req,
        'rate_limited',
        429
      );
    }

    const length =
      Number(
        req.headers.get(
          'content-length'
        ) ||
        0
      );

    if (
      length &&
      length >
        ICON_MAX_BYTES
    ) {

      return bad(
        req,
        'icon_too_large',
        413
      );
    }

    const buffer =
      await req.arrayBuffer();

    if (
      !buffer.byteLength
    ) {

      return bad(
        req,
        'icon_empty'
      );
    }

    if (
      buffer.byteLength >
        ICON_MAX_BYTES
    ) {

      return bad(
        req,
        'icon_too_large',
        413
      );
    }

    const bytes =
      new Uint8Array(
        buffer
      );

    if (
      !(
        bytes.length > 3 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff
      )
    ) {

      return bad(
        req,
        'not_jpeg'
      );
    }

    if (
      !env.ICONS
    ) {

      return bad(
        req,
        'no_bucket',
        503
      );
    }

    const objectKey =
      pendingIconKey(
        dev.member_id
      );

    await env.ICONS.put(
      objectKey,
      buffer,
      {
        httpMetadata: {
          contentType:
            'image/jpeg',
        },
      }
    );

    await env.DB
      .prepare(`
        INSERT INTO icon_pending (
          member_id,
          object_key,
          uploaded_at,
          bytes
        )
        VALUES (?,?,?,?)

        ON CONFLICT(member_id)
        DO UPDATE SET
          object_key=excluded.object_key,
          uploaded_at=excluded.uploaded_at,
          bytes=excluded.bytes
      `)
      .bind(
        dev.member_id,
        objectKey,
        Date.now(),
        buffer.byteLength
      )
      .run();

    const version =
      Number(
        dev.icon_ver ||
        0
      );

    return json(
      req,
      {
        ok:
          true,

        pending:
          true,

        icon_ver:
          version,

        icon_url:
          version > 0
            ? (
                '/i/' +
                dev.member_id +
                '.jpg?v=' +
                version
              )
            : null,
      }
    );
  }

  if (
    req.method ===
      'DELETE'
  ) {

    await env.DB.batch([

      env.DB
        .prepare(`
          UPDATE devices
          SET icon_ver=0
          WHERE device_id=?
        `)
        .bind(
          dev.device_id
        ),

      env.DB
        .prepare(`
          DELETE FROM icon_pending
          WHERE member_id=?
        `)
        .bind(
          dev.member_id
        ),
    ]);

    let failed =
      false;

    try {

      if (
        env.ICONS
      ) {

        await env.ICONS.delete(
          iconKey(
            dev.member_id
          )
        );

        await env.ICONS.delete(
          pendingIconKey(
            dev.member_id
          )
        );
      }

    } catch {

      failed =
        true;
    }

    if (
      failed
    ) {

      await queueCleanup(
        env,
        'icon-delete',
        dev.member_id,
        dev.group_id,
        {}
      );
    }

    return json(
      req,
      {
        ok:
          true,

        icon_ver:
          0,

        icon_url:
          null,

        pending:
          false,
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
   公開アイコン
   ============================================================ */

export async function publicIconRoute(
  req,
  env,
  url
) {

  const raw =
    decodeURIComponent(
      url.pathname
        .slice(3)
    );

  const memberId =
    normalizeMemberId(
      raw.replace(
        /\.jpe?g$/i,
        ''
      )
    );

  if (
    !memberId
  ) {

    return new Response(
      'bad_member_id',
      {
        status:
          400,
      }
    );
  }

  const dev =
    await env.DB
      .prepare(`
        SELECT
          member_id,
          icon_ver,
          banned
        FROM devices
        WHERE member_id=?
      `)
      .bind(
        memberId
      )
      .first();

  if (
    !dev ||
    Number(
      dev.banned ||
      0
    ) === 1 ||
    Number(
      dev.icon_ver ||
      0
    ) <= 0
  ) {

    return new Response(
      'not_found',
      {
        status:
          404,

        headers: {
          'cache-control':
            'no-store',
        },
      }
    );
  }

  if (
    !env.ICONS
  ) {

    return new Response(
      'no_bucket',
      {
        status:
          503,
      }
    );
  }

  const object =
    await env.ICONS.get(
      iconKey(
        memberId
      )
    );

  if (
    !object
  ) {

    return new Response(
      'not_found',
      {
        status:
          404,

        headers: {
          'cache-control':
            'no-store',
        },
      }
    );
  }

  const headers =
    new Headers();

  object.writeHttpMetadata(
    headers
  );

  headers.set(
    'content-type',
    'image/jpeg'
  );

  headers.set(
    'etag',
    object.httpEtag
  );

  headers.set(
    'cache-control',
    'public, max-age=300, must-revalidate'
  );

  headers.set(
    'access-control-allow-origin',
    '*'
  );

  headers.set(
    'x-content-type-options',
    'nosniff'
  );

  if (
    req.method ===
      'HEAD'
  ) {

    return new Response(
      null,
      {
        status:
          200,

        headers,
      }
    );
  }

  return new Response(
    object.body,
    {
      status:
        200,

      headers,
    }
  );
}


/* ============================================================
   Base64
   ============================================================ */

function arrayBufferToBase64(
  buffer
) {

  const bytes =
    new Uint8Array(
      buffer
    );

  let output =
    '';

  const step =
    0x8000;

  for (
    let i = 0;
    i < bytes.length;
    i += step
  ) {

    output +=
      String.fromCharCode(
        ...bytes.subarray(
          i,
          Math.min(
            i + step,
            bytes.length
          )
        )
      );
  }

  return btoa(
    output
  );
}


/* ============================================================
   管理：承認待ち画像
   ============================================================ */

async function adminPendingList(
  req,
  env
) {

  const rs =
    await env.DB
      .prepare(`
        SELECT
          p.member_id,
          p.uploaded_at,
          p.bytes,
          d.nickname,
          d.group_id,
          d.banned,
          d.icon_ver,
          g.name AS group_name

        FROM icon_pending p

        LEFT JOIN devices d
          ON d.member_id=p.member_id

        LEFT JOIN groups g
          ON g.group_id=d.group_id

        ORDER BY p.uploaded_at ASC
      `)
      .all();

  return json(
    req,
    {
      ok:
        true,

      items:
        rs.results ||
        [],
    }
  );
}


async function adminPendingImage(
  req,
  env,
  memberId
) {

  const pending =
    await pendingIcon(
      env,
      memberId
    );

  if (
    !pending
  ) {

    return bad(
      req,
      'pending_icon_not_found',
      404
    );
  }

  if (
    !env.ICONS
  ) {

    return bad(
      req,
      'no_bucket',
      503
    );
  }

  const object =
    await env.ICONS.get(
      pending.object_key
    );

  if (
    !object
  ) {

    return bad(
      req,
      'pending_icon_not_found',
      404
    );
  }

  const buffer =
    await object.arrayBuffer();

  return json(
    req,
    {
      ok:
        true,

      member_id:
        memberId,

      data_url:
        (
          'data:image/jpeg;base64,' +
          arrayBufferToBase64(
            buffer
          )
        ),
    }
  );
}


async function approveIcon(
  req,
  env,
  memberId
) {

  const pending =
    await pendingIcon(
      env,
      memberId
    );

  if (
    !pending
  ) {

    return bad(
      req,
      'pending_icon_not_found',
      404
    );
  }

  const dev =
    await env.DB
      .prepare(`
        SELECT
          member_id,
          icon_ver,
          banned
        FROM devices
        WHERE member_id=?
      `)
      .bind(
        memberId
      )
      .first();

  if (
    !dev
  ) {

    return bad(
      req,
      'member_not_found',
      404
    );
  }

  if (
    Number(
      dev.banned ||
      0
    ) === 1
  ) {

    return bad(
      req,
      'banned',
      403
    );
  }

  if (
    !env.ICONS
  ) {

    return bad(
      req,
      'no_bucket',
      503
    );
  }

  const object =
    await env.ICONS.get(
      pending.object_key
    );

  if (
    !object
  ) {

    return bad(
      req,
      'pending_icon_not_found',
      404
    );
  }

  const buffer =
    await object.arrayBuffer();

  await env.ICONS.put(
    iconKey(
      memberId
    ),
    buffer,
    {
      httpMetadata: {
        contentType:
          'image/jpeg',
      },
    }
  );

  const version =
    Number(
      dev.icon_ver ||
      0
    ) +
    1;

  await env.DB.batch([

    env.DB
      .prepare(`
        UPDATE devices
        SET icon_ver=?
        WHERE member_id=?
      `)
      .bind(
        version,
        memberId
      ),

    env.DB
      .prepare(`
        DELETE FROM icon_pending
        WHERE member_id=?
      `)
      .bind(
        memberId
      ),
  ]);

  try {

    await env.ICONS.delete(
      pending.object_key
    );

  } catch {

    await queueCleanup(
      env,
      'pending-icon-delete',
      memberId,
      null,
      {}
    );
  }

  return json(
    req,
    {
      ok:
        true,

      member_id:
        memberId,

      approved:
        true,

      icon_ver:
        version,

      icon_url:
        (
          '/i/' +
          memberId +
          '.jpg?v=' +
          version
        ),
    }
  );
}


async function rejectIcon(
  req,
  env,
  memberId
) {

  const pending =
    await pendingIcon(
      env,
      memberId
    );

  await env.DB
    .prepare(`
      DELETE FROM icon_pending
      WHERE member_id=?
    `)
    .bind(
      memberId
    )
    .run();

  if (
    pending &&
    env.ICONS
  ) {

    try {

      await env.ICONS.delete(
        pending.object_key
      );

    } catch {

      await queueCleanup(
        env,
        'pending-icon-delete',
        memberId,
        null,
        {}
      );
    }
  }

  return json(
    req,
    {
      ok:
        true,

      member_id:
        memberId,

      rejected:
        true,
    }
  );
}


async function adminDeleteIcon(
  req,
  env,
  memberId
) {

  await env.DB.batch([

    env.DB
      .prepare(`
        UPDATE devices
        SET icon_ver=0
        WHERE member_id=?
      `)
      .bind(
        memberId
      ),

    env.DB
      .prepare(`
        DELETE FROM icon_pending
        WHERE member_id=?
      `)
      .bind(
        memberId
      ),
  ]);

  let failed =
    false;

  try {

    if (
      env.ICONS
    ) {

      await env.ICONS.delete(
        iconKey(
          memberId
        )
      );

      await env.ICONS.delete(
        pendingIconKey(
          memberId
        )
      );
    }

  } catch {

    failed =
      true;
  }

  if (
    failed
  ) {

    await queueCleanup(
      env,
      'icon-delete',
      memberId,
      null,
      {}
    );
  }

  return json(
    req,
    {
      ok:
        true,

      member_id:
        memberId,

      deleted:
        true,
    }
  );
}


/* ============================================================
   管理：外部WEB対象グループ
   ============================================================ */

async function adminGroups(
  req,
  env
) {

  const rs =
    await env.DB
      .prepare(`
        SELECT
          g.group_id,
          g.name,
          g.show_weight,
          g.start_ymd,

          COALESCE(
            ge.enabled,
            0
          ) AS external_enabled,

          (
            SELECT COUNT(*)
            FROM devices d
            WHERE
              d.group_id=g.group_id
              AND d.banned=0
          ) AS members,

          (
            SELECT COUNT(*)

            FROM external_consent ec

            JOIN devices d
              ON d.member_id=ec.member_id

            WHERE
              ec.group_id=g.group_id
              AND ec.consented=1
              AND d.group_id=g.group_id
              AND d.banned=0
          ) AS consented

        FROM groups g

        LEFT JOIN group_external ge
          ON ge.group_id=g.group_id

        ORDER BY g.created_at DESC
      `)
      .all();

  return json(
    req,
    {
      ok:
        true,

      groups:
        (
          rs.results ||
          []
        )
          .map(
            row => ({
              group_id:
                row.group_id,

              name:
                row.name,

              start_ymd:
                row.start_ymd,

              show_weight:
                Number(
                  row.show_weight
                ) === 1,

              external_enabled:
                Number(
                  row.external_enabled
                ) === 1,

              members:
                Number(
                  row.members ||
                  0
                ),

              consented:
                Number(
                  row.consented ||
                  0
                ),
            })
          ),
    }
  );
}


async function setGroupExternal(
  req,
  env,
  groupId
) {

  const group =
    await env.DB
      .prepare(`
        SELECT group_id
        FROM groups
        WHERE group_id=?
      `)
      .bind(
        groupId
      )
      .first();

  if (
    !group
  ) {

    return bad(
      req,
      'group_not_found',
      404
    );
  }

  const body =
    await readJson(
      req
    );

  if (
    typeof body.enabled !==
      'boolean'
  ) {

    return bad(
      req,
      'bad_enabled'
    );
  }

  await env.DB
    .prepare(`
      INSERT INTO group_external (
        group_id,
        enabled,
        updated_at
      )
      VALUES (?,?,?)

      ON CONFLICT(group_id)
      DO UPDATE SET
        enabled=excluded.enabled,
        updated_at=excluded.updated_at
    `)
    .bind(
      groupId,
      body.enabled
        ? 1
        : 0,
      Date.now()
    )
    .run();

  if (
    !body.enabled
  ) {

    await env.DB.batch([

      env.DB
        .prepare(`
          DELETE FROM external_consent
          WHERE group_id=?
        `)
        .bind(
          groupId
        ),

      env.DB
        .prepare(`
          DELETE FROM external_queue
          WHERE group_id=?
        `)
        .bind(
          groupId
        ),
    ]);
  }

  return json(
    req,
    {
      ok:
        true,

      group_id:
        groupId,

      external_enabled:
        body.enabled,
    }
  );
}


/* ============================================================
   外部送信設定
   ============================================================ */

function externalSenderConfigured(
  env
) {

  return !!(
    String(
      env.EXTERNAL_PUSH_URL ||
      ''
    ).trim() &&

    String(
      env.EXTERNAL_PUSH_AUTH_HEADER ||
      ''
    ).trim() &&

    String(
      env.EXTERNAL_PUSH_AUTH_VALUE ||
      ''
    ).trim()
  );
}


/* ============================================================
   管理：Safety summary
   ============================================================ */

async function safetySummary(
  req,
  env
) {

  const [
    icons,
    cleanup,
    external,
    reports
  ] =
    await Promise.all([

      env.DB
        .prepare(`
          SELECT COUNT(*) AS n
          FROM icon_pending
        `)
        .first(),

      env.DB
        .prepare(`
          SELECT COUNT(*) AS n
          FROM cleanup_jobs
        `)
        .first(),

      env.DB
        .prepare(`
          SELECT COUNT(*) AS n
          FROM external_queue
        `)
        .first(),

      env.DB
        .prepare(`
          SELECT COUNT(*) AS n
          FROM reports
          WHERE COALESCE(handled,0)=0
        `)
        .first()
        .catch(
          () => ({
            n:
              0,
          })
        ),
    ]);

  return json(
    req,
    {
      ok:
        true,

      pending_icons:
        Number(
          icons &&
          icons.n ||
          0
        ),

      cleanup_jobs:
        Number(
          cleanup &&
          cleanup.n ||
          0
        ),

      external_queue:
        Number(
          external &&
          external.n ||
          0
        ),

      unhandled_reports:
        Number(
          reports &&
          reports.n ||
          0
        ),

      external_sender_configured:
        externalSenderConfigured(
          env
        ),
    }
  );
}


/* ============================================================
   管理 Safety API
   ============================================================ */

export async function adminSafetyRoute(
  req,
  env,
  url
) {

  await ensureSafetyTables(
    env
  );

  if (
    !await adminAuthorized(
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

  const path =
    url.pathname
      .replace(
        /\/+$/,
        ''
      );

  const method =
    req.method;

  if (
    path ===
      '/api/admin/safety/summary' &&
    method ===
      'GET'
  ) {

    return await safetySummary(
      req,
      env
    );
  }

  if (
    path ===
      '/api/admin/safety/icon-pending' &&
    method ===
      'GET'
  ) {

    return await adminPendingList(
      req,
      env
    );
  }

  if (
    path ===
      '/api/admin/safety/groups' &&
    method ===
      'GET'
  ) {

    return await adminGroups(
      req,
      env
    );
  }

  const groupMatch =
    /^\/api\/admin\/safety\/groups\/([0-9A-Z]{8})\/external$/
      .exec(
        path
      );

  if (
    groupMatch &&
    (
      method ===
        'POST' ||
      method ===
        'PATCH'
    )
  ) {

    return await setGroupExternal(
      req,
      env,
      groupMatch[1]
    );
  }

  const imageMatch =
    /^\/api\/admin\/safety\/icon-pending\/([0-9A-Z]{6,32})\/image$/
      .exec(
        path
      );

  if (
    imageMatch &&
    method ===
      'GET'
  ) {

    return await adminPendingImage(
      req,
      env,
      imageMatch[1]
    );
  }

  const approveMatch =
    /^\/api\/admin\/safety\/icon-pending\/([0-9A-Z]{6,32})\/approve$/
      .exec(
        path
      );

  if (
    approveMatch &&
    method ===
      'POST'
  ) {

    return await approveIcon(
      req,
      env,
      approveMatch[1]
    );
  }

  const rejectMatch =
    /^\/api\/admin\/safety\/icon-pending\/([0-9A-Z]{6,32})\/reject$/
      .exec(
        path
      );

  if (
    rejectMatch &&
    method ===
      'POST'
  ) {

    return await rejectIcon(
      req,
      env,
      rejectMatch[1]
    );
  }

  const deleteMatch =
    /^\/api\/admin\/safety\/icon\/([0-9A-Z]{6,32})$/
      .exec(
        path
      );

  if (
    deleteMatch &&
    method ===
      'DELETE'
  ) {

    return await adminDeleteIcon(
      req,
      env,
      deleteMatch[1]
    );
  }

  return bad(
    req,
    'not_found',
    404
  );
}


/* ============================================================
   双方向ブロック
   ============================================================ */

async function mutualBlockedSet(
  env,
  dev
) {

  const result =
    new Set();

  const own =
    await env.DB
      .prepare(`
        SELECT blocked_member_id
        FROM blocks
        WHERE device_id=?
      `)
      .bind(
        dev.device_id
      )
      .all();

  for (
    const row of
    own.results ||
    []
  ) {

    if (
      row.blocked_member_id
    ) {

      result.add(
        String(
          row.blocked_member_id
        )
      );
    }
  }

  const reverse =
    await env.DB
      .prepare(`
        SELECT d.member_id

        FROM blocks b

        JOIN devices d
          ON d.device_id=b.device_id

        WHERE b.blocked_member_id=?
      `)
      .bind(
        dev.member_id
      )
      .all();

  for (
    const row of
    reverse.results ||
    []
  ) {

    if (
      row.member_id
    ) {

      result.add(
        String(
          row.member_id
        )
      );
    }
  }

  return result;
}


export async function blockedRivalPost(
  req,
  env
) {

  const member =
    await currentDevice(
      req,
      env
    );

  if (
    member.error
  ) {

    return member.error;
  }

  const body =
    await req
      .clone()
      .json()
      .catch(
        () => ({})
      );

  const target =
    normalizeMemberId(
      body.member_id
    );

  if (
    !target
  ) {

    return null;
  }

  const blocked =
    await mutualBlockedSet(
      env,
      member.dev
    );

  if (
    blocked.has(
      target
    )
  ) {

    return bad(
      req,
      'blocked_relation',
      403
    );
  }

  return null;
}


function dayMemberId(row) {

  if (
    !row
  ) {

    return null;
  }

  return normalizeMemberId(
    row.member_id ||
    row.id
  );
}


function recalcDayResponse(
  data
) {

  if (
    !data ||
    !Array.isArray(
      data.members
    )
  ) {

    return;
  }

  let total =
    0;

  let hasWeight =
    false;

  let recorded =
    0;

  const filledIds =
    [];

  for (
    const row of
    data.members
  ) {

    if (
      !row
    ) {

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

      total +=
        Number(
          row.weight
        );

      hasWeight =
        true;
    }

    if (
      !row.filled &&
      row.ymd &&
      data.date &&
      String(
        row.ymd
      ) ===
        String(
          data.date
        )
    ) {

      recorded++;
    }

    if (
      row.filled
    ) {

      const id =
        dayMemberId(
          row
        );

      if (
        id
      ) {

        filledIds.push(
          id
        );
      }
    }
  }

  data.total =
    hasWeight
      ? round1(
          total
        )
      : null;

  data.recorded =
    recorded;

  data.count =
    data.members.length;

  if (
    data.filled
  ) {

    data.filled_ids =
      filledIds;
  }
}


export async function filterMutualBlocks(
  req,
  env,
  response
) {

  if (
    !response ||
    !response.ok
  ) {

    return response;
  }

  const member =
    await currentDevice(
      req,
      env
    );

  if (
    member.error
  ) {

    return response;
  }

  const blocked =
    await mutualBlockedSet(
      env,
      member.dev
    );

  if (
    !blocked.size
  ) {

    return response;
  }

  const data =
    await responseJson(
      response
    );

  if (
    !data
  ) {

    return response;
  }

  if (
    Array.isArray(
      data.rows
    )
  ) {

    data.rows =
      data.rows.filter(
        row => {

          if (
            row &&
            row.is_self
          ) {

            return true;
          }

          const id =
            normalizeMemberId(
              row &&
              row.member_id
            );

          return (
            !id ||
            !blocked.has(
              id
            )
          );
        }
      );
  }

  if (
    Array.isArray(
      data.rivals
    )
  ) {

    data.rivals =
      data.rivals.filter(
        row => {

          const id =
            normalizeMemberId(
              row &&
              row.member_id
            );

          return (
            !id ||
            !blocked.has(
              id
            )
          );
        }
      );
  }

  if (
    Array.isArray(
      data.members
    )
  ) {

    data.members =
      data.members.filter(
        row => {

          const id =
            dayMemberId(
              row
            );

          return (
            !id ||
            !blocked.has(
              id
            )
          );
        }
      );

    recalcDayResponse(
      data
    );
  }

  return rebuildJson(
    response,
    data
  );
}


/* ============================================================
   オーナー・リーダー管理用一覧

   ブロックでは消さない。
   ============================================================ */

export async function manageMembersRoute(
  req,
  env
) {

  const member =
    await currentDevice(
      req,
      env
    );

  if (
    member.error
  ) {

    return member.error;
  }

  const dev =
    member.dev;

  if (
    !dev.group_id
  ) {

    return bad(
      req,
      'not_in_group'
    );
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

  if (
    !group
  ) {

    return bad(
      req,
      'group_not_found',
      404
    );
  }

  const owner =
    group.owner_id ===
      dev.member_id ||
    group.owner_id ===
      dev.device_id;

  const leaders =
    await leaderIds(
      env,
      group.group_id
    );

  const leader =
    !owner &&
    leaders.includes(
      dev.member_id
    );

  if (
    !owner &&
    !leader
  ) {

    return bad(
      req,
      'not_leader',
      403
    );
  }

  const rs =
    await env.DB
      .prepare(`
        SELECT
          d.device_id,
          d.member_id,
          d.nickname,
          d.icon_ver,
          d.joined_at,

          COALESCE(
            wp.hidden,
            0
          ) AS weight_hidden,

          COALESCE(
            wpl.locked,
            0
          ) AS weight_locked,

          wpl.updated_by AS weight_lock_by

        FROM devices d

        LEFT JOIN weight_privacy wp
          ON wp.member_id=d.member_id

        LEFT JOIN weight_privacy_lock wpl
          ON wpl.member_id=d.member_id

        WHERE
          d.group_id=?
          AND d.banned=0

        ORDER BY d.joined_at ASC
      `)
      .bind(
        group.group_id
      )
      .all();

  const rows =
    (
      rs.results ||
      []
    )
      .map(
        row => {

          const lockBy =
            String(
              row.weight_lock_by ||
              ''
            );

          const locked =
            Number(
              row.weight_locked ||
              0
            ) === 1;

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
              Number(
                row.icon_ver ||
                0
              ) > 0
                ? (
                    '/i/' +
                    row.member_id +
                    '.jpg?v=' +
                    Number(
                      row.icon_ver
                    )
                  )
                : null,

            is_owner:
              (
                group.owner_id ===
                  row.member_id ||
                group.owner_id ===
                  row.device_id
              ),

            is_leader:
              leaders.includes(
                row.member_id
              ),

            weight_hidden:
              Number(
                row.weight_hidden ||
                0
              ) === 1 ||
              locked,

            weight_locked:
              locked,

            weight_lock_kind:
              locked
                ? (
                    lockBy ===
                      'self'
                      ? 'self'
                      : 'admin'
                  )
                : null,
          };
        }
      );

  return json(
    req,
    {
      ok:
        true,

      group:
        await groupView(
          env,
          group,
          dev
        ),

      rows,
    }
  );
}


/* ============================================================
   開始日前共有防止
   ============================================================ */

function csvParse(text) {

  const rows =
    [];

  let row =
    [];

  let current =
    '';

  let quoted =
    false;

  const source =
    String(
      text ||
      ''
    )
      .replace(
        /^\uFEFF/,
        ''
      );

  for (
    let i = 0;
    i < source.length;
    i++
  ) {

    const char =
      source[i];

    if (
      quoted
    ) {

      if (
        char ===
          '"'
      ) {

        if (
          source[
            i + 1
          ] ===
            '"'
        ) {

          current +=
            '"';

          i++;

        } else {

          quoted =
            false;
        }

      } else {

        current +=
          char;
      }

      continue;
    }

    if (
      char ===
        '"'
    ) {

      quoted =
        true;

    } else if (
      char ===
        ','
    ) {

      row.push(
        current
      );

      current =
        '';

    } else if (
      char ===
        '\n'
    ) {

      row.push(
        current
      );

      rows.push(
        row
      );

      row =
        [];

      current =
        '';

    } else if (
      char !==
        '\r'
    ) {

      current +=
        char;
    }
  }

  if (
    current !==
      '' ||
    row.length
  ) {

    row.push(
      current
    );

    rows.push(
      row
    );
  }

  return rows;
}


function csvCell(value) {

  const text =
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
      text
    )
      ? (
          '"' +
          text.replace(
            /"/g,
            '""'
          ) +
          '"'
        )
      : text;
}


async function getGroupById(
  env,
  groupId
) {

  if (
    !groupId
  ) {

    return null;
  }

  return await env.DB
    .prepare(`
      SELECT
        group_id,
        start_ymd,
        show_weight,
        name
      FROM groups
      WHERE group_id=?
    `)
    .bind(
      groupId
    )
    .first();
}


async function resolveShareGroup(
  req,
  env,
  dev,
  pathname,
  data
) {

  if (
    pathname ===
      '/api/group/day'
  ) {

    const responseGroupId =
      data &&
      data.group &&
      (
        data.group.id ||
        data.group.group_id
      );

    const normalizedResponseId =
      normalizeCode(
        responseGroupId
      );

    if (
      normalizedResponseId
    ) {

      return await getGroupById(
        env,
        normalizedResponseId
      );
    }
  }

  const url =
    new URL(
      req.url
    );

  const requested =
    normalizeCode(
      url.searchParams.get(
        'gid'
      ) ||
      ''
    );

  if (
    requested
  ) {

    return await getGroupById(
      env,
      requested
    );
  }

  if (
    dev &&
    dev.group_id
  ) {

    return await getGroupById(
      env,
      dev.group_id
    );
  }

  return null;
}


export async function filterStartDateShare(
  req,
  env,
  response,
  pathname
) {

  if (
    !response ||
    !response.ok
  ) {

    return response;
  }

  const member =
    await currentDevice(
      req,
      env
    );

  if (
    member.error
  ) {

    return response;
  }

  if (
    pathname ===
      '/api/group/day'
  ) {

    const data =
      await responseJson(
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

    const group =
      await resolveShareGroup(
        req,
        env,
        member.dev,
        pathname,
        data
      );

    if (
      !group ||
      !group.start_ymd
    ) {

      return response;
    }

    const start =
      String(
        group.start_ymd
      );

    for (
      const row of
      data.members
    ) {

      if (
        !row
      ) {

        continue;
      }

      const beforeStart =
        (
          data.date &&
          String(
            data.date
          ) <
            start
        ) ||
        (
          row.ymd &&
          String(
            row.ymd
          ) <
            start
        );

      if (
        !beforeStart
      ) {

        continue;
      }

      row.weight =
        null;

      row.ymd =
        null;

      row.recordedAt =
        null;

      row.filled =
        false;
    }

    recalcDayResponse(
      data
    );

    return rebuildJson(
      response,
      data
    );
  }

  if (
    pathname ===
      '/api/export'
  ) {

    const group =
      await resolveShareGroup(
        req,
        env,
        member.dev,
        pathname,
        null
      );

    if (
      !group ||
      !group.start_ymd
    ) {

      return response;
    }

    const start =
      String(
        group.start_ymd
      );

    const text =
      await response
        .clone()
        .text();

    const rows =
      csvParse(
        text
      );

    if (
      rows.length <
        2
    ) {

      return response;
    }

    const header =
      rows[0]
        .map(
          value =>
            String(
              value
            )
              .trim()
              .toLowerCase()
        );

    const dateIndex =
      header.indexOf(
        'date'
      );

    if (
      dateIndex <
        0
    ) {

      return response;
    }

    const kept = [
      rows[0],

      ...rows
        .slice(1)
        .filter(
          row =>
            String(
              row[
                dateIndex
              ] ||
              ''
            ) >=
              start
        ),
    ];

    const output =
      '\uFEFF' +
      kept
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
        ) +
      '\r\n';

    const headers =
      new Headers(
        response.headers
      );

    headers.delete(
      'content-length'
    );

    headers.set(
      'cache-control',
      'no-store'
    );

    return new Response(
      output,
      {
        status:
          response.status,

        statusText:
          response.statusText,

        headers,
      }
    );
  }

  return response;
}


/* ============================================================
   削除再試行
   ============================================================ */

function noSuchTable(error) {

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
      'no such table'
    ) ||
    text.includes(
      'does not exist'
    )
  );
}


async function optionalDelete(
  env,
  sql,
  ...values
) {

  try {

    await env.DB
      .prepare(
        sql
      )
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


async function queueCleanup(
  env,
  kind,
  memberId,
  groupId,
  payload
) {

  await ensureSafetyTables(
    env
  );

  await env.DB
    .prepare(`
      INSERT INTO cleanup_jobs (
        kind,
        member_id,
        group_id,
        payload,
        attempts,
        next_at,
        created_at
      )
      VALUES (?,?,?,?,0,0,?)
    `)
    .bind(
      kind,
      memberId ||
        null,
      groupId ||
        null,
      JSON.stringify(
        payload ||
        {}
      ),
      Date.now()
    )
    .run();
}


/*
 * DELETE /api/me の前に必要な情報を確保する。
 *
 * BAN中でも削除自体は許可するため、
 * このcontext取得だけ allowBanned=true。
 */
export async function captureDeleteContext(
  req,
  env
) {

  const member =
    await currentDevice(
      req,
      env,
      {
        allowBanned:
          true
      }
    );

  if (
    member.error
  ) {

    return null;
  }

  return {
    member_id:
      member.dev.member_id,

    device_id:
      member.dev.device_id,

    group_id:
      member.dev.group_id ||
      null,
  };
}


async function cleanupMemberArtifacts(
  env,
  context
) {

  if (
    !context ||
    !context.member_id
  ) {

    return;
  }

  await ensureSafetyTables(
    env
  );

  const memberId =
    context.member_id;

  await optionalDelete(
    env,
    `
      DELETE FROM icon_pending
      WHERE member_id=?
    `,
    memberId
  );

  await optionalDelete(
    env,
    `
      DELETE FROM external_consent
      WHERE member_id=?
    `,
    memberId
  );

  await optionalDelete(
    env,
    `
      DELETE FROM external_queue
      WHERE member_id=?
    `,
    memberId
  );

  await optionalDelete(
    env,
    `
      DELETE FROM vote_predictions
      WHERE member_id=?
    `,
    memberId
  );

  await optionalDelete(
    env,
    `
      DELETE FROM push_subscriptions
      WHERE member_id=?
    `,
    memberId
  );

  await optionalDelete(
    env,
    `
      DELETE FROM weight_privacy
      WHERE member_id=?
    `,
    memberId
  );

  await optionalDelete(
    env,
    `
      DELETE FROM weight_privacy_lock
      WHERE member_id=?
    `,
    memberId
  );

  await optionalDelete(
    env,
    `
      DELETE FROM group_leaders
      WHERE member_id=?
    `,
    memberId
  );

  if (
    env.ICONS
  ) {

    await env.ICONS.delete(
      iconKey(
        memberId
      )
    );

    await env.ICONS.delete(
      pendingIconKey(
        memberId
      )
    );
  }

  if (
    context.group_id
  ) {

    const group =
      await env.DB
        .prepare(`
          SELECT group_id
          FROM groups
          WHERE group_id=?
        `)
        .bind(
          context.group_id
        )
        .first();

    if (
      !group
    ) {

      await optionalDelete(
        env,
        `
          DELETE FROM group_external
          WHERE group_id=?
        `,
        context.group_id
      );

      await optionalDelete(
        env,
        `
          DELETE FROM external_consent
          WHERE group_id=?
        `,
        context.group_id
      );

      await optionalDelete(
        env,
        `
          DELETE FROM external_queue
          WHERE group_id=?
        `,
        context.group_id
      );
    }
  }
}


export async function cleanupAfterDelete(
  env,
  context
) {

  if (
    !context ||
    !context.member_id
  ) {

    return;
  }

  try {

    await cleanupMemberArtifacts(
      env,
      context
    );

  } catch (error) {

    await queueCleanup(
      env,
      'member-safety-delete',
      context.member_id,
      context.group_id,
      context
    );
  }
}


async function runCleanupJob(
  env,
  job
) {

  if (
    job.kind ===
      'icon-delete'
  ) {

    if (
      env.ICONS
    ) {

      await env.ICONS.delete(
        iconKey(
          job.member_id
        )
      );

      await env.ICONS.delete(
        pendingIconKey(
          job.member_id
        )
      );
    }

    return;
  }

  if (
    job.kind ===
      'pending-icon-delete'
  ) {

    if (
      env.ICONS
    ) {

      await env.ICONS.delete(
        pendingIconKey(
          job.member_id
        )
      );
    }

    return;
  }

  if (
    job.kind ===
      'member-safety-delete'
  ) {

    let payload =
      {};

    try {

      payload =
        JSON.parse(
          job.payload ||
          '{}'
        );

    } catch {}

    await cleanupMemberArtifacts(
      env,
      {
        member_id:
          job.member_id,

        device_id:
          payload.device_id ||
          null,

        group_id:
          job.group_id ||
          payload.group_id ||
          null,
      }
    );

    return;
  }

  throw new Error(
    'unknown_cleanup_job'
  );
}


export async function processCleanupJobs(
  env
) {

  await ensureSafetyTables(
    env
  );

  const now =
    Date.now();

  const rs =
    await env.DB
      .prepare(`
        SELECT *
        FROM cleanup_jobs
        WHERE next_at<=?
        ORDER BY id ASC
        LIMIT 25
      `)
      .bind(
        now
      )
      .all();

  let done =
    0;

  let failed =
    0;

  for (
    const job of
    rs.results ||
    []
  ) {

    try {

      await runCleanupJob(
        env,
        job
      );

      await env.DB
        .prepare(`
          DELETE FROM cleanup_jobs
          WHERE id=?
        `)
        .bind(
          job.id
        )
        .run();

      done++;

    } catch (error) {

      failed++;

      const attempts =
        Number(
          job.attempts ||
          0
        ) +
        1;

      const wait =
        Math.min(
          86400000,
          Math.pow(
            2,
            Math.min(
              attempts,
              10
            )
          ) *
          60000
        );

      await env.DB
        .prepare(`
          UPDATE cleanup_jobs
          SET
            attempts=?,
            next_at=?,
            last_error=?
          WHERE id=?
        `)
        .bind(
          attempts,
          Date.now() +
            wait,
          String(
            error &&
            error.message ||
            error
          )
            .slice(
              0,
              500
            ),
          job.id
        )
        .run();
    }
  }

  return {
    done,
    failed,
  };
}


/* ============================================================
   外部WEB
   ============================================================ */

async function effectiveWeightHidden(
  env,
  memberId,
  group
) {

  if (
    !group ||
    Number(
      group.show_weight
    ) !== 1
  ) {

    return true;
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

          COALESCE(
            (
              SELECT locked
              FROM weight_privacy_lock
              WHERE member_id=?
            ),
            0
          ) AS locked
      `)
      .bind(
        memberId,
        memberId
      )
      .first();

  return (
    Number(
      row &&
      row.hidden ||
      0
    ) === 1 ||

    Number(
      row &&
      row.locked ||
      0
    ) === 1
  );
}


async function lossUntilDate(
  env,
  deviceId,
  startYmd,
  ymd
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
          AND ymd<=?

        ORDER BY ymd ASC
      `)
      .bind(
        deviceId,
        startYmd ||
          '1900-01-01',
        ymd
      )
      .all();

  const rows =
    rs.results ||
    [];

  if (
    !rows.length
  ) {

    return null;
  }

  return round1(
    Number(
      rows[0].kg
    ) -
    Number(
      rows[
        rows.length -
        1
      ].kg
    )
  );
}


function jstIso(ms) {

  const date =
    new Date(
      Number(ms) +
      9 *
      60 *
      60 *
      1000
    );

  return date
    .toISOString()
    .replace(
      'Z',
      '+09:00'
    );
}


/* ============================================================
   外部送信payloadを「送信直前」に再生成
   ============================================================ */

async function buildExternalPayload(
  env,
  dev,
  group,
  measurementDate
) {

  if (
    !dev ||
    !group ||
    !isYmd(
      measurementDate
    )
  ) {

    return null;
  }

  if (
    group.start_ymd &&
    measurementDate <
      group.start_ymd
  ) {

    return null;
  }

  const weight =
    await env.DB
      .prepare(`
        SELECT
          ymd,
          kg,
          updated_at
        FROM weights
        WHERE
          device_id=?
          AND ymd=?
      `)
      .bind(
        dev.device_id,
        measurementDate
      )
      .first();

  if (
    !weight
  ) {

    return null;
  }

  const hidden =
    await effectiveWeightHidden(
      env,
      dev.member_id,
      group
    );

  const base = {
    member_id:
      dev.member_id,

    measurement_date:
      measurementDate,

    recorded_at:
      jstIso(
        Number(
          weight.updated_at ||
          Date.now()
        )
      ),
  };

  if (
    hidden
  ) {

    return {
      ...base,

      loss_kg:
        await lossUntilDate(
          env,
          dev.device_id,
          group.start_ymd,
          measurementDate
        ),
    };
  }

  return {
    ...base,

    weight_kg:
      Number(
        weight.kg
      ),
  };
}


/* ============================================================
   体重保存後キュー
   ============================================================ */

export async function queueExternalAfterWeight(
  req,
  env,
  response
) {

  if (
    !response ||
    !response.ok
  ) {

    return;
  }

  await ensureSafetyTables(
    env
  );

  const member =
    await currentDevice(
      req,
      env
    );

  if (
    member.error ||
    !member.dev.group_id
  ) {

    return;
  }

  const dev =
    member.dev;

  if (
    !await groupExternalEnabled(
      env,
      dev.group_id
    )
  ) {

    return;
  }

  if (
    !await externalConsentValue(
      env,
      dev.member_id,
      dev.group_id
    )
  ) {

    return;
  }

  const data =
    await responseJson(
      response
    );

  if (
    !data ||
    !data.ymd
  ) {

    return;
  }

  const measurementDate =
    String(
      data.ymd
    );

  if (
    !isYmd(
      measurementDate
    )
  ) {

    return;
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

  if (
    !group
  ) {

    return;
  }

  if (
    group.start_ymd &&
    measurementDate <
      group.start_ymd
  ) {

    return;
  }

  await env.DB
    .prepare(`
      INSERT INTO external_queue (
        member_id,
        group_id,
        measurement_date,
        payload,
        queued_at,
        attempts,
        next_at,
        last_error
      )
      VALUES (?,?,?,?,?,0,0,NULL)

      ON CONFLICT(
        member_id,
        group_id,
        measurement_date
      )
      DO UPDATE SET
        payload=excluded.payload,
        queued_at=excluded.queued_at,
        attempts=0,
        next_at=0,
        last_error=NULL
    `)
    .bind(
      dev.member_id,
      dev.group_id,
      measurementDate,

      JSON.stringify({
        kind:
          'weight'
      }),

      Date.now()
    )
    .run();
}


/* ============================================================
   外部キュー送信
   ============================================================ */

export async function processExternalQueue(
  env
) {

  await ensureSafetyTables(
    env
  );

  /*
   * 相手からURL / header / secretが来るまでは
   * 絶対に送信しない。
   */
  if (
    !externalSenderConfigured(
      env
    )
  ) {

    return {
      configured:
        false,

      sent:
        0,

      failed:
        0,
    };
  }

  const rs =
    await env.DB
      .prepare(`
        SELECT *
        FROM external_queue
        WHERE next_at<=?
        ORDER BY queued_at ASC
        LIMIT 25
      `)
      .bind(
        Date.now()
      )
      .all();

  let sent =
    0;

  let failed =
    0;

  for (
    const row of
    rs.results ||
    []
  ) {

    try {

      const dev =
        await env.DB
          .prepare(`
            SELECT *
            FROM devices
            WHERE member_id=?
          `)
          .bind(
            row.member_id
          )
          .first();

      const stillAllowed =
        !!(
          dev &&
          dev.group_id ===
            row.group_id &&

          await groupExternalEnabled(
            env,
            row.group_id
          ) &&

          await externalConsentValue(
            env,
            row.member_id,
            row.group_id
          )
        );

      if (
        !stillAllowed
      ) {

        await env.DB
          .prepare(`
            DELETE FROM external_queue
            WHERE
              member_id=?
              AND group_id=?
              AND measurement_date=?
          `)
          .bind(
            row.member_id,
            row.group_id,
            row.measurement_date
          )
          .run();

        continue;
      }

      const group =
        await env.DB
          .prepare(`
            SELECT *
            FROM groups
            WHERE group_id=?
          `)
          .bind(
            row.group_id
          )
          .first();

      if (
        !group
      ) {

        await env.DB
          .prepare(`
            DELETE FROM external_queue
            WHERE
              member_id=?
              AND group_id=?
              AND measurement_date=?
          `)
          .bind(
            row.member_id,
            row.group_id,
            row.measurement_date
          )
          .run();

        continue;
      }

      const payload =
        await buildExternalPayload(
          env,
          dev,
          group,
          row.measurement_date
        );

      if (
        !payload
      ) {

        await env.DB
          .prepare(`
            DELETE FROM external_queue
            WHERE
              member_id=?
              AND group_id=?
              AND measurement_date=?
          `)
          .bind(
            row.member_id,
            row.group_id,
            row.measurement_date
          )
          .run();

        continue;
      }

      const headers =
        new Headers();

      headers.set(
        'content-type',
        'application/json'
      );

      headers.set(
        String(
          env.EXTERNAL_PUSH_AUTH_HEADER
        ),
        String(
          env.EXTERNAL_PUSH_AUTH_VALUE
        )
      );

      const response =
        await fetch(
          String(
            env.EXTERNAL_PUSH_URL
          ),
          {
            method:
              'POST',

            headers,

            body:
              JSON.stringify(
                payload
              ),
          }
        );

      if (
        !response.ok
      ) {

        throw new Error(
          'external_http_' +
          response.status
        );
      }

      await env.DB
        .prepare(`
          DELETE FROM external_queue
          WHERE
            member_id=?
            AND group_id=?
            AND measurement_date=?
        `)
        .bind(
          row.member_id,
          row.group_id,
          row.measurement_date
        )
        .run();

      sent++;

    } catch (error) {

      failed++;

      const attempts =
        Number(
          row.attempts ||
          0
        ) +
        1;

      const delay =
        Math.min(
          86400000,
          Math.pow(
            2,
            Math.min(
              attempts,
              10
            )
          ) *
          60000
        );

      await env.DB
        .prepare(`
          UPDATE external_queue
          SET
            attempts=?,
            next_at=?,
            last_error=?
          WHERE
            member_id=?
            AND group_id=?
            AND measurement_date=?
        `)
        .bind(
          attempts,
          Date.now() +
            delay,
          String(
            error &&
            error.message ||
            error
          )
            .slice(
              0,
              500
            ),
          row.member_id,
          row.group_id,
          row.measurement_date
        )
        .run();
    }
  }

  return {
    configured:
      true,

    sent,

    failed,
  };
}


/* ============================================================
   Path helper
   ============================================================ */

export function isSafetyAdminPath(
  pathname
) {

  return (
    pathname ===
      '/api/admin/safety' ||

    pathname.startsWith(
      '/api/admin/safety/'
    )
  );
}
