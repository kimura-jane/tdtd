'use strict';

import {
  hiddenWeightSet
} from './weight-privacy.js';


/* ============================================================
   みんやせ / worker/external.js

   外部サーバー連携専用・読み取り専用API

   POST /api/external/weights

   Authorization:
     Bearer <EXTERNAL_API_SECRET>

   非表示ユーザー：
     ・kgは返さない
     ・weightsにも含めない
     ・loss_kgだけ返す
   ============================================================ */


const MEMBER_ID_RE =
  /^[0-9A-Z]{6,32}$/;

const MAX_MEMBERS =
  50;

const MAX_ROWS =
  10000;


/* ============================================================
   レスポンス
   ============================================================ */

function reply(
  body,
  status = 200
) {

  return new Response(
    JSON.stringify(
      body
    ),
    {
      status,

      headers: {
        'content-type':
          'application/json; charset=utf-8',

        'cache-control':
          'no-store',

        'x-content-type-options':
          'nosniff',
      },
    }
  );
}


function bad(
  error,
  status = 400
) {

  return reply(
    {
      ok:
        false,

      error,
    },
    status
  );
}


/* ============================================================
   認証
   ============================================================ */

function auth(
  req,
  env
) {

  const secret =
    typeof env.EXTERNAL_API_SECRET ===
      'string'
      ? env.EXTERNAL_API_SECRET.trim()
      : '';


  if (!secret) {

    return {
      ok:
        false,

      response:
        bad(
          'external_api_not_configured',
          503
        ),
    };
  }


  const value =
    (
      req.headers.get(
        'authorization'
      ) ||
      ''
    ).trim();


  const match =
    /^Bearer\s+(.+)$/i
      .exec(
        value
      );


  const token =
    match
      ? match[1].trim()
      : '';


  if (
    !token ||
    token !== secret
  ) {

    return {
      ok:
        false,

      response:
        bad(
          'unauthorized',
          401
        ),
    };
  }


  return {
    ok:
      true,
  };
}


/* ============================================================
   日付
   ============================================================ */

function isYmd(v) {

  if (
    typeof v !==
      'string' ||
    !/^\d{4}-\d{2}-\d{2}$/
      .test(
        v
      )
  ) {

    return false;
  }


  return !Number.isNaN(
    Date.parse(
      v +
      'T00:00:00+09:00'
    )
  );
}


function round1(
  value
) {

  return Math.round(
    Number(
      value
    ) *
    10
  ) /
  10;
}


/* ============================================================
   member_id
   ============================================================ */

function cleanMemberIds(
  raw
) {

  if (
    !Array.isArray(
      raw
    )
  ) {

    return null;
  }


  const out =
    [];

  const seen =
    new Set();


  for (
    const value of
    raw
  ) {

    const id =
      String(
        value ||
        ''
      )
        .trim()
        .toUpperCase();


    if (
      !MEMBER_ID_RE.test(
        id
      )
    ) {

      return null;
    }


    if (
      !seen.has(
        id
      )
    ) {

      seen.add(
        id
      );

      out.push(
        id
      );
    }
  }


  if (
    !out.length ||
    out.length >
      MAX_MEMBERS
  ) {

    return null;
  }


  return out;
}


/* ============================================================
   JSON
   ============================================================ */

async function readBody(
  req
) {

  try {

    const b =
      await req.json();


    return (
      b &&
      typeof b ===
        'object'
    )
      ? b
      : {};

  } catch {

    return {};
  }
}


/* ============================================================
   減量幅
   ============================================================ */

async function lossMap(
  env,
  memberIds
) {

  const out =
    new Map();


  if (
    !memberIds.length
  ) {

    return out;
  }


  const ph =
    memberIds
      .map(
        () => '?'
      )
      .join(
        ','
      );


  const rs =
    await env.DB
      .prepare(`
        SELECT
          member_id,
          ymd,
          kg,
          ra,
          rd

        FROM (
          SELECT
            d.member_id,
            w.ymd,
            w.kg,

            ROW_NUMBER() OVER (
              PARTITION BY d.member_id
              ORDER BY w.ymd ASC
            ) AS ra,

            ROW_NUMBER() OVER (
              PARTITION BY d.member_id
              ORDER BY w.ymd DESC
            ) AS rd

          FROM devices d

          LEFT JOIN groups g
            ON g.group_id=
               d.group_id

          INNER JOIN weights w
            ON w.device_id=
               d.device_id

          WHERE
            d.member_id IN (${ph})

            AND w.ymd >=
              COALESCE(
                g.start_ymd,
                '1900-01-01'
              )
        )

        WHERE
          ra=1
          OR rd=1
      `)
      .bind(
        ...memberIds
      )
      .all();


  const temp =
    new Map();


  for (
    const row of
    (
      rs.results ||
      []
    )
  ) {

    const id =
      String(
        row.member_id
      );


    let item =
      temp.get(
        id
      );


    if (!item) {

      item = {
        first:
          null,

        last:
          null,
      };


      temp.set(
        id,
        item
      );
    }


    if (
      Number(
        row.ra
      ) ===
        1
    ) {

      item.first = {
        ymd:
          row.ymd,

        kg:
          Number(
            row.kg
          ),
      };
    }


    if (
      Number(
        row.rd
      ) ===
        1
    ) {

      item.last = {
        ymd:
          row.ymd,

        kg:
          Number(
            row.kg
          ),
      };
    }
  }


  for (
    const [
      id,
      item
    ] of
    temp
  ) {

    if (
      !item.first ||
      !item.last ||
      item.first.ymd ===
        item.last.ymd
    ) {

      out.set(
        id,
        null
      );

      continue;
    }


    out.set(
      id,
      round1(
        item.first.kg -
        item.last.kg
      )
    );
  }


  return out;
}


/* ============================================================
   体重取得
   ============================================================ */

async function getWeights(
  req,
  env
) {

  const a =
    auth(
      req,
      env
    );


  if (
    !a.ok
  ) {

    return a.response;
  }


  if (
    req.method !==
      'POST'
  ) {

    return bad(
      'method_not_allowed',
      405
    );
  }


  const body =
    await readBody(
      req
    );


  const memberIds =
    cleanMemberIds(
      body.member_ids
    );


  if (
    !memberIds
  ) {

    return bad(
      'bad_member_ids'
    );
  }


  const from =
    body.from == null ||
    body.from === ''
      ? null
      : String(
          body.from
        );


  const to =
    body.to == null ||
    body.to === ''
      ? null
      : String(
          body.to
        );


  if (
    from !==
      null &&
    !isYmd(
      from
    )
  ) {

    return bad(
      'bad_from'
    );
  }


  if (
    to !==
      null &&
    !isYmd(
      to
    )
  ) {

    return bad(
      'bad_to'
    );
  }


  if (
    from !==
      null &&
    to !==
      null &&
    from > to
  ) {

    return bad(
      'bad_range'
    );
  }


  /* ==========================================================
     メンバー
     ========================================================== */

  const placeholders =
    memberIds
      .map(
        () => '?'
      )
      .join(
        ','
      );


  const memberResult =
    await env.DB
      .prepare(`
        SELECT
          d.member_id,
          d.nickname,
          d.group_id,
          g.name AS group_name,
          g.start_ymd AS group_start_ymd

        FROM devices d

        LEFT JOIN groups g
          ON g.group_id=
             d.group_id

        WHERE
          d.member_id IN (${placeholders})

          AND COALESCE(
            d.banned,
            0
          )=0

        ORDER BY
          COALESCE(
            g.name,
            ''
          ),
          d.nickname,
          d.member_id
      `)
      .bind(
        ...memberIds
      )
      .all();


  const memberRows =
    memberResult.results ||
    [];


  const validIds =
    memberRows.map(
      r =>
        String(
          r.member_id
        )
    );


  const hidden =
    await hiddenWeightSet(
      env,
      validIds
    );


  const losses =
    await lossMap(
      env,
      validIds
    );


  const visibleIds =
    validIds.filter(
      id =>
        !hidden.has(
          id
        )
    );


  /* ==========================================================
     実体重
     非表示ユーザーはSQL対象から外す
     ========================================================== */

  let weights =
    [];


  if (
    visibleIds.length
  ) {

    const weightPlaceholders =
      visibleIds
        .map(
          () => '?'
        )
        .join(
          ','
        );


    const where = [
      `d.member_id IN (${weightPlaceholders})`
    ];


    const binds = [
      ...visibleIds
    ];


    if (
      from !== null
    ) {

      where.push(
        'w.ymd >= ?'
      );


      binds.push(
        from
      );
    }


    if (
      to !== null
    ) {

      where.push(
        'w.ymd <= ?'
      );


      binds.push(
        to
      );
    }


    const result =
      await env.DB
        .prepare(`
          SELECT
            d.member_id,
            w.ymd,
            w.kg,
            w.updated_at

          FROM weights w

          INNER JOIN devices d
            ON d.device_id=
               w.device_id

          WHERE
            ${where.join(
              '\n            AND '
            )}

          ORDER BY
            w.ymd ASC,
            d.member_id ASC

          LIMIT ${MAX_ROWS + 1}
        `)
        .bind(
          ...binds
        )
        .all();


    const rows =
      result.results ||
      [];


    if (
      rows.length >
      MAX_ROWS
    ) {

      return bad(
        'too_many_rows',
        413
      );
    }


    weights =
      rows.map(
        r => ({
          member_id:
            String(
              r.member_id
            ),

          ymd:
            String(
              r.ymd
            ),

          kg:
            Number(
              r.kg
            ),

          updated_at:
            r.updated_at ==
              null
              ? null
              : Number(
                  r.updated_at
                ),
        })
      );
  }


  const returned =
    new Set(
      validIds
    );


  /* ==========================================================
     返却
     ========================================================== */

  return reply({

    ok:
      true,

    generated_at:
      Date.now(),

    requested_count:
      memberIds.length,

    returned_count:
      memberRows.length,

    missing_member_ids:
      memberIds.filter(
        id =>
          !returned.has(
            id
          )
      ),

    members:
      memberRows.map(
        r => {

          const id =
            String(
              r.member_id
            );


          return {
            member_id:
              id,

            nickname:
              r.nickname ==
                null
                ? null
                : String(
                    r.nickname
                  ),

            group_id:
              r.group_id ==
                null
                ? null
                : String(
                    r.group_id
                  ),

            group_name:
              r.group_name ==
                null
                ? null
                : String(
                    r.group_name
                  ),

            group_start_ymd:
              r.group_start_ymd ||
              null,

            weight_hidden:
              hidden.has(
                id
              ),

            loss_kg:
              losses.has(
                id
              )
                ? losses.get(
                    id
                  )
                : null,
          };
        }
      ),

    weights,
  });
}


/* ============================================================
   Router
   ============================================================ */

export async function externalRoute(
  req,
  env,
  url
) {

  if (
    url.pathname !==
      '/api/external/weights'
  ) {

    return null;
  }


  try {

    return await getWeights(
      req,
      env
    );

  } catch (e) {

    console.error(
      'external_api_error',
      url.pathname,
      req.method,
      (
        e &&
        e.stack
      ) ||
      e
    );


    return bad(
      'server_error',
      500
    );
  }
}
