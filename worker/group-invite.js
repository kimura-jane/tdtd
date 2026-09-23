
'use strict';

import {
  json,
  bad,
  normalizeCode,
} from './lib.js';

import {
  joinGroupSafely,
} from './safety.js';

import {
  isOperatorMember,
} from './operator.js';

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MEMBER_ID_RE = /^[0-9A-Z]{6,32}$/;

class InviteStateError extends Error {
  constructor(code) {
    super(code);
    this.name = 'InviteStateError';
    this.code = code;
  }
}

function normalizeMemberId(raw) {
  let value = '';

  try {
    value = decodeURIComponent(String(raw || ''));
  } catch {
    value = String(raw || '');
  }

  value = value.trim().toUpperCase();
  return MEMBER_ID_RE.test(value) ? value : null;
}

async function readJson(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

function noSuchTable(error) {
  const text = String(
    (error && error.message) || error || ''
  ).toLowerCase();

  return (
    text.includes('no such table') ||
    text.includes('does not exist')
  );
}

function inviteUnavailable(req) {
  return bad(
    req,
    'group_invite_unavailable',
    503
  );
}

async function pendingInvite(env, memberId) {
  return await env.DB
    .prepare(`
      SELECT
        member_id,
        group_id,
        created_at,
        updated_at
      FROM group_invites
      WHERE member_id=?
    `)
    .bind(memberId)
    .first();
}

async function groupById(env, groupId) {
  return await env.DB
    .prepare(`
      SELECT *
      FROM groups
      WHERE group_id=?
    `)
    .bind(groupId)
    .first();
}

async function groupExternalEnabled(env, groupId) {
  try {
    const row = await env.DB
      .prepare(`
        SELECT enabled
        FROM group_external
        WHERE group_id=?
      `)
      .bind(groupId)
      .first();

    return Number((row && row.enabled) || 0) === 1;
  } catch (error) {
    if (noSuchTable(error)) {
      return false;
    }

    throw error;
  }
}

async function groupMemberCount(env, groupId) {
  const row = await env.DB
    .prepare(`
      SELECT COUNT(*) AS n
      FROM devices
      WHERE
        group_id=?
        AND banned=0
    `)
    .bind(groupId)
    .first();

  return Number((row && row.n) || 0);
}

async function groupBanExists(env, groupId, memberId) {
  const row = await env.DB
    .prepare(`
      SELECT member_id
      FROM group_bans
      WHERE
        group_id=?
        AND member_id=?
    `)
    .bind(groupId, memberId)
    .first();

  return !!row;
}

function adminLogStatement(
  env,
  actor,
  action,
  groupId,
  detail,
  now = Date.now()
) {
  return env.DB
    .prepare(`
      INSERT INTO admin_log (
        ts,
        actor,
        action,
        group_id,
        detail
      )
      VALUES (?,?,?,?,?)
    `)
    .bind(
      now,
      actor,
      action,
      groupId || null,
      JSON.stringify(detail || {})
    );
}

async function freshSelfDevice(
  req,
  env,
  expectedMemberId
) {
  const deviceId = String(
    req.headers.get('x-device-id') || ''
  ).trim();

  if (!DEVICE_ID_RE.test(deviceId)) {
    return {
      error: 'bad_device_id',
      status: 400,
    };
  }

  const dev = await env.DB
    .prepare(`
      SELECT *
      FROM devices
      WHERE device_id=?
    `)
    .bind(deviceId)
    .first();

  if (!dev) {
    return {
      error: 'not_registered',
      status: 404,
    };
  }

  if (
    expectedMemberId &&
    dev.member_id !== expectedMemberId
  ) {
    return {
      error: 'member_mismatch',
      status: 403,
    };
  }

  if (Number(dev.banned || 0) === 1) {
    return {
      error: 'banned',
      status: 403,
    };
  }

  if (isOperatorMember(env, dev.member_id)) {
    return {
      error: 'operator_not_allowed',
      status: 403,
    };
  }

  return { dev };
}

async function clearStaleInvite(
  env,
  invite,
  reason
) {
  if (!invite || !invite.member_id) {
    return;
  }

  const now = Date.now();

  await env.DB.batch([
    env.DB
      .prepare(`
        DELETE FROM group_invites
        WHERE
          member_id=?
          AND group_id=?
      `)
      .bind(
        invite.member_id,
        invite.group_id
      ),

    adminLogStatement(
      env,
      'system',
      'group_invite_expired',
      invite.group_id,
      {
        member_id: invite.member_id,
        group_id: invite.group_id,
        reason,
      },
      now
    ),
  ]);
}

/* ============================================================
   管理者API
   adminUserRoute() で管理者認証した後に呼ぶ。
   ============================================================ */

async function adminInviteTarget(
  req,
  env,
  memberId
) {
  const dev = await env.DB
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
    .bind(memberId)
    .first();

  if (!dev) {
    return {
      response: bad(
        req,
        'member_not_found',
        404
      ),
    };
  }

  if (Number(dev.banned || 0) === 1) {
    return {
      response: bad(
        req,
        'banned',
        403
      ),
    };
  }

  if (isOperatorMember(env, memberId)) {
    return {
      response: bad(
        req,
        'operator_not_allowed',
        403
      ),
    };
  }

  if (dev.group_id) {
    return {
      response: bad(
        req,
        'already_in_group',
        409
      ),
    };
  }

  return { dev };
}

async function adminGetInvite(
  req,
  env,
  memberId
) {
  const target = await adminInviteTarget(
    req,
    env,
    memberId
  );

  if (target.response) {
    const data = await target.response
      .clone()
      .json()
      .catch(() => ({}));

    if (
      data.error === 'already_in_group' ||
      data.error === 'banned' ||
      data.error === 'operator_not_allowed'
    ) {
      return json(req, {
        ok: true,
        available: false,
        reason: data.error,
        invite: null,
      });
    }

    return target.response;
  }

  let invite;

  try {
    invite = await pendingInvite(
      env,
      memberId
    );
  } catch (error) {
    if (noSuchTable(error)) {
      return inviteUnavailable(req);
    }

    throw error;
  }

  if (!invite) {
    return json(req, {
      ok: true,
      available: true,
      invite: null,
    });
  }

  const group = await groupById(
    env,
    invite.group_id
  );

  if (!group) {
    await clearStaleInvite(
      env,
      invite,
      'group_not_found'
    );

    return json(req, {
      ok: true,
      available: true,
      invite: null,
    });
  }

  return json(req, {
    ok: true,
    available: true,
    invite: {
      member_id: invite.member_id,
      group_id: invite.group_id,
      group_name: group.name || null,
      created_at:
        Number(invite.created_at || 0) || null,
      updated_at:
        Number(invite.updated_at || 0) || null,
    },
  });
}

async function adminCreateInvite(
  req,
  env,
  memberId
) {
  const target = await adminInviteTarget(
    req,
    env,
    memberId
  );

  if (target.response) {
    return target.response;
  }

  const body = await readJson(req);
  const groupId = normalizeCode(
    body.group_id
  );

  if (!groupId) {
    return bad(req, 'bad_code');
  }

  const group = await groupById(
    env,
    groupId
  );

  if (!group) {
    return bad(
      req,
      'group_not_found',
      404
    );
  }

  if (
    await groupBanExists(
      env,
      groupId,
      memberId
    )
  ) {
    return bad(
      req,
      'banned_from_group',
      403
    );
  }

  const members = await groupMemberCount(
    env,
    groupId
  );

  if (
    members >=
    Number(group.max_members || 100)
  ) {
    return bad(
      req,
      'group_full',
      409
    );
  }

  let previous = null;

  try {
    previous = await pendingInvite(
      env,
      memberId
    );
  } catch (error) {
    if (noSuchTable(error)) {
      return inviteUnavailable(req);
    }

    throw error;
  }

  const now = Date.now();

  await env.DB.batch([
    env.DB
      .prepare(`
        INSERT INTO group_invites (
          member_id,
          group_id,
          created_at,
          updated_at
        )
        VALUES (?,?,?,?)

        ON CONFLICT(member_id)
        DO UPDATE SET
          group_id=excluded.group_id,
          created_at=excluded.created_at,
          updated_at=excluded.updated_at
      `)
      .bind(
        memberId,
        groupId,
        now,
        now
      ),

    adminLogStatement(
      env,
      'admin',
      'admin_group_invite_create',
      groupId,
      {
        member_id: memberId,
        group_id: groupId,
        previous_group_id:
          previous && previous.group_id
            ? previous.group_id
            : null,
        created_at: now,
      },
      now
    ),
  ]);

  return json(req, {
    ok: true,
    invited: true,
    member_id: memberId,
    group_id: groupId,
    group_name: group.name || null,
    replaced: !!previous,
    previous_group_id:
      previous && previous.group_id
        ? previous.group_id
        : null,
    updated_at: now,
  });
}

export async function adminGroupInviteRoute(
  req,
  env,
  memberId,
  method
) {
  const normalized = normalizeMemberId(
    memberId
  );

  if (!normalized) {
    return bad(req, 'bad_member_id');
  }

  if (method === 'GET') {
    return await adminGetInvite(
      req,
      env,
      normalized
    );
  }

  if (method === 'POST') {
    return await adminCreateInvite(
      req,
      env,
      normalized
    );
  }

  return bad(
    req,
    'method_not_allowed',
    405
  );
}

/* ============================================================
   本人API
   ============================================================ */

async function memberGetInvite(
  req,
  env,
  dev
) {
  if (isOperatorMember(env, dev.member_id)) {
    return bad(
      req,
      'operator_not_allowed',
      403
    );
  }

  let invite;

  try {
    invite = await pendingInvite(
      env,
      dev.member_id
    );
  } catch (error) {
    if (noSuchTable(error)) {
      return inviteUnavailable(req);
    }

    throw error;
  }

  if (!invite) {
    return json(req, {
      ok: true,
      invite: null,
    });
  }

  /*
   * 初版inviteは未所属ユーザーだけが対象。
   * invite後に通常コード等で所属した場合は
   * stale inviteを閉じる。
   */
  if (dev.group_id) {
    await clearStaleInvite(
      env,
      invite,
      'member_already_joined'
    );

    return json(req, {
      ok: true,
      invite: null,
    });
  }

  const group = await groupById(
    env,
    invite.group_id
  );

  if (!group) {
    await clearStaleInvite(
      env,
      invite,
      'group_not_found'
    );

    return json(req, {
      ok: true,
      invite: null,
    });
  }

  return json(req, {
    ok: true,
    invite: {
      group_id: group.group_id,
      group_name: group.name || null,
      show_weight:
        Number(group.show_weight) === 1,
      external_enabled:
        await groupExternalEnabled(
          env,
          group.group_id
        ),
      created_at:
        Number(invite.created_at || 0) || null,
      updated_at:
        Number(invite.updated_at || 0) || null,
    },
  });
}

async function acceptInvite(
  req,
  env,
  dev
) {
  /*
   * entry.js が取得した dev だけを信用せず、
   * 承認ボタン押下時点で本人・BAN状態を再取得する。
   */
  const self = await freshSelfDevice(
    req,
    env,
    dev.member_id
  );

  if (self.error) {
    return bad(
      req,
      self.error,
      self.status
    );
  }

  const fresh = self.dev;

  let invite;

  try {
    invite = await pendingInvite(
      env,
      fresh.member_id
    );
  } catch (error) {
    if (noSuchTable(error)) {
      return inviteUnavailable(req);
    }

    throw error;
  }

  if (!invite) {
    return bad(
      req,
      'invite_not_found',
      404
    );
  }

  const body = await readJson(req);
  const expectedGroupId = normalizeCode(
    body.group_id
  );

  if (
    !expectedGroupId ||
    expectedGroupId !== invite.group_id
  ) {
    return bad(
      req,
      'invite_changed',
      409
    );
  }

  /*
   * 未指定値はすべて安全側。
   */
  const weightHidden =
    body.weight_hidden !== false;

  const goalPublic =
    body.goal_public === true;

  const externalConsent =
    body.external_consent === true;

  const internalUrl = new URL(req.url);
  internalUrl.pathname = '/api/groups/join';
  internalUrl.search = '';

  const internalReq = new Request(
    internalUrl.toString(),
    {
      method: 'POST',
      headers: {
        'x-device-id': fresh.device_id,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        code: invite.group_id,
        weight_hidden: weightHidden,
        external_consent: externalConsent,
      }),
    }
  );

  let joined;

  try {
    /*
     * joinGroupSafely() 側で承認時点の状態を再確認する。
     *
     * ・本人 / BAN
     * ・未所属
     * ・group存在
     * ・group_bans
     * ・満員
     * ・非公開グループなら weight_hidden=true
     * ・外部WEB対象外なら external_consent=false
     *
     * その安全チェックを通過した後だけ、
     * goal_public / invite削除 / audit log を
     * membership等と同じ D1 batch に追加する。
     */
    joined = await joinGroupSafely(
      internalReq,
      env,
      {
        extraStatements: async ({
          dev: checkedDev,
          group: checkedGroup,
        }) => {
          if (
            checkedDev.member_id !==
            fresh.member_id
          ) {
            throw new InviteStateError(
              'member_mismatch'
            );
          }

          const latestInvite =
            await pendingInvite(
              env,
              checkedDev.member_id
            );

          if (
            !latestInvite ||
            latestInvite.group_id !==
              checkedGroup.group_id ||
            latestInvite.group_id !==
              expectedGroupId
          ) {
            throw new InviteStateError(
              'invite_changed'
            );
          }

          const now = Date.now();

          return [
            env.DB
              .prepare(`
                UPDATE devices
                SET goal_public=?
                WHERE
                  device_id=?
                  AND member_id=?
              `)
              .bind(
                goalPublic ? 1 : 0,
                checkedDev.device_id,
                checkedDev.member_id
              ),

            env.DB
              .prepare(`
                DELETE FROM group_invites
                WHERE
                  member_id=?
                  AND group_id=?
              `)
              .bind(
                checkedDev.member_id,
                checkedGroup.group_id
              ),

            adminLogStatement(
              env,
              'member:' +
                checkedDev.member_id,
              'group_invite_accept',
              checkedGroup.group_id,
              {
                member_id:
                  checkedDev.member_id,
                group_id:
                  checkedGroup.group_id,
                weight_hidden_requested:
                  weightHidden,
                goal_public:
                  goalPublic,
                external_consent_requested:
                  externalConsent,
                accepted_at: now,
              },
              now
            ),
          ];
        },
      }
    );
  } catch (error) {
    if (error instanceof InviteStateError) {
      return bad(
        req,
        error.code,
        409
      );
    }

    if (noSuchTable(error)) {
      return inviteUnavailable(req);
    }

    throw error;
  }

  let data = {};

  try {
    data = await joined.clone().json();
  } catch {}

  if (!joined.ok || data.ok === false) {
    return bad(
      req,
      data.error || 'join_failed',
      joined.status || 400
    );
  }

  return json(req, {
    ok: true,
    accepted: true,
    group: data.group || null,
    weight_hidden:
      data.weight_hidden !== false,
    goal_public: goalPublic,
    external_consent:
      !!data.external_consent,
  });
}

async function declineInvite(
  req,
  env,
  dev
) {
  const self = await freshSelfDevice(
    req,
    env,
    dev.member_id
  );

  if (self.error) {
    return bad(
      req,
      self.error,
      self.status
    );
  }

  const fresh = self.dev;

  let invite;

  try {
    invite = await pendingInvite(
      env,
      fresh.member_id
    );
  } catch (error) {
    if (noSuchTable(error)) {
      return inviteUnavailable(req);
    }

    throw error;
  }

  if (!invite) {
    return bad(
      req,
      'invite_not_found',
      404
    );
  }

  const body = await readJson(req);
  const expectedGroupId = normalizeCode(
    body.group_id
  );

  if (
    !expectedGroupId ||
    expectedGroupId !== invite.group_id
  ) {
    return bad(
      req,
      'invite_changed',
      409
    );
  }

  const now = Date.now();

  await env.DB.batch([
    env.DB
      .prepare(`
        DELETE FROM group_invites
        WHERE
          member_id=?
          AND group_id=?
      `)
      .bind(
        fresh.member_id,
        invite.group_id
      ),

    adminLogStatement(
      env,
      'member:' + fresh.member_id,
      'group_invite_decline',
      invite.group_id,
      {
        member_id: fresh.member_id,
        group_id: invite.group_id,
        declined_at: now,
      },
      now
    ),
  ]);

  return json(req, {
    ok: true,
    declined: true,
    group_id: invite.group_id,
  });
}

export async function memberGroupInviteRoute(
  req,
  env,
  dev,
  pathname,
  method
) {
  const p = String(pathname || '')
    .replace(/\/+$/, '');

  if (
    p === '/api/group-invite' &&
    method === 'GET'
  ) {
    return await memberGetInvite(
      req,
      env,
      dev
    );
  }

  if (
    p === '/api/group-invite/accept' &&
    method === 'POST'
  ) {
    return await acceptInvite(
      req,
      env,
      dev
    );
  }

  if (
    p === '/api/group-invite/decline' &&
    method === 'POST'
  ) {
    return await declineInvite(
      req,
      env,
      dev
    );
  }

  return bad(
    req,
    'not_found',
    404
  );
}
