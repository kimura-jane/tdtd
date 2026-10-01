'use strict';

/* ============================================================
   みんやせ / worker/monthly-results.js

   月間正式結果
   ------------------------------------------------------------
   ・つだもも / さこみつ / ゴトめいの3チームを集計
   ・期間の開始日 / 終了日の実測体重が全員分揃った時だけ確定可能
   ・管理画面で選んだ勝利チームと自動集計1位を照合
   ・確定時の順位をスナップショット保存
   ・保存後は過去体重を編集しても正式結果は変えない
   ・このファイル自身はD1テーブルを作成しない
   ============================================================ */

const COMPETITION_START =
  '2026-09-01';

const COMPETITION_END =
  '2026-12-31';

const TOP_VISIBLE_MS =
  7 * 24 * 60 * 60 * 1000;


export const COMPETITION_TEAMS = [
  {
    id:
      'tsudamomo',

    name:
      'つだもも',

    group_id:
      'C47DTD4C',
  },
  {
    id:
      'sakomitsu',

    name:
      'さこみつ',

    group_id:
      'XGQGRGRV',
  },
  {
    id:
      'gotomei',

    name:
      'ゴトめい',

    group_id:
      'T92787Z2',
  },
];


const TEAM_BY_ID =
  new Map(
    COMPETITION_TEAMS.map(
      team => [
        team.id,
        team,
      ]
    )
  );


function pad2(value) {

  return String(value)
    .padStart(
      2,
      '0'
    );
}


function round1(value) {

  return Math.round(
    Number(value) *
    10
  ) /
  10;
}


function validYmd(value) {

  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/
      .exec(
        String(
          value ||
          ''
        )
      );


  if (!match) {

    return false;
  }


  const year =
    Number(match[1]);

  const month =
    Number(match[2]);

  const day =
    Number(match[3]);


  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );


  return (
    date.getUTCFullYear() ===
      year &&
    date.getUTCMonth() ===
      month - 1 &&
    date.getUTCDate() ===
      day
  );
}


function previousMonthFirst(
  endYmd
) {

  if (
    !validYmd(
      endYmd
    )
  ) {

    return null;
  }


  const [
    year,
    month,
  ] =
    endYmd
      .split('-')
      .map(Number);


  let y =
    year;

  let m =
    month - 1;


  if (
    m === 0
  ) {

    m =
      12;

    y--;
  }


  return (
    y +
    '-' +
    pad2(m) +
    '-01'
  );
}


/*
 * 予想クイズの round_key と正式結果の対象期間を対応させる。
 *
 * 2026-10 → 2026-09-01〜2026-10-01
 * 2026-11 → 2026-10-01〜2026-11-01
 * 2026-12 → 2026-11-01〜2026-12-01
 * 2027-01 → 2026-12-01〜2026-12-31
 */
export function monthlyResultPeriod(
  roundKey,
  targetDate
) {

  const key =
    String(
      roundKey ||
      ''
    );


  if (
    key ===
      '2027-01'
  ) {

    return {
      start:
        '2026-12-01',

      end:
        COMPETITION_END,
    };
  }


  if (
    ![
      '2026-10',
      '2026-11',
      '2026-12',
    ].includes(key) ||
    !validYmd(
      targetDate
    )
  ) {

    return null;
  }


  const start =
    previousMonthFirst(
      targetDate
    );


  if (
    !start ||
    start <
      COMPETITION_START ||
    targetDate >
      COMPETITION_END
  ) {

    return null;
  }


  return {
    start,
    end:
      targetDate,
  };
}


function placeholders(count) {

  return new Array(count)
    .fill('?')
    .join(',');
}


export function monthlyTeamName(
  teamId
) {

  const team =
    TEAM_BY_ID.get(
      teamId
    );


  return team
    ? team.name
    : null;
}


export async function monthlyResultsTableExists(
  env
) {

  try {

    const row =
      await env.DB
        .prepare(`
          SELECT name
          FROM sqlite_master
          WHERE
            type='table'
            AND name='competition_monthly_results'
          LIMIT 1
        `)
        .first();


    return !!row;

  } catch (_) {

    return false;
  }
}


async function competitionMembers(
  env
) {

  const groupIds =
    COMPETITION_TEAMS.map(
      team =>
        team.group_id
    );


  const rs =
    await env.DB
      .prepare(`
        SELECT
          device_id,
          member_id,
          nickname,
          group_id

        FROM devices

        WHERE
          group_id IN (${placeholders(groupIds.length)})
          AND banned=0

        ORDER BY
          group_id ASC,
          joined_at ASC,
          member_id ASC
      `)
      .bind(
        ...groupIds
      )
      .all();


  return rs.results || [];
}


async function exactWeights(
  env,
  deviceIds,
  startYmd,
  endYmd
) {

  if (
    !deviceIds.length
  ) {

    return [];
  }


  const rs =
    await env.DB
      .prepare(`
        SELECT
          device_id,
          ymd,
          kg

        FROM weights

        WHERE
          device_id IN (${placeholders(deviceIds.length)})
          AND ymd IN (?, ?)
      `)
      .bind(
        ...deviceIds,
        startYmd,
        endYmd
      )
      .all();


  return rs.results || [];
}


export async function calculateMonthlyResult(
  env,
  roundKey,
  targetDate
) {

  const period =
    monthlyResultPeriod(
      roundKey,
      targetDate
    );


  if (!period) {

    return {
      ok:
        false,

      error:
        'official_result_period_unavailable',
    };
  }


  const members =
    await competitionMembers(
      env
    );


  const byGroup =
    new Map(
      COMPETITION_TEAMS.map(
        team => [
          team.group_id,
          [],
        ]
      )
    );


  for (
    const member of
    members
  ) {

    if (
      byGroup.has(
        member.group_id
      )
    ) {

      byGroup
        .get(
          member.group_id
        )
        .push(
          member
        );
    }
  }


  const emptyTeams =
    COMPETITION_TEAMS
      .filter(
        team =>
          !byGroup
            .get(
              team.group_id
            )
            .length
      )
      .map(
        team =>
          team.name
      );


  if (
    emptyTeams.length
  ) {

    return {
      ok:
        false,

      error:
        'official_result_team_empty',

      empty_teams:
        emptyTeams,
    };
  }


  const deviceIds =
    members.map(
      member =>
        member.device_id
    );


  const rows =
    await exactWeights(
      env,
      deviceIds,
      period.start,
      period.end
    );


  const weightMap =
    new Map();


  for (
    const row of
    rows
  ) {

    const kg =
      Number(row.kg);


    if (
      Number.isFinite(kg)
    ) {

      weightMap.set(
        row.device_id +
        '|' +
        row.ymd,
        kg
      );
    }
  }


  const missing =
    [];

  const totals =
    [];


  for (
    const team of
    COMPETITION_TEAMS
  ) {

    const teamMembers =
      byGroup.get(
        team.group_id
      );


    let startTotal =
      0;

    let endTotal =
      0;


    for (
      const member of
      teamMembers
    ) {

      const startKey =
        member.device_id +
        '|' +
        period.start;

      const endKey =
        member.device_id +
        '|' +
        period.end;


      const startKg =
        weightMap.has(
          startKey
        )
          ? weightMap.get(
              startKey
            )
          : null;

      const endKg =
        weightMap.has(
          endKey
        )
          ? weightMap.get(
              endKey
            )
          : null;


      if (
        !Number.isFinite(
          startKg
        )
      ) {

        missing.push({
          team_id:
            team.id,

          team_name:
            team.name,

          member_id:
            member.member_id,

          nickname:
            member.nickname ||
            null,

          ymd:
            period.start,
        });
      }


      if (
        !Number.isFinite(
          endKg
        )
      ) {

        missing.push({
          team_id:
            team.id,

          team_name:
            team.name,

          member_id:
            member.member_id,

          nickname:
            member.nickname ||
            null,

          ymd:
            period.end,
        });
      }


      if (
        Number.isFinite(
          startKg
        )
      ) {

        startTotal +=
          startKg;
      }


      if (
        Number.isFinite(
          endKg
        )
      ) {

        endTotal +=
          endKg;
      }
    }


    totals.push({
      team_id:
        team.id,

      team_name:
        team.name,

      member_count:
        teamMembers.length,

      start_total_kg:
        round1(
          startTotal
        ),

      end_total_kg:
        round1(
          endTotal
        ),

      loss_kg:
        round1(
          startTotal -
          endTotal
        ),
    });
  }


  if (
    missing.length
  ) {

    return {
      ok:
        false,

      error:
        'official_result_incomplete',

      period_start:
        period.start,

      period_end:
        period.end,

      missing_count:
        missing.length,

      missing,
    };
  }


  const rankings =
    [...totals]
      .sort(
        (
          a,
          b
        ) =>
          b.loss_kg -
          a.loss_kg
      )
      .map(
        (
          row,
          index
        ) => ({
          rank:
            index + 1,

          ...row,
        })
      );


  return {
    ok:
      true,

    round_key:
      roundKey,

    period_start:
      period.start,

    period_end:
      period.end,

    rankings,
  };
}


export async function getSavedMonthlyResult(
  env,
  roundKey
) {

  if (
    !await monthlyResultsTableExists(
      env
    )
  ) {

    return null;
  }


  return await env.DB
    .prepare(`
      SELECT *
      FROM competition_monthly_results
      WHERE round_key=?
    `)
    .bind(
      roundKey
    )
    .first();
}


export function monthlyResultInsertStatement(
  env,
  result,
  publishedAt
) {

  if (
    !result ||
    result.ok !==
      true ||
    !Array.isArray(
      result.rankings
    ) ||
    result.rankings.length !==
      3
  ) {

    throw new Error(
      'bad_official_result'
    );
  }


  const [
    first,
    second,
    third,
  ] =
    result.rankings;


  return env.DB
    .prepare(`
      INSERT INTO competition_monthly_results
      (
        round_key,
        period_start,
        period_end,
        first_team,
        first_loss_kg,
        second_team,
        second_loss_kg,
        third_team,
        third_loss_kg,
        published_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      result.round_key,
      result.period_start,
      result.period_end,
      first.team_id,
      first.loss_kg,
      second.team_id,
      second.loss_kg,
      third.team_id,
      third.loss_kg,
      publishedAt
    );
}


function publicTeam(
  teamId,
  lossKg,
  rank
) {

  const team =
    TEAM_BY_ID.get(
      teamId
    );


  return {
    rank,

    team_id:
      teamId ||
      null,

    team_name:
      team
        ? team.name
        : null,

    loss_kg:
      Number(lossKg),
  };
}


function publicSavedRow(
  row,
  now
) {

  const publishedAt =
    Number(
      row.published_at
    );


  return {
    round_key:
      row.round_key,

    period_start:
      row.period_start,

    period_end:
      row.period_end,

    published_at:
      publishedAt,

    top_visible:
      Number.isFinite(
        publishedAt
      ) &&
      now <
        publishedAt +
        TOP_VISIBLE_MS,

    rankings: [
      publicTeam(
        row.first_team,
        row.first_loss_kg,
        1
      ),
      publicTeam(
        row.second_team,
        row.second_loss_kg,
        2
      ),
      publicTeam(
        row.third_team,
        row.third_loss_kg,
        3
      ),
    ],
  };
}


export async function monthlyResultsPayload(
  env,
  now = Date.now()
) {

  if (
    !await monthlyResultsTableExists(
      env
    )
  ) {

    return {
      current:
        null,

      history:
        [],
    };
  }


  const rs =
    await env.DB
      .prepare(`
        SELECT *
        FROM competition_monthly_results
        ORDER BY period_end DESC
      `)
      .all();


  const results =
    (
      rs.results ||
      []
    )
      .map(
        row =>
          publicSavedRow(
            row,
            now
          )
      );


  return {
    current:
      results.find(
        result =>
          result.top_visible
      ) ||
      null,

    history:
      results.filter(
        result =>
          !result.top_visible
      ),
  };
}
