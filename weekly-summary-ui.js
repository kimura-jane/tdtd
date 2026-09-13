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


const LAST_MONDAY_YMD =
  '2026-12-28';


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

   total_kg
     その月曜日以前の最新体重の合計

   loss_kg
     9/1のスタート総体重からの累計減量

   week_loss_kg
     直前の集計日からの減量

     9/7だけは前の月曜日が無いため
     9/1 → 9/7 の変化を使う。
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


  /*
   * 丸め前の総体重を保持する。
   *
   * 前週差を
   * 「丸めた合計同士の差」
   * ではなく元データから計算するため。
   */
  const rawSummaries =
    mondayYmds.map(
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


          /*
           * 月曜日当日までで最新の値を採用。
           *
           * 例：
           * 9/5あり
           * 9/7なし
           * 9/8あり
           *
           * → 9/7速報は9/5を使う。
           *   9/8は使わない。
           */
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

          start_total_raw:
            startTotal,

          total_raw:
            mondayTotal,

          counted:
            count,
        };
      }
    );


  return rawSummaries.map(
    (
      row,
      index
    ) => {

      const previous =
        index >
          0
          ? rawSummaries[
              index - 1
            ]
          : null;


      /*
       * 9/7だけは9/1を比較元にする。
       *
       * 9/14以降は前回月曜日を比較元にする。
       */
      const weekFromYmd =
        previous
          ? previous.ymd
          : BASELINE_YMD;


      const weekFromTotal =
        previous
          ? previous.total_raw
          : row.start_total_raw;


      return {
        ymd:
          row.ymd,

        total_kg:
          row.counted
            ? round1(
                row.total_raw
              )
            : null,

        /*
         * 9/1からの累計減量
         */
        loss_kg:
          row.counted
            ? round1(
                row.start_total_raw -
                row.total_raw
              )
            : null,

        /*
         * 直前集計からの減量
         *
         * 9/7:
         *   9/1 → 9/7
         *
         * 9/14:
         *   9/7 → 9/14
         *
         * 9/21:
         *   9/14 → 9/21
         */
        week_from_ymd:
          weekFromYmd,

        week_loss_kg:
          row.counted
            ? round1(
                weekFromTotal -
                row.total_raw
              )
            : null,

        counted:
          row.counted,
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


  const activeMonday =
    isActiveMondayYmd(
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


  /*
   * 12/28以降の体重は
   * 月曜速報では一切必要ない。
   */
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
