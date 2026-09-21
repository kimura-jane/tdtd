'use strict';

import {
  json,
  bad
} from './lib.js';


/* ============================================================
   みんやせ / worker/goal-privacy.js

   目標体重の公開設定

   ・既存ユーザーは非公開（goal_public=0）
   ・本人が明示的にONにした場合だけ公開候補
   ・実際の目標体重はこのAPIから返さない
   ・同じチームだけに見せる判定は member-detail.js 側
   ・D1へ勝手にALTER TABLEしない
   ・goal_public列が未追加でもGETは安全側（非公開）

   D1 migration（別途、明示承認後に1回だけ実行）:
   ALTER TABLE devices
   ADD COLUMN goal_public INTEGER NOT NULL DEFAULT 0;
   ============================================================ */


function isMissingGoalPublicColumn(
  error
) {

  const text =
    String(
      error &&
      error.message ||
      error ||
      ''
    )
      .toLowerCase();


  return (
    text.includes(
      'goal_public'
    ) &&
    (
      text.includes(
        'no such column'
      ) ||
      text.includes(
        'does not exist'
      ) ||
      text.includes(
        'unknown column'
      )
    )
  );
}


function isOperator(
  env,
  dev
) {

  const configured =
    String(
      env &&
      env.OPERATOR_MEMBER_ID ||
      ''
    )
      .trim()
      .toUpperCase();


  const actual =
    String(
      dev &&
      dev.member_id ||
      ''
    )
      .trim()
      .toUpperCase();


  return !!(
    configured &&
    actual &&
    configured ===
      actual
  );
}


async function readGoalPublic(
  env,
  deviceId
) {

  try {

    const row =
      await env.DB
        .prepare(`
          SELECT goal_public
          FROM devices
          WHERE device_id=?
          LIMIT 1
        `)
        .bind(
          deviceId
        )
        .first();


    if (!row) {

      return {
        available:
          true,

        found:
          false,

        goal_public:
          false,
      };
    }


    return {
      available:
        true,

      found:
        true,

      goal_public:
        Number(
          row.goal_public ||
          0
        ) === 1,
    };


  } catch (error) {

    if (
      isMissingGoalPublicColumn(
        error
      )
    ) {

      return {
        available:
          false,

        found:
          true,

        goal_public:
          false,
      };
    }


    throw error;
  }
}


/* ============================================================
   本人用API

   GET   /api/me/goal-privacy
   PATCH /api/me/goal-privacy

   PATCH body:
   {
     "goal_public": true
   }
   ============================================================ */

export async function selfGoalPrivacyRoute(
  req,
  env,
  dev,
  p,
  m
) {

  if (
    p !==
      '/api/me/goal-privacy'
  ) {

    return null;
  }


  if (
    !dev ||
    !dev.device_id ||
    !dev.member_id
  ) {

    return bad(
      req,
      'not_registered',
      404
    );
  }


  if (
    isOperator(
      env,
      dev
    )
  ) {

    return bad(
      req,
      'operator_not_allowed',
      403
    );
  }


  if (
    m ===
      'GET'
  ) {

    const state =
      await readGoalPublic(
        env,
        dev.device_id
      );


    if (
      !state.found
    ) {

      return bad(
        req,
        'not_registered',
        404
      );
    }


    return json(
      req,
      {
        ok:
          true,

        available:
          state.available,

        goal_public:
          state.goal_public,
      }
    );
  }


  if (
    m !==
      'PATCH'
  ) {

    return bad(
      req,
      'method_not_allowed',
      405
    );
  }


  let body =
    {};


  try {

    body =
      await req.json();

  } catch {

    return bad(
      req,
      'bad_format'
    );
  }


  if (
    !body ||
    typeof body !==
      'object' ||
    typeof body.goal_public !==
      'boolean'
  ) {

    return bad(
      req,
      'bad_goal_public'
    );
  }


  const state =
    await readGoalPublic(
      env,
      dev.device_id
    );


  if (
    !state.available
  ) {

    return bad(
      req,
      'goal_privacy_unavailable',
      503
    );
  }


  if (
    !state.found
  ) {

    return bad(
      req,
      'not_registered',
      404
    );
  }


  try {

    await env.DB
      .prepare(`
        UPDATE devices
        SET goal_public=?
        WHERE device_id=?
      `)
      .bind(
        body.goal_public
          ? 1
          : 0,
        dev.device_id
      )
      .run();


  } catch (error) {

    if (
      isMissingGoalPublicColumn(
        error
      )
    ) {

      return bad(
        req,
        'goal_privacy_unavailable',
        503
      );
    }


    throw error;
  }


  return json(
    req,
    {
      ok:
        true,

      available:
        true,

      goal_public:
        body.goal_public,
    }
  );
}
