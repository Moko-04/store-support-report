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
 *      LINE_CHANNEL_ACCESS_TOKEN = LINE Messaging API の長期チャネルアクセストークン
 *      LINE_TO                   = 送信先のグループID または ユーザーID（例 Cxxxx / Uxxxx）
 *      DRIVE_FOLDER_ID           = (任意) 保存先Driveフォルダの ID。未設定ならマイドライブ直下に
 *                                  「店舗サポート報告書」フォルダを自動作成。
 * 3. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *      ・実行するユーザー：自分
 *      ・アクセスできるユーザー：全員
 *    → 発行された .../exec の URL を index.html の GAS_URL に貼る。
 *    （コード変更後は毎回「デプロイを管理」→ 編集 → バージョン＝新規 で再デプロイ）
 *
 * ※ Drive のファイルは「リンクを知っている全員が閲覧可」になります（写真をLINEに出すため）。
 *    URLを知らない人には見えませんが、共有範囲は運用方針に合わせて調整してください。
 */

var FOLDER_NAME = '店舗サポート報告書';

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
    var to = props.getProperty('LINE_TO');
    if (!token || !to) {
      return json({ error: 'LINE_CHANNEL_ACCESS_TOKEN / LINE_TO がスクリプトプロパティに未設定です。' });
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

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
