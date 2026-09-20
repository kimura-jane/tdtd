'use strict';

/* ============================================================
   みんやせ / watch-switch-ui.js

   「他のチームを見る」下部ボタンを
   登録済みチームの切り替え専用にする。

   ・新規追加 → 上部の「＋追加」
   ・登録済み切替 → 下部ボタン
   ・登録0〜1チーム → 切替ボタン無効
   ・登録2チーム以上 → 選択シート表示
   ============================================================ */

(() => {

  const STYLE_ID =
    'watchSwitchStyle';

  let observer =
    null;


  /* ==========================================================
     DOM
     ========================================================== */

  function button() {

    return document.getElementById(
      'addWatch2'
    );
  }


  function select() {

    return document.getElementById(
      'watchSel'
    );
  }


  function box() {

    return document.getElementById(
      'watchAddBox'
    );
  }


  function watchTab() {

    return document.querySelector(
      '#rankTabs .tab[data-r="watch"]'
    );
  }


  function watchingTeams() {

    const sel =
      select();


    if (!sel) {

      return [];
    }


    return [
      ...sel.options
    ]
      .filter(
        option =>
          String(
            option.value ||
            ''
          ).trim()
      )
      .map(
        option => ({
          group_id:
            option.value,

          name:
            option.textContent ||
            option.value,
        })
      );
  }


  function currentTeam() {

    const sel =
      select();


    if (!sel) {

      return null;
    }


    const option =
      sel.options[
        sel.selectedIndex
      ];


    if (
      !option ||
      !option.value
    ) {

      return null;
    }


    return {
      group_id:
        option.value,

      name:
        option.textContent ||
        option.value,
    };
  }


  /* ==========================================================
     CSS
     ========================================================== */

  function addStyle() {

    if (
      document.getElementById(
        STYLE_ID
      )
    ) {

      return;
    }


    const style =
      document.createElement(
        'style'
      );


    style.id =
      STYLE_ID;


    style.textContent = `
      #addWatch2:disabled{
        opacity:.42;
        cursor:default;
      }

      .watch-switch-note{
        margin:8px 0 0;
        color:var(--sub,#7e756d);
        font-size:11px;
        font-weight:700;
        line-height:1.55;
      }

      .watch-switch-backdrop{
        position:fixed;
        z-index:10050;
        inset:0;
        display:flex;
        align-items:flex-end;
        justify-content:center;
        padding:
          18px
          14px
          calc(
            18px +
            env(safe-area-inset-bottom)
          );
        background:
          rgba(35,28,24,.34);
        backdrop-filter:
          blur(3px);
        -webkit-backdrop-filter:
          blur(3px);
      }

      .watch-switch-sheet{
        width:min(
          100%,
          520px
        );
        overflow:hidden;
        padding:16px;
        border:
          1px solid
          rgba(255,255,255,.9);
        border-radius:24px;
        background:
          var(--paper,#fffdfa);
        box-shadow:
          0 20px 60px
          rgba(54,41,31,.20);
      }

      .watch-switch-head{
        margin-bottom:12px;
      }

      .watch-switch-title{
        margin:0;
        color:
          var(--ink,#181614);
        font-size:17px;
        font-weight:900;
        line-height:1.4;
      }

      .watch-switch-current{
        margin:4px 0 0;
        color:
          var(--sub,#7e756d);
        font-size:11px;
        font-weight:700;
        line-height:1.5;
      }

      .watch-switch-list{
        display:grid;
        gap:7px;
      }

      .watch-switch-item{
        display:flex;
        width:100%;
        min-height:48px;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        padding:10px 13px;
        border:
          1px solid
          var(--line,#eee5dc);
        border-radius:15px;
        background:#fff;
        color:
          var(--ink,#181614);
        font:inherit;
        font-size:13px;
        font-weight:900;
        text-align:left;
        cursor:pointer;
        -webkit-tap-highlight-color:
          transparent;
      }

      .watch-switch-item:active{
        transform:
          scale(.99);
        background:#fff9fc;
      }

      .watch-switch-arrow{
        flex:0 0 auto;
        color:
          var(--sub,#7e756d);
        font-size:18px;
        font-weight:900;
      }

      .watch-switch-close{
        width:100%;
        min-height:43px;
        margin-top:9px;
        border:0;
        border-radius:14px;
        background:#f2ede7;
        color:#675f58;
        font:inherit;
        font-size:12px;
        font-weight:900;
        cursor:pointer;
      }
    `;


    document.head.appendChild(
      style
    );
  }


  /* ==========================================================
     下部カード表示更新
     ========================================================== */

  function ensureNote() {

    const root =
      box();


    if (!root) {

      return null;
    }


    let note =
      document.getElementById(
        'watchSwitchNote'
      );


    if (note) {

      return note;
    }


    note =
      document.createElement(
        'p'
      );


    note.id =
      'watchSwitchNote';

    note.className =
      'watch-switch-note';


    const row =
      root.querySelector(
        '.past-row'
      );


    if (row) {

      row.insertAdjacentElement(
        'beforebegin',
        note
      );

    } else {

      root.appendChild(
        note
      );
    }


    return note;
  }


  function update() {

    const btn =
      button();


    if (!btn) {

      return;
    }


    /*
     * app.js が設定している
     * 「＋チームを追加」を切替専用へ変更。
     */
    btn.textContent =
      '他のチームに切り替える';


    const teams =
      watchingTeams();


    btn.disabled =
      teams.length <= 1;


    btn.setAttribute(
      'aria-disabled',
      btn.disabled
        ? 'true'
        : 'false'
    );


    const note =
      ensureNote();


    if (!note) {

      return;
    }


    if (
      teams.length === 0
    ) {

      note.textContent =
        'まだ他チームは登録されていません。新しいチームは「他チーム」タブの「＋追加」から登録できます。';


    } else if (
      teams.length === 1
    ) {

      note.textContent =
        '登録中：' +
        teams[0].name +
        '。別のチームを追加すると、ここから表示先を切り替えられます。';


    } else {

      const current =
        currentTeam();


      note.textContent =
        (
          current
            ? (
                '選択中：' +
                current.name +
                ' ／ '
              )
            : ''
        ) +
        '登録済み' +
        teams.length +
        'チーム。新しいチームの追加は「他チーム」タブの「＋追加」からできます。';
    }
  }


  /* ==========================================================
     切替シート
     ========================================================== */

  function closeSheet(
    backdrop
  ) {

    if (
      backdrop &&
      backdrop.parentNode
    ) {

      backdrop.remove();
    }
  }


  function switchTo(
    groupId
  ) {

    const sel =
      select();


    if (!sel) {

      return;
    }


    sel.value =
      groupId;


    /*
     * app.js 側の既存 onchange を利用。
     * state.watchId とランキング更新を任せる。
     */
    sel.dispatchEvent(
      new Event(
        'change',
        {
          bubbles:
            true,
        }
      )
    );


    /*
     * 現在どのランキングタブにいても
     * 「他チーム」へ移動する。
     */
    const tab =
      watchTab();


    if (
      tab &&
      !tab.classList.contains(
        'is-on'
      )
    ) {

      tab.click();
    }


    setTimeout(
      update,
      50
    );
  }


  function openSheet() {

    const teams =
      watchingTeams();


    if (
      teams.length <= 1
    ) {

      update();
      return;
    }


    const current =
      currentTeam();


    const choices =
      teams.filter(
        team =>
          !current ||
          team.group_id !==
            current.group_id
      );


    if (
      !choices.length
    ) {

      return;
    }


    const old =
      document.querySelector(
        '.watch-switch-backdrop'
      );


    if (old) {

      old.remove();
    }


    const backdrop =
      document.createElement(
        'div'
      );


    backdrop.className =
      'watch-switch-backdrop';


    const sheet =
      document.createElement(
        'div'
      );


    sheet.className =
      'watch-switch-sheet';


    sheet.setAttribute(
      'role',
      'dialog'
    );


    sheet.setAttribute(
      'aria-modal',
      'true'
    );


    sheet.setAttribute(
      'aria-label',
      '他のチームに切り替える'
    );


    const head =
      document.createElement(
        'div'
      );


    head.className =
      'watch-switch-head';


    const title =
      document.createElement(
        'h3'
      );


    title.className =
      'watch-switch-title';


    title.textContent =
      '他のチームに切り替える';


    const currentText =
      document.createElement(
        'p'
      );


    currentText.className =
      'watch-switch-current';


    currentText.textContent =
      current
        ? (
            '現在：' +
            current.name
          )
        : '表示するチームを選んでください';


    head.append(
      title,
      currentText
    );


    const list =
      document.createElement(
        'div'
      );


    list.className =
      'watch-switch-list';


    for (
      const team of
      choices
    ) {

      const item =
        document.createElement(
          'button'
        );


      item.type =
        'button';


      item.className =
        'watch-switch-item';


      const name =
        document.createElement(
          'span'
        );


      name.textContent =
        team.name;


      const arrow =
        document.createElement(
          'span'
        );


      arrow.className =
        'watch-switch-arrow';


      arrow.textContent =
        '›';


      item.append(
        name,
        arrow
      );


      item.addEventListener(
        'click',
        () => {

          closeSheet(
            backdrop
          );


          switchTo(
            team.group_id
          );
        }
      );


      list.appendChild(
        item
      );
    }


    const close =
      document.createElement(
        'button'
      );


    close.type =
      'button';


    close.className =
      'watch-switch-close';


    close.textContent =
      '閉じる';


    close.addEventListener(
      'click',
      () => {

        closeSheet(
          backdrop
        );
      }
    );


    sheet.append(
      head,
      list,
      close
    );


    backdrop.appendChild(
      sheet
    );


    backdrop.addEventListener(
      'click',
      event => {

        if (
          event.target ===
            backdrop
        ) {

          closeSheet(
            backdrop
          );
        }
      }
    );


    document.body.appendChild(
      backdrop
    );


    const first =
      list.querySelector(
        'button'
      );


    if (first) {

      first.focus();
    }
  }


  /* ==========================================================
     起動
     ========================================================== */

  function start() {

    addStyle();


    const btn =
      button();


    const sel =
      select();


    if (
      !btn ||
      !sel
    ) {

      return;
    }


    /*
     * app.js の #addWatch2.onclick より先に捕まえて、
     * 下部ボタンでは「追加」を起動させない。
     */
    btn.addEventListener(
      'click',
      event => {

        if (
          btn.disabled
        ) {

          return;
        }


        event.preventDefault();

        event.stopPropagation();

        event.stopImmediatePropagation();


        openSheet();
      },
      true
    );


    sel.addEventListener(
      'change',
      () => {

        setTimeout(
          update,
          0
        );
      }
    );


    /*
     * app.js の loadWatching() が
     * selectのoptionを作り直した時にも追従。
     */
    observer =
      new MutationObserver(
        () => {

          update();
        }
      );


    observer.observe(
      sel,
      {
        childList:
          true,

        subtree:
          true,
      }
    );


    update();
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
