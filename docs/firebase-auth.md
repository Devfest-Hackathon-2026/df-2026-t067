# Firebase接続とGoogleログイン

## 1. 今回利用できること

Firebase AuthenticationのGoogleログイン、ログアウト、再読み込み後のログイン状態の復元。問題の閲覧はログイン不要で、選んだ問題の「Googleログインして挑戦する」から認証画面を開く。成功・取消・失敗後も選んだ問題を表示する。

地図、撮影、写真判定、本人記録、自治体の所属確認、サーバーAPIはこれから接続する。ログイン後は撮影等が準備中であることを画面に表示する。

## 2. 各開発者の設定

PRが未マージの間は、手元の変更をgit statusで確認してから、対象ブランチを取得する。マージ後は最新mainを使う。

~~~sh
git fetch origin
git switch codex/feat/firebase-google-auth
~~~

1. Firebaseコンソールのプロジェクト設定から、対象Webアプリの接続設定を取得する。
2. AuthenticationでGoogleプロバイダーと問い合わせ先を設定する。問い合わせ先のメールと、ログイン可能なメールの制限は別の設定。
3. Authenticationの設定にある承認済みドメインへlocalhostを登録する。ホスト名の指定であり、ポート番号は付けない。公開先は決まったドメインを別途登録する。
4. リポジトリ内で次を実行する。

~~~sh
cp .env.example .env.local
~~~

5. .env.localの次の6項目に、取得したWebアプリの値を入力する。

| 環境変数 | Firebase設定の項目 |
|---|---|
| VITE_FIREBASE_API_KEY | apiKey |
| VITE_FIREBASE_AUTH_DOMAIN | authDomain |
| VITE_FIREBASE_PROJECT_ID | projectId |
| VITE_FIREBASE_STORAGE_BUCKET | storageBucket |
| VITE_FIREBASE_MESSAGING_SENDER_ID | messagingSenderId |
| VITE_FIREBASE_APP_ID | appId |

.env.localはGit対象外。.env.exampleには値を入れない。元の設定JSONもリポジトリへコピーしない。VITE_の値はブラウザのビルドへ含まれるため、サーバー秘密鍵・AI認証情報はここへ入れない。

## 3. 起動と動作確認

~~~sh
npm ci
npm run dev
~~~

認証の確認には[http://localhost:5173/](http://localhost:5173/)を開く。127.0.0.1とlocalhostはFirebaseの承認済みドメインでは別扱いなので、今回の手順ではlocalhostを使う。環境変数を変更したら開発サーバーを再起動する。

1. 問題を開く。ここまでログイン操作やGPS・カメラの許可は不要。
2. 「Googleログインして挑戦する」を押す。別ウィンドウでGoogleのアカウント選択・確認を行う。背後にある場合はGoogleのウィンドウを前面へ出す。
3. 認証後、元の問題と「Googleログイン済み」を確認する。撮影・判定・保存は準備中のまま。
4. ページを再読み込みし、ログイン状態が復元されることを確認する。
5. 「ログアウト」で未ログインへ戻る。ログアウト後も問題は閲覧できる。
6. 再度ログイン画面を開いて閉じると、取消の案内が出て同じ問題で再試行できる。

検証時に標準ポートが使用中なら、使用者を確認してから明示的に別ポートで起動する。例：npm run dev -- --port 5174、その場合はhttp://localhost:5174/を開く。

## 4. つまずいたとき

| 表示・状況 | 確認すること |
|---|---|
| Firebase未接続 | 6項目が未入力。匿名閲覧は可能 |
| 接続設定を確認してください | 一部不足・authDomainにURLやパスを入れていないか。変更後にサーバーを再起動したか |
| ログイン画面を開けませんでした | ブラウザのポップアップ許可。アプリのボタンを再度押す |
| このアクセス元からログインできません | 現在のホスト名がFirebaseの承認済みドメインにあるか |
| Googleの画面で止まって見える | 別ウィンドウのアカウント選択・情報共有確認・本人確認が残っていないか |
| 通信を確認してください | 接続状況を確認して再試行する。成功表示へ切り替える代替処理はない |

## 5. A担当の実装とAPI接続

[config.ts](../src/features/auth/config.ts)が設定を検査し、[firebaseAuth.ts](../src/features/auth/firebaseAuth.ts)がFirebase SDKを扱う。[App.tsx](../src/App.tsx)はobserverが返す認証状態を表示する。ポップアップをクリックから直接開き、アプリ独自の成功状態やGoogle access tokenは保存しない。

保護APIへ接続するときは、共通APIのcreateApiClientへAuthClient.getIdTokenを渡す。この関数は認証状態の復元を待って、Firebase ID tokenを取得する。uidやGoogle access tokenで代用しない。API側ではID tokenの検証と、本人・組織・操作の認可を実装する。

## 6. 検証と確認範囲

npm run checkで型・静的検査・単体/画面テスト・buildを実行する。単体テストでは実設定を消してテスト用設定とSDK境界のダブルを使い、実Firebaseへアクセスしない。

依存関係は固定したFirebase 13.2.0を使う。fsevents / @firebase/util / protobufjsの追加インストールスクリプトはpackage.jsonで明示的に無効化し、この状態のnpm ci・build・実認証を確認している。

Chromeで実設定のGoogle認証画面、実アカウントのログイン、同じ問題の保持、再読み込み後の状態復元、ログアウトを確認した。実アカウントの選択・Googleの確認は本人が操作した。スマートフォン実機と公開ドメインでの確認は未実施。

## 公式資料

- [Googleでログインする](https://firebase.google.com/docs/auth/web/google-signin)
- [認証状態の監視](https://firebase.google.com/docs/auth/web/manage-users)
- [redirect方式の制約とpopup方式](https://firebase.google.com/docs/auth/web/redirect-best-practices)
