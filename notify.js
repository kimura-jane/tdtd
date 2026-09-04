'use strict';

/* ============================================================
   みんやせ / notify.js

   iOS:
   Capacitor Local Notifications

   Android:
   PWA / TWA Web Push

   共通仕様
   ・3日設定: 3,6,9,12,13,14日目
   ・7日設定: 7,13,14日目
   ・13日目: おやすみ中予告
   ・14日目: おやすみ中入り
   ・14日以降: 停止
   ・許可ダイアログは通知設定保存時だけ
   ============================================================ */

(() => {
  const API =
    (typeof window !== 'undefined' && window.MINYASE_API_BASE) || '';

  const K_DEV = 'tsudatsu.device_id.v1';

  /* notify.js 自身の通信は fetch 監視に入れない */
  const baseFetch = window.fetch.bind(window);

  const IDS = {
    3: 730003,
    6: 730006,
    7: 730007,
    9: 730009,
    12: 730012,
    13: 730013,
    14: 730014,
  };

  const ALL_IDS = Object.values(IDS);

  let LocalNotifications = null;
  let syncing = false;
  let queuedSync = null;
  let fetchPatched = false;
  let pendingWebPermission = null;

  /* ==========================================================
     DOM
     ========================================================== */

  const $ = (id) => document.getElementById(id);

  function message(text, ok) {
    const n = $('nmsg');
    if (!n) return;

    n.textContent = text || '';
    n.className = 'msg ' + (ok ? 'ok' : 'ng');
  }

  function notificationCard() {
    const on = $('notifyOn');
    return on ? on.closest('.card') : null;
  }

  function updateControls() {
    const on = $('notifyOn');
    const days = $('notifyDays');
    const hour = $('notifyHour');

    if (!on) return;

    const disabled = !on.checked;
    if (days) days.disabled = disabled;
    if (hour) hour.disabled = disabled;
  }

  function applySettingsToUi(settings) {
    const on = $('notifyOn');
    const days = $('notifyDays');
    const hour = $('notifyHour');

    if (on) on.checked = !!settings.on;
    if (days) days.value = String(settings.days === 7 ? 7 : 3);

    if (hour) {
      const h =
        Number.isInteger(settings.hour) &&
        settings.hour >= 0 &&
        settings.hour <= 23
          ? settings.hour
          : 20;

      hour.value = String(h);
    }

    updateControls();
  }

  function setUiOff() {
    const on = $('notifyOn');
    if (on) on.checked = false;
    updateControls();
  }

  /* ==========================================================
     環境判定
     ========================================================== */

  function isNative() {
    const c = window.Capacitor;
    if (!c) return false;

    if (typeof c.isNativePlatform === 'function') {
      return c.isNativePlatform();
    }

    if (typeof c.getPlatform === 'function') {
      return c.getPlatform() !== 'web';
    }

    return false;
  }

  function isAndroidWebPush() {
    if (isNative()) return false;
    if (!window.isSecureContext) return false;
    if (!/Android/i.test(navigator.userAgent || '')) return false;

    return (
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  function platform() {
    if (isNative()) return 'native';
    if (isAndroidWebPush()) return 'webpush';
    return 'none';
  }

  /* ==========================================================
     Capacitor
     ========================================================== */

  function plugin() {
    if (LocalNotifications) return LocalNotifications;

    const c = window.Capacitor;
    if (!c) return null;

    if (c.Plugins && c.Plugins.LocalNotifications) {
      LocalNotifications = c.Plugins.LocalNotifications;
      return LocalNotifications;
    }

    if (typeof c.registerPlugin === 'function') {
      try {
        LocalNotifications = c.registerPlugin('LocalNotifications');
        return LocalNotifications;
      } catch (e) {
        console.error('notify_register_plugin', e);
      }
    }

    return null;
  }

  /* ==========================================================
     日付
     ========================================================== */

  const JST_DISPLAY_FMT = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  function addDaysAtHourJST(ymd, add, hour) {
    const [year, month, day] = String(ymd).split('-').map(Number);

    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day)
    ) {
      throw new Error('bad_base_date');
    }

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
    return JST_DISPLAY_FMT.format(date);
  }

  /* ==========================================================
     API
     ========================================================== */

  function deviceId() {
    return localStorage.getItem(K_DEV) || '';
  }

  async function requestJson(path, options = {}) {
    const did = deviceId();
    if (!did) throw new Error('no_device');

    const fetchOptions = {
      method: options.method || 'GET',
      headers: {
        'content-type': 'application/json',
        'x-device-id': did,
      },
      cache: 'no-store',
    };

    if (options.body !== undefined) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const res = await baseFetch(API + path, fetchOptions);

    let data = {};
    try {
      data = await res.json();
    } catch {}

    if (!res.ok || data.ok === false) {
      throw new Error(data.error || ('http_' + res.status));
    }

    return data;
  }

  async function turnNotifyOffOnServer() {
    await requestJson('/api/me', {
      method: 'PATCH',
      body: { notify_on: false },
    });
  }

  async function getSettingsAndLatest() {
    const [meData, weightsData] = await Promise.all([
      requestJson('/api/me'),
      requestJson('/api/weights'),
    ]);

    const me = meData.me || {};
    const weights = Array.isArray(weightsData.weights)
      ? weightsData.weights
      : [];

    let latest = null;

    for (const row of weights) {
      if (!row || typeof row.ymd !== 'string') continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.ymd)) continue;
      if (latest === null || row.ymd > latest) latest = row.ymd;
    }

    const rawDays = Number(me.notify_days);
    const rawHour = Number(me.notify_hour);

    return {
      on: !!me.notify_on,
      days: rawDays === 7 ? 7 : 3,
      hour:
        Number.isInteger(rawHour) &&
        rawHour >= 0 &&
        rawHour <= 23
          ? rawHour
          : 20,
      latest,
    };
  }

  /* ==========================================================
     通知文
     ========================================================== */

  function bodyForDay(day) {
    if (day === 13) {
      return '明日でおやすみ中になります。体重を記録すると継続できます。';
    }

    if (day === 14) {
      return '14日間記録がないため、おやすみ中になりました。体重を記録するとすぐ復帰できます。';
    }

    return '最近体重を記録してないよ。今日の体重を記録しよう！';
  }

  function targetDays(interval) {
    return interval === 7
      ? [7, 13, 14]
      : [3, 6, 9, 12, 13, 14];
  }

  /* ==========================================================
     iOS / Capacitor
     ========================================================== */

  async function nativePermission(shouldRequest) {
    const p = plugin();

    if (!p || typeof p.checkPermissions !== 'function') {
      return { granted: false, status: 'unavailable' };
    }

    try {
      let state = await p.checkPermissions();

      if (state && state.display === 'granted') {
        return { granted: true, status: 'granted' };
      }

      if (!shouldRequest) {
        return {
          granted: false,
          status: (state && state.display) || 'prompt',
        };
      }

      if (typeof p.requestPermissions !== 'function') {
        return { granted: false, status: 'unavailable' };
      }

      state = await p.requestPermissions();

      return {
        granted: !!(state && state.display === 'granted'),
        status: (state && state.display) || 'denied',
      };
    } catch (e) {
      console.error('notify_native_permission', e);
      return { granted: false, status: 'error' };
    }
  }

  async function cancelNative() {
    const p = plugin();
    if (!p || typeof p.cancel !== 'function') return;

    try {
      await p.cancel({
        notifications: ALL_IDS.map((id) => ({ id })),
      });
    } catch (e) {
      console.warn('notify_native_cancel', e);
    }
  }

  async function scheduleNative(baseYmd, interval, hour) {
    const p = plugin();

    if (!p || typeof p.schedule !== 'function') {
      throw new Error('plugin_missing');
    }

    await cancelNative();

    const now = Date.now();
    const notifications = [];

    for (const day of targetDays(interval)) {
      const at = addDaysAtHourJST(baseYmd, day, hour);
      if (at.getTime() <= now) continue;

      notifications.push({
        id: IDS[day],
        title: 'みんやせ',
        body: bodyForDay(day),
        schedule: { at },
        sound: '',
        silent: false,
        threadIdentifier: 'minyase-reminder',
        extra: {
          minyase: true,
          inactiveDay: day,
        },
      });
    }

    if (notifications.length > 0) {
      await p.schedule({ notifications });
    }

    return notifications;
  }

  async function syncNative(requestPermission, showMessage) {
    if (!plugin()) {
      if (showMessage) message('通知機能を読み込めませんでした', false);
      return;
    }

    const settings = await getSettingsAndLatest();
    applySettingsToUi(settings);

    if (!settings.on) {
      await cancelNative();
      if (showMessage) message('通知をオフにしました', true);
      return;
    }

    const perm = await nativePermission(!!requestPermission);

    if (!perm.granted) {
      if (perm.status === 'denied') {
        await cancelNative();

        try {
          await turnNotifyOffOnServer();
        } catch (e) {
          console.error('notify_native_auto_off_server', e);
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

      if (
        !requestPermission &&
        (perm.status === 'prompt' ||
          perm.status === 'prompt-with-rationale')
      ) {
        return;
      }

      if (showMessage) {
        message(
          perm.status === 'unavailable'
            ? 'この端末では通知機能を利用できません'
            : '通知を許可できませんでした',
          false
        );
      }
      return;
    }

    if (!settings.latest) {
      await cancelNative();

      if (showMessage) {
        message(
          '通知をオンにしました。最初の体重を記録すると通知が始まります',
          true
        );
      }
      return;
    }

    const list = await scheduleNative(
      settings.latest,
      settings.days,
      settings.hour
    );

    if (showMessage) {
      if (list.length > 0) {
        message(
          '通知を設定しました。次回は ' +
            formatJST(list[0].schedule.at) +
            ' です',
          true
        );
      } else {
        message(
          '現在おやすみ中のため、通知は停止しています。体重を記録するとすぐ再開します',
          true
        );
      }
    }
  }

  /* ==========================================================
     Android / Web Push
     ========================================================== */

  function base64UrlToUint8Array(raw) {
    const padding = '='.repeat((4 - (raw.length % 4)) % 4);

    const base64 = (raw + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const data = atob(base64);
    const out = new Uint8Array(data.length);

    for (let i = 0; i < data.length; i++) {
      out[i] = data.charCodeAt(i);
    }

    return out;
  }

  async function serviceWorkerRegistration() {
    let reg = await navigator.serviceWorker.getRegistration();

    if (!reg) {
      reg = await navigator.serviceWorker.register('./sw.js');
    }

    return (await navigator.serviceWorker.ready) || reg;
  }

  /*
   * Web通知の許可要求はユーザー操作中に始める。
   * app.js の onclick より前の capture フェーズで呼ぶ。
   */
  function primeWebPermissionFromClick() {
    if (platform() !== 'webpush') return;

    const on = $('notifyOn');
    if (!on || !on.checked) return;
    if (Notification.permission !== 'default') return;
    if (pendingWebPermission) return;

    try {
      pendingWebPermission = Promise.resolve(
        Notification.requestPermission()
      ).catch((e) => {
        console.error('notify_web_permission_click', e);
        return 'denied';
      });
    } catch (e) {
      console.error('notify_web_permission_click', e);
      pendingWebPermission = Promise.resolve('denied');
    }
  }

  async function webPermission(shouldRequest) {
    if (Notification.permission === 'granted') {
      return { granted: true, status: 'granted' };
    }

    if (Notification.permission === 'denied') {
      return { granted: false, status: 'denied' };
    }

    if (pendingWebPermission) {
      const p = pendingWebPermission;
      pendingWebPermission = null;
      const state = await p;

      return {
        granted: state === 'granted',
        status: state || 'denied',
      };
    }

    if (!shouldRequest) {
      return { granted: false, status: 'prompt' };
    }

    try {
      const state = await Notification.requestPermission();
      return {
        granted: state === 'granted',
        status: state || 'denied',
      };
    } catch (e) {
      console.error('notify_web_permission', e);
      return { granted: false, status: 'error' };
    }
  }

  async function webSubscribe() {
    const keyData = await requestJson('/api/push/key');
    const publicKey = keyData.public_key;

    if (typeof publicKey !== 'string' || !publicKey) {
      throw new Error('push_key_missing');
    }

    const reg = await serviceWorkerRegistration();
    let sub = await reg.pushManager.getSubscription();

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(publicKey),
      });
    }

    await requestJson('/api/push/subscribe', {
      method: 'POST',
      body: {
        subscription: sub.toJSON(),
      },
    });

    return sub;
  }

  async function deleteWebSubscriptionOnServer() {
    try {
      await requestJson('/api/push/subscribe', {
        method: 'DELETE',
      });
    } catch (e) {
      console.warn('notify_web_delete_server', e);
    }
  }

  async function webUnsubscribeLocal() {
    if (platform() !== 'webpush') return;

    try {
      const reg = await serviceWorkerRegistration();
      const sub = await reg.pushManager.getSubscription();

      if (sub) {
        await sub.unsubscribe();
      }
    } catch (e) {
      console.warn('notify_web_unsubscribe_local', e);
    }
  }

  async function disableWebPush() {
    await deleteWebSubscriptionOnServer();
    await webUnsubscribeLocal();
  }

  async function syncWebPush(requestPermission, showMessage) {
    const settings = await getSettingsAndLatest();
    applySettingsToUi(settings);

    if (!settings.on) {
      await disableWebPush();

      if (showMessage) {
        message('通知をオフにしました', true);
      }
      return;
    }

    const perm = await webPermission(!!requestPermission);

    if (!perm.granted) {
      if (!requestPermission && perm.status === 'prompt') {
        return;
      }

      if (perm.status === 'denied') {
        try {
          await turnNotifyOffOnServer();
        } catch (e) {
          console.error('notify_web_auto_off_server', e);
        }

        await disableWebPush();
        setUiOff();

        if (showMessage) {
          message(
            'Androidの通知が許可されていないため、通知をオフに戻しました。Androidの設定から「みんやせ」の通知を許可すると再度オンにできます',
            false
          );
        }
        return;
      }

      if (showMessage) {
        message('通知を許可できませんでした', false);
      }
      return;
    }

    try {
      await webSubscribe();
    } catch (e) {
      console.error('notify_web_subscribe', e);

      if (requestPermission) {
        try {
          await turnNotifyOffOnServer();
        } catch (e2) {
          console.error('notify_web_subscribe_auto_off', e2);
        }

        setUiOff();
      }

      if (showMessage) {
        message(
          '通知の登録に失敗しました。通信状態を確認して、もう一度通知をオンにしてください',
          false
        );
      }
      return;
    }

    if (showMessage) {
      message(
        settings.latest
          ? '通知を設定しました'
          : '通知をオンにしました。最初の体重を記録すると通知が始まります',
        true
      );
    }
  }

  /* ==========================================================
     共通同期
     ========================================================== */

  async function sync(requestPermission, showMessage) {
    const mode = platform();
    if (mode === 'none') return;

    if (syncing) {
      if (!queuedSync) {
        queuedSync = {
          requestPermission: !!requestPermission,
          showMessage: !!showMessage,
        };
      } else {
        queuedSync.requestPermission =
          queuedSync.requestPermission || !!requestPermission;

        queuedSync.showMessage =
          queuedSync.showMessage || !!showMessage;
      }
      return;
    }

    syncing = true;

    try {
      if (mode === 'native') {
        await syncNative(requestPermission, showMessage);
      } else {
        await syncWebPush(requestPermission, showMessage);
      }
    } catch (e) {
      console.error('notify_sync', e);

      if (showMessage) {
        message('通知の設定に失敗しました', false);
      }
    } finally {
      syncing = false;

      if (queuedSync) {
        const next = queuedSync;
        queuedSync = null;

        setTimeout(() => {
          sync(next.requestPermission, next.showMessage);
        }, 0);
      }
    }
  }

  /* ==========================================================
     fetch監視
     ========================================================== */

  function requestMethod(input, init) {
    if (init && init.method) {
      return String(init.method).toUpperCase();
    }

    if (
      typeof Request !== 'undefined' &&
      input instanceof Request
    ) {
      return String(input.method || 'GET').toUpperCase();
    }

    return 'GET';
  }

  function requestUrl(input) {
    if (typeof input === 'string') return input;

    if (
      typeof URL !== 'undefined' &&
      input instanceof URL
    ) {
      return input.href;
    }

    if (input && typeof input.url === 'string') {
      return input.url;
    }

    return '';
  }

  async function responseSucceeded(response) {
    if (!response || !response.ok) return false;

    try {
      const data = await response.json();
      if (data && data.ok === false) return false;
    } catch {}

    return true;
  }

  function readJsonBody(init) {
    if (!init || typeof init.body !== 'string') return null;

    try {
      return JSON.parse(init.body);
    } catch {
      return null;
    }
  }

  async function handleFetchResult(response, input, init) {
    try {
      if (!(await responseSucceeded(response))) return;

      const rawUrl = requestUrl(input);
      if (!rawUrl) return;

      const url = new URL(rawUrl, location.href);
      const path = url.pathname;
      const method = requestMethod(input, init);
      const mode = platform();

      if (path === '/api/weights' && method === 'POST') {
        if (mode === 'native') {
          setTimeout(() => sync(false, false), 100);
        }
        return;
      }

      if (
        path.startsWith('/api/weights/') &&
        method === 'DELETE'
      ) {
        if (mode === 'native') {
          setTimeout(() => sync(false, false), 100);
        }
        return;
      }

      if (path === '/api/me' && method === 'PATCH') {
        const body = readJsonBody(init);

        if (
          body &&
          Object.prototype.hasOwnProperty.call(
            body,
            'notify_on'
          )
        ) {
          setTimeout(() => sync(true, true), 0);
        }
        return;
      }

      if (path === '/api/me' && method === 'DELETE') {
        if (mode === 'native') {
          setTimeout(() => cancelNative(), 0);
        } else if (mode === 'webpush') {
          setTimeout(() => webUnsubscribeLocal(), 0);
        }
      }
    } catch (e) {
      console.warn('notify_fetch_hook', e);
    }
  }

  function patchFetch() {
    if (fetchPatched) return;
    fetchPatched = true;

    window.fetch = async function(input, init) {
      const response = await baseFetch(input, init);

      try {
        handleFetchResult(
          response.clone(),
          input,
          init
        );
      } catch (e) {
        console.warn('notify_fetch_clone', e);
      }

      return response;
    };
  }

  /* ==========================================================
     UI
     ========================================================== */

  function setupUi() {
    const on = $('notifyOn');
    if (!on) return;

    const card = notificationCard();
    const mode = platform();

    if (mode === 'none') {
      if (card) card.hidden = true;
      return;
    }

    if (card) card.hidden = false;

    on.addEventListener('change', updateControls);

    const save = $('saveNotify');

    if (save && mode === 'webpush') {
      save.addEventListener(
        'click',
        primeWebPermissionFromClick,
        { capture: true }
      );
    }

    updateControls();
  }

  /* ==========================================================
     起動
     ========================================================== */

  function start() {
    setupUi();
    patchFetch();

    setTimeout(() => sync(false, false), 1500);
    setTimeout(() => sync(false, false), 4500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      start,
      { once: true }
    );
  } else {
    start();
  }
})();
