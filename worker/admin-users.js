'use strict';

import webpush from 'web-push';

import {
  INACTIVE_DAYS,
  json,
  bad,
  notFound,
  todayYmdJST,
  isYmd,
  ymdToDay,
  round1,
  fmtCode,
} from './lib.js';


/* ============================================================
   みんやせ / worker/admin-users.js

   管理画面専用
   ------------------------------------------------------------
   ・全ユーザー一覧
   ・ユーザー詳細
   ・体重 / 減量幅
   ・予想クイズ成績
   ・通知状態
   ・Android用テスト通知

   減量幅はアプリ本体ランキングと同じ定義：
   「所属グループのstart_ymd以降の最初の実測」
   −
   「start_ymd以降の最新の実測」

   1件しかない場合は減量幅 null。
   ============================================================ */


const MEMBER_ID_RE =
  /^[0-9A-Z]{6,32}$/;


const ICON_PUBLIC =
  '/i/';


const PUSH_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    member_id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_sent_key TEXT
  )
`;


const TEAM_NAMES = {
  tsudamomo:
    'つだもも',

  sakomitsu:
    'さこみつ',

  gotomei:
    'ゴトめい',
};


/* ============================================================
   小物
   ============================================================ */

function num(v) {

  return (
    v === null ||
    v === undefined
  )
    ? null
    : Number(v);
}


function mask(raw) {

  const s =
    String(
      raw || ''
    );

  if (
    s.length <= 10
  ) {

    return s;
  }

  return (
    s.slice(
      0,
      8
    ) +
    '…' +
    s.slice(-2)
  );
}


function safeEqual(
  a,
  b
) {

  const x =
    String(
      a || ''
    );

  const y =
    String(
      b || ''
    );

  if (
    !x ||
    x.length !==
      y.length
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


function adminOk(
  req,
  env
) {

  const want =
    String(
      env.ADMIN_TOKEN ||
      ''
    )
      .trim();

  if (!want) {

    return null;
  }

  const auth =
    String(
      req.headers.get(
        'authorization'
      ) ||
      ''
    )
      .trim();


  const m =
    /^Bearer\s+(.+)$/i
      .exec(
        auth
      );


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


function normalizeMemberId(
  raw
) {

  let s =
    '';

  try {

    s =
      decodeURIComponent(
        String(
          raw || ''
        )
      );

  } catch {

    s =
      String(
        raw || ''
      );
  }


  s =
    s
      .trim()
      .toUpperCase();


  return MEMBER_ID_RE
    .test(
      s
    )
      ? s
      : null;
}


function iconUrl(
  memberId,
  iconVer
) {

  const v =
    Number(
      iconVer ||
      0
    );


  if (
    !memberId ||
    v <= 0
  ) {

    return null;
  }


  return (
    ICON_PUBLIC +
    memberId +
    '.jpg?v=' +
    v
  );
}


function teamName(
  teamId
) {

  return (
    TEAM_NAMES[
      String(
        teamId ||
        ''
      )
    ] ||
    null
  );
}


/* ============================================================
   状態
   ============================================================ */

function statusInfo(
  lastYmd,
  banned
) {

  if (
    Number(
      banned ||
      0
    ) === 1
  ) {

    return {

      status:
        'banned',

      label:
        '利用停止',

      inactive_days:
        (
          lastYmd &&
          isYmd(
            lastYmd
          )
        )
          ? Math.max(
              0,
              ymdToDay(
                todayYmdJST()
              ) -
              ymdToDay(
                lastYmd
              )
            )
          : null,
    };
  }


  if (
    !lastYmd ||
    !isYmd(
      lastYmd
    )
  ) {

    return {

      status:
        'no_record',

      label:
        '未記録',

      inactive_days:
        null,
    };
  }


  const inactiveDays =
    Math.max(
      0,
      ymdToDay(
        todayYmdJST()
      ) -
      ymdToDay(
        lastYmd
      )
    );


  if (
    inactiveDays >=
    INACTIVE_DAYS
  ) {

    return {

      status:
        'inactive',

      label:
        'おやすみ中',

      inactive_days:
        inactiveDays,
    };
  }


  return {

    status:
      'active',

    label:
      'アクティブ',

    inactive_days:
      inactiveDays,
  };
}


/* ============================================================
   減量幅
   ============================================================ */

function lossKg(
  startWeight,
  startYmd,
  latestWeight,
  latestYmd
) {

  if (
    startWeight === null ||
    startWeight === undefined ||
    latestWeight === null ||
    latestWeight === undefined ||
    !startYmd ||
    !latestYmd ||
    startYmd === latestYmd
  ) {

    return null;
  }


  return round1(
    Number(
      startWeight
    ) -
    Number(
      latestWeight
    )
  );
}


/* ============================================================
   D1
   ============================================================ */

async function ensurePushTable(
  env
) {

  await env.DB
    .prepare(
      PUSH_TABLE_SQL
    )
    .run();
}


async function quizTablesReady(
  env
) {

  try {

    await env.DB
      .prepare(
        'SELECT 1 FROM vote_rounds LIMIT 1'
      )
      .first();


    await env.DB
      .prepare(
        'SELECT 1 FROM vote_predictions LIMIT 1'
      )
      .first();


    return true;

  } catch {

    return false;
  }
}


async function ensureAdminLogTable(
  env
) {

  try {

    await env.DB
      .prepare(`
        CREATE TABLE IF NOT EXISTS admin_log (
          ts INTEGER,
          actor TEXT,
          action TEXT,
          group_id TEXT,
          detail TEXT
        )
      `)
      .run();

  } catch {}
}


async function writeAdminLog(
  env,
  action,
  groupId,
  detail
) {

  try {

    await ensureAdminLogTable(
      env
    );


    await env.DB
      .prepare(`
        INSERT INTO admin_log
          (
            ts,
            actor,
            action,
            group_id,
            detail
          )

        VALUES
          (
            ?,
            'admin',
            ?,
            ?,
            ?
          )
      `)
      .bind(
        Date.now(),
        action,
        groupId ||
          null,
        JSON.stringify(
          detail ||
          {}
        )
      )
      .run();

  } catch (e) {

    console.warn(
      'admin_user_log_failed',
      action,
      (
        e &&
        e.message
      ) ||
      e
    );
  }
}


/* ============================================================
   共通レスポンス生成
   ============================================================ */

function mapSummary(
  row
) {

  const startWeight =
    num(
      row.start_weight
    );


  const lossLatestWeight =
    num(
      row.loss_latest_weight
    );


  const currentWeight =
    num(
      row.current_weight
    );


  const goalWeight =
    num(
      row.goal_weight
    );


  const quizAnswered =
    Number(
      row.quiz_answered ||
      0
    );


  const quizCorrect =
    Number(
      row.quiz_correct ||
      0
    );


  const quizTotalPredictions =
    Number(
      row.quiz_total_predictions ||
      0
    );


  const status =
    statusInfo(
      row.last_weight_ymd,
      row.banned
    );


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
      iconUrl(
        row.member_id,
        row.icon_ver
      ),


    group_id:
      row.group_id ||
      null,

    group_code:
      row.group_id
        ? fmtCode(
            row.group_id
          )
        : null,

    group_name:
      row.group_name ||
      null,

    group_start_ymd:
      row.group_start_ymd ||
      null,


    is_owner:
      !!(
        row.group_id &&
        (
          row.group_owner_id ===
            row.member_id ||
          row.group_owner_id ===
            row.device_id
        )
      ),


    group_show_weight:
      (
        row.group_show_weight === null ||
        row.group_show_weight === undefined
      )
        ? null
        : Number(
            row.group_show_weight
          ) === 1,


    start_weight:
      startWeight,

    start_ymd:
      row.start_ymd ||
      null,


    current_weight:
      currentWeight,

    last_weight_ymd:
      row.last_weight_ymd ||
      null,


    loss_kg:
      lossKg(
        startWeight,
        row.start_ymd,
        lossLatestWeight,
        row.loss_latest_ymd
      ),


    goal_weight:
      goalWeight,


    goal_remaining_kg:
      (
        currentWeight === null ||
        goalWeight === null
      )
        ? null
        : round1(
            currentWeight -
            goalWeight
          ),


    weight_count:
      Number(
        row.weight_count ||
        0
      ),


    quiz_answered:
      quizAnswered,

    quiz_correct:
      quizCorrect,

    quiz_wrong:
      Math.max(
        0,
        quizAnswered -
        quizCorrect
      ),

    quiz_rate:
      quizAnswered
        ? Math.round(
            (
              quizCorrect /
              quizAnswered
            ) *
            100
          )
        : 0,

    quiz_total_predictions:
      quizTotalPredictions,


    notify_on:
      Number(
        row.notify_on ||
        0
      ) === 1,

    notify_days:
      Number(
        row.notify_days ||
        3
      ),

    notify_hour:
      Number(
        row.notify_hour === null ||
        row.notify_hour === undefined
          ? 20
          : row.notify_hour
      ),


    push_registered:
      Number(
        row.push_registered ||
        0
      ) === 1,

    push_updated_at:
      num(
        row.push_updated_at
      ),


    device_id_masked:
      mask(
        row.device_id
      ),


    banned:
      Number(
        row.banned ||
        0
      ) === 1,


    created_at:
      num(
        row.created_at
      ),

    joined_at:
      num(
        row.joined_at
      ),

    last_seen_at:
      num(
        row.last_seen_at
      ),


    ...status,
  };
}


/* ============================================================
   ユーザー一覧
   ============================================================ */

async function usersList(
  req,
  env
) {

  await ensurePushTable(
    env
  );


  const quizReady =
    await quizTablesReady(
      env
    );


  const quizColumns =
    quizReady
      ? `
        (
          SELECT COUNT(*)

          FROM vote_predictions vp

          INNER JOIN vote_rounds vr
            ON vr.round_key =
               vp.round_key

          WHERE
            vp.member_id =
              d.member_id

            AND
            vr.finalized_at
              IS NOT NULL
        ) AS quiz_answered,


        (
          SELECT COUNT(*)

          FROM vote_predictions vp

          INNER JOIN vote_rounds vr
            ON vr.round_key =
               vp.round_key

          WHERE
            vp.member_id =
              d.member_id

            AND
            vr.finalized_at
              IS NOT NULL

            AND
            vp.team_id =
              vr.winner_team
        ) AS quiz_correct,


        (
          SELECT COUNT(*)

          FROM vote_predictions vp

          WHERE
            vp.member_id =
              d.member_id
        ) AS quiz_total_predictions
      `
      : `
        0 AS quiz_answered,
        0 AS quiz_correct,
        0 AS quiz_total_predictions
      `;


  const rs =
    await env.DB
      .prepare(`
        SELECT

          d.device_id,
          d.member_id,
          d.nickname,
          d.icon_ver,
          d.goal_weight,
          d.notify_on,
          d.notify_days,
          d.notify_hour,
          d.group_id,
          d.banned,
          d.created_at,
          d.joined_at,
          d.last_seen_at,


          g.name AS group_name,
          g.start_ymd AS group_start_ymd,
          g.owner_id AS group_owner_id,
          g.show_weight AS group_show_weight,


          (
            SELECT w.kg

            FROM weights w

            WHERE
              w.device_id =
                d.device_id

              AND
              w.ymd >=
                COALESCE(
                  g.start_ymd,
                  '1900-01-01'
                )

            ORDER BY
              w.ymd ASC

            LIMIT 1
          ) AS start_weight,


          (
            SELECT w.ymd

            FROM weights w

            WHERE
              w.device_id =
                d.device_id

              AND
              w.ymd >=
                COALESCE(
                  g.start_ymd,
                  '1900-01-01'
                )

            ORDER BY
              w.ymd ASC

            LIMIT 1
          ) AS start_ymd,


          (
            SELECT w.kg

            FROM weights w

            WHERE
              w.device_id =
                d.device_id

              AND
              w.ymd >=
                COALESCE(
                  g.start_ymd,
                  '1900-01-01'
                )

            ORDER BY
              w.ymd DESC

            LIMIT 1
          ) AS loss_latest_weight,


          (
            SELECT w.ymd

            FROM weights w

            WHERE
              w.device_id =
                d.device_id

              AND
              w.ymd >=
                COALESCE(
                  g.start_ymd,
                  '1900-01-01'
                )

            ORDER BY
              w.ymd DESC

            LIMIT 1
          ) AS loss_latest_ymd,


          (
            SELECT w.kg

            FROM weights w

            WHERE
              w.device_id =
                d.device_id

            ORDER BY
              w.ymd DESC

            LIMIT 1
          ) AS current_weight,


          (
            SELECT w.ymd

            FROM weights w

            WHERE
              w.device_id =
                d.device_id

            ORDER BY
              w.ymd DESC

            LIMIT 1
          ) AS last_weight_ymd,


          (
            SELECT COUNT(*)

            FROM weights w

            WHERE
              w.device_id =
                d.device_id
          ) AS weight_count,


          EXISTS(
            SELECT 1

            FROM push_subscriptions ps

            WHERE
              ps.member_id =
                d.member_id
          ) AS push_registered,


          (
            SELECT
              ps.updated_at

            FROM push_subscriptions ps

            WHERE
              ps.member_id =
                d.member_id

            LIMIT 1
          ) AS push_updated_at,


          ${quizColumns}


        FROM devices d


        LEFT JOIN groups g
          ON g.group_id =
             d.group_id


        ORDER BY
          COALESCE(
            d.nickname,
            ''
          ) ASC,

          d.member_id ASC
      `)
      .all();


  const users =
    (
      rs.results ||
      []
    )
      .map(
        mapSummary
      );


  return json(
    req,
    {

      ok:
        true,

      count:
        users.length,

      quiz_available:
        quizReady,

      users,
    }
  );
}


/* ============================================================
   ユーザー詳細
   ============================================================ */

async function userDetail(
  req,
  env,
  memberId
) {

  await ensurePushTable(
    env
  );


  const dev =
    await env.DB
      .prepare(`
        SELECT

          d.*,

          g.name AS group_name,
          g.start_ymd AS group_start_ymd,
          g.owner_id AS group_owner_id,
          g.show_weight AS group_show_weight

        FROM devices d

        LEFT JOIN groups g
          ON g.group_id =
             d.group_id

        WHERE
          d.member_id=?
      `)
      .bind(
        memberId
      )
      .first();


  if (!dev) {

    return bad(
      req,
      'member_not_found',
      404
    );
  }


  const weightsRs =
    await env.DB
      .prepare(`
        SELECT
          ymd,
          kg,
          updated_at

        FROM weights

        WHERE
          device_id=?

        ORDER BY
          ymd DESC
      `)
      .bind(
        dev.device_id
      )
      .all();


  const weightHistory =
    (
      weightsRs.results ||
      []
    )
      .map(
        r => ({

          ymd:
            r.ymd,

          kg:
            Number(
              r.kg
            ),

          updated_at:
            num(
              r.updated_at
            ),
        })
      );


  /*
   * 現在体重は全履歴の最新。
   */
  const current =
    weightHistory.length
      ? weightHistory[0]
      : null;


  /*
   * 減量幅はアプリ本体ランキングと同じく
   * グループ開始日以降だけで計算。
   *
   * 未所属の場合は全期間。
   */
  const startBoundary =
    dev.group_start_ymd ||
    '1900-01-01';


  const lossHistory =
    weightHistory
      .filter(
        r =>
          r.ymd >=
          startBoundary
      );


  const lossLatest =
    lossHistory.length
      ? lossHistory[0]
      : null;


  const lossFirst =
    lossHistory.length
      ? lossHistory[
          lossHistory.length -
          1
        ]
      : null;


  const push =
    await env.DB
      .prepare(`
        SELECT
          created_at,
          updated_at

        FROM push_subscriptions

        WHERE
          member_id=?
      `)
      .bind(
        memberId
      )
      .first();


  /* ----------------------------------------------------------
     クイズ
     ---------------------------------------------------------- */

  const quizReady =
    await quizTablesReady(
      env
    );


  let quizHistory =
    [];


  if (
    quizReady
  ) {

    const qr =
      await env.DB
        .prepare(`
          SELECT

            p.round_key,
            p.team_id,
            p.voted_at,
            p.updated_at,

            r.target_date,
            r.winner_team,
            r.finalized_at

          FROM vote_predictions p

          INNER JOIN vote_rounds r
            ON r.round_key =
               p.round_key

          WHERE
            p.member_id=?

          ORDER BY
            p.round_key DESC
        `)
        .bind(
          memberId
        )
        .all();


    quizHistory =
      (
        qr.results ||
        []
      )
        .map(
          r => {

            const finalized =
              !!r.finalized_at;


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
                teamName(
                  r.winner_team
                ),

              finalized,

              correct:
                finalized
                  ? (
                      r.team_id ===
                      r.winner_team
                    )
                  : null,

              voted_at:
                num(
                  r.voted_at
                ),

              updated_at:
                num(
                  r.updated_at
                ),
            };
          }
        );
  }


  const completed =
    quizHistory
      .filter(
        r =>
          r.finalized
      );


  const quizCorrect =
    completed
      .filter(
        r =>
          r.correct ===
          true
      )
      .length;


  /* ----------------------------------------------------------
     関連情報
     ---------------------------------------------------------- */

  let rivals =
    [];

  let watching =
    [];

  let blocks =
    [];

  let reports =
    [];

  let leader =
    false;


  try {

    const rs =
      await env.DB
        .prepare(`
          SELECT

            r.rival_member_id
              AS member_id,

            d.nickname,
            d.icon_ver

          FROM rivals r

          LEFT JOIN devices d
            ON d.member_id =
               r.rival_member_id

          WHERE
            r.device_id=?

          ORDER BY
            COALESCE(
              d.nickname,
              ''
            ),

            r.rival_member_id
        `)
        .bind(
          dev.device_id
        )
        .all();


    rivals =
      (
        rs.results ||
        []
      )
        .map(
          r => ({

            member_id:
              r.member_id,

            nickname:
              r.nickname ||
              null,

            icon_url:
              iconUrl(
                r.member_id,
                r.icon_ver
              ),
          })
        );

  } catch {}


  try {

    const rs =
      await env.DB
        .prepare(`
          SELECT

            w.group_id,
            g.name

          FROM watching w

          LEFT JOIN groups g
            ON g.group_id =
               w.group_id

          WHERE
            w.device_id=?

          ORDER BY
            COALESCE(
              g.name,
              ''
            ),

            w.group_id
        `)
        .bind(
          dev.device_id
        )
        .all();


    watching =
      (
        rs.results ||
        []
      )
        .map(
          r => ({

            group_id:
              r.group_id,

            group_code:
              fmtCode(
                r.group_id
              ),

            name:
              r.name ||
              null,
          })
        );

  } catch {}


  try {

    const rs =
      await env.DB
        .prepare(`
          SELECT

            b.blocked_member_id
              AS member_id,

            d.nickname

          FROM blocks b

          LEFT JOIN devices d
            ON d.member_id =
               b.blocked_member_id

          WHERE
            b.device_id=?

          ORDER BY
            COALESCE(
              d.nickname,
              ''
            ),

            b.blocked_member_id
        `)
        .bind(
          dev.device_id
        )
        .all();


    blocks =
      (
        rs.results ||
        []
      )
        .map(
          r => ({

            member_id:
              r.member_id,

            nickname:
              r.nickname ||
              null,
          })
        );

  } catch {}


  try {

    const rs =
      await env.DB
        .prepare(`
          SELECT

            reporter_id,
            target_id,
            ymd,
            reason,
            created_at,
            handled

          FROM reports

          WHERE
            reporter_id=?
            OR
            target_id=?

          ORDER BY
            created_at DESC

          LIMIT 50
        `)
        .bind(
          memberId,
          memberId
        )
        .all();


    reports =
      (
        rs.results ||
        []
      )
        .map(
          r => ({

            reporter_id:
              r.reporter_id,

            target_id:
              r.target_id,

            ymd:
              r.ymd ||
              null,

            reason:
              r.reason ||
              '',

            created_at:
              num(
                r.created_at
              ),

            handled:
              Number(
                r.handled ||
                0
              ) === 1,
          })
        );

  } catch {}


  /*
   * group_leaders がまだ無い環境でも
   * ユーザー詳細全体を壊さない。
   */
  if (
    dev.group_id
  ) {

    try {

      const r =
        await env.DB
          .prepare(`
            SELECT
              member_id

            FROM group_leaders

            WHERE
              group_id=?
              AND
              member_id=?
          `)
          .bind(
            dev.group_id,
            memberId
          )
          .first();


      leader =
        !!r;

    } catch {

      leader =
        false;
    }
  }


  const user =
    mapSummary({

      ...dev,


      group_name:
        dev.group_name,

      group_start_ymd:
        dev.group_start_ymd,

      group_owner_id:
        dev.group_owner_id,

      group_show_weight:
        dev.group_show_weight,


      start_weight:
        lossFirst
          ? lossFirst.kg
          : null,

      start_ymd:
        lossFirst
          ? lossFirst.ymd
          : null,


      loss_latest_weight:
        lossLatest
          ? lossLatest.kg
          : null,

      loss_latest_ymd:
        lossLatest
          ? lossLatest.ymd
          : null,


      current_weight:
        current
          ? current.kg
          : null,

      last_weight_ymd:
        current
          ? current.ymd
          : null,


      weight_count:
        weightHistory.length,


      quiz_answered:
        completed.length,

      quiz_correct:
        quizCorrect,

      quiz_total_predictions:
        quizHistory.length,


      push_registered:
        push
          ? 1
          : 0,

      push_updated_at:
        push
          ? push.updated_at
          : null,
    });


  user.is_leader =
    leader;


  return json(
    req,
    {

      ok:
        true,

      user,

      weight_history:
        weightHistory,

      quiz_history:
        quizHistory,

      rivals,

      watching,

      blocks,

      reports,
    }
  );
}


/* ============================================================
   Android用テスト通知
   ============================================================ */

function pushConfig(
  env
) {

  return {

    publicKey:
      String(
        env.VAPID_PUBLIC_KEY ||
        ''
      )
        .trim(),

    privateKey:
      String(
        env.VAPID_PRIVATE_KEY ||
        ''
      )
        .trim(),

    subject:
      String(
        env.VAPID_SUBJECT ||
        ''
      )
        .trim() ||
      'mailto:jomon@jomonkusama.com',
  };
}


async function sendAndroidTestPush(
  env,
  memberId
) {

  await ensurePushTable(
    env
  );


  const c =
    pushConfig(
      env
    );


  if (
    !c.publicKey ||
    !c.privateKey
  ) {

    return {

      ok:
        false,

      error:
        'push_not_configured',
    };
  }


  const row =
    await env.DB
      .prepare(`
        SELECT

          member_id,
          endpoint,
          p256dh,
          auth

        FROM push_subscriptions

        WHERE
          member_id=?
      `)
      .bind(
        memberId
      )
      .first();


  if (!row) {

    return {

      ok:
        false,

      error:
        'push_not_registered',
    };
  }


  try {

    webpush.setVapidDetails(
      c.subject,
      c.publicKey,
      c.privateKey
    );


    const subscription = {

      endpoint:
        row.endpoint,

      keys: {

        p256dh:
          row.p256dh,

        auth:
          row.auth,
      },
    };


    const payload =
      JSON.stringify({

        title:
          'みんやせ',

        body:
          'これはテスト通知です。ご迷惑をおかけしました。',

        tag:
          'minyase-admin-test',

        url:
          '/',
      });


    await webpush
      .sendNotification(
        subscription,
        payload,
        {

          TTL:
            5 * 60,

          urgency:
            'normal',
        }
      );


    return {

      ok:
        true,

      sent:
        true,
    };


  } catch (e) {

    const status =
      Number(
        e &&
        (
          e.statusCode ||
          e.status
        )
      );


    if (
      status === 404 ||
      status === 410
    ) {

      await env.DB
        .prepare(`
          DELETE FROM push_subscriptions

          WHERE
            member_id=?
            AND
            endpoint=?
        `)
        .bind(
          memberId,
          row.endpoint
        )
        .run();


      return {

        ok:
          false,

        error:
          'push_expired',

        status,
      };
    }


    console.error(
      'admin_test_push_error',
      memberId,
      status ||
      '',
      (
        e &&
        e.message
      ) ||
      e
    );


    return {

      ok:
        false,

      error:
        'push_send_failed',

      status:
        status ||
        null,
    };
  }
}


async function testPush(
  req,
  env,
  memberId
) {

  const dev =
    await env.DB
      .prepare(`
        SELECT

          member_id,
          nickname,
          group_id,
          banned

        FROM devices

        WHERE
          member_id=?
      `)
      .bind(
        memberId
      )
      .first();


  if (!dev) {

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


  const result =
    await sendAndroidTestPush(
      env,
      memberId
    );


  await writeAdminLog(
    env,
    'admin_android_test_push',
    dev.group_id ||
      null,
    {

      member_id:
        memberId,

      nickname:
        dev.nickname ||
        null,

      result:
        result.ok
          ? 'sent'
          : result.error,
    }
  );


  if (
    !result.ok
  ) {

    const status =
      result.error ===
        'push_not_configured'
        ? 503

        : result.error ===
            'push_expired'
          ? 410

          : result.error ===
              'push_not_registered'
            ? 409

            : 502;


    return bad(
      req,
      result.error,
      status
    );
  }


  return json(
    req,
    {

      ok:
        true,

      sent:
        true,

      member_id:
        memberId,

      title:
        'みんやせ',

      body:
        'これはテスト通知です。ご迷惑をおかけしました。',
    }
  );
}


/* ============================================================
   Route
   ============================================================ */

export async function adminUserRoute(
  req,
  env,
  url,
  p,
  m
) {

  if (
    !env.ADMIN_TOKEN
  ) {

    return bad(
      req,
      'no_admin_token',
      503
    );
  }


  if (
    !adminOk(
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


  /*
   * 一覧
   */
  if (
    p ===
      '/api/admin/users' &&
    m ===
      'GET'
  ) {

    return await usersList(
      req,
      env
    );
  }


  /*
   * Android用テスト通知
   */
  const testMatch =
    /^\/api\/admin\/users\/([^/]+)\/test-push$/
      .exec(
        p
      );


  if (
    testMatch &&
    m ===
      'POST'
  ) {

    const memberId =
      normalizeMemberId(
        testMatch[1]
      );


    if (!memberId) {

      return bad(
        req,
        'bad_member_id'
      );
    }


    return await testPush(
      req,
      env,
      memberId
    );
  }


  /*
   * 個別詳細
   */
  const detailMatch =
    /^\/api\/admin\/users\/([^/]+)$/
      .exec(
        p
      );


  if (
    detailMatch &&
    m ===
      'GET'
  ) {

    const memberId =
      normalizeMemberId(
        detailMatch[1]
      );


    if (!memberId) {

      return bad(
        req,
        'bad_member_id'
      );
    }


    return await userDetail(
      req,
      env,
      memberId
    );
  }


  return notFound(
    req
  );
}
