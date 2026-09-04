'use strict';

import webpush from 'web-push';
import { json, bad } from './lib.js';

/* ============================================================
   みんやせ / worker/push.js
   Android PWA / TWA 用 Web Push
   ============================================================ */

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    member_id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_sent_key TEXT
  )
`;

const JST = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});

async function ensureTable(env) {
  await env.DB.prepare(CREATE_TABLE).run();
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function config(env) {
  return {
    publicKey: str(env.VAPID_PUBLIC_KEY),
    privateKey: str(env.VAPID_PRIVATE_KEY),
    subject: str(env.VAPID_SUBJECT) || 'mailto:jomon@jomonkusama.com',
  };
}

async function body(req) {
  try {
    const b = await req.json();
    return b && typeof b === 'object' ? b : {};
  } catch {
    return {};
  }
}

function validEndpoint(v) {
  if (typeof v !== 'string' || v.length < 10 || v.length > 2048) return false;

  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

function validKey(v, max) {
  return (
    typeof v === 'string' &&
    v.length >= 8 &&
    v.length <= max &&
    /^[A-Za-z0-9_-]+$/.test(v)
  );
}

function parseSubscription(raw) {
  const s =
    raw && typeof raw === 'object'
      ? raw.subscription || raw
      : null;

  if (!s || typeof s !== 'object') return null;

  const endpoint = str(s.endpoint);
  const keys =
    s.keys && typeof s.keys === 'object'
      ? s.keys
      : {};

  const p256dh = str(keys.p256dh);
  const auth = str(keys.auth);

  if (
    !validEndpoint(endpoint) ||
    !validKey(p256dh, 256) ||
    !validKey(auth, 128)
  ) {
    return null;
  }

  return {
    endpoint,
    p256dh,
    auth,
  };
}

function nowJst(date = new Date()) {
  const p = JST.formatToParts(date);

  const get = (type) =>
    (p.find((x) => x.type === type) || {}).value || '';

  return {
    ymd:
      `${get('year')}-${get('month')}-${get('day')}`,

    hour:
      Number(get('hour')),
  };
}

function dayNumber(ymd) {
  if (
    typeof ymd !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(ymd)
  ) {
    return null;
  }

  const ms = Date.parse(
    `${ymd}T00:00:00+09:00`
  );

  return Number.isFinite(ms)
    ? Math.floor(ms / 86400000)
    : null;
}

function elapsedDays(fromYmd, toYmd) {
  const a = dayNumber(fromYmd);
  const b = dayNumber(toYmd);

  return a === null || b === null
    ? null
    : b - a;
}

function targets(interval) {
  return Number(interval) === 7
    ? [7, 13, 14]
    : [3, 6, 9, 12, 13, 14];
}

function notificationBody(day) {
  if (day === 13) {
    return '明日でおやすみ中になります。体重を記録すると継続できます。';
  }

  if (day === 14) {
    return '14日間記録がないため、おやすみ中になりました。体重を記録するとすぐ復帰できます。';
  }

  return '最近体重を記録してないよ。今日の体重を記録しよう！';
}


/* ============================================================
   会員API
   ============================================================ */

export async function memberPushRoute(
  req,
  env,
  dev,
  p,
  m
) {
  await ensureTable(env);

  if (
    p === '/api/push/key' &&
    m === 'GET'
  ) {
    const c = config(env);

    if (!c.publicKey) {
      return bad(
        req,
        'push_not_configured',
        503
      );
    }

    return json(req, {
      ok: true,
      public_key: c.publicKey,
    });
  }

  if (
    p === '/api/push/status' &&
    m === 'GET'
  ) {
    const row =
      await env.DB
        .prepare(
          'SELECT member_id FROM push_subscriptions WHERE member_id=?'
        )
        .bind(dev.member_id)
        .first();

    return json(req, {
      ok: true,
      subscribed: !!row,
    });
  }

  if (
    p === '/api/push/subscribe' &&
    m === 'POST'
  ) {
    const c = config(env);

    if (!c.publicKey || !c.privateKey) {
      return bad(
        req,
        'push_not_configured',
        503
      );
    }

    const sub =
      parseSubscription(
        await body(req)
      );

    if (!sub) {
      return bad(
        req,
        'bad_push_subscription'
      );
    }

    const now = Date.now();

    await env.DB
      .prepare(`
        INSERT INTO push_subscriptions (
          member_id,
          endpoint,
          p256dh,
          auth,
          created_at,
          updated_at,
          last_sent_key
        )
        VALUES (?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(member_id)
        DO UPDATE SET
          endpoint=excluded.endpoint,
          p256dh=excluded.p256dh,
          auth=excluded.auth,
          updated_at=excluded.updated_at
      `)
      .bind(
        dev.member_id,
        sub.endpoint,
        sub.p256dh,
        sub.auth,
        now,
        now
      )
      .run();

    return json(req, {
      ok: true,
      subscribed: true,
    });
  }

  if (
    p === '/api/push/subscribe' &&
    m === 'DELETE'
  ) {
    await env.DB
      .prepare(
        'DELETE FROM push_subscriptions WHERE member_id=?'
      )
      .bind(dev.member_id)
      .run();

    return json(req, {
      ok: true,
      subscribed: false,
    });
  }

  return null;
}


/* ============================================================
   アカウント削除
   ============================================================ */

export async function cleanupPushForMember(
  env,
  memberId
) {
  if (!memberId) return;

  await ensureTable(env);

  await env.DB
    .prepare(
      'DELETE FROM push_subscriptions WHERE member_id=?'
    )
    .bind(memberId)
    .run();
}


/* ============================================================
   Cron送信
   ============================================================ */

async function removeDead(env, row) {
  await env.DB
    .prepare(
      'DELETE FROM push_subscriptions WHERE member_id=? AND endpoint=?'
    )
    .bind(
      row.member_id,
      row.endpoint
    )
    .run();
}

async function markSent(env, row, key) {
  await env.DB
    .prepare(`
      UPDATE push_subscriptions
      SET
        last_sent_key=?,
        updated_at=?
      WHERE member_id=?
        AND endpoint=?
    `)
    .bind(
      key,
      Date.now(),
      row.member_id,
      row.endpoint
    )
    .run();
}

async function sendOne(
  env,
  row,
  elapsed,
  ymd
) {
  const sentKey =
    `${ymd}:${elapsed}`;

  if (
    row.last_sent_key ===
      sentKey
  ) {
    return 'duplicate';
  }

  const subscription = {
    endpoint:
      row.endpoint,

    keys: {
      p256dh:
        row.p256dh,

      auth:
        row.auth,
    },
  };

  const payload =
    JSON.stringify({
      title:
        'みんやせ',

      body:
        notificationBody(elapsed),

      tag:
        'minyase-reminder',

      url:
        '/',
    });

  try {
    await webpush.sendNotification(
      subscription,
      payload,
      {
        TTL:
          60 * 60,

        urgency:
          'normal',
      }
    );

    await markSent(
      env,
      row,
      sentKey
    );

    return 'sent';

  } catch (e) {
    const status =
      Number(
        e &&
        (
          e.statusCode ||
          e.status
        )
      );

    if (
      status === 404 ||
      status === 410
    ) {
      await removeDead(
        env,
        row
      );

      return 'expired';
    }

    console.error(
      'push_send_error',
      row.member_id,
      status || '',
      (e && e.message) || e
    );

    return 'error';
  }
}

export async function sendDuePushes(env) {
  await ensureTable(env);

  const c = config(env);

  if (
    !c.publicKey ||
    !c.privateKey
  ) {
    console.error(
      'push_vapid_missing'
    );

    return {
      ok: false,
      error: 'push_not_configured',
    };
  }

  webpush.setVapidDetails(
    c.subject,
    c.publicKey,
    c.privateKey
  );

  const now = nowJst();

  if (
    !Number.isInteger(now.hour)
  ) {
    return {
      ok: false,
      error: 'bad_jst_hour',
    };
  }

  const rs =
    await env.DB
      .prepare(`
        SELECT
          p.member_id,
          p.endpoint,
          p.p256dh,
          p.auth,
          p.last_sent_key,
          d.device_id,
          d.notify_days,
          d.notify_hour,
          (
            SELECT MAX(w.ymd)
            FROM weights w
            WHERE w.device_id=d.device_id
          ) AS latest_ymd
        FROM push_subscriptions p
        INNER JOIN devices d
          ON d.member_id=p.member_id
        WHERE COALESCE(d.notify_on, 0)=1
          AND COALESCE(d.banned, 0)=0
      `)
      .all();

  const rows =
    rs.results ||
    [];

  let sent = 0;
  let expired = 0;
  let errors = 0;

  for (const row of rows) {
    const hour =
      Number(
        row.notify_hour
      );

    if (
      !Number.isInteger(hour) ||
      hour < 0 ||
      hour > 23 ||
      hour !== now.hour
    ) {
      continue;
    }

    if (
      typeof row.latest_ymd !==
        'string' ||
      !row.latest_ymd
    ) {
      continue;
    }

    const elapsed =
      elapsedDays(
        row.latest_ymd,
        now.ymd
      );

    if (
      elapsed === null ||
      elapsed < 0 ||
      elapsed > 14
    ) {
      continue;
    }

    if (
      !targets(
        row.notify_days
      )
        .includes(
          elapsed
        )
    ) {
      continue;
    }

    const result =
      await sendOne(
        env,
        row,
        elapsed,
        now.ymd
      );

    if (result === 'sent') {
      sent++;
    } else if (result === 'expired') {
      expired++;
    } else if (result === 'error') {
      errors++;
    }
  }

  return {
    ok: true,
    checked: rows.length,
    sent,
    expired,
    errors,
  };
}
