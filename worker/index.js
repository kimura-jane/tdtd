'use strict';

import {
  pickOrigin, corsHeaders, json, auth, pubMe, rateOk,
  todayYmdJST, isValidYmd, nowIso, normKg, normNickname,
  randomCode, normalizeCode,
} from './lib.js';

const INACTIVE_DAYS = 14;   // これを超えて未入力なら「休止中」

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const allow = pickOrigin(request);

    if (!path.startsWith('/api/')) {
      return new Response('Not Found', { status: 404 });
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(allow) });
    }

    try {
      if (path === '/api/register')  return await register(request, env, allow);
      if (path === '/api/me')        return await me(request, env, allow);
      if (path === '/api/weights')   return await weights(request, env, allow);

      const mw = path.match(/^\/api\/weights\/(.+)$/);
      if (mw) return await weightDelete(request, env, allow, decodeURIComponent(mw[1]));

      if (path === '/api/groups')          return await groups(request, env, allow);
      if (path === '/api/groups/join')     return await groupJoin(request, env, allow);
      if (path === '/api/groups/leave')    return await groupLeave(request, env, allow);
      if (path === '/api/groups/kick')     return await groupKick(request, env, allow);
      if (path === '/api/groups/unban')    return await groupUnban(request, env, allow);
      if (path === '/api/groups/bans')     return await groupBans(request, env, allow);
      if (path === '/api/groups/dissolve') return await groupDissolve(request, env, allow);

      if (path === '/api/ranking')  return await ranking(request, env, allow);
      if (path === '/api/watching') return await watching(request, env, allow);
      if (path === '/api/rivals')   return await rivals(request, env, allow);
      if (path === '/api/blocks')   return await blocks(request, env, allow);
      if (path === '/api/reports')  return await reports(request, env, allow);

      return json({ ok: false, error: 'not_found', path }, 404, allow);
    } catch (e) {
      return json({ ok: false, error: 'server_error', detail: String(e?.message || e) }, 500, allow);
    }
  },
};

/* ===================== /api/register ===================== */
async function register(request, env, allow) {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405, allow);

  let body = {};
  try { body = await request.json(); } catch {}

  const deviceId = body.device_id;
  if (!/^dev_[0-9a-fA-F-]{36}$/.test(deviceId || '')) {
    return json({ ok: false, error: 'device_id required (dev_ + uuid)' }, 400, allow);
  }

  const existing = await env.DB.prepare('SELECT * FROM devices WHERE device_id = ?')
    .bind(deviceId).first();

  if (existing) {
    if (existing.banned) return json({ ok: false, error: 'banned' }, 403, allow);
    await env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE device_id = ?')
      .bind(nowIso(), deviceId).run();
    return json({ ok: true, created: false, today: todayYmdJST(), me: pubMe(existing) }, 200, allow);
  }

  const nickname = normNickname(body.nickname) || '名無し';
  const now = nowIso();

  for (let i = 0; i < 5; i++) {
    try {
      await env.DB.prepare(
        `INSERT INTO devices (device_id, member_id, nickname, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(deviceId, randomCode(10), nickname, now, now).run();

      const row = await env.DB.prepare('SELECT * FROM devices WHERE device_id = ?')
        .bind(deviceId).first();
      return json({ ok: true, created: true, today: todayYmdJST(), me: pubMe(row) }, 200, allow);
    } catch (e) {
      if (!String(e?.message || e).includes('UNIQUE')) throw e;
    }
  }
  return json({ ok: false, error: 'member_id_collision' }, 500, allow);
}

/* ===================== /api/me ===================== */
async function me(request, env, allow) {
  const a = await auth(request, env);
  if (a.error) return json({ ok: false, error: a.error }, a.status, allow);
  const self = a.me;

  if (request.method === 'GET') {
    return json({
      ok: true, today: todayYmdJST(), me: pubMe(self),
      group: await groupView(env, self),
    }, 200, allow);
  }

  if (request.method === 'PATCH') {
    let body = {};
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'invalid_json' }, 400, allow);
    }
    const sets = [], args = [];

    if ('nickname' in body) {
      const n = normNickname(body.nickname);
      if (!n) return json({ ok: false, error: 'bad_nickname' }, 400, allow);
      sets.push('nickname = ?'); args.push(n);
    }
    if ('goal_weight' in body) {
      if (body.goal_weight === null) { sets.push('goal_weight = NULL'); }
      else {
        const g = normKg(body.goal_weight);
        if (g === null) return json({ ok: false, error: 'bad_goal_weight' }, 400, allow);
        sets.push('goal_weight = ?'); args.push(g);
      }
    }
    if ('notify_on' in body) { sets.push('notify_on = ?'); args.push(body.notify_on ? 1 : 0); }
    if ('notify_days' in body) {
      const d = Number(body.notify_days);
      if (![3, 7].includes(d)) return json({ ok: false, error: 'bad_notify_days' }, 400, allow);
      sets.push('notify_days = ?'); args.push(d);
    }
    if ('notify_hour' in body) {
      const h = Number(body.notify_hour);
      if (!Number.isInteger(h) || h < 0 || h > 23) {
        return json({ ok: false, error: 'bad_notify_hour' }, 400, allow);
      }
      sets.push('notify_hour = ?'); args.push(h);
    }
    if (!sets.length) return json({ ok: false, error: 'nothing_to_update' }, 400, allow);

    args.push(self.device_id);
    await env.DB.prepare(`UPDATE devices SET ${sets.join(', ')} WHERE device_id = ?`)
      .bind(...args).run();

    const row = await env.DB.prepare('SELECT * FROM devices WHERE device_id = ?')
      .bind(self.device_id).first();
    return json({ ok: true, me: pubMe(row), group: await groupView(env, row) }, 200, allow);
  }

  if (request.method === 'DELETE') {
    // 自分がオーナーのグループは解散させる
    const owned = await env.DB.prepare('SELECT group_id FROM groups WHERE owner_id = ?')
      .bind(self.device_id).first();
    if (owned) await dissolve(env, owned.group_id);

    await env.DB.batch([
      env.DB.prepare('DELETE FROM weights  WHERE device_id = ?').bind(self.device_id),
      env.DB.prepare('DELETE FROM watching WHERE device_id = ?').bind(self.device_id),
      env.DB.prepare('DELETE FROM rivals   WHERE device_id = ?').bind(self.device_id),
      env.DB.prepare('DELETE FROM blocks   WHERE device_id = ?').bind(self.device_id),
      env.DB.prepare('DELETE FROM rivals   WHERE rival_member_id = ?').bind(self.member_id),
      env.DB.prepare('DELETE FROM blocks   WHERE blocked_member_id = ?').bind(self.member_id),
      env.DB.prepare('DELETE FROM devices  WHERE device_id = ?').bind(self.device_id),
    ]);

    if (env.ICONS) {
      try { await env.ICONS.delete(`icon/${self.member_id}.jpg`); } catch {}
    }
    return json({ ok: true, deleted: true }, 200, allow);
  }

  return json({ ok: false, error: 'GET, PATCH or DELETE only' }, 405, allow);
}

/* ===================== /api/weights ===================== */
async function weights(request, env, allow) {
  const a = await auth(request, env);
  if (a.error) return json({ ok: false, error: a.error }, a.status, allow);
  const self = a.me;
  const today = todayYmdJST();

  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'invalid_json' }, 400, allow);
    }
    const ymd = body.ymd || today;
    if (!isValidYmd(ymd)) return json({ ok: false, error: 'bad_ymd' }, 400, allow);
    if (ymd > today) return json({ ok: false, error: 'future_ymd' }, 400, allow);

    const kg = normKg(body.kg);
    if (kg === null) return json({ ok: false, error: 'bad_kg' }, 400, allow);

    await env.DB.prepare(
      `INSERT INTO weights (device_id, ymd, kg, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(device_id, ymd) DO UPDATE SET kg = excluded.kg, updated_at = excluded.updated_at`
    ).bind(self.device_id, ymd, kg, nowIso()).run();

    await env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE device_id = ?')
      .bind(nowIso(), self.device_id).run();

    return json({ ok: true, saved: { ymd, kg }, today }, 200, allow);
  }

  if (request.method === 'GET') {
    const u = new URL(request.url);
    const from = u.searchParams.get('from');
    const to = u.searchParams.get('to');
    if (from && !isValidYmd(from)) return json({ ok: false, error: 'bad_from' }, 400, allow);
    if (to && !isValidYmd(to)) return json({ ok: false, error: 'bad_to' }, 400, allow);

    let sql = 'SELECT ymd, kg FROM weights WHERE device_id = ?';
    const args = [self.device_id];
    if (from) { sql += ' AND ymd >= ?'; args.push(from); }
    if (to)   { sql += ' AND ymd <= ?'; args.push(to); }
    sql += ' ORDER BY ymd ASC';

    const { results } = await env.DB.prepare(sql).bind(...args).all();
    return json({ ok: true, today, weights: results || [] }, 200, allow);
  }

  return json({ ok: false, error: 'GET or POST only' }, 405, allow);
}

/* ===================== /api/weights/:ymd ===================== */
async function weightDelete(request, env, allow, ymd) {
  if (request.method !== 'DELETE') return json({ ok: false, error: 'DELETE only' }, 405, allow);
  const a = await auth(request, env);
  if (a.error) return json({ ok: false, error: a.error }, a.status, allow);
  if (!isValidYmd(ymd)) return json({ ok: false, error: 'bad_ymd' }, 400, allow);

  const r = await env.DB.prepare('DELETE FROM weights WHERE device_id = ? AND ymd = ?')
    .bind(a.me.device_id, ymd).run();
  return json({ ok: true, deleted: r.meta.changes || 0 }, 200, allow);
}

/* ===================== グループ共通 ===================== */
async function groupView(env, self) {
  if (!self.group_id) return null;
  const g = await env.DB.prepare('SELECT * FROM groups WHERE group_id = ?')
    .bind(self.group_id).first();
  if (!g) return null;
  const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices WHERE group_id = ?')
    .bind(g.group_id).first();
  const isOwner = g.owner_id === self.device_id;
  return {
    group_id: g.group_id,
    name: g.name,
    show_weight: !!g.show_weight,
    start_ymd: g.start_ymd,
    members: c?.n || 0,
    is_owner: isOwner,
    code: isOwner ? g.group_id : undefined,   // コードはオーナーにだけ返す
  };
}

async function dissolve(env, groupId) {
  await env.DB.batch([
    env.DB.prepare('UPDATE devices SET group_id = NULL, joined_at = NULL WHERE group_id = ?').bind(groupId),
    env.DB.prepare('DELETE FROM watching   WHERE group_id = ?').bind(groupId),
    env.DB.prepare('DELETE FROM group_bans WHERE group_id = ?').bind(groupId),
    env.DB.prepare('DELETE FROM groups     WHERE group_id = ?').bind(groupId),
  ]);
}

/* ===================== /api/groups（作成・改名） ===================== */
async function groups(request, env, allow) {
  const a = await auth(request, env);
  if (a.error) return json({ ok: false, error: a.error }, a.status, allow);
  const self = a.me;

  if (request.method === 'POST') {
    if (!await rateOk(env, 'grp:' + self.device_id)) {
      return json({ ok: false, error: 'too_many_requests' }, 429, allow);
    }
    if (self.group_id) return json({ ok: false, error: 'already_in_group' }, 409, allow);

    let body = {};
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'invalid_json' }, 400, allow);
    }
    const name = normNickname(body.name);
    if (!name) return json({ ok: false, error: 'bad_name' }, 400, allow);

    const today = todayYmdJST();
    let start = body.start_ymd || today;               // 未指定なら作成日
    if (!isValidYmd(start)) return json({ ok: false, error: 'bad_start_ymd' }, 400, allow);

    const showWeight = body.show_weight === undefined ? 1 : (body.show_weight ? 1 : 0);
    const now = nowIso();

    for (let i = 0; i < 5; i++) {
      const code = randomCode(8);
      try {
        await env.DB.prepare(
          `INSERT INTO groups (group_id, name, owner_id, show_weight, start_ymd, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(code, name, self.device_id, showWeight, start, now).run();

        await env.DB.prepare('UPDATE devices SET group_id = ?, joined_at = ? WHERE device_id = ?')
          .bind(code, now, self.device_id).run();

        const row = await env.DB.prepare('SELECT * FROM devices WHERE device_id = ?')
          .bind(self.device_id).first();
        return json({ ok: true, created: true, group: await groupView(env, row) }, 200, allow);
      } catch (e) {
        if (!String(e?.message || e).includes('UNIQUE')) throw e;
      }
    }
    return json({ ok: false, error: 'code_collision' }, 500, allow);
  }

  if (request.method === 'PATCH') {
    if (!self.group_id) return json({ ok: false, error: 'not_in_group' }, 400, allow);
    const g = await env.DB.prepare('SELECT * FROM groups WHERE group_id = ?')
      .bind(self.group_id).first();
    if (!g) return json({ ok: false, error: 'group_not_found' }, 404, allow);
    if (g.owner_id !== self.device_id) return json({ ok: false, error: 'not_owner' }, 403, allow);

    let body = {};
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'invalid_json' }, 400, allow);
    }
    const sets = [], args = [];
    if ('name' in body) {
      const n = normNickname(body.name);
      if (!n) return json({ ok: false, error: 'bad_name' }, 400, allow);
      sets.push('name = ?'); args.push(n);
    }
    if ('start_ymd' in body) {
      if (!isValidYmd(body.start_ymd)) return json({ ok: false, error: 'bad_start_ymd' }, 400, allow);
      sets.push('start_ymd = ?'); args.push(body.start_ymd);
    }
    if (!sets.length) return json({ ok: false, error: 'nothing_to_update' }, 400, allow);

    args.push(g.group_id);
    await env.DB.prepare(`UPDATE groups SET ${sets.join(', ')} WHERE group_id = ?`)
      .bind(...args).run();
    return json({ ok: true, group: await groupView(env, self) }, 200, allow);
  }

  return json({ ok: false, error: 'POST or PATCH only' }, 405, allow);
}

/* ===================== /api/groups/join ===================== */
async function groupJoin(request, env, allow) {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405, allow);
  const a = await auth(request, env);
  if (a.error) return json({ ok: false, error: a.error }, a.status, allow);
  const self = a.me;

  if (!await rateOk(env, 'join:' + self.device_id)) {
    return json({ ok: false, error: 'too_many_requests' }, 429, allow);
  }
  if (self.group_id) return json({ ok: false, error: 'already_in_group' }, 409, allow);

  let body = {};
  try { body = await request.json(); } catch {
    return json({ ok: false, error: 'invalid_json' }, 400, allow);
  }
  const code = normalizeCode(body.code);
  if (!code) return json({ ok: false, error: 'bad_code' }, 400, allow);

  const g = await env.DB.prepare('SELECT * FROM groups WHERE group_id = ?').bind(code).first();
  if (!g) return json({ ok: false, error: 'group_not_found' }, 404, allow);

  const ban = await env.DB.prepare('SELECT 1 FROM group_bans WHERE group_id = ? AND member_id = ?')
    .bind(code, self.member_id).first();
  if (ban) return json({ ok: false, error: 'banned_from_group' }, 403, allow);

  const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices WHERE group_id = ?')
    .bind(code).first();
  if ((c?.n || 0) >= g.max_members) return json({ ok: false, error: 'group_full' }, 409, allow);

  await env.DB.prepare('UPDATE devices SET group_id = ?, joined_at = ? WHERE device_id = ?')
    .bind(code, nowIso(), self.device_id).run();
  await env.DB.prepare('DELETE FROM watching WHERE device_id = ? AND group_id = ?')
    .bind(self.device_id, code).run();

  const row = await env.DB.prepare('SELECT * FROM devices WHERE device_id = ?')
    .bind(self.device_id).first();
  return json({ ok: true, joined: true, group: await groupView(env, row) }, 200, allow);
}

/* ===================== /api/groups/leave ===================== */
async function groupLeave(request, env, allow) {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405, allow);
  const a = await auth(request, env);
  if (a.error) return json({ ok: false, error: a.error }, a.status, allow);
  const self = a.me;
  if (!self.group_id) return json({ ok: false, error: 'not_in_group' }, 400, allow);

  const g = await env.DB.prepare('SELECT * FROM groups WHERE group_id = ?')
    .bind(self.group_id).first();
  if (g && g.owner_id === self.device_id) {
    return json({ ok: false, error: 'owner_must_dissolve' }, 409, allow);
  }

  await env.DB.prepare('UPDATE devices SET group_id = NULL, joined_at = NULL WHERE device_id = ?')
    .bind(self.device_id).run();
  return json({ ok: true, left: true }, 200, allow);
}

/* ===================== /api/groups/kick（除名＝BAN） ===================== */
async function groupKick(request, env, allow) {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405, allow);
  const a = await auth(request, env);
  if (a.error) return json({ ok: false, error: a.error }, a.status, allow);
  const self = a.me;
  if (!self.group_id) return json({ ok: false, error: 'not_in_group' }, 400, allow);

  const g = await env.DB.prepare('SELECT * FROM groups WHERE group_id = ?')
    .bind(self.group_id).first();
  if (!g) return json({ ok: false, error: 'group_not_found' }, 404, allow);
  if (g.owner_id !== self.device_id) return json({ ok: false, error: 'not_owner' }, 403, allow);

  let body = {};
  try { body = await request.json(); } catch {
    return json({ ok: false, error: 'invalid_json' }, 400, allow);
  }
  const target = String(body.member_id || '');
  if (!target) return json({ ok: false, error: 'member_id required' }, 400, allow);
  if (target === self.member_id) return json({ ok: false, error: 'cannot_kick_self' }, 400, allow);

  const t = await env.DB.prepare('SELECT device_id FROM devices WHERE member_id = ? AND group_id = ?')
    .bind(target, g.group_id).first();
  if (!t) return json({ ok: false, error: 'member_not_found' }, 404, allow);

  await env.DB.batch([
    env.DB.prepare('UPDATE devices SET group_id = NULL, joined_at = NULL WHERE device_id = ?')
      .bind(t.device_id),
    env.DB.prepare(
      `INSERT INTO group_bans (group_id, member_id, by_admin, created_at) VALUES (?, ?, 0, ?)
       ON CONFLICT(group_id, member_id) DO NOTHING`
    ).bind(g.group_id, target, nowIso()),
  ]);
  return json({ ok: true, kicked: target }, 200, allow);
}

/* ===================== /api/groups/unban（BAN解除） ===================== */
async function groupUnban(request, env, allow) {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405, allow);
  const a = await auth(request, env);
  if (a.error) return json({ ok: false, error: a.error }, a.status, allow);
  const self = a.me;
  if (!self.group_id) return json({ ok: false, error: 'not_in_group' }, 400, allow);

  const g = await env.DB.prepare('SELECT * FROM groups WHERE group_id = ?')
    .bind(self.group_id).first();
  if (!g) return json({ ok: false, error: 'group_not_found' }, 404, allow);
  if (g.owner_id !== self.device_id) return json({ ok: false, error: 'not_owner' }, 403, allow);

  let body = {};
  try { body = await request.json(); } catch {
    return json({ ok: false, error: 'invalid_json' }, 400, allow);
  }
  const target = String(body.member_id || '');
  if (!target) return json({ ok: false, error: 'member_id required' }, 400, allow);

  const r = await env.DB.prepare('DELETE FROM group_bans WHERE group_id = ? AND member_id = ?')
    .bind(g.group_id, target).run();
  return json({ ok: true, unbanned: r.meta.changes || 0 }, 200, allow);
}

/* ===================== /api/groups/bans（BAN一覧） ===================== */
async function groupBans(request, env, allow) {
  if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405, allow);
  const a = await auth(request, env);
  if (a.error) return json({ ok: false, error: a.error }, a.status, allow);
  const self = a.me;
  if (!self.group_id) return json({ ok: false, error: 'not_in_group' }, 400, allow);

  const g = await env.DB.prepare('SELECT * FROM groups WHERE group_id = ?')
    .bind(self.group_id).first();
  if (!g) return json({ ok: false, error: 'group_not_found' }, 404, allow);
  if (g.owner_id !== self.device_id) return json({ ok: false, error: 'not_owner' }, 403, allow);

  const { results } = await env.DB.prepare(
    `SELECT b.member_id, b.by_admin, b.created_at, d.nickname
       FROM group_bans b LEFT JOIN devices d ON d.member_id = b.member_id
      WHERE b.group_id = ? ORDER BY b.created_at DESC`
  ).bind(g.group_id).all();
  return json({ ok: true, bans: results || [] }, 200, allow);
}

/* ===================== /api/groups/dissolve（解散） ===================== */
async function groupDissolve(request, env, allow) {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405, allow);
  const a = await auth(request, env);
  if (a.error) return json({ ok: false, error: a.error }, a.status, allow);
  const self = a.me;
  if (!self.group_id) return json({ ok: false, error: 'not_in_group' }, 400, allow);

  const g = await env.DB.prepare('SELECT * FROM groups WHERE group_id = ?')
    .bind(self.group_id).first();
  if (!g) return json({ ok: false, error: 'group_not_found' }, 404, allow);
  if (g.owner_id !== self.device_id) return json({ ok: false, error: 'not_owner' }, 403, allow);

  await dissolve(env, g.group_id);
  return json({ ok: true, dissolved: g.group_id }, 200, allow);
}

/* ===================== /api/ranking ===================== */
async function ranking(request, env, allow) {
  if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405, allow);
  const a = await auth(request, env);
  if (a.error) return json({ ok: false, error: a.error }, a.status, allow);
  const self = a.me;

  const u = new URL(request.url);
  const mode = u.searchParams.get('mode') || 'group';      // group | rival
  const today = todayYmdJST();

  if (mode === 'rival') {
    const { results } = await env.DB.prepare(
      `SELECT d.device_id, d.member_id, d.nickname, d.icon_ver, d.group_id
         FROM rivals r JOIN devices d ON d.member_id = r.rival_member_id
        WHERE r.device_id = ? AND d.banned = 0`
    ).bind(self.device_id).all();
    const rows = await buildRows(env, results || [], null, today, self);
    return json({ ok: true, today, mode, group: null, rows }, 200, allow);
  }

  const gid = u.searchParams.get('group_id') || self.group_id;
  if (!gid) return json({ ok: false, error: 'not_in_group' }, 400, allow);

  const g = await env.DB.prepare('SELECT * FROM groups WHERE group_id = ?').bind(gid).first();
  if (!g) return json({ ok: false, error: 'group_not_found' }, 404, allow);

  // 自分のグループ or 閲覧登録済みのみ許可
  if (gid !== self.group_id) {
    const w = await env.DB.prepare('SELECT 1 FROM watching WHERE device_id = ? AND group_id = ?')
      .bind(self.device_id, gid).first();
    if (!w) return json({ ok: false, error: 'not_allowed' }, 403, allow);
  }

  const { results } = await env.DB.prepare(
    `SELECT device_id, member_id, nickname, icon_ver, group_id
       FROM devices WHERE group_id = ? AND banned = 0`
  ).bind(gid).all();

  const rows = await buildRows(env, results || [], g.start_ymd, today, self, !!g.show_weight);
  const totalLoss = rows.filter(r => !r.inactive)
    .reduce((s, r) => s + (r.loss > 0 ? r.loss : 0), 0);

  return json({
    ok: true, today, mode: 'group',
    group: {
      group_id: g.group_id, name: g.name, start_ymd: g.start_ymd,
      show_weight: !!g.show_weight, members: rows.length,
      is_owner: g.owner_id === self.device_id,
      is_mine: gid === self.group_id,
    },
    total_loss: Math.round(totalLoss * 10) / 10,
    rows,
  }, 200, allow);
}

/* メンバー配列 → ランキング行 */
async function buildRows(env, members, startYmd, today, self, showWeight = true) {
  if (!members.length) return [];

  // ブロック中の相手は除外
  const { results: bl } = await env.DB.prepare(
    'SELECT blocked_member_id FROM blocks WHERE device_id = ?'
  ).bind(self.device_id).all();
  const blocked = new Set((bl || []).map(r => r.blocked_member_id));
  const list = members.filter(m => !blocked.has(m.member_id) || m.member_id === self.member_id);
  if (!list.length) return [];

  // ライバル登録済みの相手
  const { results: rv } = await env.DB.prepare(
    'SELECT rival_member_id FROM rivals WHERE device_id = ?'
  ).bind(self.device_id).all();
  const rivalSet = new Set((rv || []).map(r => r.rival_member_id));

  const byDevice = new Map(list.map(m => [m.device_id, m]));
  const rows = [];

  for (const m of list) {
    let sql = 'SELECT ymd, kg FROM weights WHERE device_id = ?';
    const args = [m.device_id];
    const start = startYmd || null;
    if (start) { sql += ' AND ymd >= ?'; args.push(start); }
    sql += ' ORDER BY ymd ASC';
    const { results: ws } = await env.DB.prepare(sql).bind(...args).all();

    const arr = ws || [];
    const first = arr[0] || null;
    const last = arr[arr.length - 1] || null;
    const loss = (first && last) ? Math.round((first.kg - last.kg) * 10) / 10 : null;
    const days = last ? daysBetween(last.ymd, today) : null;
    const inactive = (days === null) || (days > INACTIVE_DAYS);
    const isSelf = m.member_id === self.member_id;
    const visible = showWeight || isSelf;

    rows.push({
      member_id: m.member_id,
      nickname: m.nickname || '名無し',
      icon_ver: m.icon_ver,
      is_self: isSelf,
      is_rival: rivalSet.has(m.member_id),
      loss,
      records: arr.length,
      last_ymd: last ? last.ymd : null,
      days_since: days,
      inactive,
      start_kg: visible && first ? first.kg : undefined,
      latest_kg: visible && last ? last.kg : undefined,
    });
  }

  rows.sort((x, y) => {
    if (x.inactive !== y.inactive) return x.inactive ? 1 : -1;
    const lx = x.loss === null ? -Infinity : x.loss;
    const ly = y.loss === null ? -Infinity : y.loss;
    if (ly !== lx) return ly - lx;
    return (x.nickname || '').localeCompare(y.nickname || '', 'ja');
  });

  let rank = 0, prev = null;
  rows.forEach((r, i) => {
    if (r.inactive) { r.rank = null; return; }
    if (r.loss !== prev) { rank = i + 1; prev = r.loss; }
    r.rank = rank;
  });

  return rows;
}

function daysBetween(ymdA, ymdB) {
  const a = Date.parse(ymdA + 'T00:00:00+09:00');
  const b = Date.parse(ymdB + 'T00:00:00+09:00');
  return Math.round((b - a) / 86400000);
}

/* ===================== /api/watching（他チーム閲覧） ===================== */
async function watching(request, env, allow) {
  const a = await auth(request, env);
  if (a.error) return json({ ok: false, error: a.error }, a.status, allow);
  const self = a.me;

  if (request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT w.group_id, g.name, g.start_ymd, g.show_weight
         FROM watching w JOIN groups g ON g.group_id = w.group_id
        WHERE w.device_id = ? ORDER BY w.created_at ASC`
    ).bind(self.device_id).all();
    return json({ ok: true, watching: results || [] }, 200, allow);
  }

  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'invalid_json' }, 400, allow);
    }
    const code = normalizeCode(body.code);
    if (!code) return json({ ok: false, error: 'bad_code' }, 400, allow);
    if (code === self.group_id) return json({ ok: false, error: 'own_group' }, 400, allow);

    const g = await env.DB.prepare('SELECT group_id, name FROM groups WHERE group_id = ?')
      .bind(code).first();
    if (!g) return json({ ok: false, error: 'group_not_found' }, 404, allow);

    await env.DB.prepare(
      `INSERT INTO watching (device_id, group_id, created_at) VALUES (?, ?, ?)
       ON CONFLICT(device_id, group_id) DO NOTHING`
    ).bind(self.device_id, code, nowIso()).run();
    return json({ ok: true, added: g }, 200, allow);
  }

  if (request.method === 'DELETE') {
    const u = new URL(request.url);
    const code = normalizeCode(u.searchParams.get('group_id'));
    if (!code) return json({ ok: false, error: 'bad_code' }, 400, allow);
    const r = await env.DB.prepare('DELETE FROM watching WHERE device_id = ? AND group_id = ?')
      .bind(self.device_id, code).run();
    return json({ ok: true, removed: r.meta.changes || 0 }, 200, allow);
  }

  return json({ ok: false, error: 'GET, POST or DELETE only' }, 405, allow);
}

/* ===================== /api/rivals ===================== */
async function rivals(request, env, allow) {
  const a = await auth(request, env);
  if (a.error) return json({ ok: false, error: a.error }, a.status, allow);
  const self = a.me;

  if (request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT r.rival_member_id AS member_id, d.nickname, d.icon_ver
         FROM rivals r JOIN devices d ON d.member_id = r.rival_member_id
        WHERE r.device_id = ? ORDER BY r.created_at ASC`
    ).bind(self.device_id).all();
    return json({ ok: true, rivals: results || [] }, 200, allow);
  }

  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'invalid_json' }, 400, allow);
    }
    const target = String(body.member_id || '');
    if (!target) return json({ ok: false, error: 'member_id required' }, 400, allow);
    if (target === self.member_id) return json({ ok: false, error: 'cannot_add_self' }, 400, allow);

    const t = await env.DB.prepare('SELECT 1 FROM devices WHERE member_id = ? AND banned = 0')
      .bind(target).first();
    if (!t) return json({ ok: false, error: 'member_not_found' }, 404, allow);

    await env.DB.prepare(
      `INSERT INTO rivals (device_id, rival_member_id, created_at) VALUES (?, ?, ?)
       ON CONFLICT(device_id, rival_member_id) DO NOTHING`
    ).bind(self.device_id, target, nowIso()).run();
    return json({ ok: true, added: target }, 200, allow);
  }

  if (request.method === 'DELETE') {
    const u = new URL(request.url);
    const target = u.searchParams.get('member_id') || '';
    if (!target) return json({ ok: false, error: 'member_id required' }, 400, allow);
    const r = await env.DB.prepare('DELETE FROM rivals WHERE device_id = ? AND rival_member_id = ?')
      .bind(self.device_id, target).run();
    return json({ ok: true, removed: r.meta.changes || 0 }, 200, allow);
  }

  return json({ ok: false, error: 'GET, POST or DELETE only' }, 405, allow);
}

/* ===================== /api/blocks ===================== */
async function blocks(request, env, allow) {
  const a = await auth(request, env);
  if (a.error) return json({ ok: false, error: a.error }, a.status, allow);
  const self = a.me;

  if (request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT b.blocked_member_id AS member_id, d.nickname
         FROM blocks b LEFT JOIN devices d ON d.member_id = b.blocked_member_id
        WHERE b.device_id = ? ORDER BY b.created_at DESC`
    ).bind(self.device_id).all();
    return json({ ok: true, blocks: results || [] }, 200, allow);
  }

  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'invalid_json' }, 400, allow);
    }
    const target = String(body.member_id || '');
    if (!target) return json({ ok: false, error: 'member_id required' }, 400, allow);
    if (target === self.member_id) return json({ ok: false, error: 'cannot_block_self' }, 400, allow);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO blocks (device_id, blocked_member_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT(device_id, blocked_member_id) DO NOTHING`
      ).bind(self.device_id, target, nowIso()),
      env.DB.prepare('DELETE FROM rivals WHERE device_id = ? AND rival_member_id = ?')
        .bind(self.device_id, target),
    ]);
    return json({ ok: true, blocked: target }, 200, allow);
  }

  if (request.method === 'DELETE') {
    const u = new URL(request.url);
    const target = u.searchParams.get('member_id') || '';
    if (!target) return json({ ok: false, error: 'member_id required' }, 400, allow);
    const r = await env.DB.prepare('DELETE FROM blocks WHERE device_id = ? AND blocked_member_id = ?')
      .bind(self.device_id, target).run();
    return json({ ok: true, removed: r.meta.changes || 0 }, 200, allow);
  }

  return json({ ok: false, error: 'GET, POST or DELETE only' }, 405, allow);
}

/* ===================== /api/reports（通報） ===================== */
async function reports(request, env, allow) {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405, allow);
  const a = await auth(request, env);
  if (a.error) return json({ ok: false, error: a.error }, a.status, allow);
  const self = a.me;

  let body = {};
  try { body = await request.json(); } catch {
    return json({ ok: false, error: 'invalid_json' }, 400, allow);
  }
  const target = String(body.member_id || '');
  const reason = normNickname(body.reason) || '';
  if (!target) return json({ ok: false, error: 'member_id required' }, 400, allow);
  if (!reason) return json({ ok: false, error: 'reason required' }, 400, allow);
  if (target === self.member_id) return json({ ok: false, error: 'cannot_report_self' }, 400, allow);

  const t = await env.DB.prepare('SELECT 1 FROM devices WHERE member_id = ?').bind(target).first();
  if (!t) return json({ ok: false, error: 'member_not_found' }, 404, allow);

  const today = todayYmdJST();
  const dup = await env.DB.prepare(
    'SELECT 1 FROM reports WHERE reporter_id = ? AND target_id = ? AND ymd = ?'
  ).bind(self.member_id, target, today).first();
  if (dup) return json({ ok: false, error: 'already_reported_today' }, 409, allow);

  await env.DB.prepare(
    `INSERT INTO reports (reporter_id, target_id, ymd, reason, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(self.member_id, target, today, reason.slice(0, 200), nowIso()).run();

  return json({ ok: true, reported: true }, 200, allow);
}
