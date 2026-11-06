# ローカルAPI（架空デモ専用）

Node **26.7.0** / npm **11.19.0**を使う。架空デモでは公開データの閲覧、Firebase ID tokenの検証、挑戦開始、写真と位置の受付を確認できる。管理操作と本人記録もローカルで試せる。

回答処理を試す場合は、FirestoreとGCSの代替環境を使う別のローカルモードで起動する。[画面と追加設定](../README.md#現在の状態)

リポジトリのルートから実行する。

```sh
npm --prefix server ci --ignore-scripts
QUEST_DATA_MODE=demo NODE_ENV=development npm run dev:api
```

`http://127.0.0.1:8787/health` と `http://127.0.0.1:8787/api/v1/quests` を開いて動作を確認する。終了するにはCtrl+Cを押す。

`PORT`には1〜65535の整数を指定できる。サーバーはIPv4ループバックの`127.0.0.1`だけで待ち受ける。`SIGINT`/`SIGTERM`を受けると、新しい接続の受付を止め、接続を最大5秒で閉じる。Firebaseアプリも解放する。

`dev:api` はビルド後にルートの `.env.local` を読み込んで起動する。設定を変更したら再実行する。ビルド済みで、必要な環境変数をシェルから渡す場合は `npm --prefix server start` でも起動できる。`src/server.ts` の `createServer` は、まだ待ち受けを始めていないNode HTTP Serverを返す。`src/main.ts` もimport時には起動しない。

## デモと起動設定

| 設定 | 動作 |
|---|---|
| `QUEST_DATA_MODE` | `demo` または `durable-local` を明示。未指定や他の値は起動エラー |
| `NODE_ENV=development` / `test` / 未指定 | ローカルデモを許可 |
| `NODE_ENV=production` / その他の値 | 起動拒否。本番実装は未提供 |
| `PORT` | 既定8787。`0`や数値でない値は拒否 |
| `FIREBASE_PROJECT_ID` | 任意。認証対象のプロジェクトIDを実行時だけ渡す。空・不正値は起動拒否 |
| `FIREBASE_AUTH_EMULATOR_HOST` | 空を含め設定されていれば起動拒否。署名なしEmulatorトークンを受け付けない |

すべてのHTTP応答に`X-Quest-Data-Mode: demo`、`X-Request-Id`、`Cache-Control: private, no-store`を付ける。`/health`は次を返す。

```json
{"status":"ok","dataMode":"demo","fictionalData":true,"auth":"unconfigured"}
```

プロジェクトIDを設定すると、`auth`は`configured`になる。この値で確認できるのは設定の有無だけ。実トークンを検証できることやネットワークの状態は、別に確認する必要がある。

デモデータは「架空」と表示する2地域・3問題。座標は合成した公開領域の形状だけを表す。実在スポットの座標、正解レコード、照合写真、回答は含まない。

## 永続APIをローカルで起動する

クライアントを拒否するFirestoreエミュレーターと、ループバックのGCS代替サーバーを起動する。次の例はそれぞれ `127.0.0.1:8688` と `127.0.0.1:9688` で動作している場合。初回だけ代替サーバーに専用バケットを作る。[エミュレーターでの検証](../docs/answer-processing.md#非公開jpegの保存)

```sh
curl -fsS -X POST 'http://127.0.0.1:9688/storage/v1/b?project=demo-t067-durable-local' \
  -H 'Content-Type: application/json' -d '{"name":"demo-t067-durable-local.appspot.com"}'

QUEST_DATA_MODE=durable-local NODE_ENV=development \
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8688 QUEST_DURABLE_STORAGE_ENDPOINT=http://127.0.0.1:9688 \
  npm run dev:api
```

`FIREBASE_PROJECT_ID` は開発用の署名済みIDトークンを発行するプロジェクトをシェルまたは `.env.local` から渡す。認証付きの操作には既存の開発用ADCでユーザーを参照できる権限も必要。HTTPでトークンの失効と無効化を確認し、定期処理では対象アカウントの存在と有効状態を確認する。Auth EmulatorとStorage SDKの接続先を上書きする `STORAGE_EMULATOR_HOST`、`FIREBASE_STORAGE_EMULATOR_HOST` は起動前に外す。FirestoreとGCSの接続先はIPv4ループバックに限り、データ用プロジェクトは `demo-t067-durable-local` に固定する。

`GET /health` は `dataMode: durable-local` を返す。起動時に架空の地域と問題 `demo-quest` の版 `1` を用意する。別のターミナルで `VITE_QUEST_DATA_SOURCE=durable-local npm run dev` を実行すると、未ログインで一覧・詳細・通常ヒントを開ける。テストの回答には合成画像と架空の座標を使う。認証を代替した自動テストは、受付後に回答判定・記録保存・一時画像清掃・削除の再試行まで通す。[Webの接続手順](../docs/local-api.md#モードを選ぶ)・[永続APIと定期回収](../docs/answer-processing.md#httpと定期回収の起動)

公開カタログは `areas` と `questPublic` を読み、`quests` の公開状態と版が一致する問題を返す。通常ヒントは公開版の本文だけを返す。管理操作、報告、ヒント画像の配信は `demo` モードで確認できる。[永続公開カタログ](../docs/api.md#永続公開カタログ)

永続回答の参考画像は専用バケットへ保存し、公開版に固定した世代をworkerが読み取る。既定は合成フィクスチャの判定を使う。Vertexを試す場合は `NODE_ENV=development` で `QUEST_DURABLE_PHOTO_MATCHER=vertex-trial` と既存の `QUEST_VERTEX_TRIAL_LEDGER` を指定する。[永続回答からのVertex試験](../docs/vertex-trial.md#永続回答から試す)

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

公開デモはFirebaseを設定せずに閲覧できる。プロジェクトIDが未設定の場合、`/session`はtokenの有無にかかわらず503を返す。設定した場合は`Authorization: Bearer <Firebase ID token>`を受け付ける。ヘッダーがない場合、不正な形式の場合、重複している場合は401を返す。tokenはURLへ入れない。ログにヘッダー、token、body、SDK例外を記録しない。

`firebase-admin/app`の`initializeApp({projectId})`で専用アプリを遅延作成し、`firebase-admin/auth`の`getAuth(app).verifyIdToken(token, false)`へ委譲する。SDKが署名・issuer・audience・有効期限を検査し、その結果のuidだけを返す。手書きJWT検証やdecodeだけの受理は行わない。[Firebase公式検証ガイド](https://firebase.google.com/docs/auth/admin/verify-id-tokens)と[Admin SDK設定ガイド](https://firebase.google.com/docs/admin/setup)を確認した。

`false`は失効・ユーザー無効化の追加照会を行わない指定。**失効の即時検出は未実装**。このルートは認証の確認専用で、Googleログイン成功だけで自治体所属・role・編集権限を付けない。

このSDK版では、明示projectIdでの通常のID token検証は公開署名証明書を取得する経路を使い、ADCやサービスアカウントファイルは読み込まない。実サービスでの検証には署名証明書へのネットワーク接続が必要。`.env.local`の読み込みはNodeの起動オプションに任せ、SDK用の資格情報ファイル・dotenv・鍵fixtureは追加していない。SDKの他の管理操作を利用できるという意味ではない。インストール済み`base-auth.d.ts`の`verifyIdToken`宣言、`base-auth.js`、`token-verifier.js`、`utils/index.js`、`app/credential-internal.js`でもこの経路を確認した。

実プロジェクトIDは利用者が実行時の`FIREBASE_PROJECT_ID`へ渡す。コード・ドキュメント・テストに実値を入れない。2026-11-05に実Googleアカウントと実ID tokenを使った認証確認の正常系を検証した。アカウント情報・uid・token・実設定値を資料やログへ記録せず、資格情報ファイルや外部のFirebase JSONをサーバーへ読み込ませない。

## 検証

```sh
npm --prefix server run check
```

型検査、oxlint、Node標準テスト、ビルドを順に実行する。oxlintは警告が出た場合も失敗とする。テストはlocalhostの一時ポートを使い、Firebase SDK／リモート境界だけを置き換える。インストール済みのSDKが不正なtoken文字列を拒否することも確認する。Web側を検証するには、ルートで`npm run check`を実行する。

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

開発画面から写真と位置を送信し、受付状態を照会できる。写真判定workerは未接続のため、`RECEIVED` になった回答は受付済みのままになる。開発用の上限は、写真4MiB、本文の受信5秒、同時4件、利用者ごとに10要求/60秒、受付256件。画像は画素をデコードして正規化し、ヘッダーだけの偽画像を拒否する。[回答受付API](../docs/answer-intake.md)

[開発用の内部回答処理](../docs/answer-processing.md)は既存受付・GPS・照合・メモリー記録をつなぐが、このHTTP受付や環境変数からは起動しない。実Vertex・実保存・CORRECTへ自動接続しない。

GPSを試すときは`QUEST_LOCATION_MODE=demo`をAPIに指定する。未指定/offなら従来の受付のみ。合成範囲・試作用上限で範囲外と位置不確実を200の不合格結果として返し、位置条件の通過は未判定の受付を維持する。既存回答は再送時に鮮度を再評価しない。設定、起動手順と未検証は[GPS判定](../docs/gps-validation.md)を参照する。

## 画像検証と照合部品

serverだけにsharp 0.35.5を固定し、JPEG/PNG/WebPの破損・多フレーム・画素上限を検査する。向きを画素へ反映し、縮小・sRGB/白背景・JPEG再圧縮でEXIF等を保持しない。`npm --prefix server ci --ignore-scripts`の既存手順で事前配布バイナリを導入する。

内部のcomparePhotosで参考写真と回答写真を照合する。永続回答workerが位置と公開版を確認して呼び出し、記録を保存してからCORRECTを返す。Vertexへの通信は下記CLIと明示した合成試験モードで使う。[制限・結果・残件](../docs/photo-match.md)

## Vertexのローカル画像試験

`npm run build`後、`npm run vertex:trial -- init`で台帳を明示初期化し、`match` / `mismatch` / `uncertain`で合成画像だけを送信できる。`NODE_ENV=development`と絶対パスの`QUEST_VERTEX_TRIAL_LEDGER`、ローカルADCが必要。既存の台帳は初期化せず、永続回答の試験にも同じパスを使う。[試験手順](../docs/vertex-trial.md#ローカルの画像試験)


## Webとの接続

ルートのVitestは`src/`だけを対象にし、Node標準テストとビルド済みテストを重複実行しない。サーバー依存はルートlockfileへ移さず、独立したパッケージとして扱う。API契約は[docs/api.md](../docs/api.md#9-ローカルapiの土台)、実装判断は[docs/decisions.md](../docs/decisions.md)にも記録した。

Web画面は公開`GET`へ接続済み。Vite開発proxyが`/api`を`http://127.0.0.1:8787`へ転送し、既存`createApiClient()`の同一originパスを保つ。ブラウザから別originへ直接接続するための広いCORSは追加していない。画面では一覧・詳細・地域名を取得し、失敗時に固定デモへfallbackしない。

共通clientの`getSession()`は既存の`getIdToken`を使って認証確認を呼び、共通の`SessionIdentity`でuidだけを返す。画面はFirebaseの現在の利用者と照合する。実ChromeでGoogleログイン、実ID tokenのサーバー検証、再読み込み後の認証復元と再確認、ログアウトを確認済み。詳細は[確認記録](../docs/local-api.md#確認)を参照する。

初期接続の確認対象は、上記serverチェック、明示デモでのlocalhost起動、公開APIの契約、未設定sessionの503、検証境界のuid固定、挑戦開始の所有者・版・再要求・上限、本番・Emulator拒否。実Firestore/Storage、実地点での地図・GPS・写真判定、実際の自治体権限、APIデプロイは残件。

## 本人記録APIの開発用設定

`QUEST_DISCOVERIES_MODE` は既定offで、認証後も記録の保存先未接続として503を返す。`memory` を明示すると開発用の一覧・詳細・写真取得・削除追跡を利用できる。`QUEST_DEMO_DISCOVERY_OWNER_UID` を追加すると対象の本人に合成記録1件を用意する。省略時は空で起動する。[本人記録API](../docs/owner-discoveries.md)

## 自治体写真素材APIの開発用設定

`QUEST_ADMIN_ASSETS_MODE=memory` を指定すると、所属と画像を検証したうえで写真を登録し、認可を受けて取得できる。既定のoffでは所属確認後に503を返す。下書きストアは登録済みassetIdの台帳を共有し、組織と用途を検証する。開発用の公開ヒントには、その用途で登録した画像を使う。画像と台帳はサーバーを再起動すると消える。[設定・再送・制約](../docs/admin-assets.md)

## 自治体写真試験APIの接続口

[写真試験API](../docs/admin-photo-tests.md) は所属・参考用途・下書きrevisionに結び付く。既定は照合未接続の503。`QUEST_ADMIN_PHOTO_TEST_MODE=fixtures` を明示すると、指定の合成画像で同じ下書き版の一致・別対象を試せる。試験結果はその版の開発用公開の確認に使う。旅行者の記録は別に管理する。[合成素材の生成と公開・休止](../docs/admin-photo-tests.md#合成素材で公開休止を試す)
