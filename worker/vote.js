'use strict';

import {
  json,
  bad,
} from './lib.js';

import {
  monthlyResultPeriod,
  monthlyResultsTableExists,
  calculateMonthlyResult,
  getSavedMonthlyResult,
  monthlyResultInsertStatement,
  monthlyResultsPayload,
} from './monthly-results.js';


/* ============================================================
   みんやせ / worker/vote.js

   毎月のチーム予想クイズ
   ------------------------------------------------------------
   ・毎月15日 23:59:59 JST 締切
   ・次回の毎月1日の1位チームを予想
   ・15日締切後は翌々月1日の問題へ切り替える
   ・つだもも / さこみつ / ゴトめい
   ・1メンバー1票
   ・締切までは変更可
   ・予想履歴は member_id 単位でD1に全件保存
   ・正解は管理画面から手動確定
   ・成績は確定済み問題のみ集計
   ・管理画面から投票者と投票先を確認可能
   ・投票済みユーザーだけ投票割合を確認可能
   ・一般ユーザーには投票人数を返さない
   ・対象5グループ所属者だけ投票・外部WEBリンク利用可

   月間正式結果
   ------------------------------------------------------------
   ・9/1→10/1
   ・10/1→11/1
   ・11/1→12/1
   ・12/1→12/31
   ・期間開始日 / 終了日の実測体重が全員分必要
   ・自動集計1位と管理画面選択チームを照合
   ・一致した場合だけ正式結果を固定保存
   ・正式結果保存後は変更不可
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


/*
 * 投票・外部WEBの対象グループ。
 *
 * グループ名ではなく group_id 固定で判定する。
 * グループ名を後から変更しても影響しない。
 */
const TARGET_GROUP_IDS =
  new Set([
    '84Q8CG58',
    'AJ6N7AFJ',
    'T92787Z2',
    'XGQGRGRV',
    'C47DTD4C',
  ]);


const EXTERNAL_WEB_URL =
  'https://tsudatsu-diet.vercel.app';


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
 * 現在受付中の投票ラウンドを返す。
 *
 * 2026/09/01〜09/15
 *   → 2026-10
 *   → 10/1時点の1位を予想
 *
 * 2026/09/16〜10/15
 *   → 2026-11
 *   → 11/1時点の1位を予想
 *
 * 2026/10/16〜11/15
 *   → 2026-12
 *   → 12/1時点の1位を予想
 */
function currentRoundKey(
  now = Date.now()
) {

  const p =
    jstParts(now);


  let year =
    p.year;


  let month =
    p.month +
    (
      p.day <= 15
        ? 1
        : 2
    );


  while (
    month > 12
  ) {

    month -= 12;
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


function officialMissingMessage(
  calculated
) {

  const missing =
    calculated &&
    Array.isArray(
      calculated.missing
    )
      ? calculated.missing
      : [];


  if (!missing.length) {

    return (
      '全員分の体重が揃っていません。' +
      '対象期間の公式体重を確認してください。'
    );
  }


  const shown =
    missing
      .slice(
        0,
        6
      )
      .map(
        row =>
          (
            row.nickname ||
            row.member_id ||
            '名前未設定'
          ) +
          '（' +
          row.ymd +
          '）'
      );


  const rest =
    missing.length >
      shown.length
      ? (
          '、ほか' +
          (
            missing.length -
            shown.length
          ) +
          '件'
        )
      : '';


  return (
    '全員分の体重が揃っていません。不足：' +
    shown.join('、') +
    rest +
    '。対象期間の公式体重を確認してください。'
  );
}


/* ============================================================
   対象グループ判定
   ============================================================ */

function normalizeGroupId(
  value
) {

  return String(
    value ||
    ''
  )
    .toUpperCase()
    .replace(
      /[^0-9A-Z]/g,
      ''
    );
}


function isTargetGroup(
  dev
) {

  if (
    !dev ||
    !dev.group_id
  ) {

    return false;
  }


  return TARGET_GROUP_IDS
    .has(
      normalizeGroupId(
        dev.group_id
      )
    );
}


function canViewExternalWeb(
  dev
) {

  return isTargetGroup(
    dev
  );
}


/* ============================================================
   現在の投票割合
   ============================================================ */

async function currentVotePercentages(
  env,
  roundKey
) {

  const rs =
    await env.DB
      .prepare(`
        SELECT
          team_id,
          COUNT(*) AS c

        FROM vote_predictions

        WHERE round_key=?

        GROUP BY team_id
      `)
      .bind(
        roundKey
      )
      .all();


  const counts =
    new Map(
      TEAMS.map(
        team => [
          team.id,
          0,
        ]
      )
    );


  for (
    const row of
    (
      rs.results ||
      []
    )
  ) {

    if (
      counts.has(
        row.team_id
      )
    ) {

      counts.set(
        row.team_id,
        Number(
          row.c ||
          0
        )
      );
    }
  }


  const total =
    TEAMS.reduce(
      (
        sum,
        team
      ) =>
        sum +
        Number(
          counts.get(
            team.id
          ) ||
          0
        ),
      0
    );


  if (
    total <=
    0
  ) {

    return TEAMS.map(
      team => ({
        team_id:
          team.id,

        team_name:
          team.name,

        percent:
          0,
      })
    );
  }


  const values =
    TEAMS.map(
      (
        team,
        index
      ) => {

        const count =
          Number(
            counts.get(
              team.id
            ) ||
            0
          );


        const exact =
          (
            count /
            total
          ) *
          100;


        const base =
          Math.floor(
            exact
          );


        return {
          index,
          team,
          base,
          fraction:
            exact -
            base,
        };
      }
    );


  const percentages =
    values.map(
      row =>
        row.base
    );


  let remaining =
    100 -
    percentages.reduce(
      (
        sum,
        value
      ) =>
        sum +
        value,
      0
    );


  const remainderOrder =
    [...values]
      .sort(
        (
          a,
          b
        ) =>
          (
            b.fraction -
            a.fraction
          ) ||
          (
            a.index -
            b.index
          )
      );


  let pos =
    0;


  while (
    remaining >
    0
  ) {

    const target =
      remainderOrder[
        pos %
        remainderOrder.length
      ];


    percentages[
      target.index
    ]++;


    remaining--;
    pos++;
  }


  return TEAMS.map(
    (
      team,
      index
    ) => ({
      team_id:
        team.id,

      team_name:
        team.name,

      percent:
        percentages[
          index
        ],
    })
  );
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


  const percentages =
    vote
      ? await currentVotePercentages(
          env,
          key
        )
      : null;


  const webVisible =
    canViewExternalWeb(
      dev
    );


  const now =
    Date.now();


  const monthlyResults =
    await monthlyResultsPayload(
      env,
      now
    );


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

        winner_name:
          round &&
          round.winner_team
            ? teamName(
                round.winner_team
              )
            : null,

        finalized:
          !!(
            round &&
            round.finalized_at
          ),
      },

      voted:
        !!vote,

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

      vote_status:
        vote
          ? {
              percentages,
            }
          : null,

      external_web: {
        visible:
          webVisible,

        url:
          webVisible
            ? EXTERNAL_WEB_URL
            : null,
      },

      monthly_results:
        monthlyResults,
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

      voted:
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

      updated_at:
        now,
    }
  );
}


/* ============================================================
   マイページ
   正解数・全履歴
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

        wrong:
          completed.length -
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

        total_predictions:
          rows.length,
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


  /*
   * 投票・予想成績は
   * つだつダイエット部の対象5グループだけ。
   *
   * フロントで隠すだけではなく、
   * current GET / current POST / history GET
   * すべてをサーバー側でも遮断する。
   */
  if (
    !isTargetGroup(
      dev
    )
  ) {

    return bad(
      req,
      'vote_not_available',
      403
    );
  }


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
   管理画面
   ラウンド一覧
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
        120,
        Number(
          url.searchParams.get(
            'limit'
          ) ||
          60
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


  const officialLocked =
    new Set();


  if (
    await monthlyResultsTableExists(
      env
    )
  ) {

    const lockedRows =
      await env.DB
        .prepare(`
          SELECT round_key
          FROM competition_monthly_results
        `)
        .all();


    for (
      const row of
      (
        lockedRows.results ||
        []
      )
    ) {

      officialLocked.add(
        String(
          row.round_key ||
          ''
        )
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


        const officialPeriod =
          monthlyResultPeriod(
            r.round_key,
            r.target_date
          );


        const officialFinalized =
          !!(
            officialPeriod &&
            officialLocked.has(
              String(
                r.round_key
              )
            )
          );


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
              r.target_date &&
            !officialFinalized,

          official_result:
            officialPeriod
              ? {
                  required:
                    true,

                  finalized:
                    officialFinalized,

                  period_start:
                    officialPeriod.start,

                  period_end:
                    officialPeriod.end,
                }
              : null,

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
   管理画面
   指定月の投票者一覧
   ============================================================ */

async function adminVoters(
  req,
  env,
  url
) {

  const roundKey =
    String(
      url.searchParams.get(
        'round_key'
      ) ||
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


  await ensureRound(
    env,
    roundKey
  );


  const round =
    await env.DB
      .prepare(`
        SELECT *
        FROM vote_rounds
        WHERE round_key=?
      `)
      .bind(
        roundKey
      )
      .first();


  const rs =
    await env.DB
      .prepare(`
        SELECT
          p.member_id,
          p.team_id,
          p.voted_at,
          p.updated_at,

          d.nickname

        FROM vote_predictions p

        LEFT JOIN devices d
          ON d.member_id=p.member_id

        WHERE p.round_key=?

        ORDER BY
          p.updated_at DESC,
          p.member_id ASC
      `)
      .bind(
        roundKey
      )
      .all();


  const voters =
    (
      rs.results ||
      []
    ).map(
      r => {

        const finalized =
          !!(
            round &&
            round.finalized_at
          );


        const correct =
          finalized
            ? (
                r.team_id ===
                round.winner_team
              )
            : null;


        return {
          member_id:
            r.member_id,

          nickname:
            r.nickname ||
            null,

          team_id:
            r.team_id,

          team_name:
            teamName(
              r.team_id
            ),

          voted_at:
            Number(
              r.voted_at
            ),

          updated_at:
            Number(
              r.updated_at
            ),

          changed:
            Number(
              r.updated_at
            ) >
            Number(
              r.voted_at
            ),

          finalized,

          correct,
        };
      }
    );


  return json(
    req,
    {
      ok:
        true,

      round: {
        round_key:
          roundKey,

        target_date:
          round
            ? round.target_date
            : null,

        deadline_at:
          round
            ? Number(
                round.deadline_at
              )
            : null,

        winner_team:
          round &&
          round.winner_team
            ? round.winner_team
            : null,

        winner_name:
          round &&
          round.winner_team
            ? teamName(
                round.winner_team
              )
            : null,

        finalized:
          !!(
            round &&
            round.finalized_at
          ),
      },

      voters,
    }
  );
}


/* ============================================================
   管理画面
   正解確定・変更
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


  const officialPeriod =
    monthlyResultPeriod(
      roundKey,
      meta.targetDate
    );


  /*
   * 大会正式結果の対象外なら、
   * これまでどおり予想クイズの正解だけを更新する。
   */
  if (!officialPeriod) {

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


  /*
   * 正式結果テーブルはコードから勝手に作らない。
   * 未作成ならここで止める。
   */
  if (
    !await monthlyResultsTableExists(
      env
    )
  ) {

    return bad(
      req,
      '正式結果保存用テーブルがまだ作成されていません',
      503
    );
  }


  /*
   * 一度正式結果を保存した月は固定。
   * 後から体重や予想クイズの正解を変更しても
   * 公開済み正式結果は書き換えない。
   */
  const saved =
    await getSavedMonthlyResult(
      env,
      roundKey
    );


  if (saved) {

    return bad(
      req,
      'この月の正式結果はすでに確定済みです',
      409
    );
  }


  const calculated =
    await calculateMonthlyResult(
      env,
      roundKey,
      meta.targetDate
    );


  if (
    !calculated ||
    calculated.ok !==
      true
  ) {

    if (
      calculated &&
      calculated.error ===
        'official_result_incomplete'
    ) {

      return bad(
        req,
        officialMissingMessage(
          calculated
        ),
        409
      );
    }


    if (
      calculated &&
      calculated.error ===
        'official_result_team_empty'
    ) {

      return bad(
        req,
        '3チームすべてを集計できません。所属メンバーを確認してください。',
        409
      );
    }


    return bad(
      req,
      '正式結果を集計できませんでした',
      409
    );
  }


  const first =
    calculated.rankings &&
    calculated.rankings[0]
      ? calculated.rankings[0]
      : null;


  if (
    !first
  ) {

    return bad(
      req,
      '正式結果の1位を判定できませんでした',
      409
    );
  }


  /*
   * 管理者選択は順位を決めるためには使わない。
   * 体重データから自動計算した1位と
   * 選択した勝利チームが一致するかだけ確認する。
   */
  if (
    first.team_id !==
      winnerTeam
  ) {

    return bad(
      req,
      (
        '選択した勝利チーム：' +
        (
          teamName(
            winnerTeam
          ) ||
          winnerTeam
        ) +
        ' / 集計上の1位：' +
        (
          first.team_name ||
          first.team_id ||
          '不明'
        ) +
        ' / 結果が一致していません。体重入力を確認してください。'
      ),
      409
    );
  }


  const now =
    Date.now();


  const resultInsert =
    monthlyResultInsertStatement(
      env,
      calculated,
      now
    );


  /*
   * 予想クイズ側が既に確定済みだった場合は
   * 元の finalized_at を維持する。
   *
   * 正式結果の公開日時は
   * competition_monthly_results.published_at の now。
   */
  const roundUpdate =
    env.DB
      .prepare(`
        UPDATE vote_rounds

        SET
          winner_team=?,
          finalized_at=
            COALESCE(
              finalized_at,
              ?
            ),
          updated_at=?

        WHERE round_key=?
      `)
      .bind(
        winnerTeam,
        now,
        now,
        roundKey
      );


  /*
   * 正式結果保存と予想クイズ正解更新を
   * 同じD1 batchで実行する。
   */
  await env.DB
    .batch([
      resultInsert,
      roundUpdate,
    ]);


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

      official_result: {
        period_start:
          calculated.period_start,

        period_end:
          calculated.period_end,

        rankings:
          calculated.rankings,
      },
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
      '/api/admin/vote/voters' &&
    m ===
      'GET'
  ) {

    return await adminVoters(
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
