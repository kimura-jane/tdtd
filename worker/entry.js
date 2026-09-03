'use strict';

import worker from './index.js';
import { adminRoute, memberRoute } from './admin.js';
import { json, bad, preflight } from './lib.js';

/* ============================================================
   みんやせ / worker/entry.js

   worker/index.js の route() は先頭で x-device-id を必須にするため、
   管理画面（Bearer 認証・device_id なし）のリクエストが通らない。
   index.js を書き換えずに済ませるため、入口をこのファイルに移し、
   管理系と新規の会員系ルートだけを先に処理して、
   それ以外は従来どおり index.js の default export に丸投げする。

   wrangler.toml の main = "worker/entry.js" に変更すること。
   ============================================================ */

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;      // index.js の判定と同一

// admin.js の memberRoute が担当するパス（それ以外は index.js のまま）
const MEMBER_PATHS = ['/api/group/day', '/api/export', '/api/import'];

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return preflight(req);

    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const m = req.method;

    try {
      /* 設定確認用。トークンの値は返さず、存在・型・文字数だけを報告する。
         no_admin_token / unauthorized の切り分けが済んだら削除して良い */
      if (p === '/api/admin-selftest') {
        const t = env.ADMIN_TOKEN;
        return json(req, {
          ok: true,
          env_keys: Object.keys(env).sort(),
          admin_token: {
            present: t !== undefined && t !== null,
            type: typeof t,
            length: typeof t === 'string' ? t.length : null,
            trimmed_length: typeof t === 'string' ? t.trim().length : null,
          },
          bindings: {
            DB: !!env.DB,
            ICONS: !!env.ICONS,
            ASSETS: !!env.ASSETS,
            JOIN_LIMITER: !!env.JOIN_LIMITER,
          },
        });
      }

      /* ⑦ 管理画面 API：ADMIN_TOKEN のみで認証する。
         端末IDチェックより前なのでダミー device_id は不要 */
      if (p.startsWith('/api/admin/')) {
        return await adminRoute(req, env, url, p, m);
      }

      /* ⑤⑥ 一般ユーザー向け：index.js と同じ端末チェックを通してから渡す */
      if (MEMBER_PATHS.includes(p)) {
        const deviceId = (req.headers.get('x-device-id') || '').trim();
        if (!DEVICE_ID_RE.test(deviceId)) return bad(req, 'bad_device_id');

        const dev = await env.DB
          .prepare('SELECT * FROM devices WHERE device_id=?')
          .bind(deviceId).first();
        if (!dev) return bad(req, 'not_registered', 404);
        if (Number(dev.banned) === 1) return bad(req, 'banned', 403);

        const res = await memberRoute(req, env, dev, url, p, m);
        if (res) return res;      // null なら下の既存ルートへ落ちる
      }
    } catch (e) {
      return json(req, {
        ok: false,
        error: 'server_error',
        detail: String((e && e.message) || e),
      }, 500);
    }

    /* 既存の全ルート（/api/me, /api/weights, /api/groups, /api/ranking,
       /api/watching, /api/rivals, /api/blocks, /api/reports, /i/*, 静的ファイル） */
    return worker.fetch(req, env, ctx);
  },
};
