'use strict';

import {
  json,
  bad,
} from './lib.js';


/* ============================================================
   みんやせ / worker/vote.js

   毎月のチーム予想クイズ
   ------------------------------------------------------------
   ・毎月15日 23:59:59 JST 締切
   ・翌月1日の1位チームを予想
   ・つだもも / さこみつ / ゴトめい
   ・1メンバー1票
   ・締切までは変更可
   ・正解は管理画面から手動確定
   ・成績は確定済み問題のみ集計
   ============================================================ */


const DEVICE_ID_RE =
  /^[A-Za-z0-9_-]{8,64}$/;


const TEAMS = [
  {
    id: 'tsudamomo',
    name: 'つだもも',
  },
  {
    id: 'sakomitsu',
    name: 'さこみつ',
  },
  {
    id: 'gotomei',
    name: 'ゴトめい',
  },
];


const TEAM_IDS =
  new Set(
    TEAMS.map(
      t => t.id
    )
  );


const JST_OFFSET =
  9 * 60 * 60 * 1000;


let tablesReady =
  false;


/* ============================================================
   D1
   ============================================================ */

async function ensureTables(env) {

  if (tablesReady) {
    return;
  }


  await env.DB
    .prepare(`
      CREATE TABLE IF NOT EXISTS vote_rounds (
        round_key TEXT PRIMARY KEY,
        target_date TEXT NOT NULL,
        deadline_at INTEGER NOT NULL,
        winner_team TEXT,
        finalized_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
    .run();


  await env.DB
    .prepare(`
      CREATE TABLE IF NOT EXISTS vote_predictions (
        round_key TEXT NOT NULL,
        member_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        voted_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (round_key, member_id)
      )
    `)
    .run();


  await env.DB
    .prepare(`
      CREATE INDEX IF NOT EXISTS idx_vote_predictions_member
      ON vote_predictions(member_id, round_key)
    `)
    .run();


  await env.DB
    .prepare(`
      CREATE INDEX IF NOT EXISTS idx_vote_predictions_round
      ON vote_predictions(round_key, team_id)
    `)
    .run();


  tablesReady =
    true;
}


/* ============================================================
   日付
   ============================================================ */

function pad2(v) {

  return String(v)
    .padStart(
      2,
      '0'
    );
}


function jstParts(
  now = Date.now()
) {

  const d =
    new Date(
      now +
      JST_OFFSET
    );


  return {
    year:
      d.getUTCFullYear(),

    month:
      d.getUTCMonth() + 1,

    day:
      d.getUTCDate(),
  };
}


function todayYmdJST() {

  const p =
    jstParts();


  return (
    p.year +
    '-' +
    pad2(p.month) +
    '-' +
    pad2(p.day)
  );
}


/*
 * JSTの年月日時をUTC epochへ変換
 */
function jstEpoch(
  year,
  month,
  day,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0
) {

  return Date.UTC(
    year,
    month - 1,
    day,
    hour - 9,
    minute,
    second,
    ms
  );
}


/*
 * 現在投票対象となっている「翌月」を返す。
 *
 * 2026/09/04
 *   → 2026-10
 *
 * 2026/09/20
 *   → 2026-10
 *
 * 2026/10/01
 *   → 2026-11
 */
function currentRoundKey(
  now = Date.now()
) {

  const p =
    jstParts(now);


  let year =
    p.year;

  let month =
    p.month + 1;


  if (month > 12) {

    month =
      1;

    year++;
  }


  return (
    year +
    '-' +
    pad2(month)
  );
}


function validRoundKey(key) {

  return (
    /^\d{4}-(0[1-9]|1[0-2])$/
      .test(
        String(key || '')
      )
  );
}


function roundMeta(
  roundKey
) {

  if (
    !validRoundKey(
      roundKey
    )
  ) {

    throw new Error(
      'bad_round'
    );
  }


  const [
    targetYear,
    targetMonth
  ] =
    roundKey
      .split('-')
      .map(Number);


  let deadlineYear =
    targetYear;

  let deadlineMonth =
    targetMonth - 1;


  if (
    deadlineMonth === 0
  ) {

    deadlineMonth =
      12;

    deadlineYear--;
  }


  const targetDate =
    (
      targetYear +
      '-' +
      pad2(targetMonth) +
      '-01'
    );


  const deadlineAt =
    jstEpoch(
      deadlineYear,
      deadlineMonth,
      15,
      23,
      59,
      59,
      999
    );


  const targetAt =
    jstEpoch(
      targetYear,
      targetMonth,
      1,
      0,
      0,
      0,
      0
    );


  return {
    roundKey,

    targetDate,

    deadlineAt,

    targetAt,
  };
}


async function ensureRound(
  env,
  roundKey
) {

  const meta =
    roundMeta(
      roundKey
    );


  const now =
    Date.now();


  await env.DB
    .prepare(`
      INSERT OR IGNORE INTO vote_rounds
      (
        round_key,
        target_date,
        deadline_at,
        winner_team,
        finalized_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, NULL, NULL, ?, ?)
    `)
    .bind(
      meta.roundKey,
      meta.targetDate,
      meta.deadlineAt,
      now,
      now
    )
    .run();


  return meta;
}


/* ============================================================
   共通
   ============================================================ */

async function readBody(req) {

  try {

    const body =
      await req.json();


    if (
      body &&
      typeof body ===
        'object'
    ) {

      return body;
    }

  } catch {}


  return {};
}


function teamName(
  teamId
) {

  const t =
    TEAMS.find(
      x =>
        x.id ===
        teamId
    );


  return t
    ? t.name
    : null;
}


/* ============================================================
   一般ユーザー認証
   ============================================================ */

async function memberFromRequest(
  req,
  env
) {

  const deviceId =
    (
      req.headers.get(
        'x-device-id'
      ) ||
      ''
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
      dev.banned
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
   現在の問題
   ============================================================ */

async function getCurrent(
  req,
  env,
  dev
) {

  const key =
    currentRoundKey();


  const meta =
    await ensureRound(
      env,
      key
    );


  const round =
    await env.DB
      .prepare(`
        SELECT *
        FROM vote_rounds
        WHERE round_key=?
      `)
      .bind(
        key
      )
      .first();


  const vote =
    await env.DB
      .prepare(`
        SELECT
          team_id,
          voted_at,
          updated_at
        FROM vote_predictions
        WHERE round_key=?
          AND member_id=?
      `)
      .bind(
        key,
        dev.member_id
      )
      .first();


  const now =
    Date.now();


  return json(
    req,
    {
      ok:
        true,

      teams:
        TEAMS,

      round: {
        key,

        target_date:
          meta.targetDate,

        deadline_at:
          meta.deadlineAt,

        open:
          now <=
          meta.deadlineAt,

        winner_team:
          round &&
          round.winner_team
            ? round.winner_team
            : null,

        finalized:
          !!(
            round &&
            round.finalized_at
          ),
      },

      vote:
        vote
          ? {
              team_id:
                vote.team_id,

              team_name:
                teamName(
                  vote.team_id
                ),

              voted_at:
                Number(
                  vote.voted_at
                ),

              updated_at:
                Number(
                  vote.updated_at
                ),
            }
          : null,
    }
  );
}


/* ============================================================
   投票
   ============================================================ */

async function saveVote(
  req,
  env,
  dev
) {

  const key =
    currentRoundKey();


  const meta =
    await ensureRound(
      env,
      key
    );


  if (
    Date.now() >
    meta.deadlineAt
  ) {

    return bad(
      req,
      'vote_closed',
      409
    );
  }


  const body =
    await readBody(
      req
    );


  const teamId =
    String(
      body.team_id ||
      ''
    );


  if (
    !TEAM_IDS.has(
      teamId
    )
  ) {

    return bad(
      req,
      'bad_team'
    );
  }


  const now =
    Date.now();


  await env.DB
    .prepare(`
      INSERT INTO vote_predictions
      (
        round_key,
        member_id,
        team_id,
        voted_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?)

      ON CONFLICT(round_key, member_id)
      DO UPDATE SET
        team_id=excluded.team_id,
        updated_at=excluded.updated_at
    `)
    .bind(
      key,
      dev.member_id,
      teamId,
      now,
      now
    )
    .run();


  return json(
    req,
    {
      ok:
        true,

      round_key:
        key,

      team_id:
        teamId,

      team_name:
        teamName(
          teamId
        ),

      deadline_at:
        meta.deadlineAt,
    }
  );
}


/* ============================================================
   マイページ成績
   ============================================================ */

async function getHistory(
  req,
  env,
  dev
) {

  await ensureRound(
    env,
    currentRoundKey()
  );


  const rs =
    await env.DB
      .prepare(`
        SELECT
          p.round_key,
          p.team_id,
          p.voted_at,
          p.updated_at,

          r.target_date,
          r.deadline_at,
          r.winner_team,
          r.finalized_at

        FROM vote_predictions p

        INNER JOIN vote_rounds r
          ON r.round_key=p.round_key

        WHERE p.member_id=?

        ORDER BY p.round_key DESC

        LIMIT 36
      `)
      .bind(
        dev.member_id
      )
      .all();


  const rows =
    (
      rs.results ||
      []
    ).map(
      r => {

        const finalized =
          !!r.finalized_at;


        const correct =
          finalized
            ? (
                r.team_id ===
                r.winner_team
              )
            : null;


        return {
          round_key:
            r.round_key,

          target_date:
            r.target_date,

          team_id:
            r.team_id,

          team_name:
            teamName(
              r.team_id
            ),

          winner_team:
            r.winner_team ||
            null,

          winner_name:
            r.winner_team
              ? teamName(
                  r.winner_team
                )
              : null,

          finalized,

          correct,

          voted_at:
            Number(
              r.voted_at
            ),

          updated_at:
            Number(
              r.updated_at
            ),

          finalized_at:
            r.finalized_at
              ? Number(
                  r.finalized_at
                )
              : null,
        };
      }
    );


  const completed =
    rows.filter(
      r =>
        r.finalized
    );


  const correct =
    completed.filter(
      r =>
        r.correct ===
        true
    ).length;


  return json(
    req,
    {
      ok:
        true,

      stats: {
        answered:
          completed.length,

        correct,

        rate:
          completed.length
            ? Math.round(
                (
                  correct /
                  completed.length
                ) *
                100
              )
            : 0,
      },

      history:
        rows,
    }
  );
}


/* ============================================================
   一般ユーザーのルート
   ============================================================ */

export async function memberVoteRoute(
  req,
  env,
  url,
  p,
  m
) {

  await ensureTables(
    env
  );


  const auth =
    await memberFromRequest(
      req,
      env
    );


  if (auth.error) {
    return auth.error;
  }


  const dev =
    auth.dev;


  if (
    p ===
      '/api/vote/current'
  ) {

    if (
      m ===
      'GET'
    ) {

      return await getCurrent(
        req,
        env,
        dev
      );
    }


    if (
      m ===
      'POST'
    ) {

      return await saveVote(
        req,
        env,
        dev
      );
    }
  }


  if (
    p ===
      '/api/vote/history' &&
    m ===
      'GET'
  ) {

    return await getHistory(
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


/* ============================================================
   管理認証
   ============================================================ */

function adminAuthorized(
  req,
  env
) {

  const token =
    typeof env.ADMIN_TOKEN ===
      'string'
      ? env.ADMIN_TOKEN.trim()
      : '';


  if (!token) {

    return {
      ok:
        false,

      error:
        'no_admin_token',
    };
  }


  const auth =
    (
      req.headers.get(
        'authorization'
      ) ||
      ''
    ).trim();


  if (
    auth !==
    'Bearer ' +
      token
  ) {

    return {
      ok:
        false,

      error:
        'unauthorized',
    };
  }


  return {
    ok:
      true,
  };
}


/* ============================================================
   管理画面：ラウンド一覧
   ============================================================ */

async function adminRounds(
  req,
  env,
  url
) {

  await ensureRound(
    env,
    currentRoundKey()
  );


  const limit =
    Math.max(
      1,
      Math.min(
        60,
        Number(
          url.searchParams.get(
            'limit'
          ) ||
          24
        )
      )
    );


  const roundRows =
    await env.DB
      .prepare(`
        SELECT *
        FROM vote_rounds
        ORDER BY round_key DESC
        LIMIT ?
      `)
      .bind(
        limit
      )
      .all();


  const countRows =
    await env.DB
      .prepare(`
        SELECT
          round_key,
          team_id,
          COUNT(*) AS c
        FROM vote_predictions
        GROUP BY
          round_key,
          team_id
      `)
      .all();


  const countMap =
    new Map();


  for (
    const row of
    (
      countRows.results ||
      []
    )
  ) {

    if (
      !countMap.has(
        row.round_key
      )
    ) {

      countMap.set(
        row.round_key,
        {
          tsudamomo:
            0,

          sakomitsu:
            0,

          gotomei:
            0,
        }
      );
    }


    const x =
      countMap.get(
        row.round_key
      );


    if (
      Object.prototype
        .hasOwnProperty
        .call(
          x,
          row.team_id
        )
    ) {

      x[
        row.team_id
      ] =
        Number(
          row.c
        );
    }
  }


  const today =
    todayYmdJST();


  const rounds =
    (
      roundRows.results ||
      []
    ).map(
      r => {

        const counts =
          countMap.get(
            r.round_key
          ) ||
          {
            tsudamomo:
              0,

            sakomitsu:
              0,

            gotomei:
              0,
          };


        const voters =
          counts.tsudamomo +
          counts.sakomitsu +
          counts.gotomei;


        return {
          round_key:
            r.round_key,

          target_date:
            r.target_date,

          deadline_at:
            Number(
              r.deadline_at
            ),

          winner_team:
            r.winner_team ||
            null,

          winner_name:
            r.winner_team
              ? teamName(
                  r.winner_team
                )
              : null,

          finalized_at:
            r.finalized_at
              ? Number(
                  r.finalized_at
                )
              : null,

          finalized:
            !!r.finalized_at,

          can_finalize:
            today >=
            r.target_date,

          voters,

          counts,
        };
      }
    );


  return json(
    req,
    {
      ok:
        true,

      teams:
        TEAMS,

      rounds,
    }
  );
}


/* ============================================================
   管理画面：正解確定
   ============================================================ */

async function adminSetResult(
  req,
  env
) {

  const body =
    await readBody(
      req
    );


  const roundKey =
    String(
      body.round_key ||
      ''
    );


  const winnerTeam =
    String(
      body.winner_team ||
      ''
    );


  if (
    !validRoundKey(
      roundKey
    )
  ) {

    return bad(
      req,
      'bad_round'
    );
  }


  if (
    !TEAM_IDS.has(
      winnerTeam
    )
  ) {

    return bad(
      req,
      'bad_team'
    );
  }


  const meta =
    await ensureRound(
      env,
      roundKey
    );


  if (
    Date.now() <
    meta.targetAt
  ) {

    return bad(
      req,
      'result_too_early',
      409
    );
  }


  const now =
    Date.now();


  await env.DB
    .prepare(`
      UPDATE vote_rounds
      SET
        winner_team=?,
        finalized_at=?,
        updated_at=?
      WHERE round_key=?
    `)
    .bind(
      winnerTeam,
      now,
      now,
      roundKey
    )
    .run();


  return json(
    req,
    {
      ok:
        true,

      round_key:
        roundKey,

      winner_team:
        winnerTeam,

      winner_name:
        teamName(
          winnerTeam
        ),

      finalized_at:
        now,
    }
  );
}


/* ============================================================
   管理ルート
   ============================================================ */

export async function adminVoteRoute(
  req,
  env,
  url,
  p,
  m
) {

  const auth =
    adminAuthorized(
      req,
      env
    );


  if (!auth.ok) {

    return bad(
      req,
      auth.error,
      auth.error ===
        'unauthorized'
        ? 401
        : 503
    );
  }


  await ensureTables(
    env
  );


  if (
    p ===
      '/api/admin/vote/rounds' &&
    m ===
      'GET'
  ) {

    return await adminRounds(
      req,
      env,
      url
    );
  }


  if (
    p ===
      '/api/admin/vote/result' &&
    m ===
      'POST'
  ) {

    return await adminSetResult(
      req,
      env
    );
  }


  return bad(
    req,
    'not_found',
    404
  );
}


/* ============================================================
   アカウント削除時
   ============================================================ */

export async function cleanupVotesForMember(
  env,
  memberId
) {

  if (!memberId) {
    return;
  }


  await ensureTables(
    env
  );


  await env.DB
    .prepare(`
      DELETE FROM vote_predictions
      WHERE member_id=?
    `)
    .bind(
      memberId
    )
    .run();
}
