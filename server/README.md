# ローカルAPI（架空デモ専用）

Node **26.7.0** / npm **11.19.0**。この独立パッケージは架空データの読み取り、Firebase ID tokenの検証確認、開発用の挑戦開始と[回答受付](../docs/answer-intake.md)、明示モードの[GPS検査](../docs/gps-validation.md)を実装する。Firestore、永続保存、実地点の判定・写真照合、自治体権限は含まない。実データのアダプターは未実装で、接続失敗をデモ成功へ切り替える処理もない。

リポジトリのルートから実行する。

```sh
npm --prefix server ci --ignore-scripts
QUEST_DATA_MODE=demo NODE_ENV=development npm --prefix server run dev
```

`http://127.0.0.1:8787/health` と `http://127.0.0.1:8787/api/v1/quests` を開く。終了はCtrl+C。`PORT`で1〜65535の整数を指定できる。実行ファイルはIPv4ループバック`127.0.0.1`だけにbindする。`SIGINT`/`SIGTERM`で受付を停止し、接続は最大5秒で閉じ、Firebaseアプリも解放する。

`npm run dev`はビルド後に起動する。変更時は再実行する。ビルド済みなら`QUEST_DATA_MODE=demo NODE_ENV=development npm --prefix server start`でも起動できる。`src/server.ts`の`createServer`は未listenのNode HTTP Serverを返し、importだけでは起動しない。`src/main.ts`もimport時には起動しない。

## デモと起動設定

| 設定 | 動作 |
|---|---|
| `QUEST_DATA_MODE=demo` | 必須の明示選択。未指定・別の値は起動エラー |
| `NODE_ENV=development` / `test` / 未指定 | ローカルデモを許可 |
| `NODE_ENV=production` / その他の値 | 起動拒否。本番実装は未提供 |
| `PORT` | 既定8787。`0`や数値でない値は拒否 |
| `FIREBASE_PROJECT_ID` | 任意。認証対象のプロジェクトIDを実行時だけ渡す。空・不正値は起動拒否 |
| `FIREBASE_AUTH_EMULATOR_HOST` | 空を含め設定されていれば起動拒否。署名なしEmulatorトークンを受け付けない |

すべてのHTTP応答に`X-Quest-Data-Mode: demo`、`X-Request-Id`、`Cache-Control: private, no-store`を付ける。`/health`は次を返す。

```json
{"status":"ok","dataMode":"demo","fictionalData":true,"auth":"unconfigured"}
```

プロジェクトIDを設定した場合の`auth`は`configured`。これは設定の有無だけを示し、実トークン検証やネットワークの健全性を保証しない。デモデータは「架空」と表示する2地域・3問題。座標は合成した公開領域の形状だけで、実在スポットの座標、正解レコード、照合写真、回答は含まない。

## 実装したルート

基底は`/api/v1`。公開DTOと実行時検証は[共通型](../src/shared/api/types.ts)・[検証](../src/shared/api/validation.ts)を直接再利用する。競合するDTOや結果コードは定義しない。

| GET | 認証 | 応答・入力 |
|---|---|---|
| `/health` | 不要 | 上記のローカル状態 |
| `/api/v1/areas` | 不要 | `Page<PublicArea>`。`bbox`, `zoom`, `cursor`, `limit` |
| `/api/v1/quests` | 不要 | `Page<PublicQuest>`。`areaId`, `cursor`, `limit` |
| `/api/v1/quests/:questId` | 不要 | 公開`PublicQuest`。存在しないIDは404 |
| `/api/v1/session` | 必要 | **今回追加する接続確認ルート**。検証済み`{"uid":"…"}`だけ |

`POST /api/v1/challenges`の契約は後半の[挑戦開始](#挑戦開始)を参照する。

- `limit`は既定20、1〜100の整数。`Page`は`{items, nextCursor}`。デモデータの固定ID順でページングし、続きがなければ`nextCursor: null`。
- `cursor`はサーバーが返した値をそのまま再送する。ルート・フィルターが変わったカーソル、不正形式、未知の行は400。カーソルは公開IDを表すページ位置だけで、認可や秘密の保存には使わない。`limit`は途中で変更可能。
- `areaId`/`questId`はASCII英数字で始まり、英数字・`_`・`-`の1〜128文字。この初期サーバーで採用する入力制限であり、既存クライアントのID検査より狭い。空・区切り文字・制御文字・不正なpercent encodingは400。不明な`areaId`の一覧は空ページ。
- `bbox=west,south,east,north`。経度±180・緯度±90の有限な十進数、`south <= north`。`west > east`は日付変更線を跨ぐ指定として扱う。デモの公開ポリゴン外接範囲に重なる地域を返す（穴や任意の複雑な形状の精密交差判定ではない）。答えの位置やマーカーから選別しない。
- `zoom`は0〜24の有限な十進数。現段階では検証とカーソルの条件にだけ使い、集約粒度は変更しない。
- 公開一覧・詳細とhealthでは未定義・重複queryを400で拒否。`/session`はquery/bodyをidentityとして読まず、`uid`/`role`/`orgId`を渡しても返すuidは検証結果だけ。GETはbodyを解釈・保存しない。挑戦開始だけが認証後に上限付きのJSONを読む。
- 上表はGET、それ以外は405と`Allow: GET`。挑戦開始はPOSTだけで、異なるメソッドは405と`Allow: POST`。未知のルートは404。CORS許可は設定しない。

エラー封筒は[既存API契約](../docs/api.md)の`{error:{code,message,requestId,retryable}}`。requestIdはサーバー生成で、リクエストヘッダーから引き継がない。

| 状況 | HTTP / code | retryable |
|---|---|---|
| 不正な入力 | 400 / `INVALID_INPUT` | false |
| 認証が必要・不正／期限切れtoken | 401 / `UNAUTHENTICATED` | false |
| 資源・ルートなし | 404 / `NOT_FOUND` | false |
| 未対応メソッド | 405 / `HTTP_ERROR`（既存コードを再利用） | false |
| Firebase未設定・SDK設定／通信障害 | 503 / `AUTH_UNAVAILABLE` | true |
| 予期しないサーバー障害 | 500 / `SYSTEM_ERROR` | true |

## Firebase ID token検証

公開デモの閲覧にFirebase設定は不要。プロジェクトIDが未設定の`/session`は、tokenの有無にかかわらず503。設定時だけ`Authorization: Bearer <Firebase ID token>`を受け付け、欠落・不正形式・重複ヘッダーは401。tokenはURLへ入れない。ログにヘッダー、token、body、SDK例外を記録しない。

`firebase-admin/app`の`initializeApp({projectId})`で専用アプリを遅延作成し、`firebase-admin/auth`の`getAuth(app).verifyIdToken(token, false)`へ委譲する。SDKが署名・issuer・audience・有効期限を検査し、その結果のuidだけを返す。手書きJWT検証やdecodeだけの受理は行わない。[Firebase公式検証ガイド](https://firebase.google.com/docs/auth/admin/verify-id-tokens)と[Admin SDK設定ガイド](https://firebase.google.com/docs/admin/setup)を確認した。

`false`は失効・ユーザー無効化の追加照会を行わない指定。**失効の即時検出は未実装**。このルートは認証の確認専用で、Googleログイン成功だけで自治体所属・role・編集権限を付けない。

このSDK版では、明示projectIdでの通常のID token検証は公開署名証明書を取得する経路を使い、ADCやサービスアカウントファイルは読み込まない。実サービスでの検証には署名証明書へのネットワーク接続が必要。`.env.local`の読み込みはNodeの起動オプションに任せ、SDK用の資格情報ファイル・dotenv・鍵fixtureは追加していない。SDKの他の管理操作を利用できるという意味ではない。インストール済み`base-auth.d.ts`の`verifyIdToken`宣言、`base-auth.js`、`token-verifier.js`、`utils/index.js`、`app/credential-internal.js`でもこの経路を確認した。

実プロジェクトIDは利用者が実行時の`FIREBASE_PROJECT_ID`へ渡す。コード・ドキュメント・テストに実値を入れない。2026-11-05に実Googleアカウントと実ID tokenを使った認証確認の正常系を検証した。アカウント情報・uid・token・実設定値を資料やログへ記録せず、資格情報ファイルや外部のFirebase JSONをサーバーへ読み込ませない。

## 検証

```sh
npm --prefix server run check
```

型検査 → oxlint（警告も失敗）→ Node標準テスト → ビルド。テストはlocalhostの一時ポートを使い、Firebase SDK／リモート境界だけを置き換える。インストール済みSDKが不正なtoken文字列を拒否する確認も含む。このコマンドはサーバー専用。Web側はルートで`npm run check`を実行する。

| 条件 | 対応テスト |
|---|---|
| 匿名公開閲覧、既存client、bbox/areaId、ページング、ゼロ件 | `test/server.test.ts`（FR-03/14、AT-01のAPI部分） |
| 公開項目allowlist、答え情報なし | `test/server.test.ts`（FR-02、AT-02） |
| 不正座標・query・ID・cursor、404/405 | `test/server.test.ts` |
| 未設定503、欠落／不正認証401、検証uid優先、余分なclaim非公開 | `test/server.test.ts`、`test/firebase-auth.test.ts`（NFR-01の認証部分） |
| SDKへの検証委譲、ネットワーク失敗503、認証成功へのfallbackなし | `test/firebase-auth.test.ts` |
| 明示デモ、本番・Emulator拒否 | `test/config.test.ts`、`test/firebase-auth.test.ts`、`test/startup.test.ts`（NFR-06、AT-22） |
| import時未起動、localhost起動、SIGTERM停止 | `test/startup.test.ts` |

依存はexact pinし、独立lockfileを保持する。Node/npmはルートと同じ。TypeScriptは5.9.3を固定し、既存の拡張子なし共有importを変更せずCommonJSへ出力する。ルートのフロント用TypeScript設定・依存は変更しない。`dist/`にserverと参照した共有モジュールを一緒に出力するので、`dist/server/src/main.js`を実行する。`dist-test/`はテスト専用でGit対象外。

install scriptsは`.npmrc`で全面無効化し、`allowScripts`にも`@firebase/util`と`protobufjs`の拒否を明記する。lockfile内のinstall script保持パッケージはこの2つで、ソースを確認した。特に`@firebase/util`のpostinstallは外部設定を読み得るため実行しない。配布済みファイルとoptional platform packageだけでチェックが通ることを確認する。

## 挑戦開始

`POST /api/v1/challenges`は検証済み利用者と公開デモ問題・版からChallengeを作る。初回201、同じ利用者・問題・版の再要求は200で再利用する。JSONは4KiB・受信5秒まで。所有者・ID・日時はクライアントから採用しない。

保存先は最大256件の開発用メモリで、再起動すると消える。正常入力の開始要求は再要求を含め利用者ごとに10回/60秒までで、超過時は429とRetry-Afterを返す。永続保存・クリア記録ではない。[契約・制限・C担当向けの呼び方](../docs/challenge-start.md)を参照する。画面のlocal-apiモードから開始APIを呼び出す。

## 開発用の回答受付

`POST /api/v1/challenges/:challengeId/answers`は本人の挑戦・multipartのphoto/metadata・Idempotency-Keyを検証し、既定では202のRECEIVED/source:mockを返す。`GET /api/v1/attempts/:attemptId`は本人だけが受付を照会できる。同内容の再送では同じ受付を返し、違う内容は409。画像や位置を保存せず、hashと受付だけを上限付きメモリに保持する。

**画面送信・判定workerは未接続でRECEIVEDから進まない。** 写真4MiB、本文受信5秒、同時4件、利用者10要求/60秒、受付256件の開発用制限を置く。画像は実デコード・正規化し、ヘッダーだけの偽画像を成功扱いにしない。詳細は[回答受付API](../docs/answer-intake.md)を参照する。

GPSを試すときは`QUEST_LOCATION_MODE=demo`をAPIに指定する。未指定/offなら従来の受付のみ。合成範囲・試作用上限で範囲外と位置不確実を200の不合格結果として返し、位置条件の通過は未判定の受付を維持する。既存回答は再送時に鮮度を再評価しない。設定、起動手順と未検証は[GPS判定](../docs/gps-validation.md)を参照する。

## 画像検証と照合部品

serverだけにsharp 0.35.5を固定し、JPEG/PNG/WebPの破損・多フレーム・画素上限を検査する。向きを画素へ反映し、縮小・sRGB/白背景・JPEG再圧縮でEXIF等を保持しない。`npm --prefix server ci --ignore-scripts`の既存手順で事前配布バイナリを導入する。

内部のcomparePhotosとVertex向け要求/応答の部品を用意した。実通信transport・ADC・回数制限は下記CLIに限定し、HTTP回答workerは未接続。matcherなしは503で、MATCHもCORRECTではない。画像は保存せず、現在のHTTP受付から写真照合や課金APIへ進めない。[制限・結果・残件](../docs/photo-match.md)を参照する。

## Vertexのローカル画像試験

`npm run build`後、`npm run vertex:trial -- init`で台帳を明示初期化し、`match` / `mismatch` / `uncertain`で合成画像だけを送信できる。`NODE_ENV=development`と絶対パスの`QUEST_VERTEX_TRIAL_LEDGER`、ローカルADCが必要。既使用分・上限・再起動時の扱い・実行例は[試験手順](../docs/vertex-trial.md#ローカルの画像試験)を参照する。台帳を複製・再作成して回数を戻さない。通常のHTTPサーバーからは呼ばない。


## Webとの接続

ルートのVitestは`src/`だけを対象にし、Node標準テストとビルド済みテストを重複実行しない。サーバー依存はルートlockfileへ移さず、独立したパッケージとして扱う。API契約は[docs/api.md](../docs/api.md#9-ローカルapiの土台)、実装判断は[docs/decisions.md](../docs/decisions.md)にも記録した。

Web画面は公開`GET`へ接続済み。Vite開発proxyが`/api`を`http://127.0.0.1:8787`へ転送し、既存`createApiClient()`の同一originパスを保つ。ブラウザから別originへ直接接続するための広いCORSは追加していない。画面では一覧・詳細・地域名を取得し、失敗時に固定デモへfallbackしない。

共通clientの`getSession()`は既存の`getIdToken`を使って認証確認を呼び、共通の`SessionIdentity`でuidだけを返す。画面はFirebaseの現在の利用者と照合する。実ChromeでGoogleログイン、実ID tokenのサーバー検証、再読み込み後の認証復元と再確認、ログアウトを確認済み。詳細は[確認記録](../docs/local-api.md#確認)を参照する。

完了条件は、上記serverチェック成功、明示デモでlocalhost起動、公開APIの契約一致、未設定sessionの503、検証境界のuid固定、挑戦開始の所有者・版・再要求・上限の確認、本番・Emulator拒否。**実Firestore／データ保存、実地図・実地点GPS・写真判定、組織認可、APIデプロイは別作業・未検証**。

## 本人記録APIの開発用設定

`QUEST_DISCOVERIES_MODE`は既定off。認証後も記録の保存先未接続として503を返す。`memory`を明示すると空の開発用メモリーストアを起動し、一覧/詳細/認証付き写真取得/削除追跡を利用できる。再起動で消え、架空のクリアを自動追加しない。実判定・実DB/Storage・回答workerからの保存は未接続。詳しくは[本人記録API](../docs/owner-discoveries.md)。
