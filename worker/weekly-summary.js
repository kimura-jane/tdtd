'use strict';

import {
  json,
  bad,
  round1
} from './lib.js';

import {
  hiddenWeightSet
} from './weight-privacy.js';


const TARGET_GROUP_IDS =
  new Set([
    '84Q8CG58',
    'AJ6N7AFJ',
    'T92787Z2',
    'XGQGRGRV',
    'C47DTD4C',
  ]);


const COMPETITION_TEAMS = [
  {
    team_id: 'tsudamomo',
    group_id: 'C47DTD4C',
    name: 'つだもも',
    short: 'つ',
    color: '#d8a91d',
  },
  {
    team_id: 'sakomitsu',
    group_id: 'XGQGRGRV',
    name: 'さこみつ',
    short: 'さ',
    color: '#4f9ec5',
  },
  {
    team_id: 'gotomei',
    group_id: 'T92787Z2',
    name: 'ゴトめい',
    short: 'ゴ',
    color: '#58a76a',
  },
];


const TEAM_BY_GROUP_ID =
  new Map(
    COMPETITION_TEAMS.map(
      team => [
        team.group_id,
        team
      ]
    )
  );


const BASELINE_YMD =
  '2026-09-01';


const FIRST_MONDAY_YMD =
  '2026-09-07';


const LAST_MONDAY_YMD =
  '2026-12-28';


const CAMPAIGN_END_YMD =
  '2026-12-31';


const JST_OFFSET =
  9 * 60 * 60 * 1000;


/* ============================================================
   group_id
   ============================================================ */

function normalizeGroupId(raw) {

  const id =
    String(
      raw ||
      ''
    )
      .trim()
      .toUpperCase()
      .replace(
        /[^0-9A-Z]/g,
        ''
      );


  return /^[0-9A-Z]{8}$/
    .test(
      id
    )
      ? id
      : null;
}


/* ============================================================
   JST日付
   ============================================================ */

function pad2(value) {

  return String(
    value
  )
    .padStart(
      2,
      '0'
    );
}


function todayYmdJST() {

  const d =
    new Date(
      Date.now() +
      JST_OFFSET
    );


  return (
    d.getUTCFullYear() +
    '-' +
    pad2(
      d.getUTCMonth() +
      1
    ) +
    '-' +
    pad2(
      d.getUTCDate()
    )
  );
}


function ymdToDay(ymd) {

  const m =
    /^(\d{4})-(\d{2})-(\d{2})$/
      .exec(
        String(
          ymd ||
          ''
        )
      );


  if (!m) {

    return null;
  }


  return Math.floor(
    Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3])
    ) /
    86400000
  );
}


function dayToYmd(day) {

  const d =
    new Date(
      day *
      86400000
    );


  return (
    d.getUTCFullYear() +
    '-' +
    pad2(
      d.getUTCMonth() +
      1
    ) +
    '-' +
    pad2(
      d.getUTCDate()
    )
  );
}


function isMondayYmd(ymd) {

  const day =
    ymdToDay(
      ymd
    );


  if (
    day ===
      null
  ) {

    return false;
  }


  return new Date(
    day *
    86400000
  )
    .getUTCDay() ===
    1;
}


function isMonthStartYmd(ymd) {

  return /^\d{4}-\d{2}-01$/
    .test(
      String(
        ymd ||
        ''
      )
    );
}


function isActiveMondayYmd(ymd) {

  return !!(
    ymd >=
      FIRST_MONDAY_YMD &&
    ymd <=
      LAST_MONDAY_YMD &&
    isMondayYmd(
      ymd
    )
  );
}


function mondayYmdsThrough(todayYmd) {

  const first =
    ymdToDay(
      FIRST_MONDAY_YMD
    );


  const today =
    ymdToDay(
      todayYmd
    );


  const last =
    ymdToDay(
      LAST_MONDAY_YMD
    );


  if (
    first ===
      null ||
    today ===
      null ||
    last ===
      null
  ) {

    return [];
  }


  const end =
    Math.min(
      today,
      last
    );


  if (
    end <
      first
  ) {

    return [];
  }


  const result =
    [];


  for (
    let day = first;
    day <= end;
    day += 7
  ) {

    result.push(
      dayToYmd(
        day
      )
    );
  }


  return result;
}


function officialYmdsThrough(todayYmd) {

  const first =
    ymdToDay(
      BASELINE_YMD
    );


  const today =
    ymdToDay(
      todayYmd
    );


  const last =
    ymdToDay(
      CAMPAIGN_END_YMD
    );


  if (
    first ===
      null ||
    today ===
      null ||
    last ===
      null
  ) {

    return [];
  }


  const end =
    Math.min(
      today,
      last
    );


  if (
    end <
      first
  ) {

    return [];
  }


  const result =
    [];


  for (
    let day = first;
    day <= end;
    day++
  ) {

    const ymd =
      dayToYmd(
        day
      );


    if (
      isMondayYmd(
        ymd
      ) ||
      isMonthStartYmd(
        ymd
      )
    ) {

      result.push(
        ymd
      );
    }
  }


  return result;
}


function nextOfficialYmd(todayYmd) {

  const today =
    ymdToDay(
      todayYmd
    );


  const last =
    ymdToDay(
      CAMPAIGN_END_YMD
    );


  if (
    today ===
      null ||
    last ===
      null ||
    today >
      last
  ) {

    return null;
  }


  for (
    let day = today;
    day <= last;
    day++
  ) {

    const ymd =
      dayToYmd(
        day
      );


    if (
      isMondayYmd(
        ymd
      ) ||
      isMonthStartYmd(
        ymd
      )
    ) {

      return ymd;
    }
  }


  return null;
}


function daysBetween(
  fromYmd,
  toYmd
) {

  const from =
    ymdToDay(
      fromYmd
    );


  const to =
    ymdToDay(
      toYmd
    );


  if (
    from ===
      null ||
    to ===
      null
  ) {

    return null;
  }


  return (
    to -
    from
  );
}


/* ============================================================
   閲覧権限
   ============================================================ */

async function canViewGroup(
  env,
  dev,
  groupId
) {

  if (
    !dev ||
    !groupId
  ) {

    return false;
  }


  if (
    normalizeGroupId(
      dev.group_id
    ) ===
      groupId
  ) {

    return true;
  }


  const row =
    await env.DB
      .prepare(`
        SELECT group_id
        FROM watching
        WHERE
          device_id=?
          AND group_id=?
        LIMIT 1
      `)
      .bind(
        dev.device_id,
        groupId
      )
      .first();


  return !!row;
}


function canViewClub(dev) {

  const groupId =
    normalizeGroupId(
      dev &&
      dev.group_id
    );


  return !!(
    groupId &&
    TARGET_GROUP_IDS.has(
      groupId
    )
  );
}


/* ============================================================
   体重履歴
   ============================================================ */

async function loadWeightsByDevice(
  env,
  deviceIds,
  endYmd
) {

  const ids =
    [
      ...new Set(
        (
          Array.isArray(
            deviceIds
          )
            ? deviceIds
            : []
        )
          .map(
            value =>
              String(
                value ||
                ''
              )
                .trim()
          )
          .filter(
            Boolean
          )
      )
    ];


  const map =
    new Map(
      ids.map(
        id => [
          id,
          []
        ]
      )
    );


  if (!ids.length) {

    return map;
  }


  const CHUNK_SIZE =
    98;


  for (
    let offset = 0;
    offset < ids.length;
    offset += CHUNK_SIZE
  ) {

    const chunk =
      ids.slice(
        offset,
        offset + CHUNK_SIZE
      );


    const ph =
      chunk
        .map(
          () => '?'
        )
        .join(',');


    const rs =
      await env.DB
        .prepare(`
          SELECT
            device_id,
            ymd,
            kg

          FROM weights

          WHERE
            device_id IN (${ph})
            AND ymd>=?
            AND ymd<=?

          ORDER BY
            device_id ASC,
            ymd ASC
        `)
        .bind(
          ...chunk,
          BASELINE_YMD,
          endYmd
        )
        .all();


    for (
      const row of
      (
        rs.results ||
        []
      )
    ) {

      const deviceId =
        String(
          row.device_id ||
          ''
        );


      const ymd =
        String(
          row.ymd ||
          ''
        );


      const kg =
        Number(
          row.kg
        );


      if (
        !map.has(
          deviceId
        ) ||
        !/^\d{4}-\d{2}-\d{2}$/
          .test(
            ymd
          ) ||
        !Number.isFinite(
          kg
        )
      ) {

        continue;
      }


      map
        .get(
          deviceId
        )
        .push({
          ymd,
          kg,
        });
    }
  }


  return map;
}


/* ============================================================
   指定日以前 / 指定日の体重
   ============================================================ */

function latestAtOrBefore(
  list,
  ymd
) {

  let latest =
    null;


  for (
    const row of
    (
      Array.isArray(
        list
      )
        ? list
        : []
    )
  ) {

    if (
      row.ymd >
        ymd
    ) {

      break;
    }


    latest =
      row;
  }


  return latest;
}


function exactAt(
  list,
  ymd
) {

  for (
    const row of
    (
      Array.isArray(
        list
      )
        ? list
        : []
    )
  ) {

    if (
      row.ymd ===
        ymd
    ) {

      return row;
    }


    if (
      row.ymd >
        ymd
    ) {

      break;
    }
  }


  return null;
}


/* ============================================================
   月曜速報を計算
   既存仕様は変更しない
   ============================================================ */

function buildSummaries(
  members,
  weightsByDevice,
  mondayYmds,
  hiddenMembers,
  publicTotalsEnabled
) {

  const prepared =
    [];


  for (
    const member of
    members
  ) {

    const list =
      weightsByDevice.get(
        member.device_id
      ) ||
      [];


    const baseline =
      list.length
        ? list[0]
        : null;


    if (!baseline) {

      continue;
    }


    prepared.push({
      device_id:
        member.device_id,

      member_id:
        String(
          member.member_id ||
          ''
        ),

      baseline_ymd:
        baseline.ymd,

      baseline_kg:
        baseline.kg,

      weight_hidden:
        hiddenMembers.has(
          String(
            member.member_id ||
            ''
          )
        ),

      weights:
        list,
    });
  }


  return mondayYmds.map(
    (
      mondayYmd,
      index
    ) => {

      const previousMondayYmd =
        index >
          0
          ? mondayYmds[
              index -
              1
            ]
          : BASELINE_YMD;


      let totalRaw =
        0;


      let totalCount =
        0;


      let lossRaw =
        0;


      let lossCount =
        0;


      let weekLossRaw =
        0;


      let weekCount =
        0;


      for (
        const member of
        prepared
      ) {

        if (
          member.baseline_ymd >
            mondayYmd
        ) {

          continue;
        }


        const latest =
          latestAtOrBefore(
            member.weights,
            mondayYmd
          );


        if (!latest) {

          continue;
        }


        lossRaw +=
          member.baseline_kg -
          latest.kg;


        lossCount++;


        if (
          publicTotalsEnabled &&
          !member.weight_hidden
        ) {

          totalRaw +=
            latest.kg;


          totalCount++;
        }


        let weekStart =
          null;


        if (
          index ===
            0
        ) {

          weekStart = {
            ymd:
              member.baseline_ymd,

            kg:
              member.baseline_kg,
          };


        } else {

          const previous =
            latestAtOrBefore(
              member.weights,
              previousMondayYmd
            );


          if (
            previous &&
            member.baseline_ymd <=
              previousMondayYmd
          ) {

            weekStart =
              previous;


          } else if (
            member.baseline_ymd >
              previousMondayYmd &&
            member.baseline_ymd <=
              mondayYmd
          ) {

            weekStart = {
              ymd:
                member.baseline_ymd,

              kg:
                member.baseline_kg,
            };
          }
        }


        if (
          weekStart
        ) {

          weekLossRaw +=
            weekStart.kg -
            latest.kg;


          weekCount++;
        }
      }


      return {
        ymd:
          mondayYmd,

        total_kg:
          totalCount
            ? round1(
                totalRaw
              )
            : null,

        total_count:
          totalCount,

        loss_kg:
          lossCount
            ? round1(
                lossRaw
              )
            : null,

        loss_count:
          lossCount,

        week_from_ymd:
          previousMondayYmd,

        week_loss_kg:
          weekCount
            ? round1(
                weekLossRaw
              )
            : null,

        week_count:
          weekCount,

        counted:
          totalCount,
      };
    }
  );
}


/* ============================================================
   つだつダイエット部 大会データ
   ============================================================ */

async function loadCompetitionMembers(
  env
) {

  const groupIds =
    COMPETITION_TEAMS.map(
      team =>
        team.group_id
    );


  const ph =
    groupIds
      .map(
        () => '?'
      )
      .join(',');


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
          group_id IN (${ph})
          AND banned=0

        ORDER BY
          group_id ASC,
          member_id ASC
      `)
      .bind(
        ...groupIds
      )
      .all();


  return (
    rs.results ||
    []
  )
    .map(
      row => {

        const groupId =
          normalizeGroupId(
            row.group_id
          );


        const team =
          TEAM_BY_GROUP_ID.get(
            groupId
          );


        if (
          !team
        ) {

          return null;
        }


        return {
          device_id:
            String(
              row.device_id ||
              ''
            ),

          member_id:
            String(
              row.member_id ||
              ''
            ),

          nickname:
            String(
              row.nickname ||
              ''
            ).trim() ||
            '名前未設定',

          group_id:
            groupId,

          team_id:
            team.team_id,

          team_name:
            team.name,

          team_short:
            team.short,

          team_color:
            team.color,
        };
      }
    )
    .filter(
      Boolean
    );
}


function prepareCompetitionMembers(
  members,
  weightsByDevice,
  hiddenMembers
) {

  return members.map(
    member => {

      const weights =
        weightsByDevice.get(
          member.device_id
        ) ||
        [];


      const baseline =
        exactAt(
          weights,
          BASELINE_YMD
        );


      return {
        ...member,

        weights,

        baseline_kg:
          baseline
            ? baseline.kg
            : null,

        has_baseline:
          !!baseline,

        weight_hidden:
          hiddenMembers.has(
            member.member_id
          ),
      };
    }
  );
}


function buildCompetitionPoints(
  preparedMembers,
  officialYmds
) {

  return COMPETITION_TEAMS.map(
    team => {

      const allTeamMembers =
        preparedMembers.filter(
          member =>
            member.group_id ===
              team.group_id
        );


      const teamMembers =
        allTeamMembers.filter(
          member =>
            member.has_baseline
        );


      const points =
        officialYmds.map(
          ymd => {

            let lossRaw =
              0;


            let counted =
              0;


            for (
              const member of
              teamMembers
            ) {

              const latest =
                latestAtOrBefore(
                  member.weights,
                  ymd
                );


              if (!latest) {

                continue;
              }


              lossRaw +=
                member.baseline_kg -
                latest.kg;


              counted++;
            }


            return {
              ymd,

              loss_kg:
                counted
                  ? round1(
                      lossRaw
                    )
                  : null,

              counted,
            };
          }
        );


      return {
        team_id:
          team.team_id,

        group_id:
          team.group_id,

        name:
          team.name,

        short:
          team.short,

        color:
          team.color,

        member_count:
          allTeamMembers.length,

        baseline_count:
          teamMembers.length,

        points,
      };
    }
  );
}


function topEntry(
  member,
  lossKg
) {

  return {
    member_id:
      member.member_id,

    nickname:
      member.nickname,

    group_id:
      member.group_id,

    team_id:
      member.team_id,

    team_name:
      member.team_name,

    team_short:
      member.team_short,

    team_color:
      member.team_color,

    weight_hidden:
      member.weight_hidden,

    loss_kg:
      round1(
        lossKg
      ),
  };
}


function sortTopRows(rows) {

  return rows
    .sort(
      (
        a,
        b
      ) => {

        const lossDiff =
          Number(
            b.loss_kg
          ) -
          Number(
            a.loss_kg
          );


        if (
          lossDiff !==
            0
        ) {

          return lossDiff;
        }


        const teamDiff =
          String(
            a.team_id
          )
            .localeCompare(
              String(
                b.team_id
              )
            );


        if (
          teamDiff !==
            0
        ) {

          return teamDiff;
        }


        return String(
          a.nickname
        )
          .localeCompare(
            String(
              b.nickname
            ),
            'ja'
          );
      }
    )
    .slice(
      0,
      5
    );
}


function buildCompetitionTop5(
  preparedMembers,
  officialYmds,
  mondayYmds
) {

  const cumulativeYmd =
    officialYmds.length
      ? officialYmds[
          officialYmds.length -
          1
        ]
      : null;


  const weeklyYmd =
    mondayYmds.length
      ? mondayYmds[
          mondayYmds.length -
          1
        ]
      : null;


  const weekFromYmd =
    mondayYmds.length >
      1
      ? mondayYmds[
          mondayYmds.length -
          2
        ]
      : (
          weeklyYmd
            ? BASELINE_YMD
            : null
        );


  const cumulative =
    [];


  const weekly =
    [];


  for (
    const member of
    preparedMembers
  ) {

    if (
      !member.has_baseline
    ) {

      continue;
    }


    if (
      cumulativeYmd
    ) {

      const latest =
        latestAtOrBefore(
          member.weights,
          cumulativeYmd
        );


      if (
        latest
      ) {

        cumulative.push(
          topEntry(
            member,
            member.baseline_kg -
            latest.kg
          )
        );
      }
    }


    if (
      weeklyYmd &&
      weekFromYmd
    ) {

      const latestMonday =
        latestAtOrBefore(
          member.weights,
          weeklyYmd
        );


      const previousMonday =
        weekFromYmd ===
          BASELINE_YMD
          ? exactAt(
              member.weights,
              BASELINE_YMD
            )
          : latestAtOrBefore(
              member.weights,
              weekFromYmd
            );


      if (
        latestMonday &&
        previousMonday
      ) {

        weekly.push(
          topEntry(
            member,
            previousMonday.kg -
            latestMonday.kg
          )
        );
      }
    }
  }


  return {
    official_ymd:
      cumulativeYmd,

    weekly_ymd:
      weeklyYmd,

    week_from_ymd:
      weekFromYmd,

    cumulative:
      sortTopRows(
        cumulative
      ),

    weekly:
      sortTopRows(
        weekly
      ),
  };
}


function mondayWindowStillOpen(
  officialYmd,
  todayYmd
) {

  if (
    !isMondayYmd(
      officialYmd
    )
  ) {

    return false;
  }


  const officialDay =
    ymdToDay(
      officialYmd
    );


  const todayDay =
    ymdToDay(
      todayYmd
    );


  if (
    officialDay ===
      null ||
    todayDay ===
      null
  ) {

    return false;
  }


  return (
    todayDay >=
      officialDay &&
    todayDay <
      officialDay +
      7
  );
}


function buildMissingOfficials(
  preparedMembers,
  officialYmds,
  todayYmd
) {

  const result =
    [];


  for (
    const ymd of
    officialYmds
  ) {

    const monthStart =
      isMonthStartYmd(
        ymd
      );


    const monday =
      isMondayYmd(
        ymd
      );


    if (
      !monthStart &&
      !monday
    ) {

      continue;
    }


    /*
     * 月曜日の未入力：
     * 次の月曜日になるまで残す。
     *
     * 毎月1日の未入力：
     * 全員が入力するまで残す。
     */
    if (
      !monthStart &&
      monday &&
      !mondayWindowStillOpen(
        ymd,
        todayYmd
      )
    ) {

      continue;
    }


    const missing =
      [];


    for (
      const member of
      preparedMembers
    ) {

      if (
        exactAt(
          member.weights,
          ymd
        )
      ) {

        continue;
      }


      missing.push({
        member_id:
          member.member_id,

        nickname:
          member.nickname,

        group_id:
          member.group_id,

        team_id:
          member.team_id,

        team_name:
          member.team_name,

        team_short:
          member.team_short,

        team_color:
          member.team_color,
      });
    }


    if (
      !missing.length
    ) {

      continue;
    }


    result.push({
      ymd,

      kind:
        monthStart
          ? 'month_start'
          : 'monday',

      missing_count:
        missing.length,

      members:
        missing,
    });
  }


  return result;
}


async function clubSummaryRoute(
  req,
  env,
  dev
) {

  if (
    !canViewClub(
      dev
    )
  ) {

    return bad(
      req,
      'club_summary_not_enabled',
      403
    );
  }


  const todayYmd =
    todayYmdJST();


  const weightEndYmd =
    todayYmd <
      CAMPAIGN_END_YMD
      ? todayYmd
      : CAMPAIGN_END_YMD;


  const members =
    await loadCompetitionMembers(
      env
    );


  const hiddenMembers =
    await hiddenWeightSet(
      env,
      members.map(
        member =>
          member.member_id
      )
    );


  const weightsByDevice =
    await loadWeightsByDevice(
      env,
      members.map(
        member =>
          member.device_id
      ),
      weightEndYmd
    );


  const preparedMembers =
    prepareCompetitionMembers(
      members,
      weightsByDevice,
      hiddenMembers
    );


  const officialYmds =
    officialYmdsThrough(
      todayYmd
    );


  const mondayYmds =
    mondayYmdsThrough(
      todayYmd
    );


  const teams =
    buildCompetitionPoints(
      preparedMembers,
      officialYmds
    );


  const top5 =
    buildCompetitionTop5(
      preparedMembers,
      officialYmds,
      mondayYmds
    );


  const missing =
    buildMissingOfficials(
      preparedMembers,
      officialYmds,
      todayYmd
    );


  const nextOfficial =
    nextOfficialYmd(
      todayYmd
    );


  return json(
    req,
    {
      ok:
        true,

      eligible:
        true,

      mode:
        'club',

      title:
        'つだつダイエット部',

      today_ymd:
        todayYmd,

      baseline_ymd:
        BASELINE_YMD,

      campaign_end_ymd:
        CAMPAIGN_END_YMD,

      next_official_ymd:
        nextOfficial,

      next_official_days:
        nextOfficial
          ? daysBetween(
              todayYmd,
              nextOfficial
            )
          : null,

      official_ymds:
        officialYmds,

      teams,

      top5,

      missing,
    }
  );
}


/* ============================================================
   API

   GET /api/weekly-summary?group_id=XXXXXXXX
   GET /api/weekly-summary?club=1
   ============================================================ */

export async function weeklySummaryRoute(
  req,
  env,
  dev,
  url,
  p,
  m
) {

  if (
    p !==
      '/api/weekly-summary'
  ) {

    return null;
  }


  if (
    m !==
      'GET'
  ) {

    return bad(
      req,
      'method_not_allowed',
      405
    );
  }


  if (
    url.searchParams.get(
      'club'
    ) ===
      '1'
  ) {

    return await clubSummaryRoute(
      req,
      env,
      dev
    );
  }


  const groupId =
    normalizeGroupId(
      url.searchParams.get(
        'group_id'
      )
    );


  if (!groupId) {

    return bad(
      req,
      'bad_code'
    );
  }


  if (
    !TARGET_GROUP_IDS.has(
      groupId
    )
  ) {

    return bad(
      req,
      'weekly_summary_not_enabled',
      404
    );
  }


  if (
    !await canViewGroup(
      env,
      dev,
      groupId
    )
  ) {

    return bad(
      req,
      'not_watching',
      403
    );
  }


  const group =
    await env.DB
      .prepare(`
        SELECT
          group_id,
          name,
          show_weight

        FROM groups

        WHERE group_id=?
      `)
      .bind(
        groupId
      )
      .first();


  if (!group) {

    return bad(
      req,
      'group_not_found',
      404
    );
  }


  const todayYmd =
    todayYmdJST();


  const mondayYmds =
    mondayYmdsThrough(
      todayYmd
    );


  const activeMonday =
    isActiveMondayYmd(
      todayYmd
    );


  const publicTotalsEnabled =
    Number(
      group.show_weight ||
      0
    ) ===
      1;


  const rs =
    await env.DB
      .prepare(`
        SELECT
          device_id,
          member_id

        FROM devices

        WHERE
          group_id=?
          AND banned=0
      `)
      .bind(
        groupId
      )
      .all();


  const members =
    rs.results ||
    [];


  const hiddenMembers =
    await hiddenWeightSet(
      env,
      members.map(
        row =>
          row.member_id
      )
    );


  const weightEndYmd =
    todayYmd <
      LAST_MONDAY_YMD
      ? todayYmd
      : LAST_MONDAY_YMD;


  const weightsByDevice =
    await loadWeightsByDevice(
      env,
      members.map(
        row =>
          row.device_id
      ),
      weightEndYmd
    );


  const summaries =
    buildSummaries(
      members,
      weightsByDevice,
      mondayYmds,
      hiddenMembers,
      publicTotalsEnabled
    );


  return json(
    req,
    {
      ok:
        true,

      eligible:
        true,

      today_ymd:
        todayYmd,

      today_is_monday:
        activeMonday,

      baseline_ymd:
        BASELINE_YMD,

      first_monday_ymd:
        FIRST_MONDAY_YMD,

      last_monday_ymd:
        LAST_MONDAY_YMD,

      group: {
        group_id:
          group.group_id,

        name:
          group.name,
      },

      summaries,
    }
  );
}
