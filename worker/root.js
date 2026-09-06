'use strict';

import app from './entry.js';

import {
  externalRoute
} from './external.js';


/* ============================================================
   みんやせ / worker/root.js

   Cloudflare Workers 最上位エントリーポイント。

   ・Android TWA Digital Asset Links
   ・既存管理画面への管理機能追加
   ・外部連携API
   ・それ以外は worker/entry.js
   ============================================================ */


const ASSET_LINKS_PATH =
  '/.well-known/assetlinks.json';

const ASSET_LINKS_SOURCE_PATH =
  '/assetlinks.json';

const ADMIN_PATH =
  '/admin.html';


/* ============================================================
   Digital Asset Links
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


  const sourceRequest =
    new Request(
      sourceUrl.toString(),
      {
        method:
          'GET'
      }
    );


  const sourceResponse =
    await env.ASSETS.fetch(
      sourceRequest
    );


  if (
    !sourceResponse.ok
  ) {

    return new Response(
      JSON.stringify({
        ok:
          false,

        error:
          'assetlinks_source_not_found'
      }),
      {
        status:
          500,

        headers: {
          'Content-Type':
            'application/json; charset=utf-8',

          'Cache-Control':
            'no-store',

          'X-Content-Type-Options':
            'nosniff'
        }
      }
    );
  }


  const body =
    await sourceResponse.text();


  return new Response(
    req.method ===
      'HEAD'
      ? null
      : body,
    {
      status:
        200,

      headers: {
        'Content-Type':
          'application/json; charset=utf-8',

        'Cache-Control':
          'public, max-age=300',

        'X-Content-Type-Options':
          'nosniff'
      }
    }
  );
}


/* ============================================================
   既存管理画面
   ============================================================ */

async function serveAdmin(
  req,
  env
) {

  /*
   * Static Assetsから既存admin.htmlを取得。
   */
  const response =
    await env.ASSETS.fetch(
      req
    );


  if (
    !response.ok ||
    req.method ===
      'HEAD'
  ) {

    return response;
  }


  const type =
    String(
      response.headers.get(
        'content-type'
      ) ||
      ''
    )
      .toLowerCase();


  if (
    !type.includes(
      'text/html'
    )
  ) {

    return response;
  }


  let html =
    await response.text();


  const script =
    '<script src="/admin-privacy.js?v=20260906a"></script>';


  /*
   * 二重挿入防止。
   */
  if (
    !html.includes(
      '/admin-privacy.js'
    )
  ) {

    if (
      html.includes(
        '</body>'
      )
    ) {

      html =
        html.replace(
          '</body>',
          script +
          '\n\n</body>'
        );

    } else {

      html +=
        '\n' +
        script;
    }
  }


  const headers =
    new Headers(
      response.headers
    );


  headers.delete(
    'content-length'
  );


  /*
   * 管理画面はキャッシュさせない。
   */
  headers.set(
    'cache-control',
    'no-store'
  );


  headers.set(
    'content-type',
    'text/html; charset=utf-8'
  );


  return new Response(
    html,
    {
      status:
        response.status,

      statusText:
        response.statusText,

      headers
    }
  );
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


    /* ==========================================================
       Digital Asset Links
       ========================================================== */

    if (
      url.pathname ===
        ASSET_LINKS_PATH &&
      (
        req.method ===
          'GET' ||
        req.method ===
          'HEAD'
      )
    ) {

      return await serveAssetLinks(
        req,
        env
      );
    }


    /* ==========================================================
       既存管理画面
       ========================================================== */

    if (
      url.pathname ===
        ADMIN_PATH &&
      (
        req.method ===
          'GET' ||
        req.method ===
          'HEAD'
      )
    ) {

      return await serveAdmin(
        req,
        env
      );
    }


    /* ==========================================================
       外部連携API
       ========================================================== */

    if (
      url.pathname ===
        '/api/external/weights'
    ) {

      return await externalRoute(
        req,
        env,
        url
      );
    }


    /* ==========================================================
       通常API
       ========================================================== */

    return app.fetch(
      req,
      env,
      ctx
    );
  },


  /* ==========================================================
     Cron
     ========================================================== */

  async scheduled(
    controller,
    env,
    ctx
  ) {

    return app.scheduled(
      controller,
      env,
      ctx
    );
  }
};
