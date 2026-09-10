/* ============================================================
   管理画面：体重未入力チェック
   2026-09-10

   ・グループを選択
   ・今月1日 / 今週月曜日
   ・対象日の実測体重がないメンバーだけ抽出
   ・オープンチャット用テキストをワンタップコピー
   ============================================================ */

(function () {

  'use strict';


  const adminNav =
    document.getElementById(
      'adminNav'
    );

  const app =
    document.getElementById(
      'app'
    );


  if (
    !adminNav ||
    !app ||
    typeof api !==
      'function'
  ) {

    console.error(
      'admin_missing_weight_required_element_missing'
    );

    return;
  }


  let loading =
    false;


  /* ============================================================
     共通
     ============================================================ */

  function errorText(
    error
  ) {

    try {

      if (
        typeof emsg ===
          'function'
      ) {

        return emsg(
          error
        );
      }

    } catch {}


    return (
      error &&
      error.message
    )
      ? String(
          error.message
        )
      : 'エラー';
  }


  function groupsArray() {

    try {

      return (
        typeof GROUPS !==
          'undefined' &&
        Array.isArray(
          GROUPS
        )
      )
        ? GROUPS
        : [];

    } catch {

      return [];
    }
  }


  async function copyPlainText(
    value
  ) {

    const text =
      String(
        value ||
        ''
      );


    if (!text) {

      return false;
    }


    try {

      if (
        navigator.clipboard &&
        typeof navigator.clipboard.writeText ===
          'function'
      ) {

        await navigator.clipboard
          .writeText(
            text
          );

        return true;
      }

    } catch {}


    let textarea =
      null;


    try {

      textarea =
        document.createElement(
          'textarea'
        );

      textarea.value =
        text;

      textarea.setAttribute(
        'readonly',
        ''
      );

      textarea.style.position =
        'fixed';

      textarea.style.left =
        '-9999px';

      textarea.style.top =
        '0';

      textarea.style.opacity =
        '0';

      document.body.appendChild(
        textarea
      );

      textarea.focus();
      textarea.select();


      if (
        typeof textarea.setSelectionRange ===
          'function'
      ) {

        textarea.setSelectionRange(
          0,
          textarea.value.length
        );
      }


      const copied =
        typeof document.execCommand ===
          'function' &&
        document.execCommand(
          'copy'
        );


      textarea.remove();

      return !!copied;

    } catch {

      if (
        textarea &&
        textarea.parentNode
      ) {

        textarea.parentNode
          .removeChild(
            textarea
          );
      }

      return false;
    }
  }


  /* ============================================================
     CSS
     ============================================================ */

  function ensureCss() {

    if (
      document.getElementById(
        'adminMissingWeightCss'
      )
    ) {

      return;
    }


    const style =
      document.createElement(
        'style'
      );

    style.id =
      'adminMissingWeightCss';

    style.textContent =
      `
        .missing-admin-box{
          max-width:760px;
        }

        .missing-admin-actions{
          display:flex;
          flex-wrap:wrap;
          gap:8px;
          margin-top:12px;
        }

        .missing-admin-status{
          margin-top:12px;
          padding:10px 12px;
          border:1px solid var(--line);
          border-radius:8px;
          background:#fcfaf7;
          white-space:pre-wrap;
        }

        .missing-admin-output{
          min-height:220px;
          margin-top:12px;
          font-family:inherit;
          font-size:14px;
          line-height:1.8;
          white-space:pre-wrap;
        }

        .missing-admin-copy{
          margin-top:8px;
        }
      `;


    document.head.appendChild(
      style
    );
  }


  /* ============================================================
     パネル
     ============================================================ */

  function ensurePanel() {

    ensureCss();


    let navButton =
      document.getElementById(
        'navMissingWeight'
      );


    if (!navButton) {

      navButton =
        document.createElement(
          'button'
        );

      navButton.id =
        'navMissingWeight';

      navButton.type =
        'button';

      navButton.dataset.t =
        'missing-weight';

      navButton.textContent =
        '未入力チェック';

      adminNav.appendChild(
        navButton
      );

      navButton.addEventListener(
        'click',
        event => {

          event.preventDefault();

          showPanel();
        }
      );
    }


    let panel =
      document.getElementById(
        'p-missing-weight'
      );


    if (!panel) {

      panel =
        document.createElement(
          'section'
        );

      panel.id =
        'p-missing-weight';

      panel.className =
        'panel';

      panel.hidden =
        true;

      panel.innerHTML =
        `
          <div class="missing-admin-box">

            <h2>
              体重未入力チェック
            </h2>

            <p class="mut">
              グループと確認日を選ぶと、対象日に実際の体重入力がないメンバーだけを抽出します。
              体重の数値は表示しません。
            </p>

            <label for="missingWeightGroup">
              グループ
            </label>

            <select id="missingWeightGroup"></select>

            <div class="missing-admin-actions">

              <button
                id="btnMissingMonthStart"
                type="button"
              >
                今月1日
              </button>

              <button
                id="btnMissingMonday"
                type="button"
              >
                今週月曜日
              </button>

            </div>

            <div
              class="missing-admin-status mut"
              id="missingWeightStatus"
            >
              グループと確認日を選んでください。
            </div>

            <textarea
              class="missing-admin-output"
              id="missingWeightOutput"
              readonly
              hidden
              aria-label="オープンチャット用呼びかけテキスト"
            ></textarea>

            <button
              class="missing-admin-copy"
              id="btnMissingCopy"
              type="button"
              hidden
            >
              テキストをコピー
            </button>

          </div>
        `;

      app.appendChild(
        panel
      );


      panel
        .querySelector(
          '#btnMissingMonthStart'
        )
        .addEventListener(
          'click',
          () =>
            runCheck(
              'month_start'
            )
        );


      panel
        .querySelector(
          '#btnMissingMonday'
        )
        .addEventListener(
          'click',
          () =>
            runCheck(
              'monday'
            )
        );


      panel
        .querySelector(
          '#missingWeightGroup'
        )
        .addEventListener(
          'change',
          clearResult
        );


      panel
        .querySelector(
          '#btnMissingCopy'
        )
        .addEventListener(
          'click',
          copyResult
        );
    }


    syncGroups();

    return panel;
  }


  function syncGroups() {

    const select =
      document.getElementById(
        'missingWeightGroup'
      );


    if (!select) {

      return;
    }


    const groups =
      groupsArray();

    const keep =
      select.value;


    select.innerHTML =
      '';


    if (!groups.length) {

      const option =
        document.createElement(
          'option'
        );

      option.value =
        '';

      option.textContent =
        'グループがありません';

      select.appendChild(
        option
      );

      return;
    }


    for (
      const group of
      groups
    ) {

      if (
        !group ||
        !group.id
      ) {

        continue;
      }


      const option =
        document.createElement(
          'option'
        );

      option.value =
        group.id;

      option.textContent =
        (
          group.name ||
          group.id
        ) +
        '（' +
        Number(
          group.members ||
          0
        ) +
        '人）';

      select.appendChild(
        option
      );
    }


    if (
      keep &&
      groups.some(
        group =>
          group.id ===
            keep
      )
    ) {

      select.value =
        keep;
    }
  }


  function showPanel() {

    const panel =
      ensurePanel();


    for (
      const p of
      document.querySelectorAll(
        '.panel'
      )
    ) {

      p.hidden =
        p !==
        panel;
    }


    for (
      const button of
      adminNav.querySelectorAll(
        'button[data-t]'
      )
    ) {

      button.classList.toggle(
        'on',
        button.id ===
          'navMissingWeight'
      );
    }


    syncGroups();

    panel.hidden =
      false;
  }


  function clearResult() {

    const status =
      document.getElementById(
        'missingWeightStatus'
      );

    const output =
      document.getElementById(
        'missingWeightOutput'
      );

    const copy =
      document.getElementById(
        'btnMissingCopy'
      );


    if (status) {

      status.textContent =
        '確認日を選んでください。';

      status.className =
        'missing-admin-status mut';
    }


    if (output) {

      output.value =
        '';

      output.hidden =
        true;
    }


    if (copy) {

      copy.hidden =
        true;
    }
  }


  /* ============================================================
     抽出
     ============================================================ */

  async function runCheck(
    kind
  ) {

    if (loading) {

      return;
    }


    const select =
      document.getElementById(
        'missingWeightGroup'
      );

    const status =
      document.getElementById(
        'missingWeightStatus'
      );

    const output =
      document.getElementById(
        'missingWeightOutput'
      );

    const copy =
      document.getElementById(
        'btnMissingCopy'
      );

    const monthButton =
      document.getElementById(
        'btnMissingMonthStart'
      );

    const mondayButton =
      document.getElementById(
        'btnMissingMonday'
      );


    const groupId =
      select
        ? select.value
        : '';


    if (!groupId) {

      if (status) {

        status.textContent =
          'グループを選んでください。';

        status.className =
          'missing-admin-status ng';
      }

      return;
    }


    loading =
      true;


    if (monthButton) {

      monthButton.disabled =
        true;
    }

    if (mondayButton) {

      mondayButton.disabled =
        true;
    }

    if (copy) {

      copy.hidden =
        true;
    }

    if (output) {

      output.hidden =
        true;

      output.value =
        '';
    }

    if (status) {

      status.textContent =
        '確認中…';

      status.className =
        'missing-admin-status mut';
    }


    try {

      const params =
        new URLSearchParams({
          gid:
            groupId,

          kind:
            kind,
        });


      const data =
        await api(
          '/api/admin/group/missing-weights?' +
          params.toString()
        );


      if (
        data.available ===
          false
      ) {

        if (status) {

          status.textContent =
            data.message ||
            '対象日はグループのスタート日前です。';

          status.className =
            'missing-admin-status ng';
        }

        return;
      }


      const eligible =
        Number(
          data.eligible_count ||
          0
        );

      const recorded =
        Number(
          data.recorded_count ||
          0
        );

      const missing =
        Number(
          data.missing_count ||
          0
        );


      if (status) {

        status.textContent =
          (
            String(
              data.date_label ||
              data.target_ymd ||
              ''
            ) +
            ' ／ 対象 ' +
            eligible +
            '人 ／ 入力済み ' +
            recorded +
            '人 ／ 未入力 ' +
            missing +
            '人'
          );

        status.className =
          'missing-admin-status ' +
          (
            missing > 0
              ? 'ng'
              : 'ok'
          );
      }


      const text =
        String(
          data.text ||
          ''
        );


      if (
        output &&
        text
      ) {

        output.value =
          text;

        output.hidden =
          false;
      }


      if (
        copy &&
        text
      ) {

        copy.hidden =
          false;
      }


    } catch (
      error
    ) {

      if (status) {

        status.textContent =
          errorText(
            error
          );

        status.className =
          'missing-admin-status ng';
      }


    } finally {

      loading =
        false;

      if (monthButton) {

        monthButton.disabled =
          false;
      }

      if (mondayButton) {

        mondayButton.disabled =
          false;
      }
    }
  }


  async function copyResult() {

    const output =
      document.getElementById(
        'missingWeightOutput'
      );

    const button =
      document.getElementById(
        'btnMissingCopy'
      );


    const text =
      output
        ? String(
            output.value ||
            ''
          )
        : '';


    if (!text) {

      return;
    }


    const copied =
      await copyPlainText(
        text
      );


    if (copied) {

      if (button) {

        const before =
          button.textContent;

        button.textContent =
          'コピーしました';

        setTimeout(
          () => {

            button.textContent =
              before;
          },
          1200
        );
      }

      return;
    }


    window.alert(
      'コピーできませんでした。テキスト欄を選択してコピーしてください。'
    );


    try {

      output.focus();
      output.select();

    } catch {}
  }


  /* ============================================================
     既存画面との同期
     ============================================================ */

  adminNav.addEventListener(
    'click',
    event => {

      const button =
        event.target.closest(
          'button[data-t]'
        );


      if (
        !button ||
        button.id ===
          'navMissingWeight'
      ) {

        return;
      }


      const panel =
        document.getElementById(
          'p-missing-weight'
        );


      if (panel) {

        panel.hidden =
          true;
      }


      const navButton =
        document.getElementById(
          'navMissingWeight'
        );


      if (navButton) {

        navButton.classList.remove(
          'on'
        );
      }
    }
  );


  const groupTable =
    document.getElementById(
      'gTbl'
    );


  if (groupTable) {

    const observer =
      new MutationObserver(
        () => {

          syncGroups();
        }
      );


    observer.observe(
      groupTable,
      {
        childList:
          true,

        subtree:
          true,
      }
    );
  }


  /* ============================================================
     エラーメッセージ
     ============================================================ */

  try {

    if (
      typeof ERR ===
        'object' &&
      ERR
    ) {

      ERR.bad_missing_kind =
        '確認する日を選び直してください';
    }

  } catch {}


  /* ============================================================
     初期化
     ============================================================ */

  ensurePanel();

})();
