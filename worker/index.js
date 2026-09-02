import {
  pickOrigin, corsHeaders, json, auth, pubMe,
  todayYmdJST, isValidYmd, nowIso, normKg, normNickname, randomCode,
} from './lib.js';

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
      if (path === '/api/register') return await register(request, env, allow);
      if (path === '/api/me')       return await me(request, env, allow);
      if (path === '/api/weights')  return await weights(request, env, allow);

      const m = path.match(/^\/api\/weights\/(.+)$/);
      if (m) return await weightDelete(request, env, allow, decodeURIComponent(m[1]));

      return json({ ok: false, error: 'not_found', path }, 404, allow);
    } catch (e) {
      return json({ ok: false, error: 'server_error', detail: String(e?.message || e) }, 500, allow);
    }
  },
};

/* ================= /api/register ================= */
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

  for (let i = 0; i < 3; i++) {
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

/* ================= /api/me ================= */
async function me(request, env, allow) {
  const a = await auth(request, env);
  if (a.error) return json({ ok: false, error: a.error }, a.status, allow);
  const self = a.me;

  if (request.method === 'GET') {
    const g = self.group_id
      ? await env.DB.prepare(
          'SELECT group_id, name, show_weight, start_ymd, owner_id FROM groups WHERE group_id = ?'
        ).bind(self.group_id).first()
      : null;
    return json({
      ok: true, today: todayYmdJST(), me: pubMe(self),
      group: g ? {
        group_id: g.group_id, name: g.name, show_weight: !!g.show_weight,
        start_ymd: g.start_ymd, is_owner: g.owner_id === self.device_id,
      } : null,
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
      if (body.goal_weight === null) sets.push('goal_weight = NULL');
      else {
        const v = normKg(body.goal_weight);
        if (v === null) return json({ ok: false, error: 'bad_goal_weight' }, 400, allow);
        sets.push('goal_weight = ?'); args.push(v);
      }
    }
    if ('notify_on' in body) { sets.push('notify_on = ?'); args.push(body.notify_on ? 1 : 0); }
    if ('notify_days' in body) {
      const d = Number(body.notify_days);
      if (!Number.isInteger(d) || d < 1 || d > 14) return json({ ok: false, error: 'bad_notify_days' }, 400, allow);
      sets.push('notify_days = ?'); args.push(d);
    }
    if ('notify_hour' in body) {
      const h = Number(body.notify_hour);
      if (!Number.isInteger(h) || h < 0 || h > 23) return json({ ok: false, error: 'bad_notify_hour' }, 400, allow);
      sets.push('notify_hour = ?'); args.push(h);
    }
    if (!sets.length) return json({ ok: false, error: 'nothing_to_update' }, 400, allow);

    sets.push('last_seen_at = ?'); args.push(nowIso());
    args.push(self.device_id);
    await env.DB.prepare(`UPDATE devices SET ${sets.join(', ')} WHERE device_id = ?`)
      .bind(...args).run();

    const row = await env.DB.prepare('SELECT * FROM devices WHERE device_id = ?')
      .bind(self.device_id).first();
    return json({ ok: true, me: pubMe(row) }, 200, allow);
  }

  /* 全データ削除（ストア審査で必須） */
  if (request.method === 'DELETE') {
    const stmts = [];
    const owned = await env.DB.prepare('SELECT group_id FROM groups WHERE owner_id = ?')
      .bind(self.device_id).first();

    if (owned) {   // オーナーが消えたらグループは自動解散。weights は触らない
      stmts.push(
        env.DB.prepare('UPDATE devices SET group_id = NULL, joined_at = NULL WHERE group_id = ?').bind(owned.group_id),
        env.DB.prepare('DELETE FROM watching WHERE group_id = ?').bind(owned.group_id),
        env.DB.prepare('DELETE FROM group_bans WHERE group_id = ?').bind(owned.group_id),
        env.DB.prepare('DELETE FROM groups WHERE group_id = ?').bind(owned.group_id),
      );
    }
    stmts.push(
      env.DB.prepare('DELETE FROM weights  WHERE device_id = ?').bind(self.device_id),
      env.DB.prepare('DELETE FROM watching WHERE device_id = ?').bind(self.device_id),
      env.DB.prepare('DELETE FROM rivals   WHERE device_id = ?').bind(self.device_id),
      env.DB.prepare('DELETE FROM rivals   WHERE rival_member_id = ?').bind(self.member_id),
      env.DB.prepare('DELETE FROM blocks   WHERE device_id = ?').bind(self.device_id),
      env.DB.prepare('DELETE FROM blocks   WHERE blocked_member_id = ?').bind(self.member_id),
      env.DB.prepare('DELETE FROM group_bans WHERE member_id = ?').bind(self.member_id),
      env.DB.prepare('DELETE FROM reports  WHERE reporter_id = ? OR target_id = ?').bind(self.device_id, self.device_id),
      env.DB.prepare('DELETE FROM devices  WHERE device_id = ?').bind(self.device_id),
    );
    await env.DB.batch(stmts);
    if (env.ICONS) { try { await env.ICONS.delete(`icon/${self.member_id}.jpg`); } catch {} }

    return json({ ok: true, deleted: true, dissolved_group: owned?.group_id || null }, 200, allow);
  }

  return json({ ok: false, error: 'GET, PATCH or DELETE' }, 405, allow);
}

/* ================= /api/weights ================= */
async function weights(request, env, allow) {
  const a = await auth(request, env);
  if (a.error) return json({ ok: false, error: a.error }, a.status, allow);
  const self = a.me;

  if (request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'invalid_json' }, 400, allow);
    }
    const today = todayYmdJST();
    const ymd = body.ymd || today;
    if (!isValidYmd(ymd)) return json({ ok: false, error: 'bad_ymd' }, 400, allow);
    if (ymd > today) return json({ ok: false, error: 'future_date' }, 400, allow);

    const kg = normKg(body.kg);
    if (kg === null) return json({ ok: false, error: 'bad_kg' }, 400, allow);

    const now = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO weights (device_id, ymd, kg, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(device_id, ymd) DO UPDATE SET kg = excluded.kg, updated_at = excluded.updated_at`
      ).bind(self.device_id, ymd, kg, now),
      env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE device_id = ?')
        .bind(now, self.device_id),
    ]);
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
    return json({ ok: true, today: todayYmdJST(), weights: results || [] }, 200, allow);
  }

  return json({ ok: false, error: 'GET or POST only' }, 405, allow);
}

/* ================= /api/weights/:ymd ================= */
async function weightDelete(request, env, allow, ymd) {
  if (request.method !== 'DELETE') return json({ ok: false, error: 'DELETE only' }, 405, allow);
  const a = await auth(request, env);
  if (a.error) return json({ ok: false, error: a.error }, a.status, allow);
  if (!isValidYmd(ymd)) return json({ ok: false, error: 'bad_ymd' }, 400, allow);

  const r = await env.DB.prepare('DELETE FROM weights WHERE device_id = ? AND ymd = ?')
    .bind(a.me.device_id, ymd).run();
  return json({ ok: true, deleted: r.meta.changes || 0 }, 200, allow);
}
