# 店舗サポート 報告書アプリ

店舗サポート事業部の清掃等の作業報告書を **携帯だけで完結** して作成するツール。
店舗・日時・担当・項目カテゴリを選び、各作業の **施工前 / 施工後** 写真と特記事項を入力 →
**「完了」で PDF を生成し、LINE へ自動送信**します。

- 公開URL（GitHub Pages）: https://moko-04.github.io/store-support-report/
- 携帯のブラウザで開き「ホーム画面に追加」すると簡易アプリとして使えます。

## 技術構成
- **単一HTMLファイル `index.html`**。ビルド不要。React 18 + Babel standalone + Tailwind +
  **html2canvas + jsPDF**（PDF生成）をすべて CDN 読込、ブラウザ実行。
- 保存は **localStorage**（キー接頭辞 `ssr_`）のみ。**ログイン無し・クラウドDB無し**。
- **LINE自動送信は Google Apps Script（GAS）経由**（`gas/Code.gs`）。GAS未設定でも
  端末の共有シート / ダウンロードで完結（オフライン可）。

## 画面
- **作成**（2ステップ）：① 店舗 / 日時 / 担当（複数チップ）→ ② 作業項目（カテゴリ＋施工前後の写真＋メモ）を複数 → 特記事項 → **完了して送信**。
- **履歴**：過去の報告書一覧。PDF再共有・（送信済みなら）PDFリンク・削除。
- **設定**：担当者 / 店舗 / 項目カテゴリ（▲▼で並び替え）/ 店舗ごとの定番項目 のマスタ編集。

## 実行（ローカル）
- `node server.js` → http://localhost:4322
- または `index.html` を Chrome で直接開く（CDN利用のためネット必要）。

## 「完了 → LINE送信」の仕組み
```
[携帯ブラウザ index.html]
  完了 → PDF生成(html2canvas+jsPDF) + 表紙画像 + テキスト要約
     │  POST（報告内容 + PDF/画像の base64）
     ▼
[GAS Webアプリ doPost]  ← LINEトークンは Script Properties(サーバー側) に保持
  ├ PDF/画像を Google Drive に保存し公開リンク取得
  └ LINE Messaging API へ push（テキスト＋PDFリンク＋表紙画像 best-effort）
     ▼
[LINEグループ] に完了報告が届く
```
- LINE はメッセージで PDF を直接添付できないため、**PDFはリンク**＋表紙画像で送付（PDF内に施工前後の全写真あり）。
- 表紙画像のインライン表示は Drive 直リンク依存のため best-effort（出なくてもテキスト＋PDFリンクは確実に届く）。
- GAS未設定（`GAS_URL` が空）/ 送信失敗時は、端末の **共有シート（Web Share）** か **ダウンロード** にフォールバック。

## セットアップ（LINE自動送信を使う場合）
### 1. LINE Messaging API
1. [LINE Developers](https://developers.line.biz/) で **Messaging API チャネル**（LINE公式アカウント）を作成。
2. **チャネルアクセストークン（長期）** を発行。
3. 送信先（グループ or ユーザー）の **ID** を取得（公式アカウントを送りたいグループに招待し、Webhookで受け取る `groupId`。1対1なら `userId`）。

### 2. Google Apps Script（中継サーバー）
1. [script.google.com](https://script.google.com) で新規プロジェクト → `gas/Code.gs` の内容を貼り付け。
2. 「プロジェクトの設定」→「スクリプト プロパティ」に登録：
   - `LINE_CHANNEL_ACCESS_TOKEN` = 長期アクセストークン
   - `LINE_TO` = 送信先ID（`Cxxxx` / `Uxxxx`）
   - （任意）`DRIVE_FOLDER_ID` = 保存先Driveフォルダ。未設定なら「店舗サポート報告書」フォルダを自動作成。
3. 「デプロイ」→「新しいデプロイ」→ **ウェブアプリ**（実行＝自分 / アクセス＝全員）→ 発行された `.../exec` URL を控える。

### 3. アプリに接続
- `index.html` 上部の `GAS_URL` に、控えた `.../exec` URL を貼る → push して反映。
- トークン等の秘密は **GAS側（Script Properties）にのみ** 保持。リポジトリ・クライアントには公開URLしか置かない。

## データモデル
- マスタ（localStorage）：`staff[]` / `stores[]` / `categories[]`（順序保持）/ `storeDefaults{ 店舗: [カテゴリ] }`
- 報告書 `report`：`{ id, store, date, staff[], items:[{category, before[], after[], note}], note, createdAt, pdfUrl? }`
  - 写真は端末では縮小JPEGの dataURL。送信時は GAS が Drive に保存して公開URL化。

## 公開（GitHub Pages）
- `main` / root 配信、`.nojekyll` 同梱、HTTPS。公開URLは上記。
- コードを `main` に push すると数十秒で反映されます。
