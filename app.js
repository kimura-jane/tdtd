'use strict';

/* ============================================================
   みんやせ / app.js
   2026-09-08 審査・安全対応版

   ・プロフィール画像承認待ち
   ・2026-09-07版 規約再同意
   ・BAN中でも利用データ削除可能
   ・削除後は本人が再開するまで新規登録しない
   ============================================================ */


/* ============================================================
   API
   ============================================================ */

const API =
  (
    typeof window !== 'undefined' &&
    window.MINYASE_API_BASE
  ) ||
  '';

const K_DEV =
  'tsudatsu.device_id.v1';

const K_AGREE =
  'minyase.agreed.v1';

const K_DELETED =
  'minyase.deleted.v1';

/*
 * 2026-09-07版へ更新。
 *
 * 以前に2026-09-03版へ同意済みでも、
 * 今回はプライバシー・UGC・外部WEB連携について
 * 内容が大きく変わっているため再同意を出す。
 */
const AGREE_VER =
  '2026-09-07';

const ICON_SIZE =
  256;

const ICON_LIMIT =
  280 * 1024;

const CANCELED =
  'canceled';

const API_TIMEOUT =
  15000;


/* ============================================================
   削除済み状態
   ============================================================ */

function isDeletedState() {

  return (
    localStorage.getItem(
      K_DELETED
    ) ===
    '1'
  );
}


function markDeletedState() {

  localStorage.removeItem(
    K_DEV
  );

  localStorage.removeItem(
    K_AGREE
  );

  localStorage.setItem(
    K_DELETED,
    '1'
  );
}


function clearDeletedState() {

  localStorage.removeItem(
    K_DELETED
  );

  localStorage.removeItem(
    K_DEV
  );

  localStorage.removeItem(
    K_AGREE
  );
}


/* ============================================================
   端末ID
   ============================================================ */

function uuid() {

  if (
    crypto &&
    typeof crypto.randomUUID ===
      'function'
  ) {

    return crypto.randomUUID();
  }


  const b =
    new Uint8Array(16);


  crypto.getRandomValues(
    b
  );


  b[6] =
    (
      b[6] &
      0x0f
    ) |
    0x40;


  b[8] =
    (
      b[8] &
      0x3f
    ) |
    0x80;


  const h =
    [...b]
      .map(
        n =>
          n
            .toString(16)
            .padStart(
              2,
              '0'
            )
      )
      .join('');


  return (
    `${h.slice(0, 8)}-` +
    `${h.slice(8, 12)}-` +
    `${h.slice(12, 16)}-` +
    `${h.slice(16, 20)}-` +
    `${h.slice(20)}`
  );
}


function deviceId() {

  /*
   * データ削除後は、本人が「新しく始める」を
   * 押すまで新しい端末IDを生成しない。
   */
  if (
    isDeletedState()
  ) {

    return '';
  }


  let value =
    localStorage.getItem(
      K_DEV
    );


  if (!value) {

    value =
      'dev_' +
      uuid();


    localStorage.setItem(
      K_DEV,
      value
    );
  }


  return value;
}


/* ============================================================
   fetch timeout
   ============================================================ */

function withTimeout(ms) {

  if (
    typeof AbortController !==
      'function'
  ) {

    return {
      signal:
        undefined,

      done:
        () => {}
    };
  }


  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () =>
        controller.abort(),
      ms
    );


  return {
    signal:
      controller.signal,

    done:
      () =>
        clearTimeout(
          timer
        )
  };
}


/* ============================================================
   JSON API
   ============================================================ */

async function api(
  path,
  opt = {}
) {

  const id =
    deviceId();


  if (!id) {

    throw new Error(
      'account_deleted'
    );
  }


  const timeout =
    withTimeout(
      API_TIMEOUT
    );


  let response;


  try {

    response =
      await fetch(
        API +
        path,
        {
          method:
            opt.method ||
            'GET',

          headers: {
            'content-type':
              'application/json',

            'x-device-id':
              id
          },

          body:
            opt.body !==
              undefined
              ? JSON.stringify(
                  opt.body
                )
              : undefined,

          cache:
            'no-store',

          signal:
            timeout.signal,
        }
      );


  } catch (e) {

    throw new Error(
      e &&
      e.name ===
        'AbortError'
        ? 'timeout'
        : 'network_error'
    );


  } finally {

    timeout.done();
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
      (
        'http_' +
        response.status
      )
    );
  }


  return data;
}


/* ============================================================
   画像API
   ============================================================ */

async function apiBlob(
  path,
  blob,
  method = 'POST'
) {

  const id =
    deviceId();


  if (!id) {

    throw new Error(
      'account_deleted'
    );
  }


  const timeout =
    withTimeout(
      API_TIMEOUT *
      2
    );


  let response;


  try {

    response =
      await fetch(
        API +
        path,
        {
          method,

          headers: {
            'content-type':
              'image/jpeg',

            'x-device-id':
              id
          },

          body:
            blob,

          cache:
            'no-store',

          signal:
            timeout.signal,
        }
      );


  } catch (e) {

    throw new Error(
      e &&
      e.name ===
        'AbortError'
        ? 'timeout'
        : 'network_error'
    );


  } finally {

    timeout.done();
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
      (
        'http_' +
        response.status
      )
    );
  }


  return data;
}


/* ============================================================
   エラー文言
   ============================================================ */

const ERR = {

  network_error:
    '通信できませんでした。電波状況をご確認ください',

  timeout:
    '通信に時間がかかりすぎました。もう一度お試しください',


  bad_device_id:
    '端末IDが不正です',

  not_registered:
    '登録が見つかりません。再読み込みしてください',

  banned:
    'このアカウントは利用できません',

  account_deleted:
    '利用データは削除されています',


  bad_kg:
    '体重の値が不正です',

  bad_ymd:
    '日付が不正です',

  future_ymd:
    '未来の日付は登録できません',


  bad_code:
    'コードは8文字です',

  group_not_found:
    'そのコードのグループはありません',

  banned_from_group:
    'このグループには参加できません',

  already_in_group:
    'すでにグループに参加しています',

  not_in_group:
    'グループに参加していません',

  group_full:
    'グループが満員です',

  not_owner:
    'オーナーだけが操作できます',

  owner_must_dissolve:
    'オーナーは解散を使ってください',

  own_group:
    '自分のグループです',

  bad_name:
    '名前を入力してください',

  bad_nickname:
    'ニックネームを入力してください',

  bad_member_id:
    '相手を特定できませんでした',

  bad_reason:
    '通報理由を入力してください',

  bad_notify:
    '通知設定の値が不正です',

  member_not_found:
    'その人は見つかりません',

  not_watching:
    'このチームは登録されていません',

  self_not_allowed:
    '自分は対象にできません',

  cannot_kick_self:
    '自分は除名できません',

  nothing_to_update:
    '変更点がありません',


  rate_limited:
    '操作が多すぎます。1分ほど待ってください',

  too_many_requests:
    '操作が多すぎます。1分ほど待ってください',


  not_jpeg:
    '画像を変換できませんでした。別の写真でお試しください',

  icon_too_large:
    '画像が大きすぎます。別の写真でお試しください',

  icon_empty:
    '画像を読み込めませんでした',

  no_bucket:
    '画像の保存先が未設定です',

  not_image:
    '画像ファイルを選んでください',

  bad_image:
    '画像を読み込めませんでした',

  pending_icon_not_found:
    '承認待ち画像が見つかりません',


  ng_word:
    'この表現は登録できません。別の言葉に変えてください',

  has_contact:
    'URL・メールアドレス・電話番号・SNSのIDは入れられません',


  unauthorized:
    '認証できませんでした',

  no_admin_token:
    '管理用の設定がされていません',

  private_group_admin_only:
    '非公開グループのため表示できません',

  admin_only:
    '管理者だけが操作できます',

  bad_format:
    '書式が正しくありません',

  csv_empty:
    'CSVの中身が空です',

  csv_header_invalid:
    'CSVの見出し行が正しくありません',

  import_too_large:
    'ファイルが大きすぎます（2MBまで）',

  new_device_not_empty:
    '移行先の端末にすでにデータがあります',

  blocked_relation:
    'ブロック関係にあるため操作できません',

  server_error:
    'サーバーエラーが発生しました',
};


const emsg =
  e =>
    ERR[
      e.message
    ] ||
    (
      'エラー（' +
      e.message +
      '）'
    );


function errorCode(e) {

  if (
    e &&
    typeof e.message ===
      'string' &&
    e.message.trim()
  ) {

    return e.message.trim();
  }


  return 'unknown_error';
}


function saveErrorMessage(e) {

  return (
    '保存できませんでした：' +
    emsg(e) +
    '（エラーコード：' +
    errorCode(e) +
    '）'
  );
}


/* ============================================================
   投稿内容フィルタ
   ============================================================ */

const NG_WORDS = [

  '死ね',
  'しね',
  '殺す',
  'ころす',
  'ぶっ殺',
  '自殺しろ',

  'レイプ',
  '強姦',
  'セックス',
  '売春',
  '風俗',
  '援交',
  '裏垢',

  'ちんこ',
  'ちんぽ',
  'まんこ',
  '射精',
  '中出し',
  'ヤリマン',
  'ヤリチン',

  'キチガイ',
  'きちがい',
  '気違い',
  '池沼',
  'カタワ',
  '知恵遅れ',

  'ゴキブリ以下',
  '消えろ',
  'うんこ野郎',

  'fuck',
  'shit',
  'bitch',
  'cunt',
  'dick',
  'pussy',
  'porn',
  'rape',
  'kill you',
  'nigger',
  'faggot',
];


const RE_CONTACT =
  /(https?:\/\/|www\.|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|line\s*id|ラインid|カカオ|@[a-z0-9_]{4,}|\d{10,})/i;


function moderate(raw) {

  const value =
    String(
      raw ||
      ''
    )
      .normalize(
        'NFKC'
      )
      .toLowerCase();


  if (!value) {

    return null;
  }


  if (
    RE_CONTACT.test(
      value
    )
  ) {

    return 'has_contact';
  }


  const flat =
    value.replace(
      /[\s\u3000!-\/:-@\[-`{-~。、・゛゜「」…]/g,
      ''
    );


  for (
    const word of
    NG_WORDS
  ) {

    if (
      flat.includes(
        word.replace(
          /\s/g,
          ''
        )
      )
    ) {

      return 'ng_word';
    }
  }


  return null;
}


/* ============================================================
   キャッシュ
   ============================================================ */

const cache = {

  weights:
    {},

  goal:
    null,

  me:
    null,

  group:
    null,

  watching:
    [],

  blocks:
    [],

  iconPending:
    false,

  iconPendingAt:
    null,

  ready:
    false,
};


const store = {

  all() {

    return cache.weights;
  },


  async put(
    ymd,
    kg
  ) {

    await api(
      '/api/weights',
      {
        method:
          'POST',

        body: {
          ymd,
          kg,
        },
      }
    );


    cache.weights[
      ymd
    ] =
      kg;


    if (
      cache.group
    ) {

      loadRanking();
    }


    return true;
  },


  del(ymd) {

    const before =
      cache.weights[
        ymd
      ];


    delete cache.weights[
      ymd
    ];


    api(
      '/api/weights/' +
      encodeURIComponent(
        ymd
      ),
      {
        method:
          'DELETE'
      }
    )
      .then(
        () => {

          if (
            cache.group
          ) {

            loadRanking();
          }
        }
      )
      .catch(
        err => {

          if (
            before !==
              undefined
          ) {

            cache.weights[
              ymd
            ] =
              before;
          }


          renderLog();


          say(
            el.msg,
            '削除できませんでした：' +
            emsg(err),
            false
          );
        }
      );
  },


  goal() {

    return cache.goal;
  },


  setGoal(value) {

    const before =
      cache.goal;


    cache.goal =
      value;


    api(
      '/api/me',
      {
        method:
          'PATCH',

        body: {
          goal_weight:
            value
        }
      }
    )
      .catch(
        err => {

          cache.goal =
            before;


          renderLog();


          say(
            el.mmsg,
            '目標を保存できませんでした：' +
            emsg(err),
            false
          );
        }
      );
  },
};


/* ============================================================
   JST日付
   ============================================================ */

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
        '2-digit'
    }
  );


function todayYmdJST() {

  const parts =
    JST_FMT.formatToParts(
      new Date()
    );


  const get =
    type =>
      parts.find(
        item =>
          item.type ===
            type
      ).value;


  return (
    `${get('year')}-` +
    `${get('month')}-` +
    `${get('day')}`
  );
}


function ymdToDay(ymd) {

  return Math.round(
    Date.parse(
      ymd +
      'T00:00:00+09:00'
    ) /
    86400000
  );
}


function dayToYmd(day) {

  const parts =
    JST_FMT.formatToParts(
      new Date(
        day *
        86400000
      )
    );


  const get =
    type =>
      parts.find(
        item =>
          item.type ===
            type
      ).value;


  return (
    `${get('year')}-` +
    `${get('month')}-` +
    `${get('day')}`
  );
}


function fmtJp(ymd) {

  const [
    ,
    month,
    day
  ] =
    ymd.split('-');


  return (
    `${Number(month)}月` +
    `${Number(day)}日`
  );
}


function fmtJpFull(ymd) {

  const [
    year,
    month,
    day
  ] =
    ymd.split('-');


  return (
    `${year}年` +
    `${Number(month)}月` +
    `${Number(day)}日`
  );
}


function normKg(raw) {

  const value =
    parseFloat(
      raw
    );


  if (
    !Number.isFinite(
      value
    )
  ) {

    return null;
  }


  const rounded =
    Math.round(
      value *
      10
    ) /
    10;


  return (
    rounded >=
      20 &&
    rounded <=
      300
  )
    ? rounded
    : null;
}


/* ============================================================
   コード
   ============================================================ */

function fmtCode(code) {

  if (!code) {

    return '—';
  }


  const value =
    String(code)
      .toUpperCase()
      .replace(
        /[^0-9A-Z]/g,
        ''
      );


  return (
    value.length ===
      8
  )
    ? (
        value.slice(
          0,
          4
        ) +
        '-' +
        value.slice(4)
      )
    : String(code);
}


function rawCode(code) {

  return String(
    code ||
    ''
  )
    .toUpperCase()
    .replace(
      /[^0-9A-Z]/g,
      ''
    );
}


function signKg(value) {

  if (
    value ===
      null ||
    value ===
      undefined
  ) {

    return '—';
  }


  if (
    value >
      0
  ) {

    return (
      '−' +
      Math.abs(
        value
      )
        .toFixed(1) +
      'kg'
    );
  }


  if (
    value <
      0
  ) {

    return (
      '+' +
      Math.abs(
        value
      )
        .toFixed(1) +
      'kg'
    );
  }


  return '±0.0kg';
}


/* ============================================================
   DOM
   ============================================================ */

const $ =
  selector =>
    document.querySelector(
      selector
    );


const $$ =
  selector =>
    [
      ...document.querySelectorAll(
        selector
      )
    ];


const state = {

  period:
    'week',

  offset:
    0,

  view:
    'log',

  rank:
    'mine',

  watchId:
    null
};


const el = {

  hdTitle:
    $('#hdTitle'),

  todayLabel:
    $('#todayLabel'),

  kgInput:
    $('#kgInput'),

  msg:
    $('#msg'),


  pastBox:
    $('#pastBox'),

  pastYmd:
    $('#pastYmd'),

  pastKg:
    $('#pastKg'),


  chart:
    $('#chart'),

  rangeLabel:
    $('#rangeLabel'),

  summary:
    $('#summary'),

  hist:
    $('#hist'),

  tabs:
    $('#periodTabs'),


  viewGroup:
    $('#view-group'),

  noGroupBox:
    $('#noGroupBox'),

  joinCode:
    $('#joinCode'),

  newGroupName:
    $('#newGroupName'),

  newStartYmd:
    $('#newStartYmd'),

  newShowWeight:
    $('#newShowWeight'),

  gmsg:
    $('#gmsg'),

  myGroupBox:
    $('#myGroupBox'),

  gName:
    $('#gName'),

  gMeta:
    $('#gMeta'),

  gCodeBox:
    $('#gCodeBox'),

  gCode:
    $('#gCode'),

  ownerTools:
    $('#ownerTools'),

  memberTools:
    $('#memberTools'),

  gmsg2:
    $('#gmsg2'),


  rankBox:
    $('#rankBox'),

  rankTabs:
    $('#rankTabs'),

  rankHead:
    $('#rankHead'),

  rankList:
    $('#rankList'),

  rmsg:
    $('#rmsg'),

  watchNav:
    $('#watchNav'),

  watchSel:
    $('#watchSel'),


  nickInput:
    $('#nickInput'),

  goalInput:
    $('#goalInput'),

  mmsg:
    $('#mmsg'),


  notifyOn:
    $('#notifyOn'),

  notifyDays:
    $('#notifyDays'),

  notifyHour:
    $('#notifyHour'),

  nmsg:
    $('#nmsg'),


  blockList:
    $('#blockList'),

  myMemberId:
    $('#myMemberId'),

  myDeviceId:
    $('#myDeviceId'),

  dmsg:
    $('#dmsg'),


  iconBox:
    $('#iconBox'),

  iconFile:
    $('#iconFile'),

  iconPick:
    $('#iconPick'),

  iconDel:
    $('#iconDel'),

  imsg:
    $('#imsg'),


  cropOv:
    $('#cropOv'),

  cropCv:
    $('#cropCv'),

  cropZoom:
    $('#cropZoom'),

  cropOk:
    $('#cropOk'),

  cropCancel:
    $('#cropCancel'),
};


/* ============================================================
   メッセージ
   ============================================================ */

const timers =
  new WeakMap();


function say(
  node,
  text,
  ok
) {

  if (!node) {

    return;
  }


  node.textContent =
    text;


  node.className =
    'msg ' +
    (
      ok
        ? 'ok'
        : 'ng'
    );


  clearTimeout(
    timers.get(
      node
    )
  );


  timers.set(
    node,
    setTimeout(
      () => {

        if (
          node.dataset &&
          node.dataset.pending ===
            '1'
        ) {

          return;
        }


        node.textContent =
          '';

        node.className =
          'msg';
      },
      3600
    )
  );
}


function clearMsg(node) {

  if (!node) {

    return;
  }


  clearTimeout(
    timers.get(
      node
    )
  );


  node.textContent =
    '';

  node.className =
    'msg';


  if (
    node.dataset
  ) {

    delete node.dataset.pending;
  }
}


function renderIconModerationStatus() {

  if (
    !el.imsg
  ) {

    return;
  }


  if (
    cache.iconPending
  ) {

    clearTimeout(
      timers.get(
        el.imsg
      )
    );


    el.imsg.textContent =
      '確認中です。承認後に公開されます。';


    el.imsg.className =
      'msg ok';


    el.imsg.dataset.pending =
      '1';


    return;
  }


  if (
    el.imsg.dataset.pending ===
      '1'
  ) {

    clearMsg(
      el.imsg
    );
  }
}


/* ============================================================
   シートUI
   ============================================================ */

const INPUT_STYLE =
  'width:100%;padding:14px 15px;font-size:16px;font-weight:500;font-family:inherit;' +
  'color:#191714;background:#faf8f5;border:1.5px solid #f1ece4;border-radius:16px;' +
  '-webkit-appearance:none;appearance:none;';


function sheetOpen(
  title,
  note
) {

  const overlay =
    document.createElement(
      'div'
    );


  overlay.className =
    'ov';


  const sheet =
    document.createElement(
      'div'
    );


  sheet.className =
    'sheet';


  sheet.style.textAlign =
    'left';


  if (title) {

    const heading =
      document.createElement(
        'h2'
      );


    heading.className =
      'h2';


    heading.textContent =
      title;


    sheet.appendChild(
      heading
    );
  }


  if (note) {

    const paragraph =
      document.createElement(
        'p'
      );


    paragraph.className =
      'note';


    paragraph.textContent =
      note;


    sheet.appendChild(
      paragraph
    );
  }


  overlay.appendChild(
    sheet
  );


  document.body.appendChild(
    overlay
  );


  document.body.style.overflow =
    'hidden';


  const close =
    () => {

      overlay.remove();


      if (
        !document.querySelector(
          '.ov:not([hidden])'
        )
      ) {

        document.body.style.overflow =
          '';
      }
    };


  return {
    ov:
      overlay,

    sh:
      sheet,

    close
  };
}


function sheetRow(sheet) {

  const row =
    document.createElement(
      'div'
    );


  row.className =
    'past-row';


  row.style.justifyContent =
    'flex-end';


  sheet.appendChild(
    row
  );


  return row;
}


function sheetBtn(
  row,
  label,
  className
) {

  const button =
    document.createElement(
      'button'
    );


  button.type =
    'button';


  button.className =
    className;


  button.textContent =
    label;


  row.appendChild(
    button
  );


  return button;
}


function confirmSheet(
  title,
  note,
  okLabel,
  danger
) {

  return new Promise(
    resolve => {

      const {
        sh,
        close
      } =
        sheetOpen(
          title,
          note
        );


      const row =
        sheetRow(
          sh
        );


      const ok =
        sheetBtn(
          row,
          okLabel ||
          'OK',
          danger
            ? 'danger sm'
            : 'primary sm'
        );


      const no =
        sheetBtn(
          row,
          'やめる',
          'ghost sm'
        );


      ok.onclick =
        () => {

          close();

          resolve(
            true
          );
        };


      no.onclick =
        () => {

          close();

          resolve(
            false
          );
        };


      setTimeout(
        () =>
          ok.focus(),
        30
      );
    }
  );
}


function alertSheet(
  title,
  note,
  okLabel
) {

  return new Promise(
    resolve => {

      const {
        sh,
        close
      } =
        sheetOpen(
          title,
          note
        );


      const row =
        sheetRow(
          sh
        );


      const ok =
        sheetBtn(
          row,
          okLabel ||
          'OK',
          'primary sm'
        );


      ok.onclick =
        () => {

          close();

          resolve();
        };


      setTimeout(
        () =>
          ok.focus(),
        30
      );
    }
  );
}


function promptSheet(options) {

  return new Promise(
    resolve => {

      const {
        sh,
        close
      } =
        sheetOpen(
          options.title,
          options.note
        );


      let input;


      if (
        options.multiline
      ) {

        input =
          document.createElement(
            'textarea'
          );


        input.rows =
          4;


        input.style.cssText =
          INPUT_STYLE +
          'min-height:104px;line-height:1.6;resize:vertical;';


      } else {

        input =
          document.createElement(
            'input'
          );


        input.type =
          options.type ||
          'text';


        if (
          options.type ===
            'number'
        ) {

          input.step =
            options.step ||
            '0.1';


          input.inputMode =
            'decimal';


          if (
            options.min !==
              undefined
          ) {

            input.min =
              String(
                options.min
              );
          }


          if (
            options.max !==
              undefined
          ) {

            input.max =
              String(
                options.max
              );
          }
        }


        if (
          options.type ===
            'date' &&
          options.max
        ) {

          input.max =
            options.max;
        }


        input.style.cssText =
          INPUT_STYLE;
      }


      if (
        options.maxlength
      ) {

        input.maxLength =
          options.maxlength;
      }


      if (
        options.placeholder
      ) {

        input.placeholder =
          options.placeholder;
      }


      if (
        options.upper
      ) {

        input.autocapitalize =
          'characters';


        input.autocomplete =
          'off';
      }


      input.value =
        options.value ===
          undefined ||
        options.value ===
          null
          ? ''
          : String(
              options.value
            );


      const wrap =
        document.createElement(
          'div'
        );


      wrap.className =
        'field';


      wrap.appendChild(
        input
      );


      sh.appendChild(
        wrap
      );


      const error =
        document.createElement(
          'p'
        );


      error.className =
        'msg';


      sh.appendChild(
        error
      );


      const row =
        sheetRow(
          sh
        );


      const ok =
        sheetBtn(
          row,
          options.ok ||
          '決定',
          'primary sm'
        );


      const no =
        sheetBtn(
          row,
          'やめる',
          'ghost sm'
        );


      const submit =
        () => {

          const value =
            input.value;


          if (
            options.validate
          ) {

            const invalid =
              options.validate(
                value
              );


            if (invalid) {

              error.textContent =
                invalid;


              error.className =
                'msg ng';


              return;
            }
          }


          close();


          resolve(
            value
          );
        };


      ok.onclick =
        submit;


      no.onclick =
        () => {

          close();

          resolve(
            null
          );
        };


      if (
        !options.multiline
      ) {

        input.addEventListener(
          'keydown',
          event => {

            if (
              event.key ===
                'Enter'
            ) {

              event.preventDefault();

              submit();
            }
          }
        );
      }


      setTimeout(
        () => {

          input.focus();
        },
        60
      );
    }
  );
}


function menuSheet(
  title,
  note,
  items
) {

  return new Promise(
    resolve => {

      const {
        sh,
        close
      } =
        sheetOpen(
          title,
          note
        );


      const list =
        document.createElement(
          'div'
        );


      list.style.cssText =
        'display:flex;flex-direction:column;gap:8px;margin:16px 0 4px;' +
        'max-height:52vh;overflow:auto;-webkit-overflow-scrolling:touch;';


      items.forEach(
        (
          item,
          index
        ) => {

          const button =
            document.createElement(
              'button'
            );


          button.type =
            'button';


          button.className =
            item.danger
              ? 'danger'
              : 'ghost';


          button.textContent =
            item.label;


          button.style.cssText =
            'width:100%;text-align:left;';


          button.onclick =
            () => {

              close();

              resolve(
                index
              );
            };


          list.appendChild(
            button
          );
        }
      );


      sh.appendChild(
        list
      );


      const row =
        sheetRow(
          sh
        );


      const no =
        sheetBtn(
          row,
          '閉じる',
          'ghost sm'
        );


      no.onclick =
        () => {

          close();

          resolve(
            -1
          );
        };
    }
  );
}


/* ============================================================
   規約・サポートをアプリ内で表示
   ============================================================ */

function docSheet(
  url,
  title
) {

  const {
    sh,
    close
  } =
    sheetOpen(
      title,
      null
    );


  const frame =
    document.createElement(
      'iframe'
    );


  frame.src =
    url;


  frame.setAttribute(
    'title',
    title
  );


  frame.style.cssText =
    'width:100%;height:min(68vh,540px);margin:14px 0 4px;border:0;' +
    'border-radius:16px;background:#fff;';


  sh.appendChild(
    frame
  );


  const row =
    sheetRow(
      sh
    );


  const closeButton =
    sheetBtn(
      row,
      '閉じる',
      'primary sm'
    );


  closeButton.onclick =
    close;
}


document.addEventListener(
  'click',
  event => {

    const target =
      event.target;


    const anchor =
      target &&
      target.closest
        ? target.closest(
            'a[href]'
          )
        : null;


    if (!anchor) {

      return;
    }


    const href =
      anchor.getAttribute(
        'href'
      ) ||
      '';


    const match =
      /^(?:\.\/)?(terms|privacy|support)\.html$/
        .exec(
          href
        );


    if (!match) {

      return;
    }


    event.preventDefault();


    const title =
      match[1] ===
        'privacy'
        ? 'プライバシーポリシー'
        : (
            match[1] ===
              'support'
              ? 'サポート'
              : '利用規約'
          );


    docSheet(
      href,
      title
    );
  },
  true
);


/* ============================================================
   利用規約同意
   ============================================================ */

function agreed() {

  return (
    localStorage.getItem(
      K_AGREE
    ) ===
    AGREE_VER
  );
}


function agreeSheet() {

  return new Promise(
    resolve => {

      const {
        sh,
        close
      } =
        sheetOpen(
          'ご利用の前に',
          'みんやせは、あなたが入力した体重やプロフィール情報をサーバーに保存します。' +
          'グループでは公開設定に応じて体重または増減量が表示されます。'
        );


      const privacy =
        document.createElement(
          'p'
        );


      privacy.className =
        'note';


      privacy.textContent =
        '体重公開グループでも「非公開（増減量のみ）」を選べます。' +
        '新しいプロフィール画像は確認・承認後に公開されます。' +
        '外部WEB連携対象グループでも、本人が同意しない限りデータは送信されません。';


      sh.appendChild(
        privacy
      );


      const safety =
        document.createElement(
          'p'
        );


      safety.className =
        'note';


      safety.textContent =
        '13歳未満の方はご利用いただけません。' +
        '他の人を傷つける表現、性的な内容、他人の写真や連絡先の掲載は禁止です。' +
        '問題があるユーザーは通報・ブロックできます。';


      sh.appendChild(
        safety
      );


      const links =
        document.createElement(
          'p'
        );


      links.className =
        'note';


      links.style.marginTop =
        '12px';


      const terms =
        document.createElement(
          'a'
        );


      terms.href =
        './terms.html';


      terms.textContent =
        '利用規約';


      const policy =
        document.createElement(
          'a'
        );


      policy.href =
        './privacy.html';


      policy.textContent =
        'プライバシーポリシー';


      links.append(
        terms,
        document.createTextNode(
          '　／　'
        ),
        policy
      );


      sh.appendChild(
        links
      );


      const row =
        sheetRow(
          sh
        );


      const ok =
        sheetBtn(
          row,
          '同意して始める',
          'primary sm'
        );


      const no =
        sheetBtn(
          row,
          '同意しない',
          'ghost sm'
        );


      ok.onclick =
        () => {

          localStorage.setItem(
            K_AGREE,
            AGREE_VER
          );


          close();


          resolve(
            true
          );
        };


      no.onclick =
        () => {

          close();


          resolve(
            false
          );
        };
    }
  );
}


async function ensureAgreed() {

  if (
    agreed()
  ) {

    return true;
  }


  for (;;) {

    if (
      await agreeSheet()
    ) {

      return true;
    }


    await alertSheet(
      '同意が必要です',
      '利用規約とプライバシーポリシーに同意いただけない場合、みんやせはご利用いただけません。'
    );
  }
}


/* ============================================================
   データ削除済み画面
   ============================================================ */

function deletedMode() {

  cache.ready =
    false;


  const {
    sh,
    close
  } =
    sheetOpen(
      '利用データを削除しました',
      '現在、この端末にはみんやせの利用アカウントはありません。'
    );


  const note =
    document.createElement(
      'p'
    );


  note.className =
    'note';


  note.textContent =
    '新しく利用を始める場合は「新しく始める」を押してください。' +
    '新しいメンバーIDと端末IDで最初から利用を開始します。';


  sh.appendChild(
    note
  );


  const row =
    sheetRow(
      sh
    );


  const startButton =
    sheetBtn(
      row,
      '新しく始める',
      'primary sm'
    );


  const supportButton =
    sheetBtn(
      row,
      'サポートを見る',
      'ghost sm'
    );


  supportButton.onclick =
    () => {

      docSheet(
        './support.html',
        'サポート'
      );
    };


  startButton.onclick =
    async () => {

      const ok =
        await confirmSheet(
          '新しく始めますか？',
          '以前の利用データは復元されません。新しい利用者として開始します。',
          '新しく始める'
        );


      if (
        !ok
      ) {

        return;
      }


      clearDeletedState();


      close();


      location.reload();
    };
}


/* ============================================================
   B-3：利用停止中ユーザー

   通常機能には入れないが、
   ・利用データ削除
   ・サポート閲覧
   は必ず残す。

   BAN中の削除に、新しい利用規約への同意は要求しない。
   ============================================================ */

async function bannedMode() {

  cache.ready =
    false;


  clearMsg(
    el.msg
  );


  const {
    sh,
    close
  } =
    sheetOpen(
      '利用停止中です',
      'このユーザーは現在みんやせを利用できません。' +
      '保存されている通常の利用データは、この画面から削除できます。'
    );


  const explanation =
    document.createElement(
      'p'
    );


  explanation.className =
    'note';


  explanation.textContent =
    'データを削除すると、体重記録、目標体重、ニックネーム、' +
    'プロフィール画像、グループ所属、体重公開設定、外部WEB連携への同意など、' +
    '通常の利用データが削除されます。削除は取り消せません。';


  sh.appendChild(
    explanation
  );


  const privacyNote =
    document.createElement(
      'p'
    );


  privacyNote.className =
    'note';


  privacyNote.textContent =
    '通報対応、不正利用の防止、安全確保、法令上必要な対応のために、' +
    'プライバシーポリシーで定める範囲の記録を保持する場合があります。';


  sh.appendChild(
    privacyNote
  );


  const error =
    document.createElement(
      'p'
    );


  error.className =
    'msg';


  sh.appendChild(
    error
  );


  const row =
    sheetRow(
      sh
    );


  const deleteButton =
    sheetBtn(
      row,
      '利用データを削除する',
      'danger sm'
    );


  const supportButton =
    sheetBtn(
      row,
      'サポートを見る',
      'ghost sm'
    );


  supportButton.onclick =
    () => {

      docSheet(
        './support.html',
        'サポート'
      );
    };


  deleteButton.onclick =
    async () => {

      const first =
        await confirmSheet(
          '利用データの削除',
          '保存されている通常の利用データを削除します。取り消せません。',
          '次へ進む',
          true
        );


      if (
        !first
      ) {

        return;
      }


      const second =
        await confirmSheet(
          '本当に削除しますか？',
          '体重記録、プロフィール、グループ所属、プロフィール画像などを削除します。',
          '削除する',
          true
        );


      if (
        !second
      ) {

        return;
      }


      deleteButton.disabled =
        true;


      error.textContent =
        '削除中…';


      error.className =
        'msg ok';


      try {

        await api(
          '/api/me',
          {
            method:
              'DELETE'
          }
        );


        markDeletedState();


        close();


        deletedMode();


      } catch (e) {

        deleteButton.disabled =
          false;


        error.textContent =
          '削除できませんでした：' +
          emsg(e);


        error.className =
          'msg ng';
      }
    };
}


/*
 * 規約再同意が必要な状態でも、
 * 既存ユーザーがBANされている場合は
 * 規約同意画面より先に削除導線を出す。
 */
async function checkBannedBeforeAgreement() {

  if (
    agreed()
  ) {

    return false;
  }


  if (
    isDeletedState()
  ) {

    return false;
  }


  /*
   * 完全新規ユーザーなら、BAN確認だけのために
   * device_id を新規発行しない。
   */
  if (
    !localStorage.getItem(
      K_DEV
    )
  ) {

    return false;
  }


  try {

    await api(
      '/api/me'
    );


    return false;


  } catch (e) {

    if (
      e &&
      e.message ===
        'banned'
    ) {

      await bannedMode();


      return true;
    }


    return false;
  }
}


/* ============================================================
   アイコン画像処理
   ============================================================ */

function canvasToBlob(
  canvas,
  quality
) {

  return new Promise(
    resolve =>
      canvas.toBlob(
        resolve,
        'image/jpeg',
        quality
      )
  );
}


function loadImageEl(file) {

  return new Promise(
    (
      resolve,
      reject
    ) => {

      const url =
        URL.createObjectURL(
          file
        );


      const image =
        new Image();


      image.onload =
        () => {

          URL.revokeObjectURL(
            url
          );


          resolve(
            image
          );
        };


      image.onerror =
        () => {

          URL.revokeObjectURL(
            url
          );


          reject(
            new Error(
              'bad_image'
            )
          );
        };


      image.src =
        url;
    }
  );
}


async function loadImageAny(file) {

  if (
    window.createImageBitmap
  ) {

    try {

      return await createImageBitmap(
        file,
        {
          imageOrientation:
            'from-image'
        }
      );

    } catch {}
  }


  return await loadImageEl(
    file
  );
}


/* ============================================================
   画像切り取り
   ============================================================ */

function cropDialog(img) {

  return new Promise(
    (
      resolve,
      reject
    ) => {

      const ov =
        el.cropOv;


      const canvas =
        el.cropCv;


      const zoom =
        el.cropZoom;


      const ok =
        el.cropOk;


      const cancel =
        el.cropCancel;


      const size =
        Math.max(
          200,
          Math.min(
            320,
            window.innerWidth -
            96
          )
        );


      const dpr =
        window.devicePixelRatio ||
        1;


      canvas.style.width =
        size +
        'px';


      canvas.style.height =
        size +
        'px';


      canvas.width =
        Math.round(
          size *
          dpr
        );


      canvas.height =
        Math.round(
          size *
          dpr
        );


      const ctx =
        canvas.getContext(
          '2d'
        );


      const imageWidth =
        img.width;


      const imageHeight =
        img.height;


      const base =
        Math.max(
          size /
          imageWidth,
          size /
          imageHeight
        );


      let z =
        1;


      let tx =
        0;


      let ty =
        0;


      const clamp =
        () => {

          const drawWidth =
            imageWidth *
            base *
            z;


          const drawHeight =
            imageHeight *
            base *
            z;


          tx =
            Math.min(
              0,
              Math.max(
                size -
                drawWidth,
                tx
              )
            );


          ty =
            Math.min(
              0,
              Math.max(
                size -
                drawHeight,
                ty
              )
            );
        };


      const draw =
        () => {

          ctx.setTransform(
            dpr,
            0,
            0,
            dpr,
            0,
            0
          );


          ctx.fillStyle =
            '#ffffff';


          ctx.fillRect(
            0,
            0,
            size,
            size
          );


          ctx.imageSmoothingEnabled =
            true;


          ctx.imageSmoothingQuality =
            'high';


          ctx.drawImage(
            img,
            tx,
            ty,
            imageWidth *
              base *
              z,
            imageHeight *
              base *
              z
          );
        };


      const setZoom =
        (
          newZoom,
          anchorX,
          anchorY
        ) => {

          newZoom =
            Math.min(
              4,
              Math.max(
                1,
                newZoom
              )
            );


          const ratio =
            newZoom /
            z;


          tx =
            anchorX -
            (
              anchorX -
              tx
            ) *
            ratio;


          ty =
            anchorY -
            (
              anchorY -
              ty
            ) *
            ratio;


          z =
            newZoom;


          clamp();

          draw();


          zoom.value =
            String(
              Math.round(
                z *
                100
              )
            );
        };


      tx =
        (
          size -
          imageWidth *
          base
        ) /
        2;


      ty =
        (
          size -
          imageHeight *
          base
        ) /
        2;


      clamp();

      draw();


      zoom.value =
        '100';


      const pointers =
        new Map();


      let lastDistance =
        0;


      const onDown =
        event => {

          canvas.setPointerCapture(
            event.pointerId
          );


          pointers.set(
            event.pointerId,
            {
              x:
                event.clientX,

              y:
                event.clientY
            }
          );


          lastDistance =
            0;
        };


      const onMove =
        event => {

          if (
            !pointers.has(
              event.pointerId
            )
          ) {

            return;
          }


          event.preventDefault();


          const previous =
            pointers.get(
              event.pointerId
            );


          pointers.set(
            event.pointerId,
            {
              x:
                event.clientX,

              y:
                event.clientY
            }
          );


          const points =
            [
              ...pointers.values()
            ];


          if (
            points.length >=
              2
          ) {

            const distance =
              Math.hypot(
                points[0].x -
                points[1].x,

                points[0].y -
                points[1].y
              );


            const rect =
              canvas.getBoundingClientRect();


            const midX =
              (
                points[0].x +
                points[1].x
              ) /
              2 -
              rect.left;


            const midY =
              (
                points[0].y +
                points[1].y
              ) /
              2 -
              rect.top;


            if (
              lastDistance
            ) {

              setZoom(
                z *
                distance /
                lastDistance,
                midX,
                midY
              );
            }


            lastDistance =
              distance;


          } else {

            tx +=
              event.clientX -
              previous.x;


            ty +=
              event.clientY -
              previous.y;


            clamp();

            draw();
          }
        };


      const onUp =
        event => {

          pointers.delete(
            event.pointerId
          );


          lastDistance =
            0;
        };


      const onWheel =
        event => {

          event.preventDefault();


          const rect =
            canvas.getBoundingClientRect();


          setZoom(
            z *
            (
              event.deltaY <
                0
                ? 1.12
                : 1 /
                  1.12
            ),
            event.clientX -
              rect.left,
            event.clientY -
              rect.top
          );
        };


      const onSlider =
        () =>
          setZoom(
            Number(
              zoom.value
            ) /
            100,
            size /
            2,
            size /
            2
          );


      canvas.addEventListener(
        'pointerdown',
        onDown
      );


      canvas.addEventListener(
        'pointermove',
        onMove,
        {
          passive:
            false
        }
      );


      canvas.addEventListener(
        'pointerup',
        onUp
      );


      canvas.addEventListener(
        'pointercancel',
        onUp
      );


      canvas.addEventListener(
        'wheel',
        onWheel,
        {
          passive:
            false
        }
      );


      zoom.addEventListener(
        'input',
        onSlider
      );


      const close =
        () => {

          canvas.removeEventListener(
            'pointerdown',
            onDown
          );


          canvas.removeEventListener(
            'pointermove',
            onMove
          );


          canvas.removeEventListener(
            'pointerup',
            onUp
          );


          canvas.removeEventListener(
            'pointercancel',
            onUp
          );


          canvas.removeEventListener(
            'wheel',
            onWheel
          );


          zoom.removeEventListener(
            'input',
            onSlider
          );


          ok.onclick =
            null;


          cancel.onclick =
            null;


          ov.hidden =
            true;


          if (
            !document.querySelector(
              '.ov:not([hidden])'
            )
          ) {

            document.body.style.overflow =
              '';
          }
        };


      ok.onclick =
        () => {

          const scale =
            base *
            z;


          const rect = {

            sx:
              -tx /
              scale,

            sy:
              -ty /
              scale,

            sw:
              size /
              scale,

            sh:
              size /
              scale
          };


          close();


          resolve(
            rect
          );
        };


      cancel.onclick =
        () => {

          close();


          reject(
            new Error(
              CANCELED
            )
          );
        };


      ov.hidden =
        false;


      document.body.style.overflow =
        'hidden';
    }
  );
}


/* ============================================================
   画像JPEG化
   ============================================================ */

async function fileToIconBlob(file) {

  if (!file) {

    throw new Error(
      'bad_image'
    );
  }


  if (
    file.type &&
    !/^image\//.test(
      file.type
    )
  ) {

    throw new Error(
      'not_image'
    );
  }


  const image =
    await loadImageAny(
      file
    );


  try {

    const width =
      image.width;


    const height =
      image.height;


    if (
      !width ||
      !height
    ) {

      throw new Error(
        'bad_image'
      );
    }


    let rect;


    if (
      el.cropOv &&
      el.cropCv &&
      el.cropZoom &&
      el.cropOk &&
      el.cropCancel
    ) {

      rect =
        await cropDialog(
          image
        );


    } else {

      const size =
        Math.min(
          width,
          height
        );


      rect = {

        sx:
          (
            width -
            size
          ) /
          2,

        sy:
          (
            height -
            size
          ) /
          2,

        sw:
          size,

        sh:
          size
      };
    }


    const canvas =
      document.createElement(
        'canvas'
      );


    canvas.width =
      ICON_SIZE;


    canvas.height =
      ICON_SIZE;


    const ctx =
      canvas.getContext(
        '2d'
      );


    ctx.fillStyle =
      '#ffffff';


    ctx.fillRect(
      0,
      0,
      ICON_SIZE,
      ICON_SIZE
    );


    ctx.imageSmoothingEnabled =
      true;


    ctx.imageSmoothingQuality =
      'high';


    ctx.drawImage(
      image,

      rect.sx,
      rect.sy,
      rect.sw,
      rect.sh,

      0,
      0,

      ICON_SIZE,
      ICON_SIZE
    );


    let quality =
      0.85;


    let blob =
      await canvasToBlob(
        canvas,
        quality
      );


    while (
      blob &&
      blob.size >
        ICON_LIMIT &&
      quality >
        0.4
    ) {

      quality -=
        0.15;


      blob =
        await canvasToBlob(
          canvas,
          quality
        );
    }


    if (!blob) {

      throw new Error(
        'bad_image'
      );
    }


    return blob;


  } finally {

    if (
      image.close
    ) {

      image.close();
    }
  }
}


/* ============================================================
   Avatar
   ============================================================ */

function initialOf(row) {

  const nickname =
    String(
      (
        row &&
        row.nickname
      ) ||
      ''
    )
      .trim();


  return nickname
    ? [...nickname][0]
    : '?';
}


function avatar(
  row,
  size
) {

  const px =
    size ||
    36;


  const box =
    document.createElement(
      'div'
    );


  box.className =
    'av';


  box.style.cssText =
    `width:${px}px;height:${px}px;flex:0 0 auto;border-radius:50%;overflow:hidden;` +
    `background:#ece7e2;display:flex;align-items:center;justify-content:center;` +
    `font-weight:700;color:#a8998f;font-size:${Math.round(px * 0.42)}px;line-height:1;`;


  if (
    row &&
    row.icon_url
  ) {

    const image =
      document.createElement(
        'img'
      );


    image.src =
      API +
      row.icon_url;


    image.alt =
      '';


    image.loading =
      'lazy';


    image.style.cssText =
      'width:100%;height:100%;object-fit:cover;display:block;';


    image.onerror =
      () => {

        image.remove();


        box.textContent =
          initialOf(
            row
          );
      };


    box.appendChild(
      image
    );


  } else {

    box.textContent =
      initialOf(
        row
      );
  }


  return box;
}


/* ============================================================
   アイコン表示・承認待ち状態
   ============================================================ */

function renderIcon() {

  if (
    !el.iconBox
  ) {

    return;
  }


  el.iconBox.innerHTML =
    '';


  el.iconBox.appendChild(
    avatar(
      cache.me ||
      {},
      72
    )
  );


  if (
    el.iconDel
  ) {

    el.iconDel.hidden =
      !(
        (
          cache.me &&
          cache.me.icon_url
        ) ||
        cache.iconPending
      );
  }


  renderIconModerationStatus();
}


async function loadIconState() {

  if (
    !cache.me
  ) {

    return;
  }


  try {

    const data =
      await api(
        '/api/icon'
      );


    cache.iconPending =
      !!data.pending;


    cache.iconPendingAt =
      data.pending_at ||
      null;


    cache.me.icon_ver =
      Number(
        data.icon_ver ||
        0
      );


    cache.me.icon_url =
      data.icon_url ||
      null;


    renderIcon();


    if (
      cache.group ||
      state.rank ===
        'rival'
    ) {

      loadRanking();
    }


  } catch {}
}


/* ============================================================
   アイコンアップロード
   ============================================================ */

async function uploadIcon(file) {

  if (
    !cache.ready
  ) {

    say(
      el.imsg,
      'サーバーに接続中です',
      false
    );


    return;
  }


  try {

    const blob =
      await fileToIconBlob(
        file
      );


    if (
      el.imsg &&
      el.imsg.dataset
    ) {

      delete el.imsg.dataset.pending;
    }


    say(
      el.imsg,
      'アップロード中…',
      true
    );


    const data =
      await apiBlob(
        '/api/icon',
        blob
      );


    if (
      cache.me
    ) {

      cache.me.icon_ver =
        Number(
          data.icon_ver ||
          0
        );


      cache.me.icon_url =
        data.icon_url ||
        null;
    }


    cache.iconPending =
      !!data.pending;


    cache.iconPendingAt =
      Date.now();


    renderIcon();


    if (
      cache.group ||
      state.rank ===
        'rival'
    ) {

      loadRanking();
    }


    renderIconModerationStatus();


  } catch (e) {

    if (
      e &&
      e.message ===
        CANCELED
    ) {

      clearMsg(
        el.imsg
      );


    } else {

      say(
        el.imsg,
        emsg(e),
        false
      );
    }
  }
}


/* ============================================================
   アイコン削除
   ============================================================ */

async function removeIcon() {

  if (
    !await confirmSheet(
      'アイコンの削除',
      '公開中のプロフィール画像と承認待ち画像を削除します。',
      '削除する',
      true
    )
  ) {

    return;
  }


  try {

    await api(
      '/api/icon',
      {
        method:
          'DELETE'
      }
    );


    if (
      cache.me
    ) {

      cache.me.icon_ver =
        0;


      cache.me.icon_url =
        null;
    }


    cache.iconPending =
      false;


    cache.iconPendingAt =
      null;


    clearMsg(
      el.imsg
    );


    renderIcon();


    if (
      cache.group ||
      state.rank ===
        'rival'
    ) {

      loadRanking();
    }


    say(
      el.imsg,
      'アイコンを削除しました',
      true
    );


  } catch (e) {

    say(
      el.imsg,
      emsg(e),
      false
    );
  }
}


/* ============================================================
   体重保存
   ============================================================ */

async function saveWeight(
  ymd,
  kg
) {

  if (
    !cache.ready
  ) {

    say(
      el.msg,
      'サーバーに接続中です',
      false
    );


    return false;
  }


  if (
    ymd >
    todayYmdJST()
  ) {

    say(
      el.msg,
      '未来の日付は登録できません',
      false
    );


    return false;
  }


  const value =
    normKg(
      kg
    );


  if (
    value ===
      null
  ) {

    say(
      el.msg,
      '体重を 20〜300kg で入力してください',
      false
    );


    return false;
  }


  say(
    el.msg,
    '保存中…',
    true
  );


  try {

    await store.put(
      ymd,
      value
    );


    renderLog();


    say(
      el.msg,
      `${fmtJp(ymd)} を ${value.toFixed(1)}kg で記録しました`,
      true
    );


    return true;


  } catch (err) {

    renderLog();


    say(
      el.msg,
      saveErrorMessage(
        err
      ),
      false
    );


    return false;
  }
}


/* ============================================================
   表示期間
   ============================================================ */

function currentRange() {

  const today =
    todayYmdJST();


  const todayDay =
    ymdToDay(
      today
    );


  const [
    currentYear,
    currentMonth
  ] =
    today
      .split('-')
      .map(
        Number
      );


  if (
    state.period ===
      'week'
  ) {

    const end =
      todayDay +
      state.offset *
      7;


    return {
      from:
        end -
        6,

      to:
        end,

      label:
        `${fmtJp(dayToYmd(end - 6))} 〜 ${fmtJp(dayToYmd(end))}`
    };
  }


  if (
    state.period ===
      'month'
  ) {

    let year =
      currentYear;


    let month =
      currentMonth +
      state.offset;


    year +=
      Math.floor(
        (
          month -
          1
        ) /
        12
      );


    month =
      (
        (
          month -
          1
        ) %
        12 +
        12
      ) %
      12 +
      1;


    const monthText =
      String(
        month
      )
        .padStart(
          2,
          '0'
        );


    const lastDay =
      new Date(
        Date.UTC(
          year,
          month,
          0
        )
      )
        .getUTCDate();


    return {
      from:
        ymdToDay(
          `${year}-${monthText}-01`
        ),

      to:
        ymdToDay(
          `${year}-${monthText}-${String(lastDay).padStart(2, '0')}`
        ),

      label:
        `${year}年${month}月`
    };
  }


  if (
    state.period ===
      'year'
  ) {

    const year =
      currentYear +
      state.offset;


    return {
      from:
        ymdToDay(
          `${year}-01-01`
        ),

      to:
        ymdToDay(
          `${year}-12-31`
        ),

      label:
        `${year}年`
    };
  }


  const keys =
    Object.keys(
      store.all()
    )
      .sort();


  if (
    !keys.length
  ) {

    return {
      from:
        todayDay -
        6,

      to:
        todayDay,

      label:
        '全期間'
    };
  }


  return {
    from:
      ymdToDay(
        keys[0]
      ),

    to:
      Math.max(
        ymdToDay(
          keys[
            keys.length -
            1
          ]
        ),
        todayDay
      ),

    label:
      `${fmtJpFull(keys[0])} 〜`
  };
}
/* ============================================================
   グラフ
   ============================================================ */

function drawChart() {

  const canvas =
    el.chart;


  const ctx =
    canvas.getContext(
      '2d'
    );


  const dpr =
    window.devicePixelRatio ||
    1;


  const cssWidth =
    canvas.clientWidth;


  const cssHeight =
    240;


  canvas.width =
    Math.round(
      cssWidth *
      dpr
    );


  canvas.height =
    Math.round(
      cssHeight *
      dpr
    );


  ctx.setTransform(
    dpr,
    0,
    0,
    dpr,
    0,
    0
  );


  ctx.clearRect(
    0,
    0,
    cssWidth,
    cssHeight
  );


  const pad = {
    l:
      42,

    r:
      12,

    t:
      14,

    b:
      24
  };


  const width =
    cssWidth -
    pad.l -
    pad.r;


  const height =
    cssHeight -
    pad.t -
    pad.b;


  const all =
    store.all();


  const {
    from,
    to
  } =
    currentRange();


  const points =
    Object.keys(
      all
    )
      .map(
        ymd => ({
          ymd,

          day:
            ymdToDay(
              ymd
            ),

          kg:
            all[
              ymd
            ]
        })
      )
      .filter(
        point =>
          point.day >=
            from &&
          point.day <=
            to
      )
      .sort(
        (
          a,
          b
        ) =>
          a.day -
          b.day
      );


  const before =
    Object.keys(
      all
    )
      .map(
        ymd => ({
          day:
            ymdToDay(
              ymd
            ),

          kg:
            all[
              ymd
            ]
        })
      )
      .filter(
        point =>
          point.day <
            from
      )
      .sort(
        (
          a,
          b
        ) =>
          a.day -
          b.day
      )
      .pop();


  ctx.font =
    '10px -apple-system,sans-serif';


  ctx.textBaseline =
    'middle';


  if (
    !points.length &&
    !before
  ) {

    ctx.fillStyle =
      '#8a8a8a';


    ctx.textAlign =
      'center';


    ctx.fillText(
      cache.ready
        ? 'この期間の記録はありません'
        : '読み込み中…',

      cssWidth /
      2,

      cssHeight /
      2
    );


    return;
  }


  const goal =
    store.goal();


  const values =
    points.map(
      point =>
        point.kg
    );


  if (
    before
  ) {

    values.push(
      before.kg
    );
  }


  if (
    goal !==
      null
  ) {

    values.push(
      goal
    );
  }


  let low =
    Math.min(
      ...values
    );


  let high =
    Math.max(
      ...values
    );


  if (
    high -
    low <
      0.5
  ) {

    const middle =
      (
        high +
        low
      ) /
      2;


    low =
      middle -
      0.25;


    high =
      middle +
      0.25;
  }


  const margin =
    (
      high -
      low
    ) *
    0.12;


  low -=
    margin;


  high +=
    margin;


  const x =
    day =>
      pad.l +
      (
        to ===
          from
          ? width /
            2
          : (
              day -
              from
            ) /
            (
              to -
              from
            ) *
            width
      );


  const y =
    kg =>
      pad.t +
      (
        high -
        kg
      ) /
      (
        high -
        low
      ) *
      height;


  ctx.strokeStyle =
    '#f0eeea';


  ctx.lineWidth =
    1;


  ctx.textAlign =
    'right';


  ctx.fillStyle =
    '#a5a29d';


  for (
    let i = 0;
    i <= 4;
    i++
  ) {

    const kg =
      low +
      (
        high -
        low
      ) *
      i /
      4;


    const yy =
      Math.round(
        y(
          kg
        )
      ) +
      0.5;


    ctx.beginPath();


    ctx.moveTo(
      pad.l,
      yy
    );


    ctx.lineTo(
      cssWidth -
      pad.r,
      yy
    );


    ctx.stroke();


    ctx.fillText(
      kg.toFixed(1),
      pad.l -
      6,
      yy
    );
  }


  if (
    goal !==
      null &&
    goal >=
      low &&
    goal <=
      high
  ) {

    ctx.save();


    ctx.setLineDash(
      [
        2,
        3
      ]
    );


    ctx.strokeStyle =
      '#7aa3c9';


    ctx.lineWidth =
      1.5;


    ctx.beginPath();


    ctx.moveTo(
      pad.l,
      y(
        goal
      )
    );


    ctx.lineTo(
      cssWidth -
      pad.r,
      y(
        goal
      )
    );

    ctx.stroke();


    ctx.restore();
  }


  const sequence =
    [];


  if (
    before
  ) {

    sequence.push({
      day:
        from,

      kg:
        before.kg,

      virtual:
        true
    });
  }


  sequence.push(
    ...points
  );


  for (
    let i = 1;
    i <
      sequence.length;
    i++
  ) {

    const a =
      sequence[
        i -
        1
      ];


    const b =
      sequence[
        i
      ];


    if (
      b.day -
      a.day ===
        1 &&
      !a.virtual
    ) {

      ctx.setLineDash(
        []
      );


      ctx.strokeStyle =
        '#e2725b';


      ctx.lineWidth =
        2;


      ctx.beginPath();


      ctx.moveTo(
        x(
          a.day
        ),
        y(
          a.kg
        )
      );


      ctx.lineTo(
        x(
          b.day
        ),
        y(
          b.kg
        )
      );


      ctx.stroke();


    } else {

      ctx.setLineDash(
        [
          3,
          3
        ]
      );


      ctx.strokeStyle =
        '#c9948a';


      ctx.lineWidth =
        1.5;


      ctx.beginPath();


      ctx.moveTo(
        x(
          a.day
        ),
        y(
          a.kg
        )
      );


      ctx.lineTo(
        x(
          b.day
        ),
        y(
          a.kg
        )
      );


      ctx.lineTo(
        x(
          b.day
        ),
        y(
          b.kg
        )
      );


      ctx.stroke();


      ctx.setLineDash(
        []
      );
    }
  }


  const last =
    points[
      points.length -
      1
    ] ||
    (
      before
        ? {
            day:
              from,

            kg:
              before.kg
          }
        : null
    );


  const rightEnd =
    Math.min(
      to,
      ymdToDay(
        todayYmdJST()
      )
    );


  if (
    last &&
    rightEnd >
      last.day
  ) {

    ctx.save();


    ctx.setLineDash(
      [
        3,
        3
      ]
    );


    ctx.strokeStyle =
      '#c9948a';


    ctx.lineWidth =
      1.5;


    ctx.beginPath();


    ctx.moveTo(
      x(
        last.day
      ),
      y(
        last.kg
      )
    );


    ctx.lineTo(
      x(
        rightEnd
      ),
      y(
        last.kg
      )
    );


    ctx.stroke();


    ctx.restore();
  }


  ctx.fillStyle =
    '#e2725b';


  for (
    const point of
    points
  ) {

    ctx.beginPath();


    ctx.arc(
      x(
        point.day
      ),
      y(
        point.kg
      ),
      3.2,
      0,
      Math.PI *
      2
    );


    ctx.fill();
  }


  ctx.fillStyle =
    '#a5a29d';


  ctx.textAlign =
    'left';


  ctx.fillText(
    fmtJp(
      dayToYmd(
        from
      )
    ),
    pad.l,
    cssHeight -
    pad.b /
    2
  );


  ctx.textAlign =
    'right';


  ctx.fillText(
    fmtJp(
      dayToYmd(
        to
      )
    ),
    cssWidth -
    pad.r,
    cssHeight -
    pad.b /
    2
  );
}


/* ============================================================
   サマリ
   ============================================================ */

function drawSummary() {

  const all =
    store.all();


  const keys =
    Object.keys(
      all
    )
      .sort();


  if (
    !keys.length
  ) {

    el.summary.textContent =
      '';


    return;
  }


  const first =
    all[
      keys[0]
    ];


  const last =
    all[
      keys[
        keys.length -
        1
      ]
    ];


  const change =
    last -
    first;


  let text =
    `記録 ${keys.length}件 ／ ` +
    `開始 ${first.toFixed(1)}kg → 最新 ${last.toFixed(1)}kg` +
    `（${change <= 0 ? '' : '+'}${change.toFixed(1)}kg）`;


  const goal =
    store.goal();


  if (
    goal !==
      null
  ) {

    const remaining =
      last -
      goal;


    text +=
      remaining >
        0
        ? ` ／ 目標まで あと ${remaining.toFixed(1)}kg`
        : ' ／ 目標達成';
  }


  el.summary.textContent =
    text;
}


/* ============================================================
   履歴
   ============================================================ */

function drawHist() {

  const all =
    store.all();


  const keys =
    Object.keys(
      all
    )
      .sort()
      .reverse();


  el.hist.innerHTML =
    '';


  if (
    !keys.length
  ) {

    el.hist.innerHTML =
      `<li class="empty">${
        cache.ready
          ? 'まだ記録がありません'
          : '読み込み中…'
      }</li>`;


    return;
  }


  for (
    let i = 0;
    i <
      keys.length;
    i++
  ) {

    const ymd =
      keys[i];


    const kg =
      all[
        ymd
      ];


    const previous =
      keys[
        i +
        1
      ]
        ? all[
            keys[
              i +
              1
            ]
          ]
        : null;


    const li =
      document.createElement(
        'li'
      );


    const date =
      document.createElement(
        'span'
      );


    date.className =
      'd';


    date.textContent =
      fmtJpFull(
        ymd
      )
        .slice(5);


    const weight =
      document.createElement(
        'span'
      );


    weight.className =
      'k';


    weight.textContent =
      kg.toFixed(1) +
      ' kg';


    const diff =
      document.createElement(
        'span'
      );


    diff.className =
      'diff';


    if (
      previous !==
        null
    ) {

      const value =
        kg -
        previous;


      diff.textContent =
        (
          value >
            0
            ? '+'
            : ''
        ) +
        value.toFixed(1);


      diff.style.color =
        value >
          0
          ? '#c0392b'
          : (
              value <
                0
                ? '#3a8a5f'
                : '#8a8a8a'
            );
    }


    const edit =
      document.createElement(
        'button'
      );


    edit.type =
      'button';


    edit.textContent =
      '編集';


    edit.onclick =
      async () => {

        const value =
          await promptSheet({
            title:
              fmtJpFull(
                ymd
              ) +
              ' の体重',

            note:
              '20〜300kg の範囲で入力してください。',

            type:
              'number',

            value:
              kg.toFixed(1),

            min:
              20,

            max:
              300,

            ok:
              '保存する',

            validate:
              input =>
                normKg(
                  input
                ) ===
                  null
                  ? '20〜300kg で入力してください'
                  : null,
          });


        if (
          value !==
            null
        ) {

          await saveWeight(
            ymd,
            value
          );
        }
      };


    const del =
      document.createElement(
        'button'
      );


    del.type =
      'button';


    del.textContent =
      '削除';


    del.onclick =
      async () => {

        const ok =
          await confirmSheet(
            '記録の削除',
            `${fmtJpFull(ymd)} の記録（${kg.toFixed(1)}kg）を削除します。`,
            '削除する',
            true
          );


        if (!ok) {

          return;
        }


        store.del(
          ymd
        );


        renderLog();


        say(
          el.msg,
          '削除しました',
          true
        );
      };


    li.append(
      date,
      weight,
      diff,
      edit,
      del
    );


    el.hist.appendChild(
      li
    );
  }
}


function renderLog() {

  drawChart();

  drawSummary();

  drawHist();


  el.rangeLabel.textContent =
    currentRange().label;
}


/* ============================================================
   グループ
   ============================================================ */

function renderGroup() {

  const group =
    cache.group;


  el.noGroupBox.hidden =
    !!group;


  el.myGroupBox.hidden =
    !group;


  el.rankBox.hidden =
    false;


  el.viewGroup.classList.toggle(
    'no-group',
    !group
  );


  if (
    !group
  ) {

    return;
  }


  el.gName.textContent =
    group.name;


  el.gMeta.textContent =
    `メンバー ${group.members}人 ／ ` +
    `スタート ${fmtJpFull(group.start_ymd)} ／ ` +
    `体重${group.show_weight ? '公開' : '非公開'}`;


  el.gCodeBox.hidden =
    !group.is_owner;


  if (
    group.is_owner
  ) {

    el.gCode.textContent =
      fmtCode(
        group.code ||
        group.group_id
      );
  }


  el.ownerTools.hidden =
    !group.is_owner;


  el.memberTools.hidden =
    !!group.is_owner;
}


/* ============================================================
   他チームselect
   ============================================================ */

function renderWatchSel() {

  el.watchSel.innerHTML =
    '';


  if (
    !cache.watching.length
  ) {

    const option =
      document.createElement(
        'option'
      );


    option.value =
      '';


    option.textContent =
      '登録なし';


    el.watchSel.appendChild(
      option
    );


    state.watchId =
      null;


    return;
  }


  for (
    const watching of
    cache.watching
  ) {

    const option =
      document.createElement(
        'option'
      );


    option.value =
      watching.group_id;


    option.textContent =
      watching.name;


    el.watchSel.appendChild(
      option
    );
  }


  const ids =
    cache.watching.map(
      watching =>
        watching.group_id
    );


  if (
    !state.watchId ||
    !ids.includes(
      state.watchId
    )
  ) {

    state.watchId =
      ids[0];
  }


  el.watchSel.value =
    state.watchId;
}


/* ============================================================
   ランキング描画
   ============================================================ */

function drawRank(data) {

  el.rankList.innerHTML =
    '';


  const rows =
    data.rows ||
    [];


  if (
    !rows.length
  ) {

    el.rankList.innerHTML =
      '<li class="empty">表示できるメンバーがいません</li>';


    return;
  }


  for (
    const row of
    rows
  ) {

    const li =
      document.createElement(
        'li'
      );


    if (
      row.is_self
    ) {

      li.classList.add(
        'self'
      );
    }


    if (
      row.inactive
    ) {

      li.classList.add(
        'rest'
      );
    }


    const number =
      document.createElement(
        'span'
      );


    number.className =
      'no' +
      (
        row.rank &&
        row.rank <=
          3
          ? ' top'
          : ''
      );


    number.textContent =
      row.rank
        ? row.rank
        : '—';


    const avatarNode =
      avatar(
        row,
        38
      );


    const whoBox =
      document.createElement(
        'div'
      );


    whoBox.className =
      'who';


    const name =
      document.createElement(
        'div'
      );


    name.className =
      'nm';


    name.textContent =
      row.nickname ||
      '名前未設定';


    if (
      row.is_self
    ) {

      name.appendChild(
        badge(
          'あなた'
        )
      );
    }


    if (
      row.is_rival &&
      !row.is_self
    ) {

      name.appendChild(
        badge(
          'ライバル',
          'rival'
        )
      );
    }


    if (
      row.inactive
    ) {

      name.appendChild(
        badge(
          '休止中'
        )
      );
    }


    const sub =
      document.createElement(
        'div'
      );


    sub.className =
      'sb';


    if (
      !row.last_ymd
    ) {

      sub.textContent =
        '記録なし';


    } else {

      const kgPart =
        (
          row.start_kg !=
            null &&
          row.latest_kg !=
            null
        )
          ? `${row.start_kg.toFixed(1)} → ${row.latest_kg.toFixed(1)}kg ／ `
          : '';


      const idle =
        row.idle_days ===
          0
          ? '今日'
          : `${row.idle_days}日前`;


      const groupName =
        row.group_name
          ? `${row.group_name} ／ `
          : '';


      sub.textContent =
        groupName +
        kgPart +
        `最終 ${fmtJp(row.last_ymd)}（${idle}）`;
    }


    whoBox.append(
      name,
      sub
    );


    const loss =
      document.createElement(
        'span'
      );


    if (
      row.loss ===
        null
    ) {

      loss.className =
        'ls none';


      loss.textContent =
        '—';


    } else {

      loss.className =
        'ls ' +
        (
          row.loss >
            0
            ? 'minus'
            : (
                row.loss <
                  0
                  ? 'plus'
                  : ''
              )
        );


      loss.textContent =
        signKg(
          row.loss
        );
    }


    const menu =
      document.createElement(
        'button'
      );


    menu.className =
      'kebab';


    menu.type =
      'button';


    menu.textContent =
      '⋯';


    menu.setAttribute(
      'aria-label',
      'このメンバーへの操作'
    );


    menu.onclick =
      () =>
        memberMenu(
          row,
          data
        );


    li.append(
      number,
      avatarNode,
      whoBox,
      loss
    );


    if (
      !row.is_self
    ) {

      li.append(
        menu
      );
    }


    el.rankList.appendChild(
      li
    );
  }
}


function badge(
  text,
  className
) {

  const node =
    document.createElement(
      'span'
    );


  node.className =
    'badge' +
    (
      className
        ? ' ' +
          className
        : ''
    );


  node.textContent =
    text;


  return node;
}


const who =
  row =>
    row.nickname ||
    '名前未設定';


/* ============================================================
   メンバー操作
   ============================================================ */

async function memberMenu(
  row,
  data
) {

  const isOwner =
    !!(
      data &&
      data.group &&
      data.group.is_owner &&
      data.group.is_mine !==
        false
    );


  const actions =
    [];


  actions.push(
    row.is_rival
      ? {
          label:
            'ライバルから外す',

          run:
            () =>
              rivalDel(
                row
              )
        }
      : {
          label:
            'ライバルに追加',

          run:
            () =>
              rivalAdd(
                row
              )
        }
  );


  actions.push({
    label:
      'この人を通報する',

    run:
      () =>
        doReport(
          row
        )
  });


  actions.push({
    label:
      'この人をブロックする',

    run:
      () =>
        doBlock(
          row
        ),

    danger:
      true
  });


  if (
    isOwner
  ) {

    actions.push({
      label:
        'グループから除名する',

      run:
        () =>
          doKick(
            row
          ),

      danger:
        true
    });
  }


  const index =
    await menuSheet(
      who(
        row
      ),
      '通報された内容は開発者が確認します。ブロックすると、あなたと相手は互いの通常ランキング等に表示されなくなります。',
      actions
    );


  if (
    index >=
      0 &&
    actions[
      index
    ]
  ) {

    actions[
      index
    ].run();
  }
}


/* ============================================================
   ライバル
   ============================================================ */

async function rivalAdd(row) {

  try {

    await api(
      '/api/rivals',
      {
        method:
          'POST',

        body: {
          member_id:
            row.member_id
        }
      }
    );


    say(
      el.rmsg,
      `${who(row)} をライバルに追加しました`,
      true
    );


    loadRanking();


  } catch (e) {

    say(
      el.rmsg,
      emsg(e),
      false
    );
  }
}


async function rivalDel(row) {

  try {

    await api(
      '/api/rivals/' +
      encodeURIComponent(
        row.member_id
      ),
      {
        method:
          'DELETE'
      }
    );


    say(
      el.rmsg,
      `${who(row)} をライバルから外しました`,
      true
    );


    loadRanking();


  } catch (e) {

    say(
      el.rmsg,
      emsg(e),
      false
    );
  }
}


/* ============================================================
   通報
   ============================================================ */

const REPORT_PRESETS = [

  'ニックネームが不適切',
  'アイコン画像が不適切',
  'なりすまし・他人の写真',
  'いやがらせ・攻撃的な言動',
  '性的な内容',
  'スパム・宣伝・勧誘',
];


async function doReport(row) {

  const items =
    REPORT_PRESETS.map(
      label => ({
        label
      })
    );


  items.push({
    label:
      'その他（自分で書く）'
  });


  const index =
    await menuSheet(
      `${who(row)} を通報`,
      '当てはまるものを選んでください。内容は開発者が確認し、必要に応じて表示の停止や利用停止を行います。',
      items
    );


  if (
    index <
      0
  ) {

    return;
  }


  let reason;


  if (
    index ===
      REPORT_PRESETS.length
  ) {

    reason =
      await promptSheet({
        title:
          '通報の理由',

        note:
          '200文字まで。相手の連絡先や個人情報は書かないでください。',

        multiline:
          true,

        maxlength:
          200,

        placeholder:
          '何があったかを具体的に書いてください',

        ok:
          '通報する',

        validate:
          value => {

            if (
              !String(
                value
              ).trim()
            ) {

              return '理由を入力してください';
            }


            if (
              moderate(
                value
              ) ===
                'has_contact'
            ) {

              return ERR.has_contact;
            }


            return null;
          },
      });


    if (
      reason ===
        null
    ) {

      return;
    }


  } else {

    reason =
      REPORT_PRESETS[
        index
      ];
  }


  try {

    await api(
      '/api/reports',
      {
        method:
          'POST',

        body: {
          target_id:
            row.member_id,

          reason
        },
      }
    );


    say(
      el.rmsg,
      '通報を受け付けました。確認まで少しお時間をください',
      true
    );


  } catch (e) {

    say(
      el.rmsg,
      emsg(e),
      false
    );


    return;
  }


  if (
    row.is_blocked
  ) {

    return;
  }


  const alsoBlock =
    await confirmSheet(
      'あわせてブロックしますか？',
      `${who(row)} をブロックすると、あなたと相手は互いの通常ランキング等に表示されなくなります。あとから「マイページ」で解除できます。`,
      'ブロックする',
      true
    );


  if (
    alsoBlock
  ) {

    await blockNow(
      row
    );
  }
}


/* ============================================================
   ブロック
   ============================================================ */

async function blockNow(row) {

  try {

    await api(
      '/api/blocks',
      {
        method:
          'POST',

        body: {
          member_id:
            row.member_id
        }
      }
    );


    say(
      el.rmsg,
      'ブロックしました',
      true
    );


    await loadBlocks();


    loadRanking();


  } catch (e) {

    say(
      el.rmsg,
      emsg(e),
      false
    );
  }
}


async function doBlock(row) {

  const ok =
    await confirmSheet(
      `${who(row)} をブロック`,
      'ブロックすると、あなたと相手は互いの通常ランキング等に表示されなくなります。あとから「マイページ」の「ブロック中」で解除できます。',
      'ブロックする',
      true
    );


  if (!ok) {

    return;
  }


  await blockNow(
    row
  );
}


/* ============================================================
   除名
   ============================================================ */

async function doKick(row) {

  const ok =
    await confirmSheet(
      `${who(row)} を除名`,
      '同じコードでは再参加できなくなります。除名した人は「除名リスト」から戻せます。',
      '除名する',
      true
    );


  if (!ok) {

    return;
  }


  try {

    await api(
      '/api/groups/kick',
      {
        method:
          'POST',

        body: {
          member_id:
            row.member_id
        }
      }
    );


    say(
      el.rmsg,
      '除名しました',
      true
    );


    await loadMe();


    loadRanking();


  } catch (e) {

    say(
      el.rmsg,
      emsg(e),
      false
    );
  }
}


/* ============================================================
   読み込み
   ============================================================ */

async function loadMe() {

  const data =
    await api(
      '/api/me'
    );


  cache.me =
    data.me ||
    null;


  cache.group =
    data.group ||
    null;


  cache.goal =
    (
      data.me &&
      data.me.goal_weight !=
        null
    )
      ? Number(
          data.me.goal_weight
        )
      : null;


  renderGroup();

  renderMy();
}


async function loadWeights() {

  const data =
    await api(
      '/api/weights'
    );


  cache.weights =
    {};


  for (
    const row of
    (
      data.weights ||
      []
    )
  ) {

    cache.weights[
      row.ymd
    ] =
      row.kg;
  }
}


async function loadWatching() {

  try {

    const data =
      await api(
        '/api/watching'
      );


    cache.watching =
      data.watching ||
      [];


    renderWatchSel();


  } catch {}
}


async function loadBlocks() {

  try {

    const data =
      await api(
        '/api/blocks'
      );


    cache.blocks =
      data.blocks ||
      [];


    drawBlocks();


  } catch {}
}


/* ============================================================
   ランキング読み込み
   ============================================================ */

async function loadRanking() {

  if (
    state.view !==
      'group'
  ) {

    return;
  }


  let path =
    '/api/ranking?scope=mine';


  if (
    state.rank ===
      'rival'
  ) {

    path =
      '/api/ranking?scope=rival';


  } else if (
    state.rank ===
      'watch'
  ) {

    if (
      !state.watchId
    ) {

      el.rankHead.textContent =
        '';


      el.rankList.innerHTML =
        '<li class="empty">下の「チームを追加」からコードを登録してください</li>';


      return;
    }


    path =
      '/api/ranking?scope=watch&group_id=' +
      encodeURIComponent(
        state.watchId
      );


  } else if (
    !cache.group
  ) {

    el.rankHead.textContent =
      '';


    el.rankList.innerHTML =
      '<li class="empty">グループに参加すると表示されます</li>';


    return;
  }


  el.rankList.innerHTML =
    '<li class="empty">読み込み中…</li>';


  try {

    const data =
      await api(
        path
      );


    const summary =
      data.summary;


    if (
      data.group
    ) {

      el.rankHead.innerHTML =
        '';


      const firstLine =
        document.createElement(
          'div'
        );


      firstLine.textContent =
        `${data.group.name} ／ スタート ${fmtJpFull(data.group.start_ymd)}`;


      el.rankHead.appendChild(
        firstLine
      );


      if (
        summary &&
        summary.counted
      ) {

        const secondLine =
          document.createElement(
            'div'
          );


        secondLine.textContent =
          `合計 ${signKg(summary.total_loss)} ｜ 平均 ${signKg(summary.avg_loss)}/人`;


        el.rankHead.appendChild(
          secondLine
        );
      }


    } else {

      el.rankHead.textContent =
        `自分＋ライバル ${(data.rows || []).length}人`;
    }


    drawRank(
      data
    );


  } catch (e) {

    el.rankHead.textContent =
      '';


    el.rankList.innerHTML =
      `<li class="empty">${emsg(e)}</li>`;
  }
}


/* ============================================================
   他チーム追加
   ============================================================ */

async function addWatchByCode(
  messageNode
) {

  const code =
    await promptSheet({
      title:
        'チームを追加',

      note:
        '見たいチームの参加コード（8文字）を入れてください。',

      value:
        '',

      placeholder:
        'ABCD-1234',

      upper:
        true,

      maxlength:
        12,

      ok:
        '追加する',

      validate:
        value =>
          rawCode(
            value
          ).length ===
            8
            ? null
            : 'コードは8文字です',
    });


  if (
    code ===
      null
  ) {

    return;
  }


  try {

    const data =
      await api(
        '/api/watching',
        {
          method:
            'POST',

          body: {
            code:
              code.trim()
          }
        }
      );


    cache.watching =
      data.watching ||
      [];


    const wanted =
      rawCode(
        code
      );


    const hit =
      cache.watching.find(
        watching =>
          rawCode(
            watching.group_id
          ) ===
          wanted
      );


    state.watchId =
      hit
        ? hit.group_id
        : (
            cache.watching.length
              ? cache.watching[
                  cache.watching.length -
                  1
                ].group_id
              : null
          );


    renderWatchSel();


    state.rank =
      'watch';


    [
      ...el.rankTabs.children
    ]
      .forEach(
        tab =>
          tab.classList.toggle(
            'is-on',
            tab.dataset.r ===
              'watch'
          )
      );


    el.watchNav.hidden =
      false;


    loadRanking();


    say(
      messageNode ||
      el.rmsg,
      'チームを追加しました',
      true
    );


  } catch (e) {

    say(
      messageNode ||
      el.rmsg,
      emsg(e),
      false
    );
  }
}


/* ============================================================
   マイページ
   ============================================================ */

function renderMy() {

  const me =
    cache.me;


  if (!me) {

    return;
  }


  if (
    document.activeElement !==
      el.nickInput
  ) {

    el.nickInput.value =
      me.nickname ||
      '';
  }


  if (
    document.activeElement !==
      el.goalInput
  ) {

    el.goalInput.value =
      cache.goal !==
        null
        ? cache.goal.toFixed(1)
        : '';
  }


  if (
    el.notifyOn
  ) {

    el.notifyOn.checked =
      !!me.notify_on;
  }


  if (
    el.notifyDays
  ) {

    el.notifyDays.value =
      String(
        me.notify_days ||
        3
      );
  }


  if (
    el.notifyHour
  ) {

    el.notifyHour.value =
      String(
        me.notify_hour ==
          null
          ? 20
          : me.notify_hour
      );
  }


  el.myMemberId.textContent =
    me.member_id ||
    '—';


  el.myDeviceId.textContent =
    deviceId();


  renderIcon();
}


/* ============================================================
   ブロック一覧
   ============================================================ */

function drawBlocks() {

  el.blockList.innerHTML =
    '';


  if (
    !cache.blocks.length
  ) {

    el.blockList.innerHTML =
      '<li class="empty">ブロックしている人はいません</li>';


    return;
  }


  for (
    const blocked of
    cache.blocks
  ) {

    const li =
      document.createElement(
        'li'
      );


    const avatarNode =
      avatar(
        blocked,
        28
      );


    const name =
      document.createElement(
        'span'
      );


    name.className =
      'd';


    name.textContent =
      blocked.nickname ||
      blocked.member_id;


    const button =
      document.createElement(
        'button'
      );


    button.type =
      'button';


    button.textContent =
      '解除';


    button.onclick =
      async () => {

        const ok =
          await confirmSheet(
            'ブロックの解除',
            `${blocked.nickname || blocked.member_id} のブロックを解除します。通常の表示に再び表示されるようになります。`,
            '解除する'
          );


        if (!ok) {

          return;
        }


        try {

          await api(
            '/api/blocks/' +
            encodeURIComponent(
              blocked.member_id
            ),
            {
              method:
                'DELETE'
            }
          );


          await loadBlocks();


          loadRanking();


          say(
            el.mmsg,
            'ブロックを解除しました',
            true
          );


        } catch (e) {

          say(
            el.mmsg,
            emsg(e),
            false
          );
        }
      };


    li.append(
      avatarNode,
      name,
      button
    );


    el.blockList.appendChild(
      li
    );
  }
}


/* ============================================================
   画面切替
   ============================================================ */

function switchView(view) {

  state.view =
    view;


  $$('.view')
    .forEach(
      node =>
        node.classList.toggle(
          'is-on',
          node.id ===
            'view-' +
            view
        )
    );


  $$('.tabbtn')
    .forEach(
      button =>
        button.classList.toggle(
          'is-on',
          button.dataset.v ===
            view
        )
    );


  el.hdTitle.textContent =
    view ===
      'log'
      ? '体重記録'
      : (
          view ===
            'group'
            ? 'グループ'
            : 'マイページ'
        );


  window.scrollTo(
    0,
    0
  );


  if (
    view ===
      'log'
  ) {

    renderLog();
  }


  if (
    view ===
      'group'
  ) {

    loadWatching();

    loadRanking();
  }


  if (
    view ===
      'my'
  ) {

    renderMy();

    loadBlocks();

    loadIconState();
  }
}


/* ============================================================
   初期配線
   ============================================================ */

function init() {

  const today =
    todayYmdJST();


  el.todayLabel.textContent =
    fmtJpFull(
      today
    ) +
    ' の体重';


  el.pastYmd.max =
    today;


  el.pastYmd.value =
    today;


  el.newStartYmd.value =
    today;


  if (
    el.notifyHour
  ) {

    for (
      let hour = 0;
      hour < 24;
      hour++
    ) {

      const option =
        document.createElement(
          'option'
        );


      option.value =
        String(
          hour
        );


      option.textContent =
        String(
          hour
        )
          .padStart(
            2,
            '0'
          ) +
        ':00';


      el.notifyHour.appendChild(
        option
      );
    }


    el.notifyHour.value =
      '20';
  }


  const bump =
    amount => {

      const keys =
        Object.keys(
          store.all()
        )
          .sort();


      const latest =
        keys.length
          ? store.all()[
              keys[
                keys.length -
                1
              ]
            ]
          : 60;


      const current =
        normKg(
          el.kgInput.value
        );


      const base =
        current ===
          null
          ? latest
          : current;


      el.kgInput.value =
        (
          Math.round(
            (
              base +
              amount
            ) *
            10
          ) /
          10
        )
          .toFixed(1);
    };


  $('#plus').onclick =
    () =>
      bump(
        0.1
      );


  $('#minus').onclick =
    () =>
      bump(
        -0.1
      );


  $('#saveToday').onclick =
    async () => {

      await saveWeight(
        todayYmdJST(),
        el.kgInput.value
      );
    };


  $('#openPast').onclick =
    () => {

      el.pastBox.hidden =
        false;


      el.pastKg.focus();
    };


  $('#closePast').onclick =
    () => {

      el.pastBox.hidden =
        true;
    };


  $('#savePast').onclick =
    async () => {

      const ymd =
        el.pastYmd.value;


      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(
          ymd
        )
      ) {

        say(
          el.msg,
          '日付を選んでください',
          false
        );


        return;
      }


      const ok =
        await saveWeight(
          ymd,
          el.pastKg.value
        );


      if (
        ok
      ) {

        el.pastKg.value =
          '';
      }
    };


  el.tabs.onclick =
    event => {

      const button =
        event.target.closest(
          '.tab'
        );


      if (
        !button
      ) {

        return;
      }


      [
        ...el.tabs.children
      ]
        .forEach(
          tab =>
            tab.classList.toggle(
              'is-on',
              tab ===
                button
            )
        );


      state.period =
        button.dataset.p;


      state.offset =
        0;


      renderLog();
    };


  $('#prevRange').onclick =
    () => {

      state.offset--;


      renderLog();
    };


  $('#nextRange').onclick =
    () => {

      if (
        state.offset <
          0
      ) {

        state.offset++;
      }


      renderLog();
    };


  /* ----------------------------------------------------------
     グループ参加
     ---------------------------------------------------------- */

  $('#doJoin').onclick =
    async () => {

      const code =
        el.joinCode.value
          .trim();


      if (!code) {

        say(
          el.gmsg,
          'コードを入力してください',
          false
        );


        return;
      }


      try {

        await api(
          '/api/groups/join',
          {
            method:
              'POST',

            body: {
              code
            }
          }
        );


        el.joinCode.value =
          '';


        await loadMe();


        loadRanking();


        say(
          el.gmsg2,
          '参加しました',
          true
        );


      } catch (e) {

        say(
          el.gmsg,
          emsg(e),
          false
        );
      }
    };


  /* ----------------------------------------------------------
     グループ作成
     ---------------------------------------------------------- */

  $('#doCreate').onclick =
    async () => {

      const name =
        el.newGroupName.value
          .trim();


      if (!name) {

        say(
          el.gmsg,
          'グループ名を入力してください',
          false
        );


        return;
      }


      const moderation =
        moderate(
          name
        );


      if (
        moderation
      ) {

        say(
          el.gmsg,
          ERR[
            moderation
          ],
          false
        );


        return;
      }


      try {

        await api(
          '/api/groups/create',
          {
            method:
              'POST',

            body: {
              name,

              start_ymd:
                el.newStartYmd.value ||
                undefined,

              show_weight:
                el.newShowWeight.checked,
            },
          }
        );


        await loadMe();


        loadRanking();


        say(
          el.gmsg2,
          'グループを作りました。コードを配ってください',
          true
        );


      } catch (e) {

        say(
          el.gmsg,
          emsg(e),
          false
        );
      }
    };


  /* ----------------------------------------------------------
     コードコピー
     ---------------------------------------------------------- */

  $('#copyCode').onclick =
    async () => {

      const group =
        cache.group;


      const code =
        group
          ? rawCode(
              group.code ||
              group.group_id
            )
          : '';


      if (!code) {

        return;
      }


      try {

        await navigator.clipboard.writeText(
          code
        );


        say(
          el.gmsg2,
          'コードをコピーしました',
          true
        );


      } catch {

        say(
          el.gmsg2,
          'コピーできませんでした。手で入力してください',
          false
        );
      }
    };


  /* ----------------------------------------------------------
     グループ名変更
     ---------------------------------------------------------- */

  $('#renameGroup').onclick =
    async () => {

      const value =
        await promptSheet({
          title:
            'グループ名の変更',

          note:
            '24文字まで。メンバー全員に表示されます。',

          value:
            cache.group
              ? cache.group.name
              : '',

          maxlength:
            24,

          ok:
            '変更する',

          validate:
            input => {

              if (
                !String(
                  input
                ).trim()
              ) {

                return '名前を入力してください';
              }


              const moderation =
                moderate(
                  input
                );


              return moderation
                ? ERR[
                    moderation
                  ]
                : null;
            },
        });


      if (
        value ===
          null
      ) {

        return;
      }


      try {

        await api(
          '/api/groups/rename',
          {
            method:
              'POST',

            body: {
              name:
                value.trim()
            }
          }
        );


        await loadMe();


        loadRanking();


        say(
          el.gmsg2,
          '名前を変更しました',
          true
        );


      } catch (e) {

        say(
          el.gmsg2,
          emsg(e),
          false
        );
      }
    };


  /* ----------------------------------------------------------
     スタート日
     ---------------------------------------------------------- */

  $('#editStart').onclick =
    async () => {

      const value =
        await promptSheet({
          title:
            'スタート日',

          note:
            'この日以降の最初の記録が減量幅の基準になります。スタート日より前の体重はグループ共有の対象になりません。',

          type:
            'date',

          value:
            cache.group
              ? cache.group.start_ymd
              : todayYmdJST(),

          max:
            todayYmdJST(),

          ok:
            '変更する',

          validate:
            input =>
              /^\d{4}-\d{2}-\d{2}$/.test(
                String(
                  input
                ).trim()
              )
                ? null
                : '日付を選んでください',
        });


      if (
        value ===
          null
      ) {

        return;
      }


      try {

        await api(
          '/api/groups/start',
          {
            method:
              'POST',

            body: {
              start_ymd:
                value.trim()
            }
          }
        );


        await loadMe();


        loadRanking();


        say(
          el.gmsg2,
          'スタート日を変更しました',
          true
        );


      } catch (e) {

        say(
          el.gmsg2,
          emsg(e),
          false
        );
      }
    };


  /* ----------------------------------------------------------
     除名リスト
     ---------------------------------------------------------- */

  $('#showBans').onclick =
    async () => {

      try {

        const data =
          await api(
            '/api/groups/bans'
          );


        const bans =
          data.bans ||
          [];


        if (
          !bans.length
        ) {

          say(
            el.gmsg2,
            '除名した人はいません',
            true
          );


          return;
        }


        const index =
          await menuSheet(
            '除名リスト',
            '選ぶと再参加できるように戻します。',
            bans.map(
              item => ({
                label:
                  item.nickname ||
                  item.member_id
              })
            )
          );


        if (
          index <
            0
        ) {

          return;
        }


        const target =
          bans[
            index
          ];


        if (!target) {

          return;
        }


        const ok =
          await confirmSheet(
            '再参加を許可',
            `${target.nickname || target.member_id} が同じコードで再参加できるようになります。`,
            '許可する'
          );


        if (!ok) {

          return;
        }


        await api(
          '/api/groups/unban',
          {
            method:
              'POST',

            body: {
              member_id:
                target.member_id
            }
          }
        );


        say(
          el.gmsg2,
          `${target.nickname || target.member_id} を戻しました`,
          true
        );


      } catch (e) {

        say(
          el.gmsg2,
          emsg(e),
          false
        );
      }
    };


  /* ----------------------------------------------------------
     解散
     ---------------------------------------------------------- */

  $('#dissolveGroup').onclick =
    async () => {

      const ok =
        await confirmSheet(
          'グループを解散',
          'メンバー全員がグループ無しになります。体重の記録は残ります。取り消せません。',
          '解散する',
          true
        );


      if (!ok) {

        return;
      }


      try {

        await api(
          '/api/groups/dissolve',
          {
            method:
              'POST'
          }
        );


        await loadMe();


        loadRanking();


        say(
          el.gmsg,
          '解散しました',
          true
        );


      } catch (e) {

        say(
          el.gmsg2,
          emsg(e),
          false
        );
      }
    };


  /* ----------------------------------------------------------
     グループ退出
     ---------------------------------------------------------- */

  $('#leaveGroup').onclick =
    async () => {

      const ok =
        await confirmSheet(
          'グループを抜ける',
          '体重の記録は残ります。もう一度参加するには参加コードが必要です。',
          '抜ける',
          true
        );


      if (!ok) {

        return;
      }


      try {

        await api(
          '/api/groups/leave',
          {
            method:
              'POST'
          }
        );


        await loadMe();


        loadRanking();


        say(
          el.gmsg,
          '抜けました',
          true
        );


      } catch (e) {

        say(
          el.gmsg2,
          emsg(e),
          false
        );
      }
    };


  /* ----------------------------------------------------------
     ランキングタブ
     ---------------------------------------------------------- */

  el.rankTabs.onclick =
    event => {

      const button =
        event.target.closest(
          '.tab'
        );


      if (!button) {

        return;
      }


      [
        ...el.rankTabs.children
      ]
        .forEach(
          tab =>
            tab.classList.toggle(
              'is-on',
              tab ===
                button
            )
        );


      state.rank =
        button.dataset.r;


      el.watchNav.hidden =
        state.rank !==
          'watch';


      loadRanking();
    };


  el.watchSel.onchange =
    () => {

      state.watchId =
        el.watchSel.value;


      loadRanking();
    };


  $('#addWatch').onclick =
    () =>
      addWatchByCode(
        el.rmsg
      );


  const addWatch2 =
    $('#addWatch2');


  if (
    addWatch2
  ) {

    addWatch2.onclick =
      () =>
        addWatchByCode(
          el.rmsg
        );
  }


  /* ----------------------------------------------------------
     アイコン
     ---------------------------------------------------------- */

  if (
    el.iconPick &&
    el.iconFile
  ) {

    el.iconPick.onclick =
      () =>
        el.iconFile.click();
  }


  if (
    el.iconFile
  ) {

    el.iconFile.onchange =
      () => {

        const file =
          el.iconFile.files &&
          el.iconFile.files[0];


        el.iconFile.value =
          '';


        if (
          file
        ) {

          uploadIcon(
            file
          );
        }
      };
  }


  if (
    el.iconDel
  ) {

    el.iconDel.onclick =
      removeIcon;
  }


  /* ----------------------------------------------------------
     ニックネーム
     ---------------------------------------------------------- */

  $('#saveNick').onclick =
    async () => {

      const value =
        el.nickInput.value
          .trim();


      if (!value) {

        say(
          el.mmsg,
          'ニックネームを入力してください',
          false
        );


        return;
      }


      const moderation =
        moderate(
          value
        );


      if (
        moderation
      ) {

        say(
          el.mmsg,
          ERR[
            moderation
          ],
          false
        );


        return;
      }


      try {

        await api(
          '/api/me',
          {
            method:
              'PATCH',

            body: {
              nickname:
                value
            }
          }
        );


        await loadMe();


        say(
          el.mmsg,
          '保存しました',
          true
        );


      } catch (e) {

        say(
          el.mmsg,
          emsg(e),
          false
        );
      }
    };


  /* ----------------------------------------------------------
     目標体重
     ---------------------------------------------------------- */

  $('#saveGoal').onclick =
    () => {

      if (
        !cache.ready
      ) {

        say(
          el.mmsg,
          'サーバーに接続中です',
          false
        );


        return;
      }


      const raw =
        el.goalInput.value
          .trim();


      if (
        raw ===
          ''
      ) {

        store.setGoal(
          null
        );


        renderLog();


        say(
          el.mmsg,
          '目標を解除しました',
          true
        );


        return;
      }


      const value =
        normKg(
          raw
        );


      if (
        value ===
          null
      ) {

        say(
          el.mmsg,
          '目標体重を 20〜300kg で入力してください',
          false
        );


        return;
      }


      store.setGoal(
        value
      );


      el.goalInput.value =
        value.toFixed(1);


      renderLog();


      say(
        el.mmsg,
        '目標を保存しました',
        true
      );
    };


  /* ----------------------------------------------------------
     通知設定
     ---------------------------------------------------------- */

  const saveNotify =
    $('#saveNotify');


  if (
    saveNotify
  ) {

    saveNotify.onclick =
      async () => {

        try {

          await api(
            '/api/me',
            {
              method:
                'PATCH',

              body: {
                notify_on:
                  el.notifyOn.checked,

                notify_days:
                  Number(
                    el.notifyDays.value
                  ),

                notify_hour:
                  Number(
                    el.notifyHour.value
                  ),
              },
            }
          );


          await loadMe();


          say(
            el.nmsg,
            '通知設定を保存しました',
            true
          );


        } catch (e) {

          say(
            el.nmsg,
            emsg(e),
            false
          );
        }
      };
  }


  /* ----------------------------------------------------------
     端末IDコピー
     ---------------------------------------------------------- */

  $('#copyDeviceId').onclick =
    async () => {

      try {

        await navigator.clipboard.writeText(
          deviceId()
        );


        say(
          el.dmsg,
          '端末IDをコピーしました',
          true
        );


      } catch {

        say(
          el.dmsg,
          'コピーできませんでした',
          false
        );
      }
    };


  /* ----------------------------------------------------------
     データ削除
     ---------------------------------------------------------- */

  $('#deleteAll').onclick =
    async () => {

      const first =
        await confirmSheet(
          '利用データの削除',
          '体重記録、目標体重、ニックネーム、プロフィール画像、グループ所属、体重公開設定、外部WEB連携への同意など通常の利用データを削除します。取り消せません。',
          '次へ進む',
          true
        );


      if (
        !first
      ) {

        return;
      }


      const second =
        await confirmSheet(
          '本当に削除しますか？',
          'この端末の通常の利用データはサーバーからも削除されます。元に戻すことはできません。',
          '削除する',
          true
        );


      if (
        !second
      ) {

        return;
      }


      try {

        await api(
          '/api/me',
          {
            method:
              'DELETE'
          }
        );


        /*
         * 削除後に単純reloadすると
         * 新しいdevice_idが生成され、
         * /api/register で即再登録されてしまう。
         *
         * 削除済み状態を保持して、
         * 本人が「新しく始める」を押すまで
         * API登録を停止する。
         */
        markDeletedState();


        deletedMode();


      } catch (e) {

        say(
          el.dmsg,
          emsg(e),
          false
        );
      }
    };


  /* ----------------------------------------------------------
     下部タブ
     ---------------------------------------------------------- */

  $$('.tabbtn')
    .forEach(
      button => {

        button.onclick =
          () =>
            switchView(
              button.dataset.v
            );
      }
    );


  window.addEventListener(
    'resize',
    () => {

      if (
        state.view ===
          'log'
      ) {

        drawChart();
      }
    }
  );


  renderLog();
}


/* ============================================================
   起動
   ============================================================ */

async function boot() {

  /*
   * 削除済みなら登録処理へ入らない。
   */
  if (
    isDeletedState()
  ) {

    deletedMode();

    return;
  }


  try {

    await api(
      '/api/register',
      {
        method:
          'POST',

        body: {
          device_id:
            deviceId()
        }
      }
    );


    await Promise.all([
      loadWeights(),
      loadMe()
    ]);


    cache.ready =
      true;


    await loadIconState();


    const today =
      todayYmdJST();


    if (
      cache.weights[
        today
      ] !==
        undefined
    ) {

      el.kgInput.value =
        cache.weights[
          today
        ]
          .toFixed(1);
    }


    renderLog();


    clearMsg(
      el.msg
    );


  } catch (err) {

    /*
     * 削除済みは通信エラーとして扱わない。
     */
    if (
      err &&
      err.message ===
        'account_deleted'
    ) {

      deletedMode();

      return;
    }


    /*
     * 利用停止は通信エラーではない。
     *
     * 通常画面には入れず、
     * データ削除とサポートだけ表示する。
     */
    if (
      err &&
      err.message ===
        'banned'
    ) {

      await bannedMode();


      return;
    }


    say(
      el.msg,
      'サーバーに接続できません：' +
      emsg(err),
      false
    );


    const ok =
      await confirmSheet(
        '接続できませんでした',
        'みんやせは記録の保存にインターネット接続が必要です。電波状況をご確認のうえ、もう一度お試しください。',
        'もう一度試す'
      );


    if (
      ok
    ) {

      boot();
    }
  }
}


async function start() {

  init();


  /*
   * データ削除後はここで完全に停止。
   *
   * 本人が「新しく始める」を押すまで、
   * device_id生成・規約同意・registerを行わない。
   */
  if (
    isDeletedState()
  ) {

    deletedMode();

    return;
  }


  /*
   * B-3:
   *
   * 最新規約へ未同意の既存BANユーザーが
   * 「同意しないと削除できない」状態になるのを防ぐ。
   *
   * 新規ユーザーの場合は /api/me が
   * not_registered を返すだけなので、
   * 同意前にサーバー登録は行わない。
   */
  if (
    await checkBannedBeforeAgreement()
  ) {

    return;
  }


  await ensureAgreed();


  boot();
}


start();
