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
   指定日以前の最新体重
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


/* ============================================================
   月曜速報を計算

   基準体重
   ------------------------------------------------------------
   ・9/1に記録があれば9/1
   ・9/1に記録が無ければ
     9/1以降の最初の記録

   例：
   最初の記録が9/10なら
   9/7速報には入らない。
   9/14速報から対象になる。


   total_kg / total_count
   ------------------------------------------------------------
   実体重を公開しているメンバーだけ。

   現在非公開のメンバーは、
   過去の総体重からも除外する。


   loss_kg / loss_count
   ------------------------------------------------------------
   公開・非公開に関係なく、
   基準体重からの減量差だけを集計する。

   個人の実体重は返さない。


   week_loss_kg / week_count
   ------------------------------------------------------------
   前回月曜から今回月曜までの減量差。

   前回月曜より後に初記録した新規対象者は、
   その人の最初の記録を週次の比較元にする。


   ブロック
   ------------------------------------------------------------
   チーム全体の公式集計値なので、
   閲覧者ごとのブロック関係では母数を変えない。
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


    /*
     * loadWeightsByDevice() は
     * 9/1以降を日付昇順で返す。
     *
     * したがって先頭が、
     * その人の基準体重。
     *
     * 9/1に記録があれば9/1。
     * 無ければ9/1以降の最初の記録。
     */
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
              index - 1
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

        /*
         * 最初の記録より前の月曜には
         * まだ集計対象として参加させない。
         *
         * 例：
         * baseline=9/10
         * → 9/7は対象外
         * → 9/14から対象
         */
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


        /* ------------------------------------------------------
           累計減量

           非公開でも減量差だけは集計する。
           ------------------------------------------------------ */

        lossRaw +=
          member.baseline_kg -
          latest.kg;


        lossCount++;


        /* ------------------------------------------------------
           総体重

           実体重公開中だけ。
           ------------------------------------------------------ */

        if (
          publicTotalsEnabled &&
          !member.weight_hidden
        ) {

          totalRaw +=
            latest.kg;


          totalCount++;
        }


        /* ------------------------------------------------------
           週次減量

           9/7：
             基準体重 → 9/7

           9/14以降：
             原則、前回月曜時点 → 今回月曜

           ただし前回月曜より後に
           初記録した人は、
             最初の記録 → 今回月曜
           ------------------------------------------------------ */

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

        /*
         * 旧UIとの一時的な互換用。
         *
         * UI更新後は
         * total_count / loss_count / week_count
         * を個別に表示する。
         */
        counted:
          totalCount,
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


  const publicTotalsEnabled =
    Number(
      group.show_weight ||
      0
    ) ===
      1;


  /*
   * 現在このグループに所属している
   * 利用停止ではないメンバーを取得。
   *
   * ブロック関係は集計人数から除外しない。
   * チームの合計値を閲覧者ごとに変えないため。
   */
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


  /*
   * 総体重に含められるかどうかだけ、
   * 現在の体重公開設定を見る。
   *
   * 非公開者も減量差の集計には残す。
   */
  const hiddenMembers =
    await hiddenWeightSet(
      env,
      members.map(
        row =>
          row.member_id
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


  /*
   * 公開 / 非公開に関係なく
   * 全対象メンバーの体重履歴をサーバ側で読む。
   *
   * 非公開者についてクライアントへ返すのは
   * 個別体重ではなく集計済みの減量差だけ。
   */
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
