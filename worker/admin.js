'use strict';

import {
  json, bad, notFound,
  todayYmdJST, isYmd, ymdToDay, round1, normKg, normalizeCode, fmtCode,
} from './lib.js';

/* ============================================================
   みんやせ / worker/admin.js
   ⑤日付ビュー ⑥書き出し・取り込み ⑦権限 ＋ 端末差し替え

   権限の原則（合意事項）
     show_weight=1（公開） : オーナー + 管理画面
     show_weight=0（非公開）: 管理画面のみ
   非公開グループはオーナーも他人の体重を見られない仕様（patchGroup の
   コメント参照）。その約束を export/import で破らないための分岐。
   ============================================================ */

const IMPORT_MAX_BYTES = 2 * 1024 * 1024;   // CSV 取り込みの上限
const BATCH_SIZE = 50;                      // D1 batch の分割単位
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;  // route() の判定と同一
const ICON_PREFIX = 'icon/';

/* ---------- 小物 ---------- */
function iconKey(memberId) { return ICON_PREFIX + memberId + '.jpg'; }

function num(v) { return v === null || v === undefined ? null : Number(v); }

function mask(s) {
  const t = String(s || '');
  return t.length <= 10 ? t : t.slice(0, 8) + '…' + t.slice(-2);
}

/* 時間差から中身を推測されないよう長さと全バイトを比較する */
function safeEqual(a, b) {
  const x = String(a || ''), y = String(b || '');
  if (x.length !== y.length || x.length === 0) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

function adminOk(req, env) {
  const want = String(env.ADMIN_TOKEN || '');
  if (!want) return null;                       // 未設定は 503 にする
  const h = String(req.headers.get('authorization') || '').trim();
  const m = /^Bearer\s+(.+)$/i.exec(h);
  const got = m ? m[1].trim() : String(req.headers.get('x-admin-token') || '').trim();
  return safeEqual(got, want);
}

/* 日付の正規化。YYYY-MM-DD / YYYY/M/D / YYYYMMDD を受ける */
function normYmd(raw) {
  const s = String(raw || '').trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (!m) m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  const ymd = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isYmd(ymd) ? ymd : null;
}

function ph(n) { return new Array(n).fill('?').join(','); }

async function readBodyText(req) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len && len > IMPORT_MAX_BYTES) return { error: 'import_too_large' };
  const t = await req.text();
  if (t.length > IMPORT_MAX_BYTES) return { error: 'import_too_large' };
  return { text: t };
}

async function readJson(req) {
  try {
    const b = await req.json();
    return (b && typeof b === 'object') ? b : {};
  } catch {
    return {};
  }
}

/* ---------- D1 参照 ---------- */
async function getGroup(env, gid) {
  return await env.DB.prepare('SELECT * FROM groups WHERE group_id=?').bind(gid).first();
}

async function getMembers(env, gid) {
  const rs = await env.DB.prepare(
    `SELECT device_id, member_id, nickname, icon_ver, goal_weight,
            notify_on, notify_days, notify_hour, joined_at
       FROM devices WHERE group_id=? AND banned=0
      ORDER BY joined_at ASC`
  ).bind(gid).all();
  return rs.results || [];
}

// index.js の isOwnerOf と同じ判定（owner_id は member_id 運用。旧 device_id 行も拾う）
function isOwnerOf(group, dev) {
  return group.owner_id === dev.member_id || group.owner_id === dev.device_id;
}

/* ---------- 監査ログ ---------- */
async function ensureLogTable(env) {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS admin_log (
         ts INTEGER, actor TEXT, action TEXT, group_id TEXT, detail TEXT
       )`
    ).run();
    return true;
  } catch {
    return false;
  }
}

async function writeLog(env, actor, action, gid, detail) {
  const rec = {
    ts: Date.now(),
    actor,
    action,
    group_id: gid || null,
    detail: detail || null,
  };

  try {
    await ensureLogTable(env);
    await env.DB.prepare(
      'INSERT INTO admin_log (ts,actor,action,group_id,detail) VALUES (?,?,?,?,?)'
    ).bind(
      rec.ts,
      rec.actor,
      rec.action,
      rec.group_id,
      JSON.stringify(rec.detail)
    ).run();
  } catch (e) {
    console.log('admin_log_failed', JSON.stringify(rec));
  }
}

/* ============================================================
   ⑤ 日付指定・全員体重＋総重量
   ============================================================ */

async function dayView(env, g, date, fill) {
  const members = await getMembers(env, g.group_id);
  const ids = members.map(m => m.device_id);

  const exact = new Map();

  if (ids.length) {
    const rs = await env.DB.prepare(
      `SELECT device_id, ymd, kg, updated_at FROM weights
        WHERE device_id IN (${ph(ids.length)}) AND ymd=?`
    ).bind(...ids, date).all();

    for (const r of (rs.results || [])) {
      exact.set(r.device_id, r);
    }
  }

  // &fill=last : 未記録を「その日以前の直近の実測」で補完する
  const back = new Map();

  if (fill && ids.length) {
    const rs = await env.DB.prepare(
      `SELECT device_id, ymd, kg, updated_at FROM (
         SELECT device_id, ymd, kg, updated_at,
                ROW_NUMBER() OVER (
                  PARTITION BY device_id
                  ORDER BY ymd DESC
                ) AS rn
           FROM weights
          WHERE device_id IN (${ph(ids.length)}) AND ymd <= ?
       ) WHERE rn = 1`
    ).bind(...ids, date).all();

    for (const r of (rs.results || [])) {
      back.set(r.device_id, r);
    }
  }

  const rows = [];
  const filledIds = [];

  let total = 0;
  let recorded = 0;

  for (const m of members) {
    const hit = exact.get(m.device_id);
    const alt = hit ? null : (fill ? back.get(m.device_id) : null);
    const src = hit || alt || null;

    const kg =
      src
        ? Number(src.kg)
        : null;

    if (hit) recorded++;

    if (alt) {
      filledIds.push(m.member_id);
    }

    if (kg !== null) {
      total += kg;
    }

    rows.push({
      id: m.member_id,
      name: m.nickname || null,
      weight: kg,
      ymd: src ? src.ymd : null,
      recordedAt:
        src && src.updated_at != null
          ? Number(src.updated_at)
          : null,
      filled: !!alt,
    });
  }

  const out = {
    date,
    group: {
      id: g.group_id,
      name: g.name,
    },
    members: rows,
    total:
      rows.some(r => r.weight !== null)
        ? round1(total)
        : null,
    recorded,
    count: members.length,
  };

  if (fill) {
    out.filled = true;
    out.filled_ids = filledIds;
  }

  return out;
}

/* ============================================================
   ⑥ 書き出し
   ============================================================ */

function csvCell(v) {
  const s =
    v === null || v === undefined
      ? ''
      : String(v);

  return /[",\r\n]/.test(s)
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

function asciiSlug(s) {
  const t = String(s || '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return t || 'group';
}

function dispositionHeader(base, ext) {
  const ascii =
    `minyase_${asciiSlug(base)}_${todayYmdJST().replace(/-/g, '')}.${ext}`;

  const utf8 =
    `minyase_${base}_${todayYmdJST().replace(/-/g, '')}.${ext}`;

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(utf8)}`;
}

async function exportCsv(req, env, g, actor) {
  const members = await getMembers(env, g.group_id);

  const byDev =
    new Map(
      members.map(m => [
        m.device_id,
        m,
      ])
    );

  const ids =
    members.map(
      m => m.device_id
    );

  /*
   * device_id は実質的にユーザー識別に使う重要情報。
   *
   * ADMIN_TOKEN で認証された管理画面からのCSVだけに
   * device_id 全文を含める。
   *
   * 一般ユーザー向け GET /api/export では
   * device_id を絶対に出さない。
   */
  const isAdmin =
    actor === 'admin';

  const lines = [
    isAdmin
      ? 'date,group_id,group_name,member_id,member_name,device_id,weight_kg'
      : 'date,group_id,group_name,member_id,member_name,weight_kg'
  ];

  let n = 0;

  if (ids.length) {
    const rs = await env.DB.prepare(
      `SELECT device_id, ymd, kg
         FROM weights
        WHERE device_id IN (${ph(ids.length)})
        ORDER BY ymd ASC, device_id ASC`
    ).bind(...ids).all();

    for (const r of (rs.results || [])) {
      const m =
        byDev.get(r.device_id);

      if (!m) {
        continue;
      }

      if (isAdmin) {
        lines.push([
          r.ymd,
          g.group_id,
          csvCell(g.name),
          m.member_id,
          csvCell(m.nickname || ''),
          csvCell(r.device_id),
          Number(r.kg).toFixed(1),
        ].join(','));
      } else {
        lines.push([
          r.ymd,
          g.group_id,
          csvCell(g.name),
          m.member_id,
          csvCell(m.nickname || ''),
          Number(r.kg).toFixed(1),
        ].join(','));
      }

      n++;
    }
  }

  await writeLog(
    env,
    actor,
    'export_csv',
    g.group_id,
    {
      rows: n,
      members: members.length,
      device_id_included: isAdmin,
    }
  );

  // Excel で文字化けしないよう BOM を付ける
  return new Response(
    '\uFEFF' +
    lines.join('\r\n') +
    '\r\n',
    {
      status: 200,
      headers: {
        'content-type':
          'text/csv; charset=utf-8',
        'content-disposition':
          dispositionHeader(
            g.name,
            'csv'
          ),
        'cache-control':
          'no-store',
      },
    }
  );
}

/* 全バックアップ（管理画面のみ）。
   device_id は実質パスワードなので含めない。端末の復旧は
   POST /api/admin/device/swap（member_id 据え置き）で行う。 */
async function exportJson(req, env, g, actor) {
  const members = await getMembers(env, g.group_id);
  const byDev = new Map(members.map(m => [m.device_id, m]));
  const ids = members.map(m => m.device_id);

  const pick = async (sql, mapper) => {
    if (!ids.length) return [];

    const rs =
      await env.DB
        .prepare(sql)
        .bind(...ids)
        .all();

    return (rs.results || [])
      .map(mapper)
      .filter(Boolean);
  };

  const weights = await pick(
    `SELECT device_id, ymd, kg, updated_at
       FROM weights
      WHERE device_id IN (${ph(ids.length)})
      ORDER BY ymd ASC`,
    r => {
      const m = byDev.get(r.device_id);

      return m
        ? {
            member_id: m.member_id,
            ymd: r.ymd,
            kg: Number(r.kg),
            updated_at: num(r.updated_at),
          }
        : null;
    }
  );

  const rivals = await pick(
    `SELECT device_id, rival_member_id
       FROM rivals
      WHERE device_id IN (${ph(ids.length)})`,
    r => {
      const m = byDev.get(r.device_id);

      return m
        ? {
            member_id: m.member_id,
            rival_member_id: r.rival_member_id,
          }
        : null;
    }
  );

  const blocks = await pick(
    `SELECT device_id, blocked_member_id
       FROM blocks
      WHERE device_id IN (${ph(ids.length)})`,
    r => {
      const m = byDev.get(r.device_id);

      return m
        ? {
            member_id: m.member_id,
            blocked_member_id: r.blocked_member_id,
          }
        : null;
    }
  );

  const watching = await pick(
    `SELECT device_id, group_id
       FROM watching
      WHERE device_id IN (${ph(ids.length)})`,
    r => {
      const m = byDev.get(r.device_id);

      return m
        ? {
            member_id: m.member_id,
            group_id: r.group_id,
          }
        : null;
    }
  );

  const bansRs =
    await env.DB
      .prepare(
        'SELECT member_id, by_admin, created_at FROM group_bans WHERE group_id=?'
      )
      .bind(g.group_id)
      .all();

  const body = {
    app: 'minyase',
    format_version: 1,
    exported_at: Date.now(),

    note:
      'device_id は含みません。端末の復旧は /api/admin/device/swap を使ってください。',

    group: {
      group_id: g.group_id,
      code: fmtCode(g.group_id),
      name: g.name,
      owner_id: g.owner_id,
      show_weight:
        Number(g.show_weight) === 1,
      start_ymd:
        g.start_ymd,
      max_members:
        Number(g.max_members || 100),
      created_at:
        num(g.created_at),
    },

    members:
      members.map(m => ({
        member_id:
          m.member_id,

        nickname:
          m.nickname || null,

        icon_ver:
          Number(m.icon_ver || 0),

        goal_weight:
          num(m.goal_weight),

        notify_on:
          Number(m.notify_on || 0) === 1,

        notify_days:
          Number(m.notify_days || 3),

        notify_hour:
          Number(
            m.notify_hour == null
              ? 20
              : m.notify_hour
          ),

        joined_at:
          num(m.joined_at),

        is_owner:
          isOwnerOf(g, m),
      })),

    weights,
    rivals,
    blocks,
    watching,

    bans:
      (bansRs.results || []).map(
        b => ({
          member_id:
            b.member_id,

          by_admin:
            Number(b.by_admin || 0) === 1,

          created_at:
            num(b.created_at),
        })
      ),
  };

  await writeLog(
    env,
    actor,
    'export_json',
    g.group_id,
    {
      weights: weights.length,
      members: members.length,
    }
  );

  return new Response(
    JSON.stringify(
      body,
      null,
      2
    ),
    {
      status: 200,
      headers: {
        'content-type':
          'application/json; charset=utf-8',

        'content-disposition':
          `attachment; filename="minyase_backup_${todayYmdJST().replace(/-/g, '')}.json"`,

        'cache-control':
          'no-store',
      },
    }
  );
}

/* ============================================================
   ⑥ 取り込み
   ============================================================ */

function parseCsv(text) {
  const s =
    String(text || '')
      .replace(/^\uFEFF/, '');

  const rows = [];

  let row = [];
  let cur = '';
  let q = false;
  let had = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          q = false;
        }
      } else {
        cur += c;
      }

    } else if (c === '"') {
      q = true;
      had = true;

    } else if (c === ',') {
      row.push(cur);
      cur = '';
      had = true;

    } else if (c === '\n') {
      row.push(cur);
      rows.push(row);

      row = [];
      cur = '';
      had = false;

    } else if (c === '\r') {
      /* CRLF の CR は捨てる */

    } else {
      cur += c;
      had = true;
    }
  }

  if (
    had ||
    cur !== '' ||
    row.length
  ) {
    row.push(cur);
    rows.push(row);
  }

  return rows.filter(
    r =>
      r.some(
        c =>
          String(c).trim() !== ''
      )
  );
}

const COL = {
  member_id: [
    'member_id',
    'memberid',
    'member',
  ],

  date: [
    'date',
    'ymd',
    '日付',
  ],

  weight: [
    'weight_kg',
    'weight',
    'kg',
    '体重',
  ],
};

function headerIndex(head) {
  const norm =
    head.map(
      h =>
        String(h || '')
          .trim()
          .toLowerCase()
          .replace(/^\uFEFF/, '')
    );

  const find = keys => {
    for (const k of keys) {
      const i =
        norm.indexOf(k);

      if (i >= 0) {
        return i;
      }
    }

    return -1;
  };

  return {
    member_id:
      find(COL.member_id),

    date:
      find(COL.date),

    weight:
      find(COL.weight),
  };
}

async function runImport(
  req,
  env,
  g,
  actor,
  dryRun
) {
  const bt =
    await readBodyText(req);

  if (bt.error) {
    return bad(
      req,
      bt.error,
      413
    );
  }

  const rows =
    parseCsv(bt.text);

  if (rows.length < 2) {
    return bad(
      req,
      'csv_empty'
    );
  }

  const idx =
    headerIndex(rows[0]);

  if (
    idx.member_id < 0 ||
    idx.date < 0 ||
    idx.weight < 0
  ) {
    return bad(
      req,
      'csv_header_invalid'
    );
  }

  const members =
    await getMembers(
      env,
      g.group_id
    );

  const byMember =
    new Map(
      members.map(
        m => [
          m.member_id,
          m,
        ]
      )
    );

  const ids =
    members.map(
      m => m.device_id
    );

  // 既存値（skip 判定用）
  const cur =
    new Map();

  if (ids.length) {
    const rs =
      await env.DB.prepare(
        `SELECT device_id, ymd, kg
           FROM weights
          WHERE device_id IN (${ph(ids.length)})`
      ).bind(...ids).all();

    for (const r of (rs.results || [])) {
      cur.set(
        r.device_id + '|' + r.ymd,
        Number(r.kg)
      );
    }
  }

  const today =
    todayYmdJST();

  const errors = [];

  const plan =
    new Map();

  let add = 0;
  let update = 0;
  let skip = 0;

  for (
    let i = 1;
    i < rows.length;
    i++
  ) {
    const r =
      rows[i];

    const line =
      i + 1;

    const mid =
      String(
        r[idx.member_id] || ''
      )
        .trim()
        .toUpperCase();

    const rawDate =
      r[idx.date];

    const rawKg =
      r[idx.weight];

    const push = code =>
      errors.push({
        line,
        member_id:
          mid || null,
        date:
          String(rawDate || '').trim(),
        error:
          code,
      });

    if (!mid) {
      push('bad_member_id');
      continue;
    }

    const m =
      byMember.get(mid);

    /*
     * 取り込みは他人の記録を書き換える操作なので、
     * 在籍中のメンバーだけに限る。
     */
    if (!m) {
      push('not_in_group');
      continue;
    }

    const ymd =
      normYmd(rawDate);

    if (!ymd) {
      push('bad_ymd');
      continue;
    }

    if (ymd > today) {
      push('future_ymd');
      continue;
    }

    const kg =
      normKg(rawKg);

    if (kg === null) {
      push('bad_kg');
      continue;
    }

    const key =
      m.device_id +
      '|' +
      ymd;

    /*
     * 同じ member_id + date が複数あれば
     * 後の行を採用
     */
    plan.set(
      key,
      {
        device_id:
          m.device_id,

        ymd,

        kg,
      }
    );
  }

  for (const [key, v] of plan) {
    const before =
      cur.get(key);

    if (before === undefined) {
      add++;

    } else if (
      round1(before) !==
      round1(v.kg)
    ) {
      update++;

    } else {
      skip++;
    }
  }

  const result = {
    ok: true,
    dryRun: !!dryRun,

    group: {
      id:
        g.group_id,

      name:
        g.name,
    },

    add,
    update,
    skip,

    rows:
      plan.size,

    errors,
  };

  if (dryRun) {
    return json(
      req,
      result
    );
  }

  const now =
    Date.now();

  const stmts = [];

  for (const v of plan.values()) {
    const before =
      cur.get(
        v.device_id +
        '|' +
        v.ymd
      );

    /*
     * 冪等。
     * 同じ値なら書き込まない
     */
    if (
      before !== undefined &&
      round1(before) ===
      round1(v.kg)
    ) {
      continue;
    }

    stmts.push(
      env.DB.prepare(
        `INSERT INTO weights
           (device_id,ymd,kg,updated_at)
         VALUES (?,?,?,?)
         ON CONFLICT(device_id,ymd)
         DO UPDATE SET
           kg=excluded.kg,
           updated_at=excluded.updated_at`
      ).bind(
        v.device_id,
        v.ymd,
        v.kg,
        now
      )
    );
  }

  for (
    let i = 0;
    i < stmts.length;
    i += BATCH_SIZE
  ) {
    await env.DB.batch(
      stmts.slice(
        i,
        i + BATCH_SIZE
      )
    );
  }

  result.applied =
    stmts.length;

  await writeLog(
    env,
    actor,
    'import_csv',
    g.group_id,
    {
      add,
      update,
      skip,
      applied:
        stmts.length,
      errors:
        errors.length,
    }
  );

  return json(
    req,
    result
  );
}

/* ============================================================
   端末の差し替え（管理画面のみ）
   member_id を据え置いて device_id だけ入れ替える。
   体重・アイコン(R2は member_id キー)・グループ所属・オーナー権限・
   他人から見たライバル登録・除名リストがそのまま残る。
   ============================================================ */

async function deviceLookup(
  req,
  env,
  url
) {
  const mid =
    String(
      url.searchParams.get(
        'member_id'
      ) || ''
    )
      .trim()
      .toUpperCase();

  const did =
    String(
      url.searchParams.get(
        'device_id'
      ) || ''
    )
      .trim();

  if (
    !mid &&
    !did
  ) {
    return bad(
      req,
      'bad_member_id'
    );
  }

  const dev =
    mid
      ? await env.DB
          .prepare(
            'SELECT * FROM devices WHERE member_id=?'
          )
          .bind(mid)
          .first()

      : await env.DB
          .prepare(
            'SELECT * FROM devices WHERE device_id=?'
          )
          .bind(did)
          .first();

  if (!dev) {
    return bad(
      req,
      'member_not_found',
      404
    );
  }

  const c =
    await env.DB.prepare(
      `SELECT
         COUNT(*) AS n,
         MIN(ymd) AS a,
         MAX(ymd) AS b
       FROM weights
       WHERE device_id=?`
    )
      .bind(dev.device_id)
      .first();

  const g =
    dev.group_id
      ? await getGroup(
          env,
          dev.group_id
        )
      : null;

  return json(
    req,
    {
      ok: true,

      device: {
        member_id:
          dev.member_id,

        device_id_masked:
          mask(dev.device_id),

        nickname:
          dev.nickname || null,

        icon_ver:
          Number(
            dev.icon_ver || 0
          ),

        banned:
          Number(
            dev.banned || 0
          ) === 1,

        created_at:
          num(dev.created_at),

        last_seen_at:
          num(dev.last_seen_at),

        weights:
          Number(
            c ? c.n : 0
          ),

        first_ymd:
          c ? c.a : null,

        last_ymd:
          c ? c.b : null,

        group:
          g
            ? {
                id:
                  g.group_id,

                name:
                  g.name,

                is_owner:
                  isOwnerOf(
                    g,
                    dev
                  ),
              }
            : null,
      },
    }
  );
}

async function deviceSwap(
  req,
  env
) {
  const b =
    await readJson(req);

  const mid =
    String(
      b.member_id || ''
    )
      .trim()
      .toUpperCase();

  const nd =
    String(
      b.new_device_id || ''
    )
      .trim();

  const force =
    !!b.force;

  if (!mid) {
    return bad(
      req,
      'bad_member_id'
    );
  }

  if (
    !DEVICE_ID_RE.test(nd)
  ) {
    return bad(
      req,
      'bad_device_id'
    );
  }

  const old =
    await env.DB.prepare(
      'SELECT * FROM devices WHERE member_id=?'
    )
      .bind(mid)
      .first();

  if (!old) {
    return bad(
      req,
      'member_not_found',
      404
    );
  }

  if (
    old.device_id === nd
  ) {
    return bad(
      req,
      'nothing_to_update'
    );
  }

  if (
    Number(old.banned) === 1 &&
    !force
  ) {
    return bad(
      req,
      'banned',
      403
    );
  }

  /*
   * 入れ直した端末が作ってしまった新しい行。
   * 空であることを確かめて先に消す
   */
  const stale =
    await env.DB.prepare(
      'SELECT * FROM devices WHERE device_id=?'
    )
      .bind(nd)
      .first();

  let staleInfo =
    null;

  if (stale) {
    const c =
      await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM weights WHERE device_id=?'
      )
        .bind(nd)
        .first();

    const n =
      Number(
        c ? c.n : 0
      );

    const ownsGroup =
      stale.group_id
        ? await env.DB.prepare(
            'SELECT group_id FROM groups WHERE group_id=? AND owner_id=?'
          )
            .bind(
              stale.group_id,
              stale.member_id
            )
            .first()
        : null;

    /*
     * 記録が入っている／
     * グループのオーナーになっている行は
     * 勝手に消さない
     */
    if (
      (n > 0 || ownsGroup) &&
      !force
    ) {
      return bad(
        req,
        'new_device_not_empty',
        409
      );
    }

    staleInfo = {
      member_id:
        stale.member_id,

      weights:
        n,

      owner:
        !!ownsGroup,
    };
  }

  const now =
    Date.now();

  const stmts = [];

  if (stale) {
    stmts.push(
      env.DB.prepare(
        'DELETE FROM weights WHERE device_id=?'
      ).bind(nd),

      env.DB.prepare(
        'DELETE FROM watching WHERE device_id=?'
      ).bind(nd),

      env.DB.prepare(
        'DELETE FROM rivals WHERE device_id=?'
      ).bind(nd),

      env.DB.prepare(
        'DELETE FROM blocks WHERE device_id=?'
      ).bind(nd),

      env.DB.prepare(
        'DELETE FROM rivals WHERE rival_member_id=?'
      ).bind(stale.member_id),

      env.DB.prepare(
        'DELETE FROM blocks WHERE blocked_member_id=?'
      ).bind(stale.member_id),

      env.DB.prepare(
        'DELETE FROM devices WHERE device_id=?'
      ).bind(nd)
    );
  }

  /*
   * device_id を持つ表を全部付け替える
   */
  stmts.push(
    env.DB.prepare(
      'UPDATE weights SET device_id=? WHERE device_id=?'
    ).bind(
      nd,
      old.device_id
    ),

    env.DB.prepare(
      'UPDATE watching SET device_id=? WHERE device_id=?'
    ).bind(
      nd,
      old.device_id
    ),

    env.DB.prepare(
      'UPDATE rivals SET device_id=? WHERE device_id=?'
    ).bind(
      nd,
      old.device_id
    ),

    env.DB.prepare(
      'UPDATE blocks SET device_id=? WHERE device_id=?'
    ).bind(
      nd,
      old.device_id
    ),

    env.DB.prepare(
      'UPDATE devices SET device_id=?, last_seen_at=? WHERE device_id=?'
    ).bind(
      nd,
      now,
      old.device_id
    )
  );

  await env.DB.batch(
    stmts
  );

  /*
   * 消した新規端末側のアイコンを掃除
   */
  if (
    stale &&
    staleInfo &&
    staleInfo.member_id !== mid
  ) {
    try {
      if (env.ICONS) {
        await env.ICONS.delete(
          iconKey(
            staleInfo.member_id
          )
        );
      }
    } catch {}
  }

  const after =
    await env.DB.prepare(
      'SELECT * FROM devices WHERE device_id=?'
    )
      .bind(nd)
      .first();

  const cw =
    await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM weights WHERE device_id=?'
    )
      .bind(nd)
      .first();

  await writeLog(
    env,
    'admin',
    'device_swap',
    after
      ? after.group_id
      : null,
    {
      member_id:
        mid,

      old_device_id:
        mask(old.device_id),

      new_device_id:
        mask(nd),

      removed_stale:
        staleInfo,

      forced:
        force,
    }
  );

  return json(
    req,
    {
      ok: true,

      member_id:
        mid,

      old_device_id_masked:
        mask(old.device_id),

      new_device_id_masked:
        mask(nd),

      removed_stale:
        staleInfo,

      weights:
        Number(
          cw ? cw.n : 0
        ),

      group_id:
        after
          ? after.group_id
          : null,
    }
  );
}

/* ============================================================
   管理画面 API（route() の bad_device_id 判定より上で呼ぶ）
   ============================================================ */

export async function adminRoute(
  req,
  env,
  url,
  p,
  m
) {
  if (!env.ADMIN_TOKEN) {
    return bad(
      req,
      'no_admin_token',
      503
    );
  }

  if (!adminOk(req, env)) {
    return bad(
      req,
      'unauthorized',
      401
    );
  }

  /* グループ一覧（名前・人数・記録率・合計） */
  if (
    p === '/api/admin/groups' &&
    m === 'GET'
  ) {
    const date =
      normYmd(
        url.searchParams.get('date') || ''
      ) ||
      todayYmdJST();

    const rs =
      await env.DB.prepare(
        `SELECT
           g.group_id,
           g.name,
           g.owner_id,
           g.show_weight,
           g.start_ymd,
           g.created_at,

           (
             SELECT COUNT(*)
             FROM devices d
             WHERE d.group_id=g.group_id
               AND d.banned=0
           ) AS members,

           (
             SELECT COUNT(*)
             FROM devices d
             JOIN weights w
               ON w.device_id=d.device_id
             WHERE d.group_id=g.group_id
               AND d.banned=0
               AND w.ymd=?
           ) AS recorded,

           (
             SELECT SUM(w.kg)
             FROM devices d
             JOIN weights w
               ON w.device_id=d.device_id
             WHERE d.group_id=g.group_id
               AND d.banned=0
               AND w.ymd=?
           ) AS total

         FROM groups g
         ORDER BY g.created_at DESC`
      )
        .bind(
          date,
          date
        )
        .all();

    return json(
      req,
      {
        ok: true,

        date,

        groups:
          (rs.results || [])
            .map(g => {
              const members =
                Number(
                  g.members || 0
                );

              const recorded =
                Number(
                  g.recorded || 0
                );

              return {
                id:
                  g.group_id,

                code:
                  fmtCode(
                    g.group_id
                  ),

                name:
                  g.name,

                owner_id:
                  g.owner_id,

                show_weight:
                  Number(
                    g.show_weight
                  ) === 1,

                start_ymd:
                  g.start_ymd,

                members,

                recorded,

                rate:
                  members
                    ? Math.round(
                        recorded /
                        members *
                        100
                      )
                    : 0,

                total:
                  g.total === null ||
                  g.total === undefined
                    ? null
                    : round1(
                        Number(
                          g.total
                        )
                      ),
              };
            }),
      }
    );
  }

  /* ⑤ 日付ビュー（非公開グループもここからは見える） */
  if (
    p === '/api/admin/group/day' &&
    m === 'GET'
  ) {
    const gid =
      normalizeCode(
        url.searchParams.get('gid') || ''
      );

    if (!gid) {
      return bad(
        req,
        'bad_code'
      );
    }

    const g =
      await getGroup(
        env,
        gid
      );

    if (!g) {
      return bad(
        req,
        'group_not_found',
        404
      );
    }

    const date =
      normYmd(
        url.searchParams.get('date') || ''
      ) ||
      todayYmdJST();

    const fill =
      url.searchParams.get('fill') === 'last';

    const out =
      await dayView(
        env,
        g,
        date,
        fill
      );

    out.ok =
      true;

    out.show_weight =
      Number(
        g.show_weight
      ) === 1;

    return json(
      req,
      out
    );
  }

  /* ⑥ 書き出し */
  if (
    p === '/api/admin/export' &&
    m === 'GET'
  ) {
    const gid =
      normalizeCode(
        url.searchParams.get('gid') || ''
      );

    if (!gid) {
      return bad(
        req,
        'bad_code'
      );
    }

    const g =
      await getGroup(
        env,
        gid
      );

    if (!g) {
      return bad(
        req,
        'group_not_found',
        404
      );
    }

    const fmt =
      String(
        url.searchParams.get('format') ||
        'csv'
      )
        .toLowerCase();

    if (fmt === 'json') {
      return await exportJson(
        req,
        env,
        g,
        'admin'
      );
    }

    if (fmt === 'csv') {
      return await exportCsv(
        req,
        env,
        g,
        'admin'
      );
    }

    return bad(
      req,
      'bad_format'
    );
  }

  /* ⑥ 取り込み */
  if (
    p === '/api/admin/import' &&
    m === 'POST'
  ) {
    const gid =
      normalizeCode(
        url.searchParams.get('gid') || ''
      );

    if (!gid) {
      return bad(
        req,
        'bad_code'
      );
    }

    const g =
      await getGroup(
        env,
        gid
      );

    if (!g) {
      return bad(
        req,
        'group_not_found',
        404
      );
    }

    const dry =
      url.searchParams.get('dryRun') === '1';

    return await runImport(
      req,
      env,
      g,
      'admin',
      dry
    );
  }

  /* 端末の差し替え */
  if (
    p === '/api/admin/device/lookup' &&
    m === 'GET'
  ) {
    return await deviceLookup(
      req,
      env,
      url
    );
  }

  if (
    p === '/api/admin/device/swap' &&
    m === 'POST'
  ) {
    return await deviceSwap(
      req,
      env
    );
  }

  /* 通報の閲覧 */
  if (
    p === '/api/admin/reports' &&
    m === 'GET'
  ) {
    const lim =
      Math.min(
        200,
        Math.max(
          1,
          Number(
            url.searchParams.get('limit') ||
            50
          )
        )
      );

    const rs =
      await env.DB.prepare(
        `SELECT
           r.reporter_id,
           r.target_id,
           r.ymd,
           r.reason,
           r.created_at,
           r.handled,
           a.nickname AS reporter_name,
           b.nickname AS target_name

         FROM reports r

         LEFT JOIN devices a
           ON a.member_id=r.reporter_id

         LEFT JOIN devices b
           ON b.member_id=r.target_id

         ORDER BY
           r.handled ASC,
           r.created_at DESC

         LIMIT ?`
      )
        .bind(lim)
        .all();

    return json(
      req,
      {
        ok: true,
        reports:
          rs.results || [],
      }
    );
  }

  /* 監査ログの閲覧 */
  if (
    p === '/api/admin/log' &&
    m === 'GET'
  ) {
    await ensureLogTable(
      env
    );

    const lim =
      Math.min(
        500,
        Math.max(
          1,
          Number(
            url.searchParams.get('limit') ||
            100
          )
        )
      );

    const rs =
      await env.DB.prepare(
        'SELECT * FROM admin_log ORDER BY ts DESC LIMIT ?'
      )
        .bind(lim)
        .all();

    return json(
      req,
      {
        ok: true,
        log:
          rs.results || [],
      }
    );
  }

  return notFound(req);
}

/* ============================================================
   一般ユーザー向け（route() の端末チェック通過後に呼ぶ）
   ============================================================ */

async function needPublicOwnedGroup(
  req,
  env,
  dev,
  gidRaw
) {
  const gid =
    gidRaw
      ? normalizeCode(gidRaw)
      : dev.group_id;

  if (!gid) {
    return {
      resp:
        bad(
          req,
          'not_in_group'
        ),
    };
  }

  const g =
    await getGroup(
      env,
      gid
    );

  if (!g) {
    return {
      resp:
        bad(
          req,
          'group_not_found',
          404
        ),
    };
  }

  if (
    !isOwnerOf(
      g,
      dev
    )
  ) {
    return {
      resp:
        bad(
          req,
          'not_owner',
          403
        ),
    };
  }

  /*
   * 非公開グループは
   * オーナーも他人の体重を見られない
   */
  if (
    Number(
      g.show_weight
    ) !== 1
  ) {
    return {
      resp:
        bad(
          req,
          'private_group_admin_only',
          403
        ),
    };
  }

  return {
    group: g,
  };
}

export async function memberRoute(
  req,
  env,
  dev,
  url,
  p,
  m
) {
  /* ⑤ 日付ビュー */
  if (
    p === '/api/group/day' &&
    m === 'GET'
  ) {
    const gid =
      normalizeCode(
        url.searchParams.get('gid') || ''
      ) ||
      dev.group_id;

    if (!gid) {
      return bad(
        req,
        'not_in_group'
      );
    }

    const g =
      await getGroup(
        env,
        gid
      );

    if (!g) {
      return bad(
        req,
        'group_not_found',
        404
      );
    }

    if (
      gid !==
      dev.group_id
    ) {
      const w =
        await env.DB.prepare(
          'SELECT group_id FROM watching WHERE device_id=? AND group_id=?'
        )
          .bind(
            dev.device_id,
            gid
          )
          .first();

      if (!w) {
        return bad(
          req,
          'not_watching',
          403
        );
      }
    }

    if (
      Number(
        g.show_weight
      ) !== 1
    ) {
      return bad(
        req,
        'private_group_admin_only',
        403
      );
    }

    const date =
      normYmd(
        url.searchParams.get('date') || ''
      ) ||
      todayYmdJST();

    const fill =
      url.searchParams.get('fill') === 'last';

    const out =
      await dayView(
        env,
        g,
        date,
        fill
      );

    out.ok =
      true;

    out.show_weight =
      true;

    return json(
      req,
      out
    );
  }

  /*
   * ⑥ 書き出し
   * 公開グループのオーナーのみ。
   * CSVだけ。
   * device_id は出さない。
   */
  if (
    p === '/api/export' &&
    m === 'GET'
  ) {
    const r =
      await needPublicOwnedGroup(
        req,
        env,
        dev,
        url.searchParams.get('gid')
      );

    if (r.resp) {
      return r.resp;
    }

    const fmt =
      String(
        url.searchParams.get('format') ||
        'csv'
      )
        .toLowerCase();

    if (
      fmt === 'json'
    ) {
      return bad(
        req,
        'admin_only',
        403
      );
    }

    if (
      fmt !== 'csv'
    ) {
      return bad(
        req,
        'bad_format'
      );
    }

    return await exportCsv(
      req,
      env,
      r.group,
      dev.member_id
    );
  }

  /* ⑥ 取り込み：公開グループのオーナーのみ */
  if (
    p === '/api/import' &&
    m === 'POST'
  ) {
    const r =
      await needPublicOwnedGroup(
        req,
        env,
        dev,
        url.searchParams.get('gid')
      );

    if (r.resp) {
      return r.resp;
    }

    const dry =
      url.searchParams.get('dryRun') === '1';

    return await runImport(
      req,
      env,
      r.group,
      dev.member_id,
      dry
    );
  }

  return null;
}
