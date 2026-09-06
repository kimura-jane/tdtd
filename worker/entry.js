'use strict';

import worker from './index.js';

import {
  adminRoute,
  memberRoute
} from './admin.js';

import {
  adminUserRoute
} from './admin-users.js';

import {
  json,
  bad,
  preflight
} from './lib.js';

import {
  memberVoteRoute,
  adminVoteRoute,
  cleanupVotesForMember
} from './vote.js';

import {
  memberPushRoute,
  cleanupPushForMember,
  sendDuePushes
} from './push.js';

import {
  memberWeightPrivacyRoute,
  adminWeightPrivacyRoute,
  selfWeightPrivacyRoute,
  prepareJoinWeightPrivacy,
  cleanupWeightPrivacyForMember,
  filterRankingWeightPrivacy,
  filterMemberWeightPrivacy
} from './weight-privacy.js';


/* ============================================================
   みんやせ / worker/entry.js
   ============================================================ */


const DEVICE_ID_RE =
  /^[A-Za-z0-9_-]{8,64}$/;


const MEMBER_PATHS = [
  '/api/group/day',
  '/api/export',
  '/api/import',
];


let tokCache =
  null;


/* ============================================================
   ADMIN_TOKEN
   ============================================================ */

async function adminToken(
  env
) {

  const fromEnv =
    env.ADMIN_TOKEN;


  if (
    typeof fromEnv ===
      'string' &&
    fromEnv.trim()
  ) {

    return {
      token:
        fromEnv.trim(),

      source:
        'env',
    };
  }


  if (
    tokCache
  ) {

    return tokCache;
  }


  try {

    const r =
      await env.DB
        .prepare(`
          SELECT v
          FROM app_config
          WHERE k='admin_token'
        `)
        .first();


    const v =
      r &&
      typeof r.v ===
        'string'
        ? r.v.trim()
        : '';


    if (
      v
    ) {

      tokCache = {
        token:
          v,

        source:
          'd1',
      };


      return tokCache;
    }

  } catch {}


  return {
    token:
      '',

    source:
      'none',
  };
}


/* ============================================================
   一般ユーザー
   ============================================================ */

async function getMember(
  req,
  env
) {

  const deviceId =
    (
      req.headers.get(
        'x-device-id'
      ) ||
      ''
    )
      .trim();


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


  if (
    !dev
  ) {

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
    ) ===
      1
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
   Worker
   ============================================================ */

export default {

  async fetch(
    req,
    env,
    ctx
  ) {

    if (
      req.method ===
        'OPTIONS'
    ) {

      return preflight(
        req
      );
    }


    const url =
      new URL(
        req.url
      );


    const p =
      url.pathname
        .replace(
          /\/+$/,
          ''
        ) ||
      '/';


    const m =
      req.method;


    try {

      /* --------------------------------------------------------
         Android Push
         -------------------------------------------------------- */

      if (
        p.startsWith(
          '/api/push/'
        )
      ) {

        const member =
          await getMember(
            req,
            env
          );


        if (
          member.error
        ) {

          return member.error;
        }


        const res =
          await memberPushRoute(
            req,
            env,
            member.dev,
            p,
            m
          );


        return (
          res ||
          bad(
            req,
            'not_found',
            404
          )
        );
      }


      /* --------------------------------------------------------
         体重公開設定 管理API
         -------------------------------------------------------- */

      if (
        p ===
          '/api/admin/weight-privacy' ||
        p.startsWith(
          '/api/admin/weight-privacy/'
        )
      ) {

        const a =
          await adminToken(
            env
          );


        const e2 =
          a.source ===
            'env'
            ? env
            : {
                ...env,

                ADMIN_TOKEN:
                  a.token,
              };


        return await adminWeightPrivacyRoute(
          req,
          e2,
          url,
          p,
          m
        );
      }


      /* --------------------------------------------------------
         ユーザー管理 管理API
         -------------------------------------------------------- */

      if (
        p ===
          '/api/admin/users' ||
        p.startsWith(
          '/api/admin/users/'
        )
      ) {

        const a =
          await adminToken(
            env
          );


        const e2 =
          a.source ===
            'env'
            ? env
            : {
                ...env,

                ADMIN_TOKEN:
                  a.token,
              };


        return await adminUserRoute(
          req,
          e2,
          url,
          p,
          m
        );
      }


      /* --------------------------------------------------------
         投票 管理API
         -------------------------------------------------------- */

      if (
        p.startsWith(
          '/api/admin/vote/'
        )
      ) {

        const a =
          await adminToken(
            env
          );


        const e2 =
          a.source ===
            'env'
            ? env
            : {
                ...env,

                ADMIN_TOKEN:
                  a.token,
              };


        return await adminVoteRoute(
          req,
          e2,
          url,
          p,
          m
        );
      }


      /* --------------------------------------------------------
         その他 管理API
         -------------------------------------------------------- */

      if (
        p.startsWith(
          '/api/admin/'
        )
      ) {

        const a =
          await adminToken(
            env
          );


        const e2 =
          a.source ===
            'env'
            ? env
            : {
                ...env,

                ADMIN_TOKEN:
                  a.token,
              };


        return await adminRoute(
          req,
          e2,
          url,
          p,
          m
        );
      }


      /* --------------------------------------------------------
         本人の体重公開設定
         -------------------------------------------------------- */

      if (
        p ===
          '/api/me/weight-privacy'
      ) {

        const member =
          await getMember(
            req,
            env
          );


        if (
          member.error
        ) {

          return member.error;
        }


        return await selfWeightPrivacyRoute(
          req,
          env,
          member.dev,
          p,
          m
        );
      }


      /* --------------------------------------------------------
         オーナー / リーダー
         -------------------------------------------------------- */

      if (
        p ===
          '/api/groups/weight-privacy'
      ) {

        const member =
          await getMember(
            req,
            env
          );


        if (
          member.error
        ) {

          return member.error;
        }


        return await memberWeightPrivacyRoute(
          req,
          env,
          member.dev,
          p,
          m
        );
      }


      /* --------------------------------------------------------
         グループ参加

         joinGroupでgroup_idが付く前に
         本人の公開設定を保存する。

         これにより公開グループへ入った瞬間に
         既存体重が一瞬見える問題を防ぐ。
         -------------------------------------------------------- */

      if (
        p ===
          '/api/groups/join' &&
        m ===
          'POST'
      ) {

        const member =
          await getMember(
            req,
            env
          );


        if (
          member.error
        ) {

          return member.error;
        }


        await prepareJoinWeightPrivacy(
          req,
          env,
          member.dev
        );


        return worker.fetch(
          req,
          env,
          ctx
        );
      }


      /* --------------------------------------------------------
         投票
         -------------------------------------------------------- */

      if (
        p.startsWith(
          '/api/vote/'
        )
      ) {

        return await memberVoteRoute(
          req,
          env,
          url,
          p,
          m
        );
      }


      /* --------------------------------------------------------
         アカウント削除
         -------------------------------------------------------- */

      if (
        p ===
          '/api/me' &&
        m ===
          'DELETE'
      ) {

        const member =
          await getMember(
            req,
            env
          );


        const res =
          await worker.fetch(
            req,
            env,
            ctx
          );


        if (
          res.ok &&
          member.dev &&
          member.dev.member_id
        ) {

          try {

            await cleanupVotesForMember(
              env,
              member.dev.member_id
            );

          } catch (e) {

            console.error(
              'vote_cleanup_error',
              member.dev.member_id,
              (
                e &&
                e.stack
              ) ||
              e
            );
          }


          try {

            await cleanupPushForMember(
              env,
              member.dev.member_id
            );

          } catch (e) {

            console.error(
              'push_cleanup_error',
              member.dev.member_id,
              (
                e &&
                e.stack
              ) ||
              e
            );
          }


          try {

            await cleanupWeightPrivacyForMember(
              env,
              member.dev.member_id
            );

          } catch (e) {

            console.error(
              'weight_privacy_cleanup_error',
              member.dev.member_id,
              (
                e &&
                e.stack
              ) ||
              e
            );
          }
        }


        return res;
      }


      /* --------------------------------------------------------
         ランキング
         -------------------------------------------------------- */

      if (
        p ===
          '/api/ranking' &&
        m ===
          'GET'
      ) {

        const res =
          await worker.fetch(
            req,
            env,
            ctx
          );


        return await filterRankingWeightPrivacy(
          res,
          env
        );
      }


      /* --------------------------------------------------------
         admin.js 一般API
         -------------------------------------------------------- */

      if (
        MEMBER_PATHS.includes(
          p
        )
      ) {

        const member =
          await getMember(
            req,
            env
          );


        if (
          member.error
        ) {

          return member.error;
        }


        const res =
          await memberRoute(
            req,
            env,
            member.dev,
            url,
            p,
            m
          );


        if (
          res
        ) {

          return await filterMemberWeightPrivacy(
            p,
            res,
            env
          );
        }
      }


    } catch (e) {

      console.error(
        'entry_error',
        p,
        m,
        (
          e &&
          e.stack
        ) ||
        e
      );


      return json(
        req,
        {
          ok:
            false,

          error:
            'server_error',
        },
        500
      );
    }


    return worker.fetch(
      req,
      env,
      ctx
    );
  },


  /* ==========================================================
     Push Cron
     ========================================================== */

  async scheduled(
    controller,
    env,
    ctx
  ) {

    ctx.waitUntil(

      sendDuePushes(
        env
      )
        .then(
          result => {

            console.log(
              'push_cron',
              controller.cron,
              JSON.stringify(
                result
              )
            );
          }
        )
        .catch(
          e => {

            console.error(
              'push_cron_error',
              (
                e &&
                e.stack
              ) ||
              e
            );
          }
        )
    );
  },
};
