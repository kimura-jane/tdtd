'use strict';

import app from './entry.js';


/* ============================================================
   みんやせ / worker/root.js

   Cloudflare Workers の最上位エントリーポイント。

   Android TWA の Digital Asset Links を
   /.well-known/assetlinks.json で確実に返し、
   それ以外は既存 worker/entry.js にそのまま渡す。
   ============================================================ */


const ASSET_LINKS_PATH =
  '/.well-known/assetlinks.json';

const ASSET_LINKS_SOURCE_PATH =
  '/assetlinks.json';


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
          'GET',
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
      JSON.stringify(
        {
          ok:
            false,

          error:
            'assetlinks_source_not_found',
        }
      ),
      {
        status:
          500,

        headers: {
          'Content-Type':
            'application/json; charset=utf-8',

          'Cache-Control':
            'no-store',

          'X-Content-Type-Options':
            'nosniff',
        },
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
          'nosniff',
      },
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


    return app.fetch(
      req,
      env,
      ctx
    );
  },


  /* ==========================================================
     Cron は既存 entry.js にそのまま渡す
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
  },
};
