'use strict';

import app from './entry.js';

import {
  bad
} from './lib.js';

import {
  isSafetyAdminPath,
  adminSafetyRoute,
  publicIconRoute,
  memberIconRoute,
  joinGroupSafely,
  augmentGroupPreview,
  externalConsentRoute,
  manageMembersRoute,
  blockedRivalPost,
  filterMutualBlocks,
  filterStartDateShare,
  captureDeleteContext,
  cleanupAfterDelete,
  queueExternalAfterWeight,
  processCleanupJobs,
  processExternalQueue
} from './safety.js';

import {
  operatorRoute,
  operatorParticipationGuard,
  isOperatorRequest,
  isOperatorMember,
  normalizeConfiguredOperator,
  prepareOperatorForDelete
} from './operator.js';


const ASSET_LINKS_PATH =
  '/.well-known/assetlinks.json';

const ASSET_LINKS_SOURCE_PATH =
  '/assetlinks.json';


/* ============================================================
   Android Digital Asset Links
   ============================================================ */

async function serveAssetLinks(
  req,
  env
) {

  const sourceUrl =
    new URL(
      ASSET_LINKS_SOURCE_PATH,
      req.url
    );

  const res =
    await env.ASSETS.fetch(
      new Request(
        sourceUrl.toString(),
        {
          method:
            'GET',
        }
      )
    );

  if (!res.ok) {

    return new Response(
      JSON.stringify({
        ok:
          false,

        error:
          'assetlinks_source_not_found',
      }),
      {
        status:
          500,

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

  const body =
    await res.text();

  return new Response(
    req.method ===
      'HEAD'
      ? null
      : body,
    {
      status:
        200,

      headers: {
        'content-type':
          'application/json; charset=utf-8',

        'cache-control':
          'public, max-age=300',

        'x-content-type-options':
          'nosniff',
      },
    }
  );
}


/* ============================================================
   運営者判定をレスポンスへ追加
   ============================================================ */

async function augmentOperatorFlag(
  response,
  env
) {

  if (
    !response ||
    !response.ok
  ) {

    return response;
  }


  try {

    const data =
      await response
        .clone()
        .json();

    const memberId =
      data &&
      data.me &&
      data.me.member_id;


    if (!memberId) {

      return response;
    }


    data.operator =
      isOperatorMember(
        env,
        memberId
      );


    const headers =
      new Headers(
        response.headers
      );


    headers.delete(
      'content-length'
    );


    headers.set(
      'content-type',
      'application/json; charset=utf-8'
    );


    headers.set(
      'cache-control',
      'no-store'
    );


    return new Response(
      JSON.stringify(
        data
      ),
      {
        status:
          response.status,

        statusText:
          response.statusText,

        headers,
      }
    );


  } catch {

    return response;
  }
}


/* ============================================================
   /api/me を返す前に運営状態を確定
   ============================================================ */

async function normalizeOperatorBeforeMe(
  req,
  env
) {

  const statusUrl =
    new URL(
      req.url
    );


  statusUrl.pathname =
    '/api/operator/status';

  statusUrl.search =
    '';


  try {

    const response =
      await operatorRoute(
        req,
        env,
        statusUrl
      );


    if (!response.ok) {

      return false;
    }


    const data =
      await response
        .clone()
        .json();


    return !!(
      data &&
      data.operator
    );


  } catch {

    return false;
  }
}


/* ============================================================
   運営者をライバル登録させない
   ============================================================ */

async function targetsOperator(
  req,
  env
) {

  try {

    const body =
      await req
        .clone()
        .json();


    return isOperatorMember(
      env,
      body &&
      body.member_id
    );


  } catch {

    return false;
  }
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


    /* ==========================================================
       CORS / Preflight
       ========================================================== */

    if (
      m ===
        'OPTIONS'
    ) {

      return await app.fetch(
        req,
        env,
        ctx
      );
    }


    /* ==========================================================
       Android Digital Asset Links
       ========================================================== */

    if (
      url.pathname ===
        ASSET_LINKS_PATH &&
      (
        m ===
          'GET' ||
        m ===
          'HEAD'
      )
    ) {

      return await serveAssetLinks(
        req,
        env
      );
    }


    /* ==========================================================
       承認済みプロフィール画像
       ========================================================== */

    if (
      url.pathname.startsWith(
        '/i/'
      )
    ) {

      if (
        m !==
          'GET' &&
        m !==
          'HEAD'
      ) {

        return new Response(
          'method_not_allowed',
          {
            status:
              405,
          }
        );
      }


      return await publicIconRoute(
        req,
        env,
        url
      );
    }


    /* ==========================================================
       運営アカウントを集計より先に正規化

       OPERATOR_MEMBER_ID が設定済みなら、
       運営者本人がアプリを開くのを待たずに
       旧所属・投票・ライバル等を除去する。

       これより下のAPIは正規化後のDBだけを見る。
       ========================================================== */

    if (
      p ===
        '/api' ||
      p.startsWith(
        '/api/'
      )
    ) {

      await normalizeConfiguredOperator(
        env
      );
    }


    /* ==========================================================
       プロフィール画像アップロード
       ========================================================== */

    if (
      p ===
        '/api/icon'
    ) {

      return await memberIconRoute(
        req,
        env
      );
    }


    /* ==========================================================
       審査・安全管理
       ========================================================== */

    if (
      isSafetyAdminPath(
        p
      )
    ) {

      return await adminSafetyRoute(
        req,
        env,
        url
      );
    }


    /* ==========================================================
       旧 pull 型外部API停止
       ========================================================== */

    if (
      p ===
        '/api/external/weights'
    ) {

      return new Response(
        JSON.stringify({
          ok:
            false,

          error:
            'not_found',
        }),
        {
          status:
            404,

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


    /* ==========================================================
       運営専用API
       ========================================================== */

    if (
      p ===
        '/api/operator' ||
      p.startsWith(
        '/api/operator/'
      )
    ) {

      return await operatorRoute(
        req,
        env,
        url
      );
    }


    /* ==========================================================
       運営アカウントの通常参加機能を禁止
       ========================================================== */

    const operatorBootstrapRead =
      (
        p ===
          '/api/weights' &&
        m ===
          'GET'
      ) ||
      (
        p ===
          '/api/me' &&
        m ===
          'GET'
      ) ||
      (
        p ===
          '/api/register' &&
        m ===
          'POST'
      );


    if (
      !operatorBootstrapRead
    ) {

      const operatorBlocked =
        await operatorParticipationGuard(
          req,
          env,
          p,
          m
        );


      if (
        operatorBlocked
      ) {

        return operatorBlocked;
      }
    }


    /* ==========================================================
       運営者では不要な参加者設定を禁止
       ========================================================== */

    if (
      (
        p.startsWith(
          '/api/push/'
        ) ||
        p ===
          '/api/me/external-consent' ||
        p ===
          '/api/me/weight-privacy' ||
        p ===
          '/api/groups/weight-privacy'
      ) &&
      await isOperatorRequest(
        req,
        env
      )
    ) {

      return bad(
        req,
        'operator_not_allowed',
        403
      );
    }


    /* ==========================================================
       運営者を他ユーザーのライバルにしない
       ========================================================== */

    if (
      p ===
        '/api/rivals' &&
      m ===
        'POST' &&
      await targetsOperator(
        req,
        env
      )
    ) {

      return bad(
        req,
        'operator_not_available',
        403
      );
    }


    /* ==========================================================
       グループ参加
       ========================================================== */

    if (
      p ===
        '/api/groups/join' &&
      m ===
        'POST'
    ) {

      return await joinGroupSafely(
        req,
        env
      );
    }


    /* ==========================================================
       本人の外部WEB連携同意
       ========================================================== */

    if (
      p ===
        '/api/me/external-consent'
    ) {

      return await externalConsentRoute(
        req,
        env
      );
    }


    /* ==========================================================
       オーナー・リーダー管理用メンバー一覧
       ========================================================== */

    if (
      p ===
        '/api/groups/manage-members' &&
      m ===
        'GET'
    ) {

      return await manageMembersRoute(
        req,
        env
      );
    }


    /* ==========================================================
       ブロック関係の相手をライバル登録させない
       ========================================================== */

    if (
      p ===
        '/api/rivals' &&
      m ===
        'POST'
    ) {

      const blocked =
        await blockedRivalPost(
          req,
          env
        );


      if (
        blocked
      ) {

        return blocked;
      }
    }


    /* ==========================================================
       アカウント削除前の識別情報保存
       ========================================================== */

    let deleteContext =
      null;


    if (
      p ===
        '/api/me' &&
      m ===
        'DELETE'
    ) {

      deleteContext =
        await captureDeleteContext(
          req,
          env
        );


      /*
       * 運営者の場合は、
       * app.fetch() が通常のアカウント削除を行う前に
       * グループ所有者を __MINYASE_OPERATOR__ へ移行する。
       *
       * ここで失敗した場合は削除処理へ進ませない。
       * 運営グループを誤って解散する事故を防ぐため。
       */
      if (
        deleteContext
      ) {

        await prepareOperatorForDelete(
          env,
          deleteContext
        );
      }
    }


    /* ==========================================================
       運営者の /api/me
       ========================================================== */

    let operatorForResponse =
      false;


    if (
      p ===
        '/api/me' &&
      m ===
        'GET'
    ) {

      operatorForResponse =
        await normalizeOperatorBeforeMe(
          req,
          env
        );
    }


    /* ==========================================================
       既存アプリ処理
       ========================================================== */

    let response =
      await app.fetch(
        req,
        env,
        ctx
      );


    /* ==========================================================
       /api/me / register に operator 判定追加
       ========================================================== */

    if (
      (
        p ===
          '/api/me' &&
        m ===
          'GET'
      ) ||
      (
        p ===
          '/api/register' &&
        m ===
          'POST'
      )
    ) {

      response =
        await augmentOperatorFlag(
          response,
          env
        );
    }


    void operatorForResponse;


    /* ==========================================================
       参加前グループ情報
       ========================================================== */

    if (
      p ===
        '/api/groups' &&
      m ===
        'GET' &&
      url.searchParams.has(
        'code'
      )
    ) {

      response =
        await augmentGroupPreview(
          req,
          env,
          response
        );
    }


    /* ==========================================================
       スタート日前の共有を遮断
       ========================================================== */

    if (
      (
        p ===
          '/api/group/day' &&
        m ===
          'GET'
      ) ||
      (
        p ===
          '/api/export' &&
        m ===
          'GET'
      )
    ) {

      response =
        await filterStartDateShare(
          req,
          env,
          response,
          p
        );
    }


    /* ==========================================================
       双方向ブロック
       ========================================================== */

    if (
      (
        p ===
          '/api/ranking' &&
        m ===
          'GET'
      ) ||
      (
        p ===
          '/api/rivals' &&
        m ===
          'GET'
      ) ||
      (
        p ===
          '/api/group/day' &&
        m ===
          'GET'
      )
    ) {

      response =
        await filterMutualBlocks(
          req,
          env,
          response
        );
    }


    /* ==========================================================
       体重保存後の外部WEBキュー
       ========================================================== */

    if (
      p ===
        '/api/weights' &&
      m ===
        'POST' &&
      response.ok
    ) {

      ctx.waitUntil(

        queueExternalAfterWeight(
          req,
          env,
          response.clone()
        )
          .then(
            () =>
              processExternalQueue(
                env
              )
          )
          .catch(
            e =>
              console.error(
                'external_push_error',
                (
                  e &&
                  e.stack
                ) ||
                e
              )
          )
      );
    }


    /* ==========================================================
       アカウント削除後の追加cleanup
       ========================================================== */

    if (
      p ===
        '/api/me' &&
      m ===
        'DELETE' &&
      response.ok &&
      deleteContext
    ) {

      ctx.waitUntil(

        cleanupAfterDelete(
          env,
          deleteContext
        )
          .catch(
            e =>
              console.error(
                'safety_cleanup_error',
                (
                  e &&
                  e.stack
                ) ||
                e
              )
          )
      );
    }


    return response;
  },


  /* ==========================================================
     Cron
     ========================================================== */

  async scheduled(
    controller,
    env,
    ctx
  ) {

    /* ----------------------------------------------------------
       既存 Push Cron
       ---------------------------------------------------------- */

    if (
      app.scheduled
    ) {

      try {

        const promise =
          app.scheduled(
            controller,
            env,
            ctx
          );


        if (
          promise &&
          typeof promise.then ===
            'function'
        ) {

          ctx.waitUntil(
            promise
          );
        }


      } catch (e) {

        console.error(
          'base_scheduled_error',
          (
            e &&
            e.stack
          ) ||
          e
        );
      }
    }


    /* ----------------------------------------------------------
       削除再試行
       ---------------------------------------------------------- */

    ctx.waitUntil(

      processCleanupJobs(
        env
      )
        .catch(
          e =>
            console.error(
              'cleanup_cron_error',
              (
                e &&
                e.stack
              ) ||
              e
            )
        )
    );


    /* ----------------------------------------------------------
       外部WEB push
       ---------------------------------------------------------- */

    ctx.waitUntil(

      processExternalQueue(
        env
      )
        .catch(
          e =>
            console.error(
              'external_cron_error',
              (
                e &&
                e.stack
              ) ||
              e
            )
        )
    );
  },
};
