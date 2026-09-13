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


const BASELINE_YMD =
  '2026-09-01';


const FIRST_MONDAY_YMD =
  '2026-09-07';


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


function mondayYmdsThrough(todayYmd) {

  const first =
    ymdToDay(
      FIRST_MONDAY_YMD
    );

  const end =
    ymdToDay(
      todayYmd
    );


  if (
    first ===
      null ||
    end ===
      null ||
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


/* ============================================================
   双方向ブロック

   ランキングと同様、ブロック関係の相手は
   集計からも除外する。
   ============================================================ */

async function mutualBlockedSet(
  env,
  dev
) {

  const result =
    new Set();


  const own =
    await env.DB
      .prepare(`
        SELECT blocked_member_id
        FROM blocks
        WHERE device_id=?
      `)
      .bind(
        dev.device_id
      )
      .all();


  for (
    const row of
    (
      own.results ||
      []
    )
  ) {

    if (
      row.blocked_member_id
    ) {

      result.add(
        String(
          row.blocked_member_id
        )
      );
    }
  }


  const reverse =
    await env.DB
      .prepare(`
        SELECT d.member_id

        FROM blocks b

        JOIN devices d
          ON d.device_id=b.device_id

        WHERE b.blocked_member_id=?
      `)
      .bind(
        dev.member_id
      )
      .all();


  for (
    const row of
    (
      reverse.results ||
      []
    )
  ) {

    if (
      row.member_id
    ) {

      result.add(
        String(
          row.member_id
        )
      );
    }
  }


  return result;
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


  /*
   * D1の1クエリ100パラメータ上限を超えないよう、
   * device_id 98件 + 開始日 + 終了日で分割する。
   */
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
   月曜速報を計算
   ============================================================ */

function buildSummaries(
  members,
  weightsByDevice,
  mondayYmds
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
      list.find(
        row =>
          row.ymd ===
            BASELINE_YMD
      );


    /*
     * 9/1の基準値が無い人は、
     * 総体重と減量幅の母集団を揃えるため集計しない。
     */
    if (!baseline) {

      continue;
    }


    prepared.push({
      device_id:
        member.device_id,

      baseline_kg:
        baseline.kg,

      weights:
        list,
    });
  }


  return mondayYmds.map(
    mondayYmd => {

      let startTotal =
        0;

      let mondayTotal =
        0;

      let count =
        0;


      for (
        const member of
        prepared
      ) {

        let latest =
          null;


        for (
          const row of
          member.weights
        ) {

          if (
            row.ymd >
              mondayYmd
          ) {

            break;
          }


          latest =
            row;
        }


        if (!latest) {

          continue;
        }


        startTotal +=
          member.baseline_kg;

        mondayTotal +=
          latest.kg;

        count++;
      }


      return {
        ymd:
          mondayYmd,

        total_kg:
          count
            ? round1(
                mondayTotal
              )
            : null,

        loss_kg:
          count
            ? round1(
                startTotal -
                mondayTotal
              )
            : null,

        counted:
          count,
      };
    }
  );
}


/* ============================================================
   API

   GET /api/weekly-summary?group_id=XXXXXXXX
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


  /*
   * グループ自体が体重非公開なら、
   * 実体重を使う速報は返さない。
   */
  if (
    Number(
      group.show_weight ||
      0
    ) !==
      1
  ) {

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
          isMondayYmd(
            todayYmd
          ),

        baseline_ymd:
          BASELINE_YMD,

        first_monday_ymd:
          FIRST_MONDAY_YMD,

        group: {
          group_id:
            group.group_id,

          name:
            group.name,
        },

        summaries:
          [],
      }
    );
  }


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


  const allMembers =
    rs.results ||
    [];


  const blocked =
    await mutualBlockedSet(
      env,
      dev
    );


  const hidden =
    await hiddenWeightSet(
      env,
      allMembers.map(
        row =>
          row.member_id
      )
    );


  const members =
    allMembers.filter(
      row =>
        !blocked.has(
          String(
            row.member_id
          )
        ) &&
        !hidden.has(
          String(
            row.member_id
          )
        )
    );


  const weightsByDevice =
    await loadWeightsByDevice(
      env,
      members.map(
        row =>
          row.device_id
      ),
      todayYmd
    );


  const summaries =
    buildSummaries(
      members,
      weightsByDevice,
      mondayYmds
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
        isMondayYmd(
          todayYmd
        ),

      baseline_ymd:
        BASELINE_YMD,

      first_monday_ymd:
        FIRST_MONDAY_YMD,

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
