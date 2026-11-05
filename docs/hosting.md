# Firebase Hostingで共有する

**共有URL：[https://tour-513804.web.app/](https://tour-513804.web.app/)**

既存のFirebaseプロジェクト `tour-513804` に、Web画面の公開用ファイルだけを配置する。GitHub Actions / Pagesは使わない。Firebase Hostingの設定は `firebase.json`、接続先のプロジェクトは `.firebaserc` で管理する。

## 公開する範囲

地図のデザインプレビューと架空のサンプル問題、Firebase AuthenticationのGoogleログイン・ログアウト・状態復元、端末内の撮影・写真確認・撮影時GPS確認画面を共有する。地図はGoogle Mapsではない。写真とGPSは送信・保存しない。写真判定、クリア確定、本人記録は未実装。

自治体向けの[素材登録・編集・表示確認デモ](https://tour-513804.web.app/admin-demo)も公開する。未認証の架空データ用フォームで、入力や写真は画面内だけに保持し、保存・AI・公開APIには接続しない。

公開ビルドでは `VITE_QUEST_DATA_SOURCE=preview` を使う。ローカルAPI用のサーバーはHostingへ公開せず、`local-api` モードも本番では使わない。Firestore / Storage / Functionsの作成や公開ルールの変更は含まない。

## 初回準備

リポジトリ指定のNodeとnpmを使い、作業ツリーの変更を確認してから実行する。

```sh
npm ci
cp .env.example .env.production.local
```

`.env.production.local` の `VITE_FIREBASE_` で始まる6項目を、対象Webアプリの設定で埋める。設定値の対応は [Firebase接続手順](firebase-auth.md) を参照する。`VITE_QUEST_DATA_SOURCE=preview` にする。実設定ファイル・元JSON・CLIの認証情報はコミットしない。Firebase Web用設定はブラウザに含まれるため、サーバーの秘密鍵やAIの認証情報を入れない。

公式Firebase CLIに、対象プロジェクトへの公開権限がある本人のGoogleアカウントでログインする。メンバー間でGoogleパスワードを共有しない。

```sh
npm exec --yes --package=firebase-tools@15.35.0 -- firebase login
```

Firebase Authenticationの承認済みドメインに公開先のホスト名があることを確認する。ポートやパスは入れない。Googleログインの問い合わせ先と、ログイン可能な利用者の設定は別物。

## 更新して公開

```sh
npm run check
npm exec --yes --package=firebase-tools@15.35.0 -- firebase deploy --only hosting --project tour-513804
```

`npm run check` は型検査・lint・テスト・ビルドを行い、`dist` を生成する。Hostingにはこの `dist` 内のHTML・JavaScript・CSS・地図画像だけを送る。元コード、`.env`、`server` フォルダを公開ディレクトリにしない。

`--only hosting` により公開範囲をWeb配信に限定する。CLIのログインやWeb設定の変更はGitHubへのpushだけでは反映されない。アプリを更新した後は、再ビルドと再公開が必要。

## 公開後に確認

- 共有用のHTTPS URLを別のブラウザから開き、問題を未ログインで閲覧できる。
- Googleログインの画面を開ける。本人が認証した後も元の問題に戻り、再読み込みで状態が復元され、ログアウトできる。
- 写真判定・保存が準備中と表示される。撮影を使う場合は端末でカメラを許可し、終了後に停止することを確認する。
- 設定ファイル・秘密情報を公開対象へ含めない。ブラウザ用Firebase設定は認証・認可の代わりにはならない。

画面を開けることと、実ログイン・実スマートフォンでの撮影確認は区別して記録する。公開先と実際に確認した範囲は、この手順の末尾へ追記する。

## 公式資料

- [Firebase Hostingの開始手順](https://firebase.google.com/docs/hosting/quickstart)
- [Googleログイン](https://firebase.google.com/docs/auth/web/google-signin)

## 初回公開の確認記録

2026-11-05、mainの `98a25c6` を元に、Hosting用の設定を追加して公開した。`npm run check` は型検査・lint・124テスト・ビルドが成功。公開対象はHTML・JavaScript・CSS・地図SVG2点の計5ファイルで、全ファイルがHTTPSで200を返し、検証したローカル成果物と内容が一致した。

公開URLで未ログインの画面表示とサンプル問題の開閉、ChromeでGoogleアカウント選択画面まで進むことを確認した。公開ホスト `tour-513804.web.app` はFirebase Authenticationの承認済みドメインに登録済み。実Googleアカウントの認証完了後の状態復元・ログアウト、実スマートフォンのカメラ操作はこの公開作業では未検証。

## 最新版への更新記録

2026-11-05、mainの `2f7924d`（PR #14まで）を取り込み、同じ共有URLへ再公開した。自治体向けの `/admin-demo` と、撮影時のGPS情報を端末内に保持する変更を含む。公開用の `preview` モードを維持し、ローカルのサーバーAPIは公開していない。

`npm run check` は型検査・lint・179テスト・ビルドが成功。公開した8ファイル全てがHTTPS 200で検証済み成果物とSHA-256で一致し、`/admin-demo` の直接アクセスも成功。実Chromeで旅行者画面と自治体向けデモの表示を確認した。実Google認証の完了操作、GPS取得、実スマートフォンでの撮影はこの更新作業では試していない。

## Neobrutalism版への更新記録

2026-11-05、mainの `7f25f25`（UI更新のPR #21）から公開用にビルドし、同じ共有URLへ再公開した。旅行者画面と `/admin-demo` をNeobrutalismへ統一した版で、既存のFirebase Web設定と `VITE_QUEST_DATA_SOURCE=preview` を引き継いだ。更新先はHostingだけで、ローカルAPI・Firestore・Storage・Functionsの公開や設定変更は行っていない。

`npm run check` は型検査・lint・223テスト・ビルドが成功。公開対象の8ファイル全てがHTTPS 200でローカル成果物とSHA-256で一致し、`/` と `/admin-demo` の直接アクセスも成功した。実ChromeでPC・スマホ幅の計5表示を確認し、Neobrutalismの配色、問題の開閉、ゲスト閲覧状態、Googleログイン用ボタンが有効であることを確認した。

実Google認証の完了、実スマートフォンの撮影・GPS取得は今回未検証。MinimalismとGlassmorphismの比較案はローカルにのみ保持し、公開していない。

## 補助説明を整理した版への更新記録

2026-11-05、mainの `924f3ce`（PR #25）を同じ共有URLへ公開した。重複する補助説明を減らし、問題カードの地域・問題名・操作を分けた版。必要なラベル、権限説明、デモの注意を残し、既存のFirebase設定と `preview` モードを維持した。Hostingのみを更新した。

`npm run check` は型検査・lint・223テスト・ビルドが成功。公開対象8ファイル全てがHTTPS 200で検証済みビルドとSHA-256で一致した。実ChromeのPC・スマホ幅の計5表示で、整理後の問題カード、地図画像、問題開閉、ゲスト状態、ログインボタンの有効状態、自治体デモを確認した。スマホの地図操作ボタンとデモの注意文の重なりもない。

トップの `/` と `/admin-demo` にもHTMLの `Cache-Control: no-cache` を適用し、公開レスポンスで確認した。ハッシュ付き `assets` の長期キャッシュは維持する。実Google認証の完了、実機の撮影・GPS取得は今回未検証。
