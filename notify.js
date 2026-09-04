'use strict';

/* ============================================================
   みんやせ / notify.js

   iOSローカル通知
   ------------------------------------------------------------
   ・最終体重記録を起点に通知を予約
   ・3日設定:
       3 / 6 / 9 / 12日目
       13日目 休眠予告
       14日目 休眠入り
   ・7日設定:
       7日目
       13日目 休眠予告
       14日目 休眠入り
   ・14日以降は通知しない
   ・体重保存成功後に予約を組み直す
   ・最新記録削除後も予約を組み直す
   ・通知OFFで全キャンセル
   ・通知許可を拒否されたらサーバー側も自動でOFF
   ・Web版では動作しない
   ============================================================ */

(() => {
  const API =
    (typeof window !== 'undefined' &&
      window.MINYASE_API_BASE) ||
    '';

  const K_DEV =
    'tsudatsu.device_id.v1';

  /*
   * notify.js 自身のAPI通信はこれを使う。
   * 後から window.fetch を監視用に差し替えても、
   * notify.js 内部の通信が再び監視に引っかからないようにする。
   */
  const baseFetch =
    window.fetch.bind(window);

  /*
   * みんやせ専用の通知ID。
   * 他機能のローカル通知とぶつからない範囲を使う。
   */
  const IDS = {
    3: 730003,
    6: 730006,
    7: 730007,
    9: 730009,
    12: 730012,
    13: 730013,
    14: 730014,
  };

  const ALL_IDS =
    Object.values(IDS);

  let LocalNotifications =
    null;

  let syncing =
    false;

  let fetchPatched =
    false;

  /* ------------------------------------------------------------
     DOM
     ------------------------------------------------------------ */

  function $(id) {
    return document.getElementById(id);
  }

  function msg(text, ok) {
    const n =
      $('nmsg');

    if (!n) return;

    n.textContent =
      text || '';

    n.className =
      'msg ' +
      (ok ? 'ok' : 'ng');
  }

  function setUiOff() {
    const on =
      $('notifyOn');

    const days =
      $('notifyDays');

    const hour =
      $('notifyHour');

    if (on) {
      on.checked =
        false;
    }

    if (days) {
      days.disabled =
        true;
    }

    if (hour) {
      hour.disabled =
        true;
    }
  }

  /* ------------------------------------------------------------
     Capacitor
     ------------------------------------------------------------ */

  function isNative() {
    const c =
      window.Capacitor;

    if (!c) {
      return false;
    }

    if (
      typeof c.isNativePlatform ===
      'function'
    ) {
      return c.isNativePlatform();
    }

    return !!c.getPlatform &&
      c.getPlatform() !== 'web';
  }

  function plugin() {
    if (LocalNotifications) {
      return LocalNotifications;
    }

    const c =
      window.Capacitor;

    if (
      !c ||
      typeof c.registerPlugin !==
        'function'
    ) {
      return null;
    }

    LocalNotifications =
      c.registerPlugin(
        'LocalNotifications'
      );

    return LocalNotifications;
  }

  /* ------------------------------------------------------------
     日付
     アプリ本体と同じくJSTを基準にする
     ------------------------------------------------------------ */

  const JST_FMT =
    new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone:
          'Asia/Tokyo',

        year:
          'numeric',

        month:
          '2-digit',

        day:
          '2-digit',
      }
    );

  function todayYmdJST() {
    const p =
      JST_FMT.formatToParts(
        new Date()
      );

    const get =
      type =>
        p.find(
          x =>
            x.type === type
        ).value;

    return (
      get('year') +
      '-' +
      get('month') +
      '-' +
      get('day')
    );
  }

  function addDaysAtHour(
    ymd,
    add,
    hour
  ) {
    const parts =
      String(ymd)
        .split('-')
        .map(Number);

    const y =
      parts[0];

    const m =
      parts[1];

    const d =
      parts[2];

    /*
     * iPhoneのローカル時刻として予約する。
     * 日本で利用する前提ではJSTの指定時刻になる。
     */
    return new Date(
      y,
      m - 1,
      d + add,
      hour,
      0,
      0,
      0
    );
  }

  function fmtDate(d) {
    return (
      (d.getMonth() + 1) +
      '月' +
      d.getDate() +
      '日 ' +
      String(
        d.getHours()
      ).padStart(2, '0') +
      ':00'
    );
  }

  /* ------------------------------------------------------------
     API
     ------------------------------------------------------------ */

  function deviceId() {
    return (
      localStorage.getItem(
        K_DEV
      ) || ''
    );
  }

  async function getJson(path) {
    const did =
      deviceId();

    if (!did) {
      throw new Error(
        'no_device'
      );
    }

    const res =
      await baseFetch(
        API + path,
        {
          method:
            'GET',

          headers: {
            'content-type':
              'application/json',

            'x-device-id':
              did,
          },

          cache:
            'no-store',
        }
      );

    let data =
      {};

    try {
      data =
        await res.json();
    } catch {}

    if (
      !res.ok ||
      data.ok === false
    ) {
      throw new Error(
        data.error ||
        'http_' +
          res.status
      );
    }

    return data;
  }

  /*
   * iOS側で通知を拒否された場合、
   * サーバー側の notify_on=true を残さない。
   *
   * baseFetch を直接使うので、
   * patchFetch の通知設定監視には再び入らない。
   */
  async function turnNotifyOffOnServer() {
    const did =
      deviceId();

    if (!did) {
      throw new Error(
        'no_device'
      );
    }

    const res =
      await baseFetch(
        API + '/api/me',
        {
          method:
            'PATCH',

          headers: {
            'content-type':
              'application/json',

            'x-device-id':
              did,
          },

          body:
            JSON.stringify({
              notify_on: false,
            }),

          cache:
            'no-store',
        }
      );

    let data =
      {};

    try {
      data =
        await res.json();
    } catch {}

    if (
      !res.ok ||
      data.ok === false
    ) {
      throw new Error(
        data.error ||
        'http_' +
          res.status
      );
    }

    return true;
  }

  async function getSettingsAndLatest() {
    const [
      meData,
      weightsData,
    ] =
      await Promise.all([
        getJson('/api/me'),
        getJson('/api/weights'),
      ]);

    const me =
      meData.me || {};

    const weights =
      weightsData.weights || [];

    let latest =
      null;

    for (const row of weights) {
      if (
        row &&
        row.ymd &&
        (
          latest === null ||
          row.ymd > latest
        )
      ) {
        latest =
          row.ymd;
      }
    }

    return {
      on:
        !!me.notify_on,

      days:
        Number(
          me.notify_days || 3
        ),

      hour:
        Number(
          me.notify_hour == null
            ? 20
            : me.notify_hour
        ),

      latest:
        latest,
    };
  }

  /* ------------------------------------------------------------
     Permission
     ------------------------------------------------------------ */

  async function permission(
    request
  ) {
    const p =
      plugin();

    if (!p) {
      return {
        granted: false,
        status: 'unavailable',
      };
    }

    try {
      let s =
        await p.checkPermissions();

      if (
        s.display ===
        'granted'
      ) {
        return {
          granted: true,
          status: 'granted',
        };
      }

      /*
       * 起動時には勝手に許可ダイアログを出さない。
       * 現在の状態だけ返す。
       */
      if (!request) {
        return {
          granted: false,
          status:
            s.display ||
            'prompt',
        };
      }

      /*
       * 「通知設定を保存」を押した時だけ
       * iOSの許可ダイアログを表示する。
       */
      s =
        await p.requestPermissions();

      return {
        granted:
          s.display ===
          'granted',

        status:
          s.display ||
          'denied',
      };

    } catch (e) {
      console.error(
        'notify_permission',
        e
      );

      return {
        granted: false,
        status: 'error',
      };
    }
  }

  /* ------------------------------------------------------------
     Cancel
     ------------------------------------------------------------ */

  async function cancelAll() {
    const p =
      plugin();

    if (!p) {
      return;
    }

    try {
      await p.cancel({
        notifications:
          ALL_IDS.map(
            id => ({
              id,
            })
          ),
      });

    } catch (e) {
      /*
       * 予約が存在しない場合などは
       * 本体処理を止めない。
       */
      console.warn(
        'notify_cancel',
        e
      );
    }
  }

  /* ------------------------------------------------------------
     通知内容
     ------------------------------------------------------------ */

  function normalBody() {
    return (
      '最近体重を記録してないよ。' +
      '今日の体重を記録しよう！'
    );
  }

  function beforeSleepBody() {
    return (
      '明日でおやすみ中になります。' +
      '体重を記録すると継続できます。'
    );
  }

  function sleepBody() {
    return (
      '14日間記録がないため、' +
      'おやすみ中になりました。' +
      '体重を記録するとすぐ復帰できます。'
    );
  }

  function bodyForDay(day) {
    if (day === 13) {
      return beforeSleepBody();
    }

    if (day === 14) {
      return sleepBody();
    }

    return normalBody();
  }

  /* ------------------------------------------------------------
     予約作成
     ------------------------------------------------------------ */

  function targetDays(interval) {
    const normal =
      interval === 7
        ? [7]
        : [3, 6, 9, 12];

    return [
      ...normal,
      13,
      14,
    ];
  }

  async function scheduleFrom(
    baseYmd,
    interval,
    hour
  ) {
    const p =
      plugin();

    if (!p) {
      throw new Error(
        'plugin_missing'
      );
    }

    await cancelAll();

    const now =
      new Date();

    const notifications =
      [];

    for (
      const day of
      targetDays(interval)
    ) {
      const at =
        addDaysAtHour(
          baseYmd,
          day,
          hour
        );

      /*
       * すでに過ぎている通知は
       * 今さら鳴らさない。
       */
      if (
        at.getTime() <=
        now.getTime()
      ) {
        continue;
      }

      notifications.push({
        id:
          IDS[day],

        title:
          'みんやせ',

        body:
          bodyForDay(day),

        schedule: {
          at,
        },

        extra: {
          minyase:
            true,

          inactiveDay:
            day,
        },
      });
    }

    if (
      notifications.length
    ) {
      await p.schedule({
        notifications,
      });
    }

    return notifications;
  }

  /* ------------------------------------------------------------
     同期
     requestPermission:
       true  = ユーザーが通知設定を保存したとき
       false = 起動時など
     ------------------------------------------------------------ */

  async function sync(
    requestPermission,
    showMessage
  ) {
    if (
      syncing ||
      !isNative()
    ) {
      return;
    }

    syncing =
      true;

    try {
      const s =
        await getSettingsAndLatest();

      /*
       * OFFなら予約を全部消す。
       */
      if (!s.on) {
        await cancelAll();

        if (showMessage) {
          msg(
            '通知をオフにしました',
            true
          );
        }

        return;
      }

      const perm =
        await permission(
          !!requestPermission
        );

      if (!perm.granted) {
        /*
         * 明示的に拒否済みなら、
         * 端末側の予約を消し、
         * サーバー側のnotify_onもfalseへ戻す。
         *
         * 起動時にまだ一度も尋ねていない
         * prompt状態の場合は勝手にOFFにはしない。
         */
        if (
          perm.status ===
          'denied'
        ) {
          await cancelAll();

          try {
            await turnNotifyOffOnServer();

            setUiOff();

            if (showMessage) {
              msg(
                'iPhoneの通知が許可されなかったため、通知をオフに戻しました',
                false
              );
            }

          } catch (e) {
            console.error(
              'notify_auto_off',
              e
            );

            setUiOff();

            if (showMessage) {
              msg(
                '通知が許可されていません。通知設定をオフにしてください',
                false
              );
            }
          }

          return;
        }

        /*
         * requestPermissionsを呼んでいない起動時の
         * prompt状態では何もしない。
         */
        if (showMessage) {
          msg(
            'iPhoneの通知を許可してから、もう一度通知設定を保存してください',
            false
          );
        }

        return;
      }

      const interval =
        s.days === 7
          ? 7
          : 3;

      const hour =
        Number.isInteger(
          s.hour
        ) &&
        s.hour >= 0 &&
        s.hour <= 23
          ? s.hour
          : 20;

      /*
       * まだ一度も記録していない場合は、
       * 通知設定を有効にした今日を起点にする。
       */
      const base =
        s.latest ||
        todayYmdJST();

      const list =
        await scheduleFrom(
          base,
          interval,
          hour
        );

      if (showMessage) {
        if (
          list.length
        ) {
          msg(
            '通知を設定しました。次回は ' +
              fmtDate(
                list[0]
                  .schedule
                  .at
              ) +
              ' です',
            true
          );

        } else {
          /*
           * 最終記録から14日以上経過済み。
           */
          msg(
            '現在おやすみ中のため、通知は停止しています。体重を記録すると再開します',
            true
          );
        }
      }

    } catch (e) {
      console.error(
        'notify_sync',
        e
      );

      if (showMessage) {
        msg(
          '通知の設定に失敗しました',
          false
        );
      }

    } finally {
      syncing =
        false;
    }
  }

  /* ------------------------------------------------------------
     fetch監視

     app.jsのAPIが成功した「あと」にだけ通知を組み直す。
     これにより、
       ・保存失敗なのに通知だけリセット
       ・通知設定保存失敗なのに通知だけ有効化
     を防ぐ。
     ------------------------------------------------------------ */

  function patchFetch() {
    if (
      fetchPatched
    ) {
      return;
    }

    fetchPatched =
      true;

    window.fetch =
      async function (
        input,
        init
      ) {
        const res =
          await baseFetch(
            input,
            init
          );

        try {
          const rawUrl =
            typeof input ===
              'string'
              ? input
              : input.url;

          const url =
            new URL(
              rawUrl,
              location.href
            );

          const method =
            String(
              (
                init &&
                init.method
              ) ||
              (
                input &&
                input.method
              ) ||
              'GET'
            )
              .toUpperCase();

          const path =
            url.pathname;

          if (res.ok) {
            /*
             * 体重を正常保存
             */
            if (
              path ===
                '/api/weights' &&
              method ===
                'POST'
            ) {
              setTimeout(
                () =>
                  sync(
                    false,
                    false
                  ),
                100
              );
            }

            /*
             * 体重削除。
             * 最新記録を消した可能性があるので再計算。
             */
            if (
              path.startsWith(
                '/api/weights/'
              ) &&
              method ===
                'DELETE'
            ) {
              setTimeout(
                () =>
                  sync(
                    false,
                    false
                  ),
                100
              );
            }

            /*
             * 通知設定保存。
             * この操作のときだけ
             * iOSの通知許可ダイアログを出してよい。
             */
            if (
              path ===
                '/api/me' &&
              method ===
                'PATCH'
            ) {
              let body =
                null;

              if (
                init &&
                typeof init.body ===
                  'string'
              ) {
                try {
                  body =
                    JSON.parse(
                      init.body
                    );
                } catch {}
              }

              if (
                body &&
                Object.prototype
                  .hasOwnProperty
                  .call(
                    body,
                    'notify_on'
                  )
              ) {
                setTimeout(
                  () =>
                    sync(
                      true,
                      true
                    ),
                  150
                );
              }
            }

            /*
             * 利用データ削除
             */
            if (
              path ===
                '/api/me' &&
              method ===
                'DELETE'
            ) {
              setTimeout(
                () =>
                  cancelAll(),
                0
              );
            }
          }

        } catch (e) {
          console.warn(
            'notify_fetch_hook',
            e
          );
        }

        return res;
      };
  }

  /* ------------------------------------------------------------
     UI
     ------------------------------------------------------------ */

  function setupUi() {
    const on =
      $('notifyOn');

    if (!on) {
      return;
    }

    const card =
      on.closest(
        '.card'
      );

    /*
     * Webブラウザではローカル通知機能を出さない。
     * iOSアプリでだけ表示する。
     */
    if (!isNative()) {
      if (card) {
        card.hidden =
          true;
      }

      return;
    }

    if (card) {
      card.hidden =
        false;
    }

    /*
     * ON/OFFに応じて選択欄を見やすくする。
     */
    const update =
      () => {
        const disabled =
          !on.checked;

        const days =
          $('notifyDays');

        const hour =
          $('notifyHour');

        if (days) {
          days.disabled =
            disabled;
        }

        if (hour) {
          hour.disabled =
            disabled;
        }
      };

    on.addEventListener(
      'change',
      update
    );

    update();
  }

  /* ------------------------------------------------------------
     起動
     ------------------------------------------------------------ */

  function start() {
    setupUi();
    patchFetch();

    /*
     * app.jsのbootが完了するのを待つ。
     *
     * すでに通知ONのユーザーの場合は、
     * OS許可済みなら予約だけ再同期する。
     * 起動しただけでは許可ダイアログは出さない。
     */
    setTimeout(
      () =>
        sync(
          false,
          false
        ),
      1800
    );
  }

  if (
    document.readyState ===
      'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      start,
      {
        once:
          true,
      }
    );

  } else {
    start();
  }
})();
