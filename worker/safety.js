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

  let d = 0;

  for (
    let i = 0;
    i < x.length;
    i++
  ) {

    d |=
      x.charCodeAt(i) ^
      y.charCodeAt(i);
  }

  return d === 0;
}


async function readJson(req) {

  try {

    const b =
      await req.json();

    return (
      b &&
      typeof b === 'object'
    )
      ? b
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
  req,
  response,
  data
) {

  const h =
    new Headers(
      response.headers
    );

  h.delete(
    'content-length'
  );

  h.set(
    'content-type',
    'application/json; charset=utf-8'
  );

  h.set(
    'cache-control',
    'no-store'
  );

  return new Response(
    JSON.stringify(data),
    {
      status:
        response.status,

      statusText:
        response.statusText,

      headers:
        h,
    }
  );
}


async function currentDevice(
  req,
  env
) {

  const id =
    String(
      req.headers.get(
        'x-device-id'
      ) ||
      ''
    )
      .trim();

  if (
    !DEVICE_ID_RE.test(id)
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
      .bind(id)
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
    ) === 1
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

  if (tablesReady) {

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
   ADMIN_TOKEN
   ============================================================ */

async function adminToken(env) {

  const a =
    String(
      env.ADMIN_TOKEN ||
      ''
    )
      .trim();

  if (a) {

    return a;
  }

  try {

    const r =
      await env.DB
        .prepare(`
          SELECT v
          FROM app_config
          WHERE k='admin_token'
        `)
        .first();

    return String(
      r &&
      r.v ||
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

  const raw =
    String(
      req.headers.get(
        'authorization'
      ) ||
      ''
    )
      .trim();

  const m =
    /^Bearer\s+(.+)$/i
      .exec(raw);

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
   外部WEB対象グループ
   ============================================================ */

async function groupExternalEnabled(
  env,
  groupId
) {

  if (!groupId) {

    return false;
  }

  await ensureSafetyTables(
    env
  );

  const r =
    await env.DB
      .prepare(`
        SELECT enabled
        FROM group_external
        WHERE group_id=?
      `)
      .bind(groupId)
      .first();

  return (
    Number(
      r &&
      r.enabled ||
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

  const r =
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
      r &&
      r.consented ||
      0
    ) === 1
  );
}


/* ============================================================
   参加用グループ情報
   ============================================================ */

async function leaderIds(
  env,
  gid
) {

  if (!gid) {

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
        .bind(gid)
        .all();

    return (
      rs.results ||
      []
    )
      .map(
        r =>
          r.member_id
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

  const c =
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

  const manage =
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
        c &&
        c.n ||
        0
      ),

    is_owner:
      owner,

    is_leader:
      leader,

    can_manage:
      manage,

    leader_count:
      leaders.length,

    leader_max:
      5,

    code:
      manage
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
   参加時 privacy
   ============================================================ */

async function adminLocked(
  env,
  memberId
) {

  const r =
    await env.DB
      .prepare(`
        SELECT
          locked,
          updated_by
        FROM weight_privacy_lock
        WHERE member_id=?
      `)
      .bind(memberId)
      .first();

  return !!(
    r &&
    Number(
      r.locked
    ) === 1 &&
    String(
      r.updated_by ||
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

  const stmts = [

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

  const locked =
    await adminLocked(
      env,
      dev.member_id
    );

  /*
   * 管理者固定中は本人の選択で解除しない。
   */
  if (!locked) {

    stmts.push(

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

  const extEnabled =
    await groupExternalEnabled(
      env,
      group.group_id
    );

  stmts.push(
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
        extEnabled &&
        externalConsent
          ? 1
          : 0,
        now
      )
  );

  return stmts;
}


/* ============================================================
   安全なグループ参加

   重要：
   membership と privacy と consent を同じbatchで確定。
   参加失敗時にprivacyだけ変わる問題を防ぐ。
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

  if (member.error) {

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

  const b =
    await readJson(
      req
    );

  const gid =
    normalizeCode(
      b.code
    );

  if (!gid) {

    return bad(
      req,
      'bad_code'
    );
  }

  const g =
    await env.DB
      .prepare(`
        SELECT *
        FROM groups
        WHERE group_id=?
      `)
      .bind(gid)
      .first();

  if (!g) {

    return bad(
      req,
      'group_not_found',
      404
    );
  }

  const banned =
    await env.DB
      .prepare(`
        SELECT member_id
        FROM group_bans
        WHERE
          group_id=?
          AND member_id=?
      `)
      .bind(
        gid,
        dev.member_id
      )
      .first();

  if (banned) {

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
      .bind(gid)
      .first();

  if (
    Number(
      count &&
      count.n ||
      0
    ) >=
    Number(
      g.max_members ||
      100
    )
  ) {

    return bad(
      req,
      'group_full'
    );
  }

  const groupShowsWeight =
    Number(
      g.show_weight
    ) === 1;

  /*
   * 古いアプリがweight_hiddenを送らなくても
   * 安全側の非公開にする。
   */
  const hidden =
    !groupShowsWeight ||
    b.weight_hidden !==
      false;

  const stmts =
    await joinStatements(
      env,
      dev,
      g,
      {
        hidden,

        externalConsent:
          b.external_consent ===
            true,
      }
    );

  await env.DB.batch(
    stmts
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
          g,
          fresh
        ),

      weight_hidden:
        hidden,

      external_consent:
        await externalConsentValue(
          env,
          dev.member_id,
          g.group_id
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
    req,
    response,
    data
  );
}


/* ============================================================
   本人 外部WEB同意
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

  if (member.error) {

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

  if (!enabled) {

    return bad(
      req,
      'external_not_enabled'
    );
  }

  const b =
    await readJson(
      req
    );

  if (
    typeof b.consented !==
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
      b.consented
        ? 1
        : 0,
      Date.now()
    )
    .run();

  /*
   * 撤回したら未送信キューも破棄。
   */
  if (
    !b.consented
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
        b.consented,
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
    .bind(memberId)
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

  if (member.error) {

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

    const ver =
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
          ver,

        icon_url:
          ver > 0
            ? (
                '/i/' +
                dev.member_id +
                '.jpg?v=' +
                ver
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

    const len =
      Number(
        req.headers.get(
          'content-length'
        ) ||
        0
      );

    if (
      len &&
      len >
        ICON_MAX_BYTES
    ) {

      return bad(
        req,
        'icon_too_large',
        413
      );
    }

    const buf =
      await req.arrayBuffer();

    if (!buf.byteLength) {

      return bad(
        req,
        'icon_empty'
      );
    }

    if (
      buf.byteLength >
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
        buf
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

    if (!env.ICONS) {

      return bad(
        req,
        'no_bucket',
        503
      );
    }

    const key =
      pendingIconKey(
        dev.member_id
      );

    /*
     * 公開キーへは書かない。
     */
    await env.ICONS.put(
      key,
      buf,
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
        key,
        Date.now(),
        buf.byteLength
      )
      .run();

    const ver =
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
          ver,

        icon_url:
          ver > 0
            ? (
                '/i/' +
                dev.member_id +
                '.jpg?v=' +
                ver
              )
            : null,
      }
    );
  }

  if (
    req.method ===
      'DELETE'
  ) {

    const ver =
      Number(
        dev.icon_ver ||
        0
      );

    /*
     * まずDB上で即座に非表示にする。
     */
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

      if (env.ICONS) {

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

    if (failed) {

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

        previous_version:
          ver,
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

   承認済み + 利用中 + 非BAN のものだけ配信。
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
    raw
      .replace(
        /\.jpe?g$/i,
        ''
      )
      .trim()
      .toUpperCase();

  if (
    !MEMBER_ID_RE.test(
      memberId
    )
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

  if (!env.ICONS) {

    return new Response(
      'no_bucket',
      {
        status:
          503,
      }
    );
  }

  const obj =
    await env.ICONS.get(
      iconKey(
        memberId
      )
    );

  if (!obj) {

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

  const h =
    new Headers();

  obj.writeHttpMetadata(
    h
  );

  h.set(
    'content-type',
    'image/jpeg'
  );

  h.set(
    'etag',
    obj.httpEtag
  );

  /*
   * 1年immutableをやめる。
   */
  h.set(
    'cache-control',
    'public, max-age=300, must-revalidate'
  );

  h.set(
    'access-control-allow-origin',
    '*'
  );

  h.set(
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

        headers:
          h,
      }
    );
  }

  return new Response(
    obj.body,
    {
      status:
        200,

      headers:
        h,
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

  let out =
    '';

  const step =
    0x8000;

  for (
    let i = 0;
    i < bytes.length;
    i += step
  ) {

    out +=
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

  return btoa(out);
}


/* ============================================================
   管理者：画像
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
          g.name AS group_name,
          d.icon_ver
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

  const p =
    await pendingIcon(
      env,
      memberId
    );

  if (!p) {

    return bad(
      req,
      'pending_icon_not_found',
      404
    );
  }

  if (!env.ICONS) {

    return bad(
      req,
      'no_bucket',
      503
    );
  }

  const obj =
    await env.ICONS.get(
      p.object_key
    );

  if (!obj) {

    return bad(
      req,
      'pending_icon_not_found',
      404
    );
  }

  const buf =
    await obj.arrayBuffer();

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
            buf
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

  if (!env.ICONS) {

    return bad(
      req,
      'no_bucket',
      503
    );
  }

  const p =
    await pendingIcon(
      env,
      memberId
    );

  if (!p) {

    return bad(
      req,
      'pending_icon_not_found',
      404
    );
  }

  const obj =
    await env.ICONS.get(
      p.object_key
    );

  if (!obj) {

    return bad(
      req,
      'pending_icon_not_found',
      404
    );
  }

  const buf =
    await obj.arrayBuffer();

  /*
   * 承認時だけ公開キーへコピー。
   */
  await env.ICONS.put(
    iconKey(
      memberId
    ),
    buf,
    {
      httpMetadata: {
        contentType:
          'image/jpeg',
      },
    }
  );

  const dev =
    await env.DB
      .prepare(`
        SELECT icon_ver
        FROM devices
        WHERE member_id=?
      `)
      .bind(memberId)
      .first();

  if (!dev) {

    return bad(
      req,
      'member_not_found',
      404
    );
  }

  const ver =
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
        ver,
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
      p.object_key
    );

  } catch {}

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
        ver,

      icon_url:
        (
          '/i/' +
          memberId +
          '.jpg?v=' +
          ver
        ),
    }
  );
}


async function rejectIcon(
  req,
  env,
  memberId
) {

  const p =
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
    p &&
    env.ICONS
  ) {

    try {

      await env.ICONS.delete(
        p.object_key
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

    if (env.ICONS) {

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

  if (failed) {

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
   管理者：外部WEB対象グループ
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
            g => ({
              group_id:
                g.group_id,

              name:
                g.name,

              start_ymd:
                g.start_ymd,

              show_weight:
                Number(
                  g.show_weight
                ) === 1,

              external_enabled:
                Number(
                  g.external_enabled
                ) === 1,

              members:
                Number(
                  g.members ||
                  0
                ),

              consented:
                Number(
                  g.consented ||
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

  const g =
    await env.DB
      .prepare(`
        SELECT group_id
        FROM groups
        WHERE group_id=?
      `)
      .bind(groupId)
      .first();

  if (!g) {

    return bad(
      req,
      'group_not_found',
      404
    );
  }

  const b =
    await readJson(
      req
    );

  if (
    typeof b.enabled !==
      'boolean'
  ) {

    return bad(
      req,
      'bad_enabled'
    );
  }

  const now =
    Date.now();

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
      b.enabled
        ? 1
        : 0,
      now
    )
    .run();

  /*
   * OFFにした場合は、
   * 古い同意を次回ON時に再利用しない。
   */
  if (!b.enabled) {

    await env.DB.batch([

      env.DB
        .prepare(`
          DELETE FROM external_consent
          WHERE group_id=?
        `)
        .bind(groupId),

      env.DB
        .prepare(`
          DELETE FROM external_queue
          WHERE group_id=?
        `)
        .bind(groupId),
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
        b.enabled,
    }
  );
}


/* ============================================================
   管理者 summary
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


async function safetySummary(
  req,
  env
) {

  const [
    icons,
    cleanup,
    queue,
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
          queue &&
          queue.n ||
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
   管理者 safety route
   ============================================================ */

export async function adminSafetyRoute(
  req,
  env,
  url
) {

  await ensureSafetyTables(
    env
  );

  const ok =
    await adminAuthorized(
      req,
      env
    );

  if (!ok) {

    return bad(
      req,
      'unauthorized',
      401
    );
  }

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
      '/api/admin/safety/summary' &&
    m ===
      'GET'
  ) {

    return await safetySummary(
      req,
      env
    );
  }

  if (
    p ===
      '/api/admin/safety/icon-pending' &&
    m ===
      'GET'
  ) {

    return await adminPendingList(
      req,
      env
    );
  }

  if (
    p ===
      '/api/admin/safety/groups' &&
    m ===
      'GET'
  ) {

    return await adminGroups(
      req,
      env
    );
  }

  const groupMatch =
    /^\/api\/admin\/safety\/groups\/([0-9A-Z]{8})\/external$/
      .exec(p);

  if (
    groupMatch &&
    (
      m ===
        'POST' ||
      m ===
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
      .exec(p);

  if (
    imageMatch &&
    m ===
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
      .exec(p);

  if (
    approveMatch &&
    m ===
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
      .exec(p);

  if (
    rejectMatch &&
    m ===
      'POST'
  ) {

    return await rejectIcon(
      req,
      env,
      rejectMatch[1]
    );
  }

  const deleteIconMatch =
    /^\/api\/admin\/safety\/icon\/([0-9A-Z]{6,32})$/
      .exec(p);

  if (
    deleteIconMatch &&
    m ===
      'DELETE'
  ) {

    return await adminDeleteIcon(
      req,
      env,
      deleteIconMatch[1]
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

  const out =
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
    const r of
    own.results ||
    []
  ) {

    if (
      r.blocked_member_id
    ) {

      out.add(
        r.blocked_member_id
      );
    }
  }

  /*
   * 自分をブロックしている人も通常表示から外す。
   */
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
    const r of
    reverse.results ||
    []
  ) {

    if (
      r.member_id
    ) {

      out.add(
        r.member_id
      );
    }
  }

  return out;
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

  if (member.error) {

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
    String(
      body.member_id ||
      ''
    )
      .trim()
      .toUpperCase();

  if (!target) {

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

  const data =
    await responseJson(
      response
    );

  if (!data) {

    return response;
  }

  if (
    Array.isArray(
      data.rows
    )
  ) {

    data.rows =
      data.rows.filter(
        row =>
          (
            row &&
            row.is_self
          ) ||
          !blocked.has(
            row &&
            row.member_id
          )
      );
  }

  if (
    Array.isArray(
      data.rivals
    )
  ) {

    data.rivals =
      data.rivals.filter(
        row =>
          !blocked.has(
            row &&
            row.member_id
          )
      );
  }

  return rebuildJson(
    req,
    response,
    data
  );
}


/* ============================================================
   オーナー・リーダー管理用一覧

   ブロックには影響されない。
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

  if (member.error) {

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

  const g =
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

  if (!g) {

    return bad(
      req,
      'group_not_found',
      404
    );
  }

  const owner =
    g.owner_id ===
      dev.member_id ||
    g.owner_id ===
      dev.device_id;

  const leaders =
    await leaderIds(
      env,
      g.group_id
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
        g.group_id
      )
      .all();

  const rows =
    (
      rs.results ||
      []
    )
      .map(
        r => {

          const lockBy =
            String(
              r.weight_lock_by ||
              ''
            );

          const locked =
            Number(
              r.weight_locked ||
              0
            ) === 1;

          return {
            member_id:
              r.member_id,

            nickname:
              r.nickname ||
              null,

            icon_ver:
              Number(
                r.icon_ver ||
                0
              ),

            icon_url:
              Number(
                r.icon_ver ||
                0
              ) > 0
                ? (
                    '/i/' +
                    r.member_id +
                    '.jpg?v=' +
                    Number(
                      r.icon_ver
                    )
                  )
                : null,

            is_owner:
              r.member_id ===
                g.owner_id,

            is_leader:
              leaders.includes(
                r.member_id
              ),

            weight_hidden:
              Number(
                r.weight_hidden ||
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
          g,
          dev
        ),

      rows,
    }
  );
}


/* ============================================================
   H2: スタート日前の共有を除去
   ============================================================ */

function csvParse(text) {

  const rows =
    [];

  let row =
    [];

  let cur =
    '';

  let quote =
    false;

  const src =
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
    i < src.length;
    i++
  ) {

    const c =
      src[i];

    if (quote) {

      if (
        c === '"'
      ) {

        if (
          src[i + 1] ===
            '"'
        ) {

          cur +=
            '"';

          i++;

        } else {

          quote =
            false;
        }

      } else {

        cur += c;
      }

      continue;
    }

    if (
      c === '"'
    ) {

      quote =
        true;

    } else if (
      c === ','
    ) {

      row.push(cur);

      cur =
        '';

    } else if (
      c === '\n'
    ) {

      row.push(cur);

      rows.push(row);

      row =
        [];

      cur =
        '';

    } else if (
      c !== '\r'
    ) {

      cur += c;
    }
  }

  if (
    cur !== '' ||
    row.length
  ) {

    row.push(cur);

    rows.push(row);
  }

  return rows;
}


function csvCell(value) {

  const s =
    value ===
      null ||
    value ===
      undefined
      ? ''
      : String(value);

  return /[",\r\n]/
    .test(s)
      ? (
          '"' +
          s.replace(
            /"/g,
            '""'
          ) +
          '"'
        )
      : s;
}


async function groupStartForDevice(
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
        start_ymd
      FROM groups
      WHERE group_id=?
    `)
    .bind(
      dev.group_id
    )
    .first();
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
    member.error ||
    !member.dev.group_id
  ) {

    return response;
  }

  const g =
    await groupStartForDevice(
      env,
      member.dev
    );

  if (
    !g ||
    !g.start_ymd
  ) {

    return response;
  }

  const start =
    g.start_ymd;

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

    let total =
      0;

    let visible =
      false;

    let recorded =
      0;

    const filled =
      [];

    for (
      const r of
      data.members
    ) {

      if (!r) {

        continue;
      }

      /*
       * 指定日自体が開始日前なら全員null。
       * fillで使われた元データも開始日前ならnull。
       */
      if (
        String(
          data.date ||
          ''
        ) <
          start ||
        (
          r.ymd &&
          String(r.ymd) <
            start
        )
      ) {

        r.weight =
          null;

        r.ymd =
          null;

        r.recordedAt =
          null;

        r.filled =
          false;
      }

      if (
        r.weight !==
          null &&
        r.weight !==
          undefined &&
        Number.isFinite(
          Number(
            r.weight
          )
        )
      ) {

        total +=
          Number(
            r.weight
          );

        visible =
          true;

        if (
          !r.filled
        ) {

          recorded++;
        }

        if (
          r.filled &&
          r.id
        ) {

          filled.push(
            r.id
          );
        }
      }
    }

    data.total =
      visible
        ? round1(total)
        : null;

    data.recorded =
      recorded;

    if (
      data.filled
    ) {

      data.filled_ids =
        filled;
    }

    return rebuildJson(
      req,
      response,
      data
    );
  }

  if (
    pathname ===
      '/api/export'
  ) {

    const text =
      await response
        .clone()
        .text();

    const rows =
      csvParse(text);

    if (
      rows.length <
        2
    ) {

      return response;
    }

    const head =
      rows[0]
        .map(
          x =>
            String(x)
              .trim()
              .toLowerCase()
        );

    const dateIndex =
      head.indexOf(
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
          r =>
            String(
              r[dateIndex] ||
              ''
            ) >=
              start
        ),
    ];

    const out =
      '\uFEFF' +
      kept
        .map(
          r =>
            r.map(
              csvCell
            )
              .join(',')
        )
        .join(
          '\r\n'
        ) +
      '\r\n';

    const h =
      new Headers(
        response.headers
      );

    h.delete(
      'content-length'
    );

    h.set(
      'cache-control',
      'no-store'
    );

    return new Response(
      out,
      {
        status:
          response.status,

        headers:
          h,
      }
    );
  }

  return response;
}


/* ============================================================
   削除再試行
   ============================================================ */

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


export async function captureDeleteContext(
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


async function deleteSafetyRows(
  env,
  context
) {

  if (
    !context ||
    !context.member_id
  ) {

    return;
  }

  const mid =
    context.member_id;

  await env.DB.batch([

    env.DB
      .prepare(`
        DELETE FROM icon_pending
        WHERE member_id=?
      `)
      .bind(mid),

    env.DB
      .prepare(`
        DELETE FROM external_consent
        WHERE member_id=?
      `)
      .bind(mid),

    env.DB
      .prepare(`
        DELETE FROM external_queue
        WHERE member_id=?
      `)
      .bind(mid),
  ]);

  if (env.ICONS) {

    await env.ICONS.delete(
      iconKey(mid)
    );

    await env.ICONS.delete(
      pendingIconKey(mid)
    );
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

    await deleteSafetyRows(
      env,
      context
    );

  } catch (e) {

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

    if (env.ICONS) {

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

    if (env.ICONS) {

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

    await deleteSafetyRows(
      env,
      {
        member_id:
          job.member_id,

        group_id:
          job.group_id,
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
      .bind(now)
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

    } catch (e) {

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
            e &&
            e.message ||
            e
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
   外部WEB push
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

  const r =
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
      r &&
      r.hidden ||
      0
    ) === 1 ||
    Number(
      r &&
      r.locked ||
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
    rows.length <
      2
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

  const d =
    new Date(
      ms +
      9 *
      60 *
      60 *
      1000
    );

  return (
    d.toISOString()
      .replace(
        'Z',
        '+09:00'
      )
  );
}


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
    !data.ymd ||
    data.kg ===
      undefined
  ) {

    return;
  }

  const ymd =
    String(
      data.ymd
    );

  if (
    !isYmd(ymd)
  ) {

    return;
  }

  const g =
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

  if (!g) {

    return;
  }

  /*
   * 開始日前は送らない。
   */
  if (
    g.start_ymd &&
    ymd <
      g.start_ymd
  ) {

    return;
  }

  const hidden =
    await effectiveWeightHidden(
      env,
      dev.member_id,
      g
    );

  const now =
    Date.now();

  let payload;

  if (hidden) {

    payload = {
      member_id:
        dev.member_id,

      measurement_date:
        ymd,

      recorded_at:
        jstIso(now),

      loss_kg:
        await lossUntilDate(
          env,
          dev.device_id,
          g.start_ymd,
          ymd
        ),
    };

  } else {

    payload = {
      member_id:
        dev.member_id,

      measurement_date:
        ymd,

      recorded_at:
        jstIso(now),

      weight_kg:
        Number(
          data.kg
        ),
    };
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
      ymd,
      JSON.stringify(
        payload
      ),
      now
    )
    .run();
}


export async function processExternalQueue(
  env
) {

  await ensureSafetyTables(
    env
  );

  /*
   * 相手から3情報が来るまでは1件も送らない。
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
    };
  }

  const rows =
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
    rows.results ||
    []
  ) {

    /*
     * 送信直前に、
     * 現在もそのグループ所属 + ON + 同意済みか再確認。
     */
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

    const allowed =
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

    if (!allowed) {

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

    try {

      const h =
        new Headers();

      h.set(
        'content-type',
        'application/json'
      );

      h.set(
        String(
          env.EXTERNAL_PUSH_AUTH_HEADER
        ),
        String(
          env.EXTERNAL_PUSH_AUTH_VALUE
        )
      );

      const res =
        await fetch(
          String(
            env.EXTERNAL_PUSH_URL
          ),
          {
            method:
              'POST',

            headers:
              h,

            body:
              row.payload,
          }
        );

      if (!res.ok) {

        throw new Error(
          'external_http_' +
          res.status
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

    } catch (e) {

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
            e &&
            e.message ||
            e
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
