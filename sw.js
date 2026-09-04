'use strict';

/* ============================================================
   みんやせ / Android PWA Service Worker
   ============================================================ */

const CACHE_NAME =
  'minyase-shell-v1';

const APP_SHELL = [
  '/',
];


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
            cache.addAll(
              APP_SHELL
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
   ============================================================ */

self.addEventListener(
  'fetch',
  event => {

    const request =
      event.request;

    /*
     * API通信や画像アップロードなどには触らない。
     *
     * HTMLへのナビゲーションだけ、
     * ネットワーク優先 + 最低限のフォールバックにする。
     */
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
          response => {

            const copy =
              response.clone();

            caches
              .open(
                CACHE_NAME
              )
              .then(
                cache =>
                  cache.put(
                    '/',
                    copy
                  )
              )
              .catch(
                () =>
                  undefined
              );

            return response;
          }
        )
        .catch(
          () =>
            caches.match(
              '/'
            )
        )
    );
  }
);


/* ============================================================
   Web Push受信

   Cloudflare Worker側からPushを送る処理は
   次の工程で接続する。
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
      data.title ||
      'みんやせ';


    const options = {

      body:
        data.body ||
        '今日の体重を記録しよう！',

      icon:
        '/resources/icon.png',

      badge:
        '/resources/icon.png',

      tag:
        data.tag ||
        'minyase-reminder',

      renotify:
        false,

      data: {
        url:
          data.url ||
          '/',
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


    const url =
      (
        event.notification
          .data &&
        event.notification
          .data.url
      ) ||
      '/';


    event.waitUntil(
      clients
        .matchAll({
          type:
            'window',

          includeUncontrolled:
            true,
        })
        .then(
          windowClients => {

            for (
              const client of
              windowClients
            ) {

              if (
                'focus' in
                client
              ) {

                if (
                  'navigate' in
                  client
                ) {

                  client.navigate(
                    url
                  );
                }

                return client
                  .focus();
              }
            }


            if (
              clients.openWindow
            ) {

              return clients
                .openWindow(
                  url
                );
            }
          }
        )
    );
  }
);
