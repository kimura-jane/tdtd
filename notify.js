'use strict';

/* ============================================================
   みんやせ / notify.js

   iOS ローカル通知
   ------------------------------------------------------------
   ・最終体重記録を起点に通知
   ・3日設定
       3日目
       6日目
       9日目
       12日目
       13日目 おやすみ中予告
       14日目 おやすみ中入り
   ・7日設定
       7日目
       13日目 おやすみ中予告
       14日目 おやすみ中入り
   ・14日以降は通知停止
   ・体重保存成功後に予約を再作成
   ・体重削除成功後にも予約を再計算
   ・通知設定変更成功後に予約を再作成
   ・通知OFFで予約を全削除
   ・通知拒否時はサーバー側 notify_on も false に戻す
   ・Web版では表示しない
   ・通知許可ダイアログはユーザーが通知設定を保存した時だけ
   ============================================================ */

(() => {

  /* ==========================================================
     基本設定
     ========================================================== */

  const API =
    (typeof window !== 'undefined' &&
      window.MINYASE_API_BASE) ||
    '';

  const K_DEV =
    'tsudatsu.device_id.v1';

  /*
   * notify.js 内部通信専用。
   *
   * 後から window.fetch を監視用に差し替えるため、
   * notify.js 自身の通信まで監視対象に入らないよう
   * 元の fetch を保持する。
   */
  const baseFetch =
    window.fetch.bind(window);


  /*
   * みんやせ専用のローカル通知ID。
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

  let queuedSync =
    null;

  let fetchPatched =
    false;


  /* ==========================================================
     DOM
     ========================================================== */

  function $(id) {
    return document.getElementById(id);
  }


  function message(text, ok) {

    const n =
      $('nmsg');

    if (!n) {
      return;
    }

    n.textContent =
      text || '';

    n.className =
      'msg ' +
      (ok ? 'ok' : 'ng');
  }


  function notificationCard() {

    const on =
      $('notifyOn');

    if (!on) {
      return null;
    }

    return on.closest(
      '.card'
    );
  }


  function updateControls() {

    const on =
      $('notifyOn');

    const days =
      $('notifyDays');

    const hour =
      $('notifyHour');

    if (!on) {
      return;
    }

    const disabled =
      !on.checked;

    if (days) {
      days.disabled =
        disabled;
    }

    if (hour) {
      hour.disabled =
        disabled;
    }
  }


  function applySettingsToUi(settings) {

    const on =
      $('notifyOn');

    const days =
      $('notifyDays');

    const hour =
      $('notifyHour');

    if (on) {
      on.checked =
        !!settings.on;
    }

    if (days) {
      days.value =
        String(
          settings.days === 7
            ? 7
            : 3
        );
    }

    if (hour) {

      const h =
        Number.isInteger(
          settings.hour
        ) &&
        settings.hour >= 0 &&
        settings.hour <= 23
          ? settings.hour
          : 20;

      hour.value =
        String(h);
    }

    updateControls();
  }


  function setUiOff() {

    const on =
      $('notifyOn');

    if (on) {
      on.checked =
        false;
    }

    updateControls();
  }


  /* ==========================================================
     Capacitor
     ========================================================== */

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

    if (
      typeof c.getPlatform ===
      'function'
    ) {
      return (
        c.getPlatform() !==
        'web'
      );
    }

    return false;
  }


  /*
   * Capacitor iOS は登録済みネイティブプラグインを
   * window.Capacitor.Plugins に公開する。
   *
   * そのためバンドラーを使わない現在の構成では
   * Plugins.LocalNotifications を最優先で使う。
   *
   * registerPlugin は互換用フォールバック。
   */
  function plugin() {

    if (LocalNotifications) {
      return LocalNotifications;
    }

    const c =
      window.Capacitor;

    if (!c) {
      return null;
    }

    if (
      c.Plugins &&
      c.Plugins.LocalNotifications
    ) {

      LocalNotifications =
        c.Plugins.LocalNotifications;

      return LocalNotifications;
    }

    if (
      typeof c.registerPlugin ===
      'function'
    ) {

      try {

        LocalNotifications =
          c.registerPlugin(
            'LocalNotifications'
          );

        return LocalNotifications;

      } catch (e) {

        console.error(
          'notify_register_plugin',
          e
        );
      }
    }

    return null;
  }


  /* ==========================================================
     日付
     ========================================================== */

  const JST_DATE_FMT =
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


  const JST_DISPLAY_FMT =
    new Intl.DateTimeFormat(
      'ja-JP',
      {
        timeZone:
          'Asia/Tokyo',

        month:
          'numeric',

        day:
          'numeric',

        hour:
          '2-digit',

        minute:
          '2-digit',

        hourCycle:
          'h23',
      }
    );


  function todayYmdJST() {

    const parts =
      JST_DATE_FMT
        .formatToParts(
          new Date()
        );

    const get =
      type =>
        parts.find(
          p =>
            p.type === type
        ).value;

    return (
      get('year') +
      '-' +
      get('month') +
      '-' +
      get('day')
    );
  }


  /*
   * YYYY-MM-DD の基準日に add 日を加え、
   * JSTの指定時刻を絶対時刻の Date に変換する。
   *
   * 端末タイムゾーンが変わっても、
   * みんやせのJST基準を維持する。
   */
  function addDaysAtHourJST(
    ymd,
    add,
    hour
  ) {

    const [
      year,
      month,
      day
    ] =
      String(ymd)
        .split('-')
        .map(Number);

    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day)
    ) {
      throw new Error(
        'bad_base_date'
      );
    }

    /*
     * JST = UTC+9
     */
    return new Date(
      Date.UTC(
        year,
        month - 1,
        day + add,
        hour - 9,
        0,
        0,
        0
      )
    );
  }


  function formatJST(date) {

    return JST_DISPLAY_FMT
      .format(date);
  }


  /* ==========================================================
     API
     ========================================================== */

  function deviceId() {

    return (
      localStorage.getItem(
        K_DEV
      ) ||
      ''
    );
  }


  async function requestJson(
    path,
    options = {}
  ) {

    const did =
      deviceId();

    if (!did) {
      throw new Error(
        'no_device'
      );
    }

    const method =
      options.method ||
      'GET';

    const headers = {
      'content-type':
        'application/json',

      'x-device-id':
        did,
    };

    const fetchOptions = {
      method,
      headers,
      cache:
        'no-store',
    };

    if (
      options.body !==
      undefined
    ) {

      fetchOptions.body =
        JSON.stringify(
          options.body
        );
    }

    const res =
      await baseFetch(
        API + path,
        fetchOptions
      );

    let data =
      {};

    try {

      data =
        await res.json();

    } catch (_) {

      data =
        {};
    }

    if (
      !res.ok ||
      data.ok === false
    ) {

      throw new Error(
        data.error ||
        (
          'http_' +
          res.status
        )
      );
    }

    return data;
  }


  async function turnNotifyOffOnServer() {

    await requestJson(
      '/api/me',
      {
        method:
          'PATCH',

        body: {
          notify_on:
            false,
        },
      }
    );

    return true;
  }


  async function getSettingsAndLatest() {

    const [
      meData,
      weightsData
    ] =
      await Promise.all([
        requestJson(
          '/api/me'
        ),

        requestJson(
          '/api/weights'
        ),
      ]);


    const me =
      meData.me ||
      {};


    const weights =
      Array.isArray(
        weightsData.weights
      )
        ? weightsData.weights
        : [];


    let latest =
      null;


    for (
      const row of
      weights
    ) {

      if (
        !row ||
        typeof row.ymd !==
          'string'
      ) {
        continue;
      }

      if (
        !/^\d{4}-\d{2}-\d{2}$/
          .test(
            row.ymd
          )
      ) {
        continue;
      }

      if (
        latest === null ||
        row.ymd > latest
      ) {

        latest =
          row.ymd;
      }
    }


    const rawDays =
      Number(
        me.notify_days
      );


    const rawHour =
      Number(
        me.notify_hour
      );


    return {

      on:
        !!me.notify_on,

      days:
        rawDays === 7
          ? 7
          : 3,

      hour:
        Number.isInteger(
          rawHour
        ) &&
        rawHour >= 0 &&
        rawHour <= 23
          ? rawHour
          : 20,

      latest,
    };
  }


  /* ==========================================================
     通知権限
     ========================================================== */

  async function permission(
    shouldRequest
  ) {

    const p =
      plugin();

    if (
      !p ||
      typeof p.checkPermissions !==
        'function'
    ) {

      return {
        granted:
          false,

        status:
          'unavailable',
      };
    }


    try {

      let state =
        await p
          .checkPermissions();


      if (
        state &&
        state.display ===
          'granted'
      ) {

        return {
          granted:
            true,

          status:
            'granted',
        };
      }


      /*
       * アプリ起動だけでは
       * 通知許可ダイアログを出さない。
       */
      if (!shouldRequest) {

        return {
          granted:
            false,

          status:
            (
              state &&
              state.display
            ) ||
            'prompt',
        };
      }


      if (
        typeof p.requestPermissions !==
        'function'
      ) {

        return {
          granted:
            false,

          status:
            'unavailable',
        };
      }


      /*
       * 「通知設定を保存」を
       * ユーザーが押した場合のみ許可を要求。
       */
      state =
        await p
          .requestPermissions();


      return {

        granted:
          !!(
            state &&
            state.display ===
              'granted'
          ),

        status:
          (
            state &&
            state.display
          ) ||
          'denied',
      };


    } catch (e) {

      console.error(
        'notify_permission',
        e
      );

      return {
        granted:
          false,

        status:
          'error',
      };
    }
  }


  /* ==========================================================
     通知キャンセル
     ========================================================== */

  async function cancelAll() {

    const p =
      plugin();

    if (
      !p ||
      typeof p.cancel !==
        'function'
    ) {
      return;
    }


    try {

      await p.cancel({
        notifications:
          ALL_IDS.map(
            id => ({
              id
            })
          ),
      });

    } catch (e) {

      /*
       * まだ予約されていないIDを含む場合などでも、
       * アプリ本体は止めない。
       */
      console.warn(
        'notify_cancel',
        e
      );
    }
  }


  /* ==========================================================
     通知文章
     ========================================================== */

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


  function targetDays(interval) {

    if (interval === 7) {

      return [
        7,
        13,
        14,
      ];
    }

    return [
      3,
      6,
      9,
      12,
      13,
      14,
    ];
  }


  /* ==========================================================
     通知予約
     ========================================================== */

  async function scheduleFrom(
    baseYmd,
    interval,
    hour
  ) {

    const p =
      plugin();

    if (
      !p ||
      typeof p.schedule !==
        'function'
    ) {

      throw new Error(
        'plugin_missing'
      );
    }


    await cancelAll();


    const now =
      Date.now();


    const notifications =
      [];


    for (
      const day of
      targetDays(
        interval
      )
    ) {

      const at =
        addDaysAtHourJST(
          baseYmd,
          day,
          hour
        );


      /*
       * 過去になった通知を
       * 後からまとめて鳴らさない。
       */
      if (
        at.getTime() <=
        now
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

        /*
         * Capacitor 7では
         * iOSでsound未指定だと無音。
         *
         * 空文字は「サウンドファイルが見つからない」
         * 扱いとなり、iOSのデフォルト通知音を使用する。
         */
        sound:
          '',

        /*
         * foregroundでも
         * 通知自体を抑制しない。
         */
        silent:
          false,

        threadIdentifier:
          'minyase-reminder',

        extra: {
          minyase:
            true,

          inactiveDay:
            day,
        },
      });
    }


    if (
      notifications.length >
      0
    ) {

      await p.schedule({
        notifications,
      });
    }


    return notifications;
  }


  /* ==========================================================
     通知同期
     ========================================================== */

  async function sync(
    requestPermission,
    showMessage
  ) {

    if (!isNative()) {
      return;
    }


    /*
     * 同期中に体重保存などが発生した場合は、
     * その同期要求を捨てずに後でもう一度実行する。
     */
    if (syncing) {

      if (!queuedSync) {

        queuedSync = {
          requestPermission:
            !!requestPermission,

          showMessage:
            !!showMessage,
        };

      } else {

        queuedSync
          .requestPermission =
          (
            queuedSync
              .requestPermission ||
            !!requestPermission
          );

        queuedSync
          .showMessage =
          (
            queuedSync
              .showMessage ||
            !!showMessage
          );
      }

      return;
    }


    syncing =
      true;


    try {

      const p =
        plugin();


      if (!p) {

        if (showMessage) {

          message(
            '通知機能を読み込めませんでした',
            false
          );
        }

        return;
      }


      const settings =
        await getSettingsAndLatest();


      applySettingsToUi(
        settings
      );


      /*
       * 通知OFF
       */
      if (!settings.on) {

        await cancelAll();

        if (showMessage) {

          message(
            '通知をオフにしました',
            true
          );
        }

        return;
      }


      /*
       * OS通知権限
       */
      const perm =
        await permission(
          !!requestPermission
        );


      if (!perm.granted) {

        /*
         * iOS設定ですでに拒否されている場合。
         */
        if (
          perm.status ===
          'denied'
        ) {

          await cancelAll();


          try {

            await turnNotifyOffOnServer();

          } catch (e) {

            console.error(
              'notify_auto_off_server',
              e
            );
          }


          setUiOff();


          if (showMessage) {

            message(
              'iPhoneの通知が許可されていないため、通知をオフに戻しました。iPhoneの設定から「みんやせ」の通知を許可すると再度オンにできます',
              false
            );
          }

          return;
        }


        /*
         * 初回起動時の prompt 状態。
         * 勝手に許可ダイアログは出さない。
         */
        if (
          !requestPermission &&
          (
            perm.status ===
              'prompt' ||
            perm.status ===
              'prompt-with-rationale'
          )
        ) {

          return;
        }


        if (showMessage) {

          if (
            perm.status ===
            'unavailable'
          ) {

            message(
              'この端末では通知機能を利用できません',
              false
            );

          } else {

            message(
              '通知を許可できませんでした',
              false
            );
          }
        }

        return;
      }


      /*
       * まだ体重を一度も記録していない場合。
       *
       * 「最終体重記録」が存在しないので、
       * 勝手に今日を起点として毎回リセットせず、
       * 最初の体重記録が成功した時から通知を開始する。
       */
      if (!settings.latest) {

        await cancelAll();

        if (showMessage) {

          message(
            '通知をオンにしました。最初の体重を記録すると通知が始まります',
            true
          );
        }

        return;
      }


      const list =
        await scheduleFrom(
          settings.latest,
          settings.days,
          settings.hour
        );


      if (showMessage) {

        if (
          list.length >
          0
        ) {

          message(
            '通知を設定しました。次回は ' +
            formatJST(
              list[0]
                .schedule
                .at
            ) +
            ' です',
            true
          );

        } else {

          /*
           * 最終記録から14日目の通知時刻も
           * すでに経過している。
           */
          message(
            '現在おやすみ中のため、通知は停止しています。体重を記録するとすぐ再開します',
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

        message(
          '通知の設定に失敗しました',
          false
        );
      }


    } finally {

      syncing =
        false;


      /*
       * 同期中に別の同期要求が来ていた場合。
       */
      if (queuedSync) {

        const next =
          queuedSync;

        queuedSync =
          null;


        setTimeout(
          () => {
            sync(
              next
                .requestPermission,
              next
                .showMessage
            );
          },
          0
        );
      }
    }
  }


  /* ==========================================================
     fetch監視
     ========================================================== */

  function parseRequestMethod(
    input,
    init
  ) {

    if (
      init &&
      init.method
    ) {

      return String(
        init.method
      ).toUpperCase();
    }


    if (
      typeof Request !==
        'undefined' &&
      input instanceof Request
    ) {

      return String(
        input.method ||
        'GET'
      ).toUpperCase();
    }


    return 'GET';
  }


  function parseRequestUrl(
    input
  ) {

    if (
      typeof input ===
      'string'
    ) {

      return input;
    }


    if (
      typeof URL !==
        'undefined' &&
      input instanceof URL
    ) {

      return input.href;
    }


    if (
      input &&
      typeof input.url ===
        'string'
    ) {

      return input.url;
    }


    return '';
  }


  async function responseSucceeded(
    response
  ) {

    if (
      !response ||
      !response.ok
    ) {

      return false;
    }


    try {

      const data =
        await response.json();


      if (
        data &&
        data.ok === false
      ) {

        return false;
      }


    } catch (_) {

      /*
       * JSONではない成功レスポンスも
       * HTTP成功なら成功扱い。
       */
    }


    return true;
  }


  function readJsonBody(
    init
  ) {

    if (
      !init ||
      typeof init.body !==
        'string'
    ) {

      return null;
    }


    try {

      return JSON.parse(
        init.body
      );

    } catch (_) {

      return null;
    }
  }


  async function handleFetchResult(
    response,
    input,
    init
  ) {

    try {

      if (
        !await responseSucceeded(
          response
        )
      ) {

        return;
      }


      const rawUrl =
        parseRequestUrl(
          input
        );


      if (!rawUrl) {
        return;
      }


      const url =
        new URL(
          rawUrl,
          location.href
        );


      const path =
        url.pathname;


      const method =
        parseRequestMethod(
          input,
          init
        );


      /*
       * 体重保存成功
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

        return;
      }


      /*
       * 体重削除成功
       *
       * 最新記録を削除した可能性があるため
       * 全記録から改めて最新日を計算する。
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

        return;
      }


      /*
       * 通知設定保存成功
       */
      if (
        path ===
          '/api/me' &&
        method ===
          'PATCH'
      ) {

        const body =
          readJsonBody(
            init
          );


        if (
          body &&
          Object.prototype
            .hasOwnProperty
            .call(
              body,
              'notify_on'
            )
        ) {

          /*
           * この操作だけはユーザー操作起点なので、
           * iOS通知許可ダイアログを出してよい。
           */
          setTimeout(
            () =>
              sync(
                true,
                true
              ),
            150
          );
        }

        return;
      }


      /*
       * 利用データ削除成功
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


    } catch (e) {

      console.warn(
        'notify_fetch_hook',
        e
      );
    }
  }


  function patchFetch() {

    if (fetchPatched) {
      return;
    }


    fetchPatched =
      true;


    window.fetch =
      async function(
        input,
        init
      ) {

        const response =
          await baseFetch(
            input,
            init
          );


        /*
         * アプリ本体へ返すResponseはそのまま残し、
         * clone側だけで成功判定する。
         */
        try {

          const cloned =
            response.clone();


          handleFetchResult(
            cloned,
            input,
            init
          );

        } catch (e) {

          console.warn(
            'notify_fetch_clone',
            e
          );
        }


        return response;
      };
  }


  /* ==========================================================
     UI
     ========================================================== */

  function setupUi() {

    const on =
      $('notifyOn');


    if (!on) {
      return;
    }


    const card =
      notificationCard();


    /*
     * Web版では通知設定を表示しない。
     */
    if (!isNative()) {

      if (card) {

        card.hidden =
          true;
      }

      return;
    }


    /*
     * iOSアプリでは表示。
     */
    if (card) {

      card.hidden =
        false;
    }


    on.addEventListener(
      'change',
      updateControls
    );


    updateControls();
  }


  /* ==========================================================
     起動
     ========================================================== */

  function start() {

    setupUi();

    patchFetch();


    /*
     * app.js の登録・bootを待ってから同期。
     *
     * 起動時は通知許可ダイアログを絶対に出さない。
     */
    setTimeout(
      () => {
        sync(
          false,
          false
        );
      },
      1500
    );


    /*
     * ネットワークや初回登録が遅かった場合の
     * 再同期。
     */
    setTimeout(
      () => {
        sync(
          false,
          false
        );
      },
      4500
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
