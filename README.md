# 矢印一発（yajirushi-ippatsu）

スクリーンショットに矢印・枠・マーカー・文字ラベルを入れて、PNG で保存／共有できる PWA。Canvas ベースで、指でも操作しやすい作りです。

**無料・広告なし・ログイン不要・通信なし・アナリティクスなし。** 一度開けばオフラインで動きます。UI は日本語が初期設定で、右上で 日本語 / English を切り替えられます（`yajirushi-ippatsu-lang`）。

## 主な機能

- 画像を開く：ファイル選択・貼り付け・ドロップ・Android の共有メニュー（Web Share Target）
- ツール：矢印・枠・マーカー（半透明）・文字ラベル
- 6色 × 3サイズ。選択中の図形にも色・サイズを反映
- 選択ツールでタップして選択・ドラッグで移動・削除、文字の再編集
- 元に戻す（最大100手）
- PNG で保存、または共有（Web Share API）
- 設定（ツール・色・サイズ）だけ localStorage（`yajirushi-ippatsu:prefs`）に保存

## 共有メニューから開く（Web Share Target）

ホーム画面に追加（インストール）すると、Android Chrome ではギャラリーやスクショの「共有」先にこのアプリが表示されます。共有された画像は Service Worker が端末内の Cache Storage に一時保存し、アプリが読み込んだらすぐ削除します（`public/share-target-sw.js`）。未インストール時や iOS ではファイル選択をお使いください。

## 使い方（開発）

```bash
npm install
npm run dev       # Vite 開発サーバー
npm run build     # 型チェック + 本番ビルド → dist/
npm run preview   # 本番ビルドのプレビュー
```

## デプロイ

GitHub Pages：`.github/workflows/pages.yml`（npm ci → build → `dist` をアップロード → deploy-pages）。`base: './'` なのでサブパス（`/yajirushi-ippatsu/`）でも動きます。

## プライバシー

データはすべてこの端末のブラウザ内にだけ保存されます。サーバー・外部 API・トラッキング・広告は一切ありません。

---

## English

**Arrow Now** — Add arrows, boxes, highlighter and text labels to a screenshot, then save or share it as PNG. Canvas-based and touch-friendly.

Free, no ads, no login, no network calls, no analytics. Works fully offline once loaded and can be installed to the home screen as a PWA. The UI defaults to Japanese; switch 日本語 / English at the top right.

- Open via file picker, paste, drag-and-drop, or Android’s share sheet (Web Share Target)
- Tools: arrow, box, highlighter, text label
- 6 colours × 3 sizes; changes also apply to the selected shape
- Select tool: tap to select, drag to move, delete, edit text
- Undo (up to 100 steps)
- Save or share as PNG
- Only preferences are stored (localStorage `yajirushi-ippatsu:prefs`)

### Share target

Once installed on Android Chrome, the app appears in the share sheet. The shared image is held briefly in Cache Storage on the device by the service worker (`public/share-target-sw.js`) and removed as soon as the app picks it up. Otherwise use the file picker.

Tech: Vite + vanilla TypeScript + `vite-plugin-pwa` (`registerType: 'autoUpdate'`, `base: './'`). Deploys to GitHub Pages via `.github/workflows/pages.yml`.
