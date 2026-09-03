'use strict';

import {
  INACTIVE_DAYS, CODE_LEN,
  json, bad, preflight, notFound,
  todayYmdJST, isYmd, ymdToDay, round1,
  normKg, normNickname, normGroupName, normReason,
  normalizeCode, fmtCode, genCode, genId, rateOk,
  isBanned,
} from './lib.js';

/* ============================================================
   つだつダイエット部 / worker/index.js
   ============================================================ */

/* ---------- アイコン設定 ---------- */
const ICON_MAX_BYTES = 300 * 1024;   // クライアントで256px/JPEG化した後の上限
const ICON_PREFIX = 'icon/';         // R2キー: icon/{member_id}.jpg
const ICON_PUBLIC = '/i/';           // 公開GETパス: /i/{member_id}.jpg

function iconKey(memberId) {
  return ICON_PREFIX + memberId + '.jpg';
}

// member_id は genId(10) 由来（CODE_ALPHABET の大文字英数）。念のため幅を持たせる
function isMemberId(s) {
  return typeof s === 'string' && /^[0-9A-Z]{6,32}$/.test(s);
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return preflight(req);

    const url = new URL(req.url);

    /* アイコン取得は <img> から呼ばれるため x-device-id を付けられない。
       認証なしの公開ルートとして /api/ の手前で処理する。
       member_id は32文字アルファベットの10桁で推測できないため実害はない。 */
    if (url.pathname.startsWith(ICON_PUBLIC)) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return new Response('method_not_allowed', { status: 405 });
      }
      try {
        return await getIcon(req, env, url);
      } catch (e) {
        // 内部の例外文はクライアントに返さない（ログにだけ残す）
        console.error('icon_error', url.pathname, (e && e.stack) || e);
        return new Response('icon_error', { status: 500 });
      }
    }

    if (!url.pathname.startsWith('/api/')) {
      if (env.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(req);
      return notFound(req);
    }

    try {
      return await route(req, env, url);
    } catch (e) {
      // 内部の例外文はクライアントに返さない（ログにだけ残す）
      console.error('api_error', url.pathname, req.method, (e && e.stack) || e);
      return json(req, { ok: false, error: 'server_error' }, 500);
    }
  },
};

/* ============================================================
   アイコン（GET は公開 / POST・DELETE は本人のみ）
   ============================================================ */
async function getIcon(req, env, url) {
  const raw = decodeURIComponent(url.pathname.slice(ICON_PUBLIC.length));
  const mid = raw.replace(/\.jpe?g$/i, '').toUpperCase();
  if (!isMemberId(mid)) return new Response('bad_member_id', { status: 400 });
  if (!env.ICONS) return new Response('no_bucket', { status: 503 });

  const obj = await env.ICONS.get(iconKey(mid));
  if (!obj) return new Response('not_found', { status: 404 });

  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set('content-type', 'image/jpeg');
  h.set('etag', obj.httpEtag);
  // URL に ?v={icon_ver} が付く運用なので長期キャッシュで問題ない
  h.set('cache-control', 'public, max-age=31536000, immutable');
  h.set('access-control-allow-origin', '*');

  if (req.method === 'HEAD') return new Response(null, { status: 200, headers: h });
  return new Response(obj.body, { status: 200, headers: h });
}

async function putIcon(req, env, dev) {
  if (!env.ICONS) return bad(req, 'no_bucket', 503);
  if (!await rateOk(env, 'icon:' + dev.device_id)) return bad(req, 'rate_limited', 429);

  const len = Number(req.headers.get('content-length') || 0);
  if (len && len > ICON_MAX_BYTES) return bad(req, 'icon_too_large', 413);

  const buf = await req.arrayBuffer();
  if (buf.byteLength === 0) return bad(req, 'icon_empty');
  if (buf.byteLength > ICON_MAX_BYTES) return bad(req, 'icon_too_large', 413);

  // JPEG のマジックバイトだけ検査する。画像処理はクライアント側（Worker の CPU 時間を使わない）
  const b = new Uint8Array(buf);
  if (!(b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)) {
    return bad(req, 'not_jpeg');
  }

  await env.ICONS.put(iconKey(dev.member_id), buf, {
    httpMetadata: { contentType: 'image/jpeg' },
  });

  const ver = Number(dev.icon_ver || 0) + 1;
  await env.DB.prepare('UPDATE devices SET icon_ver=? WHERE device_id=?')
    .bind(ver, dev.device_id).run();

  return json(req, {
    ok: true,
    icon_ver: ver,
    icon_url: ICON_PUBLIC + dev.member_id + '.jpg?v=' + ver,
    bytes: buf.byteLength,
  });
}

async function deleteIcon(req, env, dev) {
  if (!env.ICONS) return bad(req, 'no_bucket', 503);
  await env.ICONS.delete(iconKey(dev.member_id));
  // icon_ver=0 は「未設定」。クライアントはデフォルトアイコンを出す
  await env.DB.prepare('UPDATE devices SET icon_ver=0 WHERE device_id=?').bind(dev.device_id).run();
  return json(req, { ok: true, icon_ver: 0 });
}

// R2 削除は失敗しても本処理を止めない（孤児オブジェクトは⑦の管理画面で掃除）
async function tryDeleteIconObject(env, memberId) {
  try {
    if (env.ICONS && memberId) await env.ICONS.delete(iconKey(memberId));
  } catch (e) { /* noop */ }
}

/* ---------- 小物 ---------- */
async function readBody(req) {
  try {
    const b = await req.json();
    return (b && typeof b === 'object') ? b : {};
  } catch {
    return {};
  }
}

function num(v) {
  return v === null || v === undefined ? null : Number(v);
}

function publicMe(dev) {
  const ver = Number(dev.icon_ver || 0);
  return {
    member_id: dev.member_id,
    nickname: dev.nickname || null,
    icon_ver: ver,
    icon_url: ver > 0 ? ICON_PUBLIC + dev.member_id + '.jpg?v=' + ver : null,
    goal_weight: dev.goal_weight === null || dev.goal_weight === undefined ? null : Number(dev.goal_weight),
    notify_on: Number(dev.notify_on || 0) === 1,
    notify_days: Number(dev.notify_days || 3),
    notify_hour: Number(dev.notify_hour || 20),
    in_group: !!dev.group_id,
    joined_at: dev.joined_at || null,
  };
}

// 一覧系で使う共通のアイコンURL生成（icon_ver=0 は null → デフォルトアイコン）
function iconUrlOf(memberId, iconVer) {
  const v = Number(iconVer || 0);
  if (!memberId || v <= 0) return null;
  return ICON_PUBLIC + memberId + '.jpg?v=' + v;
}

function isOwnerOf(group, dev) {
  // owner_id は member_id 運用。過去に device_id が入っている行があっても拾う
  return group.owner_id === dev.member_id || group.owner_id === dev.device_id;
}

/* ---------- 端末 ---------- */
async function getDevice(env, deviceId) {
  return await env.DB.prepare('SELECT * FROM devices WHERE device_id=?').bind(deviceId).first();
}

async function ensureDevice(env, deviceId) {
  const now = Date.now();
  let dev = await getDevice(env, deviceId);
  if (dev) {
    await env.DB.prepare('UPDATE devices SET last_seen_at=? WHERE device_id=?').bind(now, deviceId).run();
    dev.last_seen_at = now;
    return dev;
  }
  for (let i = 0; i < 8; i++) {
    const mid = genId(10);
    try {
      await env.DB.prepare(
        'INSERT INTO devices (device_id,member_id,icon_ver,notify_on,notify_days,notify_hour,banned,created_at,last_seen_at) VALUES (?,?,0,0,3,20,0,?,?)'
      ).bind(deviceId, mid, now, now).run();
      return await getDevice(env, deviceId);
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (!/UNIQUE/i.test(msg)) throw e;
      const again = await getDevice(env, deviceId);
      if (again) return again;      // 同時登録
    }
  }
  throw new Error('member_id_alloc_failed');
}

/* ============================================================
   ルーティング
   ============================================================ */
async function route(req, env, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/api';
  const m = req.method;

  const deviceId = (req.headers.get('x-device-id') || '').trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) return bad(req, 'bad_device_id');

  /* 登録 */
  if (p === '/api/register' && m === 'POST') {
    const dev = await ensureDevice(env, deviceId);
    if (Number(dev.banned) === 1) return bad(req, 'banned', 403);
    return json(req, { ok: true, me: publicMe(dev), group: await groupView(env, dev) });
  }

  const dev = await getDevice(env, deviceId);
  if (!dev) return bad(req, 'not_registered', 404);
  if (Number(dev.banned) === 1) return bad(req, 'banned', 403);

  /* ---------- 自分 ---------- */
  if (p === '/api/me') {
    if (m === 'GET') return json(req, { ok: true, me: publicMe(dev), group: await groupView(env, dev) });
    if (m === 'PATCH') return await patchMe(req, env, dev);
    if (m === 'DELETE') return await deleteMe(req, env, dev);
  }

  /* ---------- アイコン ---------- */
  if (p === '/api/icon') {
    if (m === 'POST' || m === 'PUT') return await putIcon(req, env, dev);
    if (m === 'DELETE') return await deleteIcon(req, env, dev);
    if (m === 'GET') {
      const ver = Number(dev.icon_ver || 0);
      return json(req, {
        ok: true,
        icon_ver: ver,
        icon_url: iconUrlOf(dev.member_id, ver),
        max_bytes: ICON_MAX_BYTES,
      });
    }
  }

  /* ---------- 体重 ---------- */
  if (p === '/api/weights') {
    if (m === 'GET') {
      const rs = await env.DB.prepare('SELECT ymd,kg FROM weights WHERE device_id=? ORDER BY ymd ASC')
        .bind(dev.device_id).all();
      return json(req, { ok: true, weights: (rs.results || []).map(r => ({ ymd: r.ymd, kg: Number(r.kg) })) });
    }
    if (m === 'POST') return await putWeight(req, env, dev);
    if (m === 'DELETE') {
      const b = await readBody(req);
      return await delWeight(req, env, dev, String(b.ymd || ''));
    }
  }
  if (p.startsWith('/api/weights/') && m === 'DELETE') {
    return await delWeight(req, env, dev, decodeURIComponent(p.slice('/api/weights/'.length)));
  }

  /* ---------- グループ ---------- */
  if (p === '/api/groups') {
    if (m === 'GET') {
      const code = url.searchParams.get('code');
      if (code) return await findGroup(req, env, dev, code);
      return json(req, { ok: true, group: await groupView(env, dev) });
    }
    if (m === 'POST')   return await createGroup(req, env, dev);
    if (m === 'PATCH')  return await patchGroup(req, env, dev);
    if (m === 'DELETE') return await dissolveGroup(req, env, dev);
  }
  if (p === '/api/groups/create'   && m === 'POST') return await createGroup(req, env, dev);
  if (p === '/api/groups/join'     && m === 'POST') return await joinGroup(req, env, dev);
  if (p === '/api/groups/leave'    && m === 'POST') return await leaveGroup(req, env, dev);
  if (p === '/api/groups/rename'   && m === 'POST') return await patchGroup(req, env, dev);
  if (p === '/api/groups/start'    && m === 'POST') return await patchGroup(req, env, dev);
  if (p === '/api/groups/kick'     && m === 'POST') return await kickMember(req, env, dev);
  if (p === '/api/groups/unban'    && m === 'POST') return await unbanMember(req, env, dev);
  if (p === '/api/groups/dissolve' && m === 'POST') return await dissolveGroup(req, env, dev);
  if (p === '/api/groups/bans'     && m === 'GET')  return await listBans(req, env, dev);

  /* ---------- ランキング ---------- */
  if (p === '/api/ranking' && m === 'GET') return await ranking(req, env, dev, url);

  /* ---------- 他チーム購読 ---------- */
  if (p === '/api/watching') {
    if (m === 'GET')    return await listWatching(req, env, dev);
    if (m === 'POST')   return await addWatching(req, env, dev);
    if (m === 'DELETE') {
      const b = await readBody(req);
      return await delWatching(req, env, dev, String(b.group_id || ''));
    }
  }
  if (p.startsWith('/api/watching/') && m === 'DELETE') {
    return await delWatching(req, env, dev, decodeURIComponent(p.slice('/api/watching/'.length)));
  }

  /* ---------- ライバル ---------- */
  if (p === '/api/rivals') {
    if (m === 'GET')    return await listRivals(req, env, dev);
    if (m === 'POST')   return await addRival(req, env, dev);
    if (m === 'DELETE') {
      const b = await readBody(req);
      return await delRival(req, env, dev, String(b.member_id || ''));
    }
  }
  if (p.startsWith('/api/rivals/') && m === 'DELETE') {
    return await delRival(req, env, dev, decodeURIComponent(p.slice('/api/rivals/'.length)));
  }

  /* ---------- ブロック ---------- */
  if (p === '/api/blocks') {
    if (m === 'GET')    return await listBlocks(req, env, dev);
    if (m === 'POST')   return await addBlock(req, env, dev);
    if (m === 'DELETE') {
      const b = await readBody(req);
      return await delBlock(req, env, dev, String(b.member_id || ''));
    }
  }
  if (p.startsWith('/api/blocks/') && m === 'DELETE') {
    return await delBlock(req, env, dev, decodeURIComponent(p.slice('/api/blocks/'.length)));
  }

  /* ---------- 通報 ---------- */
  if (p === '/api/reports' && m === 'POST') return await addReport(req, env, dev);

  return notFound(req);
}

/* ============================================================
   自分
   ============================================================ */
async function patchMe(req, env, dev) {
  const b = await readBody(req);
  const sets = [], vals = [];

  if ('nickname' in b) {
    if (b.nickname === null || b.nickname === '') { sets.push('nickname=?'); vals.push(null); }
    else {
      const nk = normNickname(b.nickname);
      // normNickname は NG語・連絡先混入でも null を返す。
      // 「入力してください」では意味が通らないので理由を分けて返す
      if (!nk) return bad(req, isBanned(b.nickname) ? 'ng_word' : 'bad_nickname');
      sets.push('nickname=?'); vals.push(nk);
    }
  }
  if ('goal_weight' in b) {
    if (b.goal_weight === null || b.goal_weight === '') { sets.push('goal_weight=?'); vals.push(null); }
    else {
      const g = normKg(b.goal_weight);
      if (g === null) return bad(req, 'bad_kg');
      sets.push('goal_weight=?'); vals.push(g);
    }
  }
  if ('notify_on' in b)   { sets.push('notify_on=?');   vals.push(b.notify_on ? 1 : 0); }
  if ('notify_days' in b) {
    const d = Number(b.notify_days);
    if (![3, 7].includes(d)) return bad(req, 'bad_notify');
    sets.push('notify_days=?'); vals.push(d);
  }
  if ('notify_hour' in b) {
    const h = Number(b.notify_hour);
    if (!Number.isInteger(h) || h < 0 || h > 23) return bad(req, 'bad_notify');
    sets.push('notify_hour=?'); vals.push(h);
  }

  if (sets.length) {
    vals.push(dev.device_id);
    await env.DB.prepare(`UPDATE devices SET ${sets.join(',')} WHERE device_id=?`).bind(...vals).run();
  }
  const fresh = await getDevice(env, dev.device_id);
  return json(req, { ok: true, me: publicMe(fresh) });
}

async function deleteMe(req, env, dev) {
  // オーナーなら先に解散（グループを孤児にしない）
  if (dev.group_id) {
    const g = await env.DB.prepare('SELECT * FROM groups WHERE group_id=?').bind(dev.group_id).first();
    if (g && isOwnerOf(g, dev)) await doDissolve(env, g.group_id);
  }
  // R2 のアイコンも消す（D1 の行を消すと二度と辿れなくなるので先に）
  await tryDeleteIconObject(env, dev.member_id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM weights  WHERE device_id=?').bind(dev.device_id),
    env.DB.prepare('DELETE FROM watching WHERE device_id=?').bind(dev.device_id),
    env.DB.prepare('DELETE FROM rivals   WHERE device_id=?').bind(dev.device_id),
    env.DB.prepare('DELETE FROM blocks   WHERE device_id=?').bind(dev.device_id),
    env.DB.prepare('DELETE FROM rivals   WHERE rival_member_id=?').bind(dev.member_id),
    env.DB.prepare('DELETE FROM blocks   WHERE blocked_member_id=?').bind(dev.member_id),
    env.DB.prepare('DELETE FROM devices  WHERE device_id=?').bind(dev.device_id),
  ]);
  return json(req, { ok: true, deleted: true });
}

/* ============================================================
   体重
   ============================================================ */
async function putWeight(req, env, dev) {
  const b = await readBody(req);
  const ymd = String(b.ymd || '');
  if (!isYmd(ymd)) return bad(req, 'bad_ymd');
  if (ymd > todayYmdJST()) return bad(req, 'future_ymd');
  const kg = normKg(b.kg);
  if (kg === null) return bad(req, 'bad_kg');

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO weights (device_id,ymd,kg,updated_at) VALUES (?,?,?,?)
       ON CONFLICT(device_id,ymd) DO UPDATE SET kg=excluded.kg, updated_at=excluded.updated_at`
    ).bind(dev.device_id, ymd, kg, now),
    env.DB.prepare('UPDATE devices SET last_seen_at=? WHERE device_id=?').bind(now, dev.device_id),
  ]);

  // ④の演出用：直前の実測記録と目標を返す（クライアントは使わなくても害なし）
  const prev = await env.DB.prepare(
    'SELECT ymd,kg FROM weights WHERE device_id=? AND ymd<? ORDER BY ymd DESC LIMIT 1'
  ).bind(dev.device_id, ymd).first();

  const goal = dev.goal_weight === null || dev.goal_weight === undefined ? null : Number(dev.goal_weight);
  return json(req, {
    ok: true, ymd, kg,
    prev: prev ? { ymd: prev.ymd, kg: Number(prev.kg) } : null,
    diff: prev ? round1(kg - Number(prev.kg)) : null,
    goal_weight: goal,
    to_goal: goal === null ? null : round1(kg - goal),
  });
}

async function delWeight(req, env, dev, ymd) {
  if (!isYmd(ymd)) return bad(req, 'bad_ymd');
  await env.DB.prepare('DELETE FROM weights WHERE device_id=? AND ymd=?').bind(dev.device_id, ymd).run();
  return json(req, { ok: true, ymd });
}

/* ============================================================
   グループ
   ============================================================ */
async function groupView(env, dev) {
  if (!dev.group_id) return null;
  const g = await env.DB.prepare('SELECT * FROM groups WHERE group_id=?').bind(dev.group_id).first();
  if (!g) return null;
  const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices WHERE group_id=? AND banned=0')
    .bind(g.group_id).first();
  const owner = isOwnerOf(g, dev);
  return {
    group_id: g.group_id,
    name: g.name,
    start_ymd: g.start_ymd,
    show_weight: Number(g.show_weight) === 1,
    max_members: Number(g.max_members || 100),
    members: Number(c ? c.n : 0),
    is_owner: owner,
    code: owner ? fmtCode(g.group_id) : null,   // 参加コードはオーナーにだけ返す
  };
}

async function createGroup(req, env, dev) {
  if (dev.group_id) return bad(req, 'already_in_group');
  if (!await rateOk(env, 'create:' + dev.device_id)) return bad(req, 'rate_limited', 429);

  const b = await readBody(req);
  const name = normGroupName(b.name);
  if (!name) return bad(req, isBanned(b.name) ? 'ng_word' : 'bad_name');

  const start = isYmd(b.start_ymd) ? b.start_ymd : todayYmdJST();
  const show = (b.show_weight === undefined || b.show_weight === null) ? 1 : (b.show_weight ? 1 : 0);
  const now = Date.now();

  let gid = null;
  for (let i = 0; i < 8; i++) {
    const cand = genCode();
    const hit = await env.DB.prepare('SELECT group_id FROM groups WHERE group_id=?').bind(cand).first();
    if (!hit) { gid = cand; break; }
  }
  if (!gid) return bad(req, 'code_alloc_failed', 500);

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO groups (group_id,name,owner_id,show_weight,start_ymd,max_members,created_at) VALUES (?,?,?,?,?,100,?)'
    ).bind(gid, name, dev.member_id, show, start, now),
    env.DB.prepare('UPDATE devices SET group_id=?, joined_at=? WHERE device_id=?').bind(gid, now, dev.device_id),
  ]);

  const fresh = await getDevice(env, dev.device_id);
  return json(req, { ok: true, group: await groupView(env, fresh) });
}

async function joinGroup(req, env, dev) {
  if (dev.group_id) return bad(req, 'already_in_group');
  if (!await rateOk(env, 'join:' + dev.device_id)) return bad(req, 'rate_limited', 429);

  const b = await readBody(req);
  const gid = normalizeCode(b.code);
  if (!gid) return bad(req, 'bad_code');

  const g = await env.DB.prepare('SELECT * FROM groups WHERE group_id=?').bind(gid).first();
  if (!g) return bad(req, 'group_not_found', 404);

  const banned = await env.DB.prepare('SELECT member_id FROM group_bans WHERE group_id=? AND member_id=?')
    .bind(gid, dev.member_id).first();
  if (banned) return bad(req, 'banned_from_group', 403);

  const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices WHERE group_id=? AND banned=0')
    .bind(gid).first();
  if (Number(c ? c.n : 0) >= Number(g.max_members || 100)) return bad(req, 'group_full');

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE devices SET group_id=?, joined_at=? WHERE device_id=?').bind(gid, now, dev.device_id),
    env.DB.prepare('DELETE FROM watching WHERE device_id=? AND group_id=?').bind(dev.device_id, gid),
  ]);

  const fresh = await getDevice(env, dev.device_id);
  return json(req, { ok: true, group: await groupView(env, fresh) });
}

async function leaveGroup(req, env, dev) {
  if (!dev.group_id) return bad(req, 'not_in_group');
  const g = await env.DB.prepare('SELECT * FROM groups WHERE group_id=?').bind(dev.group_id).first();
  if (g && isOwnerOf(g, dev)) return bad(req, 'owner_must_dissolve');
  await env.DB.prepare('UPDATE devices SET group_id=NULL, joined_at=NULL WHERE device_id=?')
    .bind(dev.device_id).run();
  return json(req, { ok: true, group: null });
}

async function requireOwnedGroup(env, dev) {
  if (!dev.group_id) return { error: 'not_in_group' };
  const g = await env.DB.prepare('SELECT * FROM groups WHERE group_id=?').bind(dev.group_id).first();
  if (!g) return { error: 'group_not_found' };
  if (!isOwnerOf(g, dev)) return { error: 'not_owner' };
  return { group: g };
}

async function patchGroup(req, env, dev) {
  const r = await requireOwnedGroup(env, dev);
  if (r.error) return bad(req, r.error, r.error === 'not_owner' ? 403 : 400);

  const b = await readBody(req);
  const sets = [], vals = [];
  if ('name' in b) {
    const nm = normGroupName(b.name);
    if (!nm) return bad(req, isBanned(b.name) ? 'ng_word' : 'bad_name');
    sets.push('name=?'); vals.push(nm);
  }
  if ('start_ymd' in b) {
    if (!isYmd(b.start_ymd)) return bad(req, 'bad_ymd');
    sets.push('start_ymd=?'); vals.push(b.start_ymd);
  }
  // show_weight は作成後に変更できない仕様（あとから公開に変えると過去分が漏れる）
  if (!sets.length) return bad(req, 'nothing_to_update');

  vals.push(r.group.group_id);
  await env.DB.prepare(`UPDATE groups SET ${sets.join(',')} WHERE group_id=?`).bind(...vals).run();

  const fresh = await getDevice(env, dev.device_id);
  return json(req, { ok: true, group: await groupView(env, fresh) });
}

async function kickMember(req, env, dev) {
  const r = await requireOwnedGroup(env, dev);
  if (r.error) return bad(req, r.error, r.error === 'not_owner' ? 403 : 400);

  const b = await readBody(req);
  const mid = String(b.member_id || '').trim();
  if (!mid) return bad(req, 'bad_member_id');
  if (mid === dev.member_id) return bad(req, 'cannot_kick_self');

  const target = await env.DB.prepare('SELECT device_id,group_id FROM devices WHERE member_id=?').bind(mid).first();
  if (!target || target.group_id !== r.group.group_id) return bad(req, 'not_in_group', 404);

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO group_bans (group_id,member_id,by_admin,created_at) VALUES (?,?,0,?)')
      .bind(r.group.group_id, mid, now),
    env.DB.prepare('UPDATE devices SET group_id=NULL, joined_at=NULL WHERE member_id=?').bind(mid),
  ]);
  return json(req, { ok: true, member_id: mid });
}

async function unbanMember(req, env, dev) {
  const r = await requireOwnedGroup(env, dev);
  if (r.error) return bad(req, r.error, r.error === 'not_owner' ? 403 : 400);

  const b = await readBody(req);
  const mid = String(b.member_id || '').trim();
  if (!mid) return bad(req, 'bad_member_id');

  await env.DB.prepare('DELETE FROM group_bans WHERE group_id=? AND member_id=?')
    .bind(r.group.group_id, mid).run();
  return json(req, { ok: true, member_id: mid });
}

async function listBans(req, env, dev) {
  const r = await requireOwnedGroup(env, dev);
  if (r.error) return bad(req, r.error, r.error === 'not_owner' ? 403 : 400);

  const rs = await env.DB.prepare(
    `SELECT b.member_id, b.created_at, d.nickname, d.icon_ver
       FROM group_bans b LEFT JOIN devices d ON d.member_id=b.member_id
      WHERE b.group_id=? ORDER BY b.created_at DESC`
  ).bind(r.group.group_id).all();

  return json(req, {
    ok: true,
    bans: (rs.results || []).map(x => ({
      member_id: x.member_id,
      nickname: x.nickname || null,
      icon_ver: Number(x.icon_ver || 0),
      icon_url: iconUrlOf(x.member_id, x.icon_ver),
      created_at: x.created_at || null,
    })),
  });
}

async function doDissolve(env, gid) {
  await env.DB.batch([
    env.DB.prepare('UPDATE devices SET group_id=NULL, joined_at=NULL WHERE group_id=?').bind(gid),
    env.DB.prepare('DELETE FROM group_bans WHERE group_id=?').bind(gid),
    env.DB.prepare('DELETE FROM watching   WHERE group_id=?').bind(gid),
    env.DB.prepare('DELETE FROM groups     WHERE group_id=?').bind(gid),
  ]);
}

async function dissolveGroup(req, env, dev) {
  const r = await requireOwnedGroup(env, dev);
  if (r.error) return bad(req, r.error, r.error === 'not_owner' ? 403 : 400);
  await doDissolve(env, r.group.group_id);
  return json(req, { ok: true, group: null });
}

async function findGroup(req, env, dev, rawCode) {
  const gid = normalizeCode(rawCode);
  if (!gid) return bad(req, 'bad_code');
  const g = await env.DB.prepare('SELECT group_id,name,start_ymd,show_weight FROM groups WHERE group_id=?')
    .bind(gid).first();
  if (!g) return bad(req, 'group_not_found', 404);
  const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices WHERE group_id=? AND banned=0')
    .bind(gid).first();
  return json(req, {
    ok: true,
    group: {
      group_id: g.group_id,
      name: g.name,
      start_ymd: g.start_ymd,
      show_weight: Number(g.show_weight) === 1,
      members: Number(c ? c.n : 0),
      is_mine: dev.group_id === g.group_id,
    },
  });
}

/* ============================================================
   減量幅の集計
   loss = (スタート日以降の最初の実測) − (最新の実測)
   → 正の値 = 減った / 負の値 = 増えた
   スタート日以降の記録が2件未満なら loss は null（増減が測れない）
   ============================================================ */
async function lossStats(env, deviceIds, startYmd) {
  const map = new Map();
  if (!deviceIds.length) return map;

  const ph = deviceIds.map(() => '?').join(',');
  const sql = `
    SELECT device_id, ymd, kg FROM (
      SELECT device_id, ymd, kg,
             ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY ymd ASC)  AS ra,
             ROW_NUMBER() OVER (PARTITION BY device_id ORDER BY ymd DESC) AS rd
        FROM weights
       WHERE device_id IN (${ph}) AND ymd >= ?
    ) WHERE ra = 1 OR rd = 1`;

  const rs = await env.DB.prepare(sql).bind(...deviceIds, startYmd || '1900-01-01').all();
  for (const r of (rs.results || [])) {
    const kg = Number(r.kg);
    let e = map.get(r.device_id);
    if (!e) { e = { first: null, last: null }; map.set(r.device_id, e); }
    if (!e.first || r.ymd < e.first.ymd) e.first = { ymd: r.ymd, kg };
    if (!e.last  || r.ymd > e.last.ymd)  e.last  = { ymd: r.ymd, kg };
  }
  return map;
}

function buildEntry(memberRow, stat, todayDay, showKg, isSelf, isRival) {
  const hasPair = !!(stat && stat.first && stat.last && stat.first.ymd !== stat.last.ymd);
  const loss = hasPair ? round1(stat.first.kg - stat.last.kg) : null;
  const lastYmd = stat && stat.last ? stat.last.ymd : null;
  const idle = lastYmd === null ? null : todayDay - ymdToDay(lastYmd);
  // 「14日間入力なし」で休止（最後の記録から14日経過した時点）
  const inactive = idle === null ? true : idle >= INACTIVE_DAYS;

  return {
    member_id: memberRow.member_id,
    nickname: memberRow.nickname || null,
    icon_ver: Number(memberRow.icon_ver || 0),
    icon_url: iconUrlOf(memberRow.member_id, memberRow.icon_ver),
    loss,
    start_kg: (showKg && stat && stat.first) ? stat.first.kg : null,
    latest_kg: (showKg && stat && stat.last) ? stat.last.kg : null,
    start_ymd: stat && stat.first ? stat.first.ymd : null,
    last_ymd: lastYmd,
    idle_days: idle,
    inactive,
    is_self: !!isSelf,
    is_rival: !!isRival,
    rank: null,
  };
}

function finishRows(entries) {
  // 集計は「休止中でも有効な記録があれば対象」／純増減の合算
  const vals = entries.filter(e => e.loss !== null).map(e => e.loss);
  const total = vals.length ? round1(vals.reduce((a, b) => a + b, 0)) : 0;
  const avg = vals.length ? round1(total / vals.length) : null;

  const active = entries.filter(e => !e.inactive && e.loss !== null)
    .sort((a, b) => b.loss - a.loss);
  const rest = entries.filter(e => e.inactive || e.loss === null)
    .sort((a, b) => {
      if (a.loss !== null && b.loss !== null) return b.loss - a.loss;
      if (a.loss !== null) return -1;
      if (b.loss !== null) return 1;
      return String(a.nickname || '').localeCompare(String(b.nickname || ''));
    });

  let rank = 0, prev = null;
  active.forEach((e, i) => {
    if (prev === null || e.loss !== prev) { rank = i + 1; prev = e.loss; }
    e.rank = rank;
  });

  return {
    rows: [...active, ...rest],
    summary: {
      total_loss: total,     // 正 = チーム全体で減った
      avg_loss: avg,         // 全体増減 ÷ 増減を計算できた人数
      counted: vals.length,
      members: entries.length,
      active: active.length,
      // 旧クライアント互換（中身は純増減に修正済み）
      team_loss: total,
    },
  };
}

async function blockedSet(env, dev) {
  const rs = await env.DB.prepare('SELECT blocked_member_id FROM blocks WHERE device_id=?')
    .bind(dev.device_id).all();
  return new Set((rs.results || []).map(r => r.blocked_member_id));
}

async function rivalSet(env, dev) {
  const rs = await env.DB.prepare('SELECT rival_member_id FROM rivals WHERE device_id=?')
    .bind(dev.device_id).all();
  return new Set((rs.results || []).map(r => r.rival_member_id));
}

/* ---------- ランキング本体 ---------- */
async function ranking(req, env, dev, url) {
  const scope = url.searchParams.get('scope') || 'mine';
  const blocked = await blockedSet(env, dev);
  const rivals = await rivalSet(env, dev);
  const todayDay = ymdToDay(todayYmdJST());

  if (scope === 'rival') return await rivalRanking(req, env, dev, blocked, rivals, todayDay);

  let gid = dev.group_id;
  if (scope === 'watch') {
    gid = normalizeCode(url.searchParams.get('group_id') || '');
    if (!gid) return bad(req, 'bad_code');
    if (gid !== dev.group_id) {
      const w = await env.DB.prepare('SELECT group_id FROM watching WHERE device_id=? AND group_id=?')
        .bind(dev.device_id, gid).first();
      if (!w) return bad(req, 'not_watching', 403);
    }
  }
  if (!gid) return json(req, { ok: true, scope, group: null, rows: [], summary: null });

  const g = await env.DB.prepare('SELECT * FROM groups WHERE group_id=?').bind(gid).first();
  if (!g) return bad(req, 'group_not_found', 404);

  const ms = await env.DB.prepare(
    'SELECT device_id,member_id,nickname,icon_ver FROM devices WHERE group_id=? AND banned=0'
  ).bind(gid).all();
  const members = ms.results || [];

  const stats = await lossStats(env, members.map(x => x.device_id), g.start_ymd);
  const showWeight = Number(g.show_weight) === 1;

  const entries = members.map(mrow => buildEntry(
    mrow,
    stats.get(mrow.device_id),
    todayDay,
    showWeight || mrow.member_id === dev.member_id,   // 非公開グループでは体重を出さない
    mrow.member_id === dev.member_id,
    rivals.has(mrow.member_id)
  ));

  const built = finishRows(entries);   // 集計はブロック前の全員で行う（誰が見ても同じ数字）
  const rows = built.rows.filter(e => e.is_self || !blocked.has(e.member_id));

  return json(req, {
    ok: true,
    scope,
    group: {
      group_id: g.group_id,
      name: g.name,
      start_ymd: g.start_ymd,
      show_weight: showWeight,
      is_mine: gid === dev.group_id,
      is_owner: gid === dev.group_id && isOwnerOf(g, dev),
    },
    summary: built.summary,
    rows,
  });
}

/* ---------- ライバル：自分＋登録したライバル ---------- */
async function rivalRanking(req, env, dev, blocked, rivals, todayDay) {
  const ids = [dev.member_id, ...[...rivals].filter(x => x !== dev.member_id)];
  const ph = ids.map(() => '?').join(',');
  const rs = await env.DB.prepare(
    `SELECT device_id,member_id,nickname,icon_ver,group_id FROM devices
      WHERE member_id IN (${ph}) AND banned=0`
  ).bind(...ids).all();
  const people = rs.results || [];

  // 各自の所属グループのスタート日を基準にそろえる
  const gids = [...new Set(people.map(x => x.group_id).filter(Boolean))];
  const groups = new Map();
  if (gids.length) {
    const gph = gids.map(() => '?').join(',');
    const grs = await env.DB.prepare(
      `SELECT group_id,name,start_ymd,show_weight FROM groups WHERE group_id IN (${gph})`
    ).bind(...gids).all();
    for (const g of (grs.results || [])) groups.set(g.group_id, g);
  }

  // スタート日ごとにまとめて集計
  const byStart = new Map();
  for (const pr of people) {
    const g = pr.group_id ? groups.get(pr.group_id) : null;
    const start = (g && g.start_ymd) ? g.start_ymd : '1900-01-01';  // 未所属は全期間
    if (!byStart.has(start)) byStart.set(start, []);
    byStart.get(start).push(pr);
  }
  const stats = new Map();
  for (const [start, list] of byStart) {
    const s = await lossStats(env, list.map(x => x.device_id), start);
    for (const [k, v] of s) stats.set(k, v);
  }

  const entries = people.map(pr => {
    const g = pr.group_id ? groups.get(pr.group_id) : null;
    const isSelf = pr.member_id === dev.member_id;
    // 非公開グループ／未所属の体重は絶対に返さない（ライバル経由の漏洩を封じる）
    const showKg = isSelf || !!(g && Number(g.show_weight) === 1);
    const e = buildEntry(pr, stats.get(pr.device_id), todayDay, showKg, isSelf, !isSelf);
    e.group_name = g ? g.name : null;
    return e;
  });

  const built = finishRows(entries);
  const rows = built.rows.filter(e => e.is_self || !blocked.has(e.member_id));

  return json(req, { ok: true, scope: 'rival', group: null, summary: built.summary, rows });
}

/* ============================================================
   購読 / ライバル / ブロック / 通報
   ============================================================ */
async function listWatching(req, env, dev) {
  const rs = await env.DB.prepare(
    `SELECT w.group_id, g.name, g.start_ymd, g.show_weight,
            (SELECT COUNT(*) FROM devices d WHERE d.group_id=w.group_id AND d.banned=0) AS n
       FROM watching w JOIN groups g ON g.group_id=w.group_id
      WHERE w.device_id=? ORDER BY w.created_at ASC`
  ).bind(dev.device_id).all();

  return json(req, {
    ok: true,
    watching: (rs.results || []).map(x => ({
      group_id: x.group_id,
      code: fmtCode(x.group_id),
      name: x.name,
      start_ymd: x.start_ymd,
      show_weight: Number(x.show_weight) === 1,
      members: Number(x.n || 0),
    })),
  });
}

async function addWatching(req, env, dev) {
  const b = await readBody(req);
  const gid = normalizeCode(b.code || b.group_id);
  if (!gid) return bad(req, 'bad_code');
  if (gid === dev.group_id) return bad(req, 'own_group');

  const g = await env.DB.prepare('SELECT group_id FROM groups WHERE group_id=?').bind(gid).first();
  if (!g) return bad(req, 'group_not_found', 404);

  await env.DB.prepare('INSERT OR IGNORE INTO watching (device_id,group_id,created_at) VALUES (?,?,?)')
    .bind(dev.device_id, gid, Date.now()).run();
  return await listWatching(req, env, dev);
}

async function delWatching(req, env, dev, raw) {
  const gid = normalizeCode(raw);
  if (!gid) return bad(req, 'bad_code');
  await env.DB.prepare('DELETE FROM watching WHERE device_id=? AND group_id=?')
    .bind(dev.device_id, gid).run();
  return await listWatching(req, env, dev);
}

async function listRivals(req, env, dev) {
  const rs = await env.DB.prepare(
    `SELECT r.rival_member_id AS member_id, d.nickname, d.icon_ver
       FROM rivals r LEFT JOIN devices d ON d.member_id=r.rival_member_id
      WHERE r.device_id=? ORDER BY r.created_at ASC`
  ).bind(dev.device_id).all();

  return json(req, {
    ok: true,
    rivals: (rs.results || []).map(x => ({
      member_id: x.member_id,
      nickname: x.nickname || null,
      icon_ver: Number(x.icon_ver || 0),
      icon_url: iconUrlOf(x.member_id, x.icon_ver),
    })),
  });
}

async function addRival(req, env, dev) {
  const b = await readBody(req);
  const mid = String(b.member_id || '').trim();
  if (!mid) return bad(req, 'bad_member_id');
  if (mid === dev.member_id) return bad(req, 'self_not_allowed');

  const t = await env.DB.prepare('SELECT member_id FROM devices WHERE member_id=? AND banned=0')
    .bind(mid).first();
  if (!t) return bad(req, 'member_not_found', 404);

  await env.DB.prepare('INSERT OR IGNORE INTO rivals (device_id,rival_member_id,created_at) VALUES (?,?,?)')
    .bind(dev.device_id, mid, Date.now()).run();
  return await listRivals(req, env, dev);
}

async function delRival(req, env, dev, mid) {
  const id = String(mid || '').trim();
  if (!id) return bad(req, 'bad_member_id');
  await env.DB.prepare('DELETE FROM rivals WHERE device_id=? AND rival_member_id=?')
    .bind(dev.device_id, id).run();
  return await listRivals(req, env, dev);
}

async function listBlocks(req, env, dev) {
  const rs = await env.DB.prepare(
    `SELECT b.blocked_member_id AS member_id, d.nickname, d.icon_ver
       FROM blocks b LEFT JOIN devices d ON d.member_id=b.blocked_member_id
      WHERE b.device_id=? ORDER BY b.created_at DESC`
  ).bind(dev.device_id).all();

  return json(req, {
    ok: true,
    blocks: (rs.results || []).map(x => ({
      member_id: x.member_id,
      nickname: x.nickname || null,
      icon_ver: Number(x.icon_ver || 0),
      icon_url: iconUrlOf(x.member_id, x.icon_ver),
    })),
  });
}

async function addBlock(req, env, dev) {
  const b = await readBody(req);
  const mid = String(b.member_id || '').trim();
  if (!mid) return bad(req, 'bad_member_id');
  if (mid === dev.member_id) return bad(req, 'self_not_allowed');

  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO blocks (device_id,blocked_member_id,created_at) VALUES (?,?,?)')
      .bind(dev.device_id, mid, Date.now()),
    env.DB.prepare('DELETE FROM rivals WHERE device_id=? AND rival_member_id=?').bind(dev.device_id, mid),
  ]);
  return await listBlocks(req, env, dev);
}

async function delBlock(req, env, dev, mid) {
  const id = String(mid || '').trim();
  if (!id) return bad(req, 'bad_member_id');
  await env.DB.prepare('DELETE FROM blocks WHERE device_id=? AND blocked_member_id=?')
    .bind(dev.device_id, id).run();
  return await listBlocks(req, env, dev);
}

async function addReport(req, env, dev) {
  if (!await rateOk(env, 'report:' + dev.device_id)) return bad(req, 'rate_limited', 429);

  const b = await readBody(req);
  const target = String(b.target_id || b.member_id || '').trim();
  if (!target) return bad(req, 'bad_member_id');
  if (target === dev.member_id) return bad(req, 'self_not_allowed');

  const reason = normReason(b.reason);        // 通報専用：最大200文字
  if (!reason) return bad(req, 'bad_reason');

  const ymd = isYmd(b.ymd) ? b.ymd : todayYmdJST();
  await env.DB.prepare(
    'INSERT INTO reports (reporter_id,target_id,ymd,reason,created_at,handled) VALUES (?,?,?,?,?,0)'
  ).bind(dev.member_id, target, ymd, reason, Date.now()).run();

  return json(req, { ok: true, reported: true });
}
