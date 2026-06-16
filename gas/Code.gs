/**
 * 店舗サポート報告書 → LINE 自動送信 中継 (Google Apps Script)
 * --------------------------------------------------------------
 * index.html の「完了」から POST され、PDF/表紙画像を Google Drive に保存して
 * 公開リンクを作り、LINE Messaging API でグループ/ユーザーへ push する。
 * LINEトークン等の秘密は Script Properties(サーバー側) にのみ保持し、クライアントには出さない。
 *
 * 【セットアップ手順】
 * 1. https://script.google.com で「新しいプロジェクト」→ このコードを丸ごと貼り付け。
 * 2. 左の歯車「プロジェクトの設定」→「スクリプト プロパティ」に以下を追加：
 *      LINE_CHANNEL_ACCESS_TOKEN = LINE Messaging API の長期チャネルアクセストークン（必須）
 *      DRIVE_FOLDER_ID           = (任意) 保存先Driveフォルダの ID。未設定ならマイドライブ直下に
 *                                  「店舗サポート報告書」フォルダを自動作成。
 *    ※ 送信先 LINE_TO は下記4のWebhookで自動登録される（手動設定も可：グループID/ユーザーID）。
 * 3. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *      ・実行するユーザー：自分
 *      ・アクセスできるユーザー：全員
 *    → 発行された .../exec の URL を index.html の GAS_URL に貼る。
 *    （コード変更後は毎回「デプロイを管理」→ 編集 → バージョン＝新規 で再デプロイ）
 * 4. 送信先グループの自動登録：
 *      ・LINE Developers → Messaging API →「Webhook URL」に上の /exec URL を設定し「Webhookの利用」をON。
 *      ・LINE公式アカウントを送りたいグループに招待すると、自動でそのグループが送信先(LINE_TO)に登録され
 *        「設定しました」と返信が来る。送信先を変えるときは、そのトークで「登録」とメッセージを送る。
 *
 * ※ Drive のファイルは「リンクを知っている全員が閲覧可」になります（写真をLINEに出すため）。
 *    URLを知らない人には見えませんが、共有範囲は運用方針に合わせて調整してください。
 */

var FOLDER_NAME = '店舗サポート報告書';

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var props = PropertiesService.getScriptProperties();

    // --- LINEからのWebhook：送信先(グループ等)を自動登録する ---
    if (body.events) {
      handleWebhook_(body.events, props);
      return json({ ok: true });
    }

    // --- アプリ(index.html)からの報告送信 ---
    var token = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
    var to = props.getProperty('LINE_TO');
    if (!token || !to) {
      return json({ error: 'LINE_CHANNEL_ACCESS_TOKEN / LINE_TO が未設定です（公式アカウントを送信先グループに追加して登録してください）。' });
    }

    var folder = getFolder_(props);
    var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss');

    // --- PDF を Drive に保存して閲覧リンクを取得 ---
    var pdfUrl = '';
    if (body.pdfBase64) {
      var pdfName = body.filename || ('report_' + stamp + '.pdf');
      var pdfFile = folder.createFile(Utilities.newBlob(Utilities.base64Decode(body.pdfBase64), 'application/pdf', pdfName));
      pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      pdfUrl = 'https://drive.google.com/file/d/' + pdfFile.getId() + '/view';
    }

    // --- メッセージ1：テキスト要約＋PDFリンク（確実に届く本体）---
    var text = (body.text || '作業報告');
    if (pdfUrl) text += '\nPDF: ' + pdfUrl;
    pushLine_(token, to, [{ type: 'text', text: text.slice(0, 4900) }]);

    // --- メッセージ2：表紙画像（best-effort。失敗してもテキストは送信済み）---
    if (body.coverBase64) {
      try {
        var imgFile = folder.createFile(Utilities.newBlob(Utilities.base64Decode(body.coverBase64), 'image/jpeg', 'cover_' + stamp + '.jpg'));
        imgFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        var imgUrl = 'https://lh3.googleusercontent.com/d/' + imgFile.getId();
        pushLine_(token, to, [{ type: 'image', originalContentUrl: imgUrl, previewImageUrl: imgUrl }]);
      } catch (imgErr) {
        // 画像は任意。Drive直リンクをLINEが弾く場合があるが、報告本体は成立しているので無視。
      }
    }

    return json({ ok: true, pdfUrl: pdfUrl });
  } catch (err) {
    return json({ error: String((err && err.message) || err) });
  }
}

/** 動作確認用（ブラウザでURLを開くと表示）。LINE送信はしない。 */
function doGet() {
  return json({ ok: true, service: 'store-support-report LINE relay' });
}

function getFolder_(props) {
  var id = props.getProperty('DRIVE_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function pushLine_(token, to, messages) {
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: to, messages: messages }),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code >= 300) throw new Error('LINE push 失敗 ' + code + ': ' + res.getContentText());
}

/** LINE Webhook を処理し、送信先(グループ/ルーム/ユーザー)を LINE_TO に登録する。 */
function handleWebhook_(events, props) {
  (events || []).forEach(function (ev) {
    var src = ev.source || {};
    var id = src.groupId || src.roomId || src.userId;
    if (!id) return;
    // bot がグループ等に追加された(join)時、または「登録」とメッセージされた時に送信先を更新
    var isJoin = ev.type === 'join';
    var isRegister = ev.type === 'message' && ev.message && ev.message.type === 'text' && (ev.message.text || '').trim() === '登録';
    if (!isJoin && !isRegister) return;
    props.setProperty('LINE_TO', id);
    var token = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
    if (token && ev.replyToken) {
      try {
        UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
          method: 'post', contentType: 'application/json',
          headers: { Authorization: 'Bearer ' + token },
          payload: JSON.stringify({ replyToken: ev.replyToken, messages: [{ type: 'text', text: '✅ このトークを報告書の送信先に設定しました。' }] }),
          muteHttpExceptions: true,
        });
      } catch (e) { /* 返信失敗は無視 */ }
    }
  });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
