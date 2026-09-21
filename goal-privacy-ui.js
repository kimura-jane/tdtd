'use strict';

/* ============================================================
   みんやせ / goal-privacy-ui.js

   目標体重の公開設定

   ・初期値は非公開
   ・本人が明示的にONにした場合だけ公開
   ・公開先は同じ所属チームのメンバーだけ
   ・他チーム閲覧には公開しない
   ・保存失敗時は表示を元へ戻す
   ============================================================ */

(() => {

  const API =
    (
      typeof window !==
        'undefined' &&
      window.MINYASE_API_BASE
    ) ||
    '';

  const K_DEV =
    'tsudatsu.device_id.v1';

  const CONTROL_ID =
    'goalPrivacyControl';

  const CHECK_ID =
    'goalPublicToggle';

  const MESSAGE_ID =
    'goalPrivacyMsg';

  let saving =
    false;

  let retryTimer =
    null;


  /* ==========================================================
     共通
     ========================================================== */

  const $ =
    id =>
      document.getElementById(
        id
      );


  function deviceId() {

    return (
      localStorage.getItem(
        K_DEV
      ) ||
      ''
    );
  }


  function setMessage(
    text,
    ok = false
  ) {

    const node =
      $(
        MESSAGE_ID
      );

    if (!node) {

      return;
    }


    node.textContent =
      text ||
      '';

    node.className =
      text
        ? (
            'msg ' +
            (
              ok
                ? 'ok'
                : 'ng'
            )
          )
        : 'msg';
  }


  async function request(
    method,
    body
  ) {

    const did =
      deviceId();

    if (!did) {

      throw new Error(
        'not_registered'
      );
    }


    let response;

    try {

      response =
        await fetch(
          API +
          '/api/me/goal-privacy',
          {
            method,

            headers: {
              'x-device-id':
                did,

              ...(body
                ? {
                    'content-type':
                      'application/json'
                  }
                : {})
            },

            body:
              body
                ? JSON.stringify(
                    body
                  )
                : undefined,

            cache:
              'no-store'
          }
        );

    } catch {

      throw new Error(
        'network_error'
      );
    }


    let data =
      {};

    try {

      data =
        await response.json();

    } catch {}


    if (
      !response.ok ||
      data.ok ===
        false
    ) {

      throw new Error(
        data.error ||
        'http_' +
        response.status
      );
    }


    return data;
  }


  /* ==========================================================
     UI
     ========================================================== */

  function ensureControl() {

    if (
      $(
        CONTROL_ID
      )
    ) {

      return true;
    }


    const goalInput =
      $('goalInput');

    if (!goalInput) {

      return false;
    }


    const field =
      goalInput.closest(
        '.field'
      );

    if (!field) {

      return false;
    }


    const box =
      document.createElement(
        'div'
      );

    box.id =
      CONTROL_ID;

    box.style.marginTop =
      '12px';

    box.innerHTML = `
      <label class="chk">
        <input
          type="checkbox"
          id="${CHECK_ID}"
          disabled
        >

        <span>
          目標体重をチームメイトに公開する
        </span>
      </label>

      <p class="note">
        オンにすると、同じ所属チームのメンバーがあなたの詳細画面で目標体重を確認できます。
        「他のチームを見る」で閲覧している人には表示されません。
      </p>

      <p
        class="msg"
        id="${MESSAGE_ID}"
      ></p>
    `;


    field.appendChild(
      box
    );


    const check =
      $(
        CHECK_ID
      );

    if (check) {

      check.addEventListener(
        'change',
        saveSetting
      );
    }


    return true;
  }


  function hideControl() {

    const box =
      $(
        CONTROL_ID
      );

    if (box) {

      box.hidden =
        true;
    }
  }


  function showControl() {

    const box =
      $(
        CONTROL_ID
      );

    if (box) {

      box.hidden =
        false;
    }
  }


  /* ==========================================================
     読み込み
     ========================================================== */

  async function loadSetting() {

    if (
      !ensureControl()
    ) {

      return false;
    }


    const check =
      $(
        CHECK_ID
      );

    if (!check) {

      return true;
    }


    if (
      !deviceId()
    ) {

      check.disabled =
        true;

      return false;
    }


    try {

      const data =
        await request(
          'GET'
        );


      showControl();


      check.checked =
        !!data.goal_public;


      if (
        data.available ===
          false
      ) {

        check.disabled =
          true;

        setMessage(
          '目標体重の公開設定は現在利用できません。'
        );

        return true;
      }


      check.disabled =
        false;

      setMessage(
        ''
      );

      return true;


    } catch (error) {

      const code =
        error &&
        error.message
          ? error.message
          : 'unknown_error';


      if (
        code ===
          'operator_not_allowed'
      ) {

        hideControl();

        return true;
      }


      if (
        code ===
          'not_registered'
      ) {

        check.disabled =
          true;

        return false;
      }


      check.disabled =
        true;

      setMessage(
        '目標体重の公開設定を読み込めませんでした。'
      );

      return true;
    }
  }


  /* ==========================================================
     保存
     ========================================================== */

  async function saveSetting() {

    const check =
      $(
        CHECK_ID
      );

    if (
      !check ||
      saving
    ) {

      return;
    }


    const desired =
      !!check.checked;

    const previous =
      !desired;


    saving =
      true;

    check.disabled =
      true;

    setMessage(
      ''
    );


    try {

      const data =
        await request(
          'PATCH',
          {
            goal_public:
              desired
          }
        );


      check.checked =
        !!data.goal_public;

      setMessage(
        desired
          ? '目標体重をチームメイトに公開します。'
          : '目標体重を非公開にしました。',
        true
      );


    } catch (error) {

      check.checked =
        previous;


      const code =
        error &&
        error.message
          ? error.message
          : 'unknown_error';


      if (
        code ===
          'operator_not_allowed'
      ) {

        hideControl();


      } else if (
        code ===
          'goal_privacy_unavailable'
      ) {

        setMessage(
          '目標体重の公開設定は現在利用できません。'
        );


      } else {

        setMessage(
          '保存できませんでした。通信状態を確認してもう一度お試しください。'
        );
      }


    } finally {

      saving =
        false;


      if (
        !$(CONTROL_ID)?.hidden
      ) {

        check.disabled =
          false;
      }
    }
  }


  /* ==========================================================
     起動
     ========================================================== */

  function start() {

    ensureControl();


    let tries =
      0;


    const retry =
      async () => {

        tries++;


        const done =
          await loadSetting();


        if (
          done ||
          tries >=
            40
        ) {

          if (
            retryTimer
          ) {

            clearInterval(
              retryTimer
            );

            retryTimer =
              null;
          }
        }
      };


    retry();


    retryTimer =
      setInterval(
        retry,
        250
      );


    window.addEventListener(
      'focus',
      () => {

        if (!saving) {

          loadSetting();
        }
      }
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
          true
      }
    );


  } else {

    start();
  }

})();
