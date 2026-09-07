'use strict';

import app from './entry.js';

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
       CORS / Preflight

       root.js が /api/icon 等を entry.js より先に処理するため、
       OPTIONS は最初に entry.js の preflight へ渡す。

       これが無いと Capacitor iOS から
       x-device-id + image/jpeg 等で送信した際の
       preflight が memberIconRoute に入ってしまう。
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

       新しい画像は公開キーへ直接保存せず、
       pending として管理者承認待ちにする。
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
       旧 pull 型外部API

       現在の外部WEB連携は
       group_external
       +
       member_id × group_id の本人同意
       +
       現在のグループ所属

       を確認する push 型だけを使用する。

       旧 /api/external/weights は
       この同意条件を迂回できるため廃止する。
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
       グループ参加

       entry.js の旧 prepareJoinWeightPrivacy を通さず、
       membership / privacy / consent を
       safety.js 側でまとめて確定する。

       グループ参加失敗時に
       privacy だけ先に変更される問題を防止。
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

       双方向ブロックとは別。
       管理権限がある人は管理目的で全員を確認できる。
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
       ブロック関係の相手を
       新しくライバル登録させない
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

       base worker で devices 行が消える前に
       member_id 等を保存する。
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

       既存 GET /api/groups?code=... に
       external_enabled を追加する。
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

       safety.js 側で
       実際に閲覧している対象グループの start_ymd を使う。
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

       AがBをブロックした場合、
       AとBは互いの通常ユーザー向け表示から消す。

       対象：
       ・ランキング
       ・ライバル
       ・日付別メンバー体重

       管理用 /api/groups/manage-members は除外。
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

       ユーザーの体重保存成功自体は
       外部WEB障害の影響を受けない。

       外部API情報が未設定なら
       processExternalQueue() は送信しない。
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

       相手から以下3つが届くまでは送信しない。

       EXTERNAL_PUSH_URL
       EXTERNAL_PUSH_AUTH_HEADER
       EXTERNAL_PUSH_AUTH_VALUE
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
