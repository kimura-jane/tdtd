'use strict';

import app from './entry.js';

import {
  externalRoute
} from './external.js';

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


const ASSET_LINKS_PATH =
  '/.well-known/assetlinks.json';

const ASSET_LINKS_SOURCE_PATH =
  '/assetlinks.json';


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

       worker/index.js の旧 /i/ より先に処理する。
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
       既存pull型外部API

       互換性のため残す。
       ========================================================== */

    if (
      p ===
        '/api/external/weights'
    ) {

      return await externalRoute(
        req,
        env,
        url
      );
    }


    /* ==========================================================
       グループ参加

       entry.jsの旧prepareJoinWeightPrivacyを通さず、
       membership/privacy/consentをまとめて保存。
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
       本人の外部WEB同意
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

       ブロック関係にかかわらず管理できる。
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
       ブロック相手をライバル登録させない
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

      if (blocked) {

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

       ユーザーの保存成功自体は
       外部WEB障害の影響を受けない。
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


  async scheduled(
    controller,
    env,
    ctx
  ) {

    /*
     * 既存Push Cron
     */
    if (
      app.scheduled
    ) {

      try {

        const p =
          app.scheduled(
            controller,
            env,
            ctx
          );

        if (
          p &&
          typeof p.then ===
            'function'
        ) {

          ctx.waitUntil(p);
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


    /*
     * 削除再試行
     */
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


    /*
     * 外部WEB
     *
     * 3つの環境変数が無ければ
     * processExternalQueue()は何も送らない。
     */
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
