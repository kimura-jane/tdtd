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
  cleanupWeightPrivacyForMember,
  filterRankingWeightPrivacy,
  filterMemberWeightPrivacy
} from './weight-privacy.js';

import {
  memberWeightDetailRoute
} from './member-detail.js';

import {
  weeklySummaryRoute
} from './weekly-summary.js';


/* ============================================================
   みんやせ / worker/entry.js
   2026-09-08

   root.js の内側で既存APIを処理する。

   重要：
   /api/groups/join は root.js → safety.js が先に処理する。
   entry.js では参加前privacy変更を行わない。

   2026-09-08
   利用停止中でも DELETE /api/me だけは許可する。
   その他のAPIは従来どおり banned 403。
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
  env,
  {
    allowBanned = false
  } = {}
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


  /*
   * 通常APIでは利用停止ユーザーを拒否。
   *
   * DELETE /api/me の場合だけ
   * allowBanned=true で通す。
   */
  if (
    Number(
      dev.banned ||
      0
    ) ===
      1 &&
    !allowBanned
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

    /*
     * root.js からOPTIONSがここへ渡される。
     */
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


      /*
       * 旧：
       *
       * /api/groups/join
       * → prepareJoinWeightPrivacy()
       * → worker.fetch()
       *
       * は削除。
       *
       * root.js の joinGroupSafely() が
       * membership / privacy / external consent を
       * 同じ成功処理として確定する。
       */


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
         公開メンバーの体重詳細

         ・自分のチーム
         ・閲覧登録済みの他チーム
         ・体重公開中のメンバーのみ
         ・非公開は本人を含めて閲覧不可
         -------------------------------------------------------- */

      if (
        p ===
          '/api/member-weight-detail'
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
          await memberWeightDetailRoute(
            req,
            env,
            member.dev,
            url,
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
         毎週月曜の速報

         ・対象5チームだけ
         ・9/1を基準体重として使用
         ・各月曜日以前の最新体重を採用
         ・未来日の体重は使わない
         ・体重非公開メンバーは集計しない
         ・過去入力を修正すれば速報も再計算
         -------------------------------------------------------- */

      if (
        p ===
          '/api/weekly-summary'
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
          await weeklySummaryRoute(
            req,
            env,
            member.dev,
            url,
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
         アカウント削除

         通常時：
         従来どおり削除。

         利用停止中：
         DELETE /api/me だけは例外的に許可する。

         削除成功後、
         vote / push / weight privacy を即時cleanup。

         root.js / safety.js 側でも削除状態を確認し、
         失敗した処理はcleanup_jobsで再試行する。
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
            env,
            {
              allowBanned:
                true
            }
          );


        if (
          member.error
        ) {

          return member.error;
        }


        /*
         * index.js 側も
         * DELETE /api/me だけは
         * banned判定より先に処理する必要がある。
         */
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

         まず個別体重非公開を適用。
         その外側のroot.jsで双方向ブロックも適用する。
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

         /api/group/day
         /api/export
         /api/import

         個別体重非公開を適用後、
         root.js側で開始日制限・双方向ブロックを追加する。
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


    /*
     * ここへ来る通常ユーザーAPIは
     * worker/index.jsへ。
     *
     * bannedユーザーの通常APIは
     * index.js側で従来どおり403。
     */
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
