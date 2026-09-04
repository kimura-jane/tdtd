'use strict';

/* ============================================================
   みんやせ / Android PWA Service Worker
   ============================================================ */

const CACHE_NAME =
  'minyase-shell-v2';

const HOME_URL =
  '/';


/* ============================================================
   インストール
   ============================================================ */

self.addEventListener(
  'install',
  event => {

    event.waitUntil(
      caches
        .open(
          CACHE_NAME
        )
        .then(
          cache =>
            cache.add(
              HOME_URL
            )
        )
        .catch(
          () =>
            undefined
        )
    );

    self.skipWaiting();
  }
);


/* ============================================================
   有効化
   ============================================================ */

self.addEventListener(
  'activate',
  event => {

    event.waitUntil(
      caches
        .keys()
        .then(
          keys =>
            Promise.all(
              keys
                .filter(
                  key =>
                    key !==
                    CACHE_NAME
                )
                .map(
                  key =>
                    caches.delete(
                      key
                    )
                )
            )
        )
        .then(
          () =>
            self.clients.claim()
        )
    );
  }
);


/* ============================================================
   ナビゲーション

   API・画像・JS・CSSには触らない。
   HTMLナビゲーションのみ
   「ネットワーク優先 → 同じURLのキャッシュ → ホーム」
   の順で返す。
   ============================================================ */

self.addEventListener(
  'fetch',
  event => {

    const request =
      event.request;

    if (
      request.method !==
        'GET' ||
      request.mode !==
        'navigate'
    ) {
      return;
    }


    event.respondWith(
      fetch(
        request
      )
        .then(
          async response => {

            if (
              response &&
              response.ok
            ) {

              try {

                const cache =
                  await caches.open(
                    CACHE_NAME
                  );

                await cache.put(
                  request,
                  response.clone()
                );

              } catch (e) {

                console.warn(
                  'sw_cache_put',
                  e
                );
              }
            }

            return response;
          }
        )
        .catch(
          async () => {

            const exact =
              await caches.match(
                request
              );

            if (exact) {
              return exact;
            }

            const home =
              await caches.match(
                HOME_URL
              );

            if (home) {
              return home;
            }

            return new Response(
              'オフラインです。通信できる状態でもう一度お試しください。',
              {
                status:
                  503,

                headers: {
                  'content-type':
                    'text/plain; charset=utf-8',
                },
              }
            );
          }
        )
    );
  }
);


/* ============================================================
   Web Push受信
   ============================================================ */

self.addEventListener(
  'push',
  event => {

    let data =
      {};

    try {

      data =
        event.data
          ? event.data.json()
          : {};

    } catch (_) {

      data = {
        body:
          event.data
            ? event.data.text()
            : '',
      };
    }


    const title =
      typeof data.title ===
        'string' &&
      data.title
        ? data.title
        : 'みんやせ';


    const body =
      typeof data.body ===
        'string' &&
      data.body
        ? data.body
        : '今日の体重を記録しよう！';


    const tag =
      typeof data.tag ===
        'string' &&
      data.tag
        ? data.tag
        : 'minyase-reminder';


    const rawUrl =
      typeof data.url ===
        'string' &&
      data.url
        ? data.url
        : '/';


    let url =
      '/';

    try {

      const resolved =
        new URL(
          rawUrl,
          self.location.origin
        );

      if (
        resolved.origin ===
          self.location.origin
      ) {

        url =
          resolved.href;
      }

    } catch (_) {
      url = '/';
    }


    const options = {

      body,

      icon:
        '/gazo/icon-192.png',

      tag,

      renotify:
        false,

      data: {
        url,
      },
    };


    event.waitUntil(
      self.registration
        .showNotification(
          title,
          options
        )
    );
  }
);


/* ============================================================
   通知タップ
   ============================================================ */

self.addEventListener(
  'notificationclick',
  event => {

    event.notification
      .close();


    const rawUrl =
      (
        event.notification &&
        event.notification.data &&
        event.notification.data.url
      ) ||
      '/';


    let targetUrl =
      self.location.origin +
      '/';

    try {

      const resolved =
        new URL(
          rawUrl,
          self.location.origin
        );

      if (
        resolved.origin ===
          self.location.origin
      ) {

        targetUrl =
          resolved.href;
      }

    } catch (_) {
      /* ホームを使う */
    }


    event.waitUntil(
      clients
        .matchAll({
          type:
            'window',

          includeUncontrolled:
            true,
        })
        .then(
          async windowClients => {

            for (
              const client of
              windowClients
            ) {

              try {

                if (
                  'navigate' in
                  client
                ) {

                  await client.navigate(
                    targetUrl
                  );
                }

                if (
                  'focus' in
                  client
                ) {

                  return client.focus();
                }

              } catch (_) {
                /* 次のクライアントへ */
              }
            }


            if (
              clients.openWindow
            ) {

              return clients.openWindow(
                targetUrl
              );
            }
          }
        )
    );
  }
);
