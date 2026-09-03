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

   wrangler.toml の main = "worker/entry.js"

   管理トークンの取得順
     1. env.ADMIN_TOKEN（ダッシュボードの Settings > 変数とシークレット）
     2. D1 の app_config テーブル k='admin_token'
   2 はデプロイでシークレットが消える環境向けの予備。現在は 1 で稼働中。
   ============================================================ */

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

// admin.js の memberRoute が担当するパス（それ以外は index.js のまま）
const MEMBER_PATHS = ['/api/group/day', '/api/export', '/api/import'];

// 同一 isolate 内でのみ再利用する。デプロイや isolate 入れ替えで自然に消える
let tokCache = null;

async function adminToken(env) {
  const fromEnv = env.ADMIN_TOKEN;
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return { token: fromEnv.trim(), source: 'env' };
  }
  if (tokCache) return tokCache;
  try {
    const r = await env.DB
      .prepare("SELECT v FROM app_config WHERE k='admin_token'")
      .first();
    const v = r && typeof r.v === 'string' ? r.v.trim() : '';
    if (v) {
      tokCache = { token: v, source: 'd1' };
      return tokCache;
    }
  } catch { /* テーブル未作成 → 未設定として扱う */ }
  return { token: '', source: 'none' };
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return preflight(req);

    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const m = req.method;

    try {
      /* ⑦ 管理画面 API：ADMIN_TOKEN のみで認証する。
         端末IDチェックより前なのでダミー device_id は不要 */
      if (p.startsWith('/api/admin/')) {
        const a = await adminToken(env);
        // admin.js は env.ADMIN_TOKEN を見るので、D1 由来のときは差し込んで渡す
        const e2 = a.source === 'env' ? env : { ...env, ADMIN_TOKEN: a.token };
        return await adminRoute(req, e2, url, p, m);
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
        if (res) return res;
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
