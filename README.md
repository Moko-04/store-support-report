# 店舗サポート 報告書アプリ

店舗サポート事業部の清掃等の作業報告書を **携帯だけで完結** して作成するツール。
店舗・日付・担当を選び、各作業の **施工前 / 施工後** 写真と特記事項を入力 →
**「完了」で PDF を生成し、LINE へ自動送信**します。

- 公開URL（GitHub Pages）: https://moko-04.github.io/store-support-report/
- 携帯のブラウザで開き「ホーム画面に追加」すると簡易アプリとして使えます。

## 技術構成
- **単一HTMLファイル `index.html`**。ビルド不要。
- UI は **Preact + hooks + htm（合計 約8KB）** ＋ 自前CSS。React/Babel/Tailwind は使わない。
  → 端末側でのJSXコンパイルや巨大CDNの読み込みが無く、モバイル回線でも初回表示が速い
    （実測：スクリプト 8KB / DOMContentLoaded 約40ms）。
- **PDF生成ライブラリ（html2canvas + jsPDF）は「完了」を押した時だけ読み込む**（遅延読込）。
- 保存はすべて端末内。**ログイン・クラウドDBなし**。
  - マスタ（担当者・店舗・カテゴリ）→ localStorage（キー接頭辞 `ssr_`）
  - 下書き・履歴（写真を含み大きい）→ **IndexedDB**（`ssr-db` / ストア `kv`）
    localStorage の 5MB 制限で写真つきデータの保存が失敗するのを回避するため。
    旧版の localStorage データは初回起動時に自動で引き継がれます。
- **LINE自動送信は Google Apps Script（GAS）経由**（`gas/Code.gs`）。GAS未設定でも
  端末の共有シート / ダウンロードで完結（オフライン可）。

## 画面（下部4タブ）
- **📝作成**（2ステップ）：① 店舗 / 日付 / 担当（複数チップ）→ ② 作業項目（カテゴリ＋施工前後の写真＋メモ）→ 特記事項 → **完了して送信**。
  - 項目一覧は 完了=緑✓＋枚数 / 写真不足=橙! / 未入力=灰＋ で状態表示。
  - 「完了して送信」ボタンは画面下に固定され、スクロール不要でいつでも押せる。
- **📋作成中**：入力途中の下書きを表示。「続きから編集」「削除」。下書きがあるとタブに●が付く。
- **🗂履歴**：過去の報告書一覧。PDF再共有 /（送信済みなら）PDFリンク / 削除。
- **⚙️設定**：担当者 / 店舗 / 項目カテゴリ（▲▼で並び替え）/ 店舗ごとの定番項目。

## 自動保存
作成画面の入力（店舗・日付・担当・写真・メモ・特記事項）は入力のたびに自動保存されます。
タブを切り替えても、ブラウザを閉じても、次に開いたときに続きから再開できます。

## 実行（ローカル）
- `node server.js` → http://localhost:4322
- または `index.html` を Chrome で直接開く（CDN利用のためネット必要）。

## 「完了 → LINE送信」の仕組み
```
[携帯ブラウザ index.html]
  完了 → PDF生成（html2canvas + jsPDF、作業項目ごとにブロック化して改ページ）
     │  POST（テキスト要約 + PDFのbase64）※Content-Type: text/plain（CORSプリフライト回避）
     ▼
[GAS Webアプリ doPost]  ← LINEトークン / 送信先IDは Script Properties（サーバー側）に保持
  ├ PDFを Google Drive に保存し公開リンクを取得
  └ LINE Messaging API へ push
     ▼
[LINEグループ] に「テキスト要約 ＋ PDFリンク」が届く
```
- LINE はメッセージで PDF を直接添付できないため **PDFはリンク**で送付（写真はPDF内に全て含まれる）。
- 写真自体のLINE添付は行いません。
- GAS未設定（`GAS_URL` が空）/ 送信失敗時は、端末の **共有シート（Web Share）** か **ダウンロード** にフォールバック。

## PDFレイアウト
- A4縦・余白10mm。ヘッダー表（店舗 / 日付 / 担当）＋ 作業ごとに施工前・施工後を左右に並べる。
- 写真は `object-fit: contain` で全体を表示（縦撮りでもトリミングしない）。
- **作業項目ごとにブロック単位で改ページ**するため、項目や写真がページ境界で切れません。

## セットアップ（LINE自動送信）
### 1. LINE Messaging API
1. [LINE Developers](https://developers.line.biz/) で **Messaging API チャネル**（LINE公式アカウント）を作成。
2. **チャネルアクセストークン（長期）** を発行。
3. 送信先グループの **ID**（`Cxxxx`）を取得し控える。
   - GAS は仕様上 302 を返すため LINE の Webhook 検証を通せません。グループIDは
     [webhook.site](https://webhook.site) 等を一時的に Webhook URL に設定して一度だけ取得します。

### 2. Google Apps Script（中継）
1. [script.google.com](https://script.google.com) で新規プロジェクト → `gas/Code.gs` の内容を貼り付け。
2. 「プロジェクトの設定」→「スクリプト プロパティ」に登録：
   - `LINE_CHANNEL_ACCESS_TOKEN` = 長期アクセストークン
   - `LINE_TO` = 送信先ID（`Cxxxx` / `Uxxxx`）
   - （任意）`DRIVE_FOLDER_ID` = 保存先Driveフォルダ。未設定なら「店舗サポート報告書」フォルダを自動作成。
3. 「デプロイ」→「新しいデプロイ」→ **ウェブアプリ**
   （実行＝自分 / **アクセス＝全員**）→ 発行された `.../exec` URL を控える。
   - ⚠️ アクセスが「自分のみ」だとログイン画面が返り送信できません。
   - ⚠️ コード修正後は「**デプロイを管理 → 編集 → 新バージョン**」で再デプロイ（URL不変）。
     「新しいデプロイ」を選ぶと **URLが変わる** ので注意。

### 3. アプリに接続
- `index.html` 上部の `GAS_URL` に `.../exec` URL を設定 → push して反映。
- トークン等の秘密は **GAS側（Script Properties）にのみ** 保持。リポジトリには公開URLしか置かない。

## データモデル
- マスタ（localStorage）：`staff[]` / `stores[]` / `categories[]`（順序保持）/ `storeDefaults{ 店舗: [カテゴリ] }`
  - アプリ内の初期値（担当者・店舗・カテゴリ）は保存済みリストに自動でマージされます。
- 下書き（IndexedDB `draft`）：`{ step, store, date, staff[], items[], editingId, note }`
- 報告書（IndexedDB `reports`）：`{ id, store, date, staff[], items:[{category, before[], after[], note}], note, createdAt, sent, pdfUrl? }`
  - 写真は長辺1400px・JPEG(品質0.82)に縮小した dataURL。

## 公開（GitHub Pages）
- `main` / root 配信、`.nojekyll` 同梱、HTTPS。コードを `main` に push すると数十秒で反映。
- HTMLにキャッシュ無効化の meta を入れているため、更新後に古い画面が残りにくくなっています。

## 旧版に戻す
リビルド前のバージョンはタグ `v1-old` で残しています（`git checkout v1-old -- index.html`）。
