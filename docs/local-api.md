# 画面とローカルAPIを接続する

審査と今後の開発は `durable-local` を基準にする。API・画面の起動手順の正本はこの文書。Node **26.7.0** / npm **11.19.0**を使い、リポジトリのルートで実行する。

## 永続側の準備

合成データでの実Firestoreと非公開バケットの検証手順は[クラウド保存試験](cloud-storage-trial.md)に分けて記載する。

1. `npm ci` と `npm --prefix server ci --ignore-scripts` で依存を導入する。
2. [Firebase認証](firebase-auth.md)を設定する。ブラウザとサーバーの `FIREBASE_PROJECT_ID` は同じプロジェクトを使う。実設定は `.env.local` に置き、コミットしない。サーバーには既存の開発用ADCによるアカウント照会権限も必要。新規の課金・IAM・API有効化はこの手順では行わない。
3. クライアントアクセスを拒否するFirestoreエミュレーターと `fake-gcs-server` 1.56.1をループバックで起動する。以下はそれぞれ8688番・9688番で起動済みの場合。このリポジトリに保存環境の一括起動スクリプトはない。[保存境界と検証](answer-processing.md#非公開jpegの保存)を参照し、再起動後も残す場合は保存環境のデータ保持を設定する。
4. 初回は下記の専用バケットを作る。自治体の操作には[永続素材の所属登録](admin-assets.md#永続素材をローカルで試す)を管理者が行う。Googleログインだけでは所属は付かない。

## 永続APIをローカルで起動する

クライアントを拒否するFirestoreエミュレーターと、ループバックのGCS代替サーバーを起動する。次の例はそれぞれ `127.0.0.1:8688` と `127.0.0.1:9688` で動作している場合。初回だけ代替サーバーに専用バケットを作る。[エミュレーターでの検証](answer-processing.md#非公開jpegの保存)

```sh
curl -fsS -X POST 'http://127.0.0.1:9688/storage/v1/b?project=demo-t067-durable-local' \
  -H 'Content-Type: application/json' -d '{"name":"demo-t067-durable-local.appspot.com"}'

QUEST_DATA_MODE=durable-local NODE_ENV=development \
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8688 QUEST_DURABLE_STORAGE_ENDPOINT=http://127.0.0.1:9688 \
  npm run dev:api
```

`FIREBASE_PROJECT_ID` は開発用の署名済みIDトークンを発行するプロジェクトをシェルまたは `.env.local` から渡す。認証付きの操作には既存の開発用ADCでユーザーを参照できる権限も必要。HTTPでトークンの失効と無効化を確認し、定期処理では対象アカウントの存在と有効状態を確認する。Auth EmulatorとStorage SDKの接続先を上書きする `STORAGE_EMULATOR_HOST`、`FIREBASE_STORAGE_EMULATOR_HOST` は起動前に外す。FirestoreとGCSの接続先はIPv4ループバックに限り、データ用プロジェクトは `demo-t067-durable-local` に固定する。

`GET /health` は `dataMode: durable-local` を返す。起動時に架空の地域と問題 `demo-quest` の版 `1` を用意する。別のターミナルで `VITE_QUEST_DATA_SOURCE=durable-local npm run dev` を実行すると、未ログインで一覧・詳細・通常ヒントを開ける。テストの回答には合成画像と架空の座標を使う。認証を代替した自動テストは、受付後に回答判定・記録保存・一時画像清掃・削除の再試行まで通す。[Webの接続手順](local-api.md#画面を起動して確認する)・[永続APIと定期回収](answer-processing.md#httpと定期回収の起動)

公開カタログは `areas` と `questPublic` を読み、`quests` の公開状態と版が一致する問題を返す。通常ヒントとヒント画像は現在の公開版から取得できる。旅行者の問題報告はローカルのFirestoreに保存する。[永続公開カタログ](api.md#永続公開カタログ)

永続回答の参考画像は専用バケットへ保存し、公開版に固定した世代をworkerが読み取る。既定は合成フィクスチャの判定を使う。Vertexを試す場合は `NODE_ENV=development` で `QUEST_DURABLE_PHOTO_MATCHER=vertex-trial` と既存の `QUEST_VERTEX_TRIAL_LEDGER` を指定する。[永続回答からのVertex試験](vertex-trial.md#永続回答から試す)

自治体の写真素材APIも `durable-local` で使える。Firebaseの署名済みIDトークンと、Firestoreエミュレーターに管理者が登録した所属が必要。[永続素材の設定と使い方](admin-assets.md#永続素材をローカルで試す)

同じ所属で下書きと撮影範囲を保存できる。本文と撮影範囲は同じ版番号で更新の競合を検出する。[永続下書きの使い方](team-api-handoffs.md#永続の所属下書きをローカルで試す)

自組織の公開担当者は、確認待ちと写真試験がそろった版を公開できる。休止は公開カタログから外し、挑戦開始と回答受付を止める。[公開と休止の使い方](api.md#18-開発用の公開と休止)

## 画面を起動して確認する

別ターミナルで実行する。

```sh
VITE_QUEST_DATA_SOURCE=durable-local npm run dev
```

[旅行者画面](http://localhost:5173/)では、問題選択 → 詳細・ヒント → Googleログイン → 写真と位置の送信までを画面で確認する。判定結果の表示と「自分の記録」を開けることも画面で確認できる。地図は[Maps設定](google-maps.md)が必要。実カメラと端末の現在地ではクリアや本人記録の保存までは進まない。合成データでクリアから保存までを再現する手順は[合成データでクリアと本人記録を確認する](#合成データでクリアと本人記録を確認する)。

[自治体画面](http://localhost:5173/admin-local)も `VITE_QUEST_DATA_SOURCE=durable-local` で起動する。初回の設定と操作は[自治体画面をローカルで検証する](#自治体画面をローカルで検証する)を参照。

Viteは `/api` を `127.0.0.1:8787` に転送する。APIが失敗しても成功モックへ切り替えない。終了は各ターミナルでCtrl+C。PowerShellでは `NAME=value` の代わりに `$env:NAME = 'value'` で各変数を設定してからコマンドを実行する。

## 自治体画面をローカルで検証する

審査と開発の基準は `durable-local`。[共有用のHosting](https://tour-513804.web.app/)は静的プレビューで、自治体画面をAPIにつないで操作するには上記のローカル起動が必要。

1. **Googleログインを準備する。** チームのFirebase管理者に、使用する開発用Webアプリの設定の入手先を確認する。[設定表](firebase-auth.md#2-各開発者の設定)の `VITE_FIREBASE_*` を自分の `.env.local` に入れ、API用の `FIREBASE_PROJECT_ID` を `VITE_FIREBASE_PROJECT_ID` とそろえる。APIにはユーザー照会が許可された開発用ADCを使う。資格情報や `.env.local` は共有リポジトリやIssueに載せない。
2. **APIと所属を確認する。** 上記の手順で起動し、`http://127.0.0.1:8787/health` が `dataMode: durable-local` を返すことを確認する。[所属の登録手順](admin-assets.md#永続素材をローカルで試す)を使い、検証環境の管理者が、使うFirebaseアカウントのUIDと架空の組織をFirestoreエミュレーターでひも付ける。下書き編集には `editor`、公開・休止まで試す場合には `publisher` を使う。所属は検証に使うエミュレーターごとに登録する。
3. **合成素材で操作する。** [自治体画面](http://localhost:5173/admin-local)でGoogleログインし、所属の問題一覧を開く。下書きと参考素材を保存し、撮影範囲を設定する。[永続の写真試験](admin-photo-tests.md#永続の写真試験をローカルで試す)に沿い、同じ版で一致・別対象を確認する。確認依頼の後、公開担当者がローカルで公開し、旅行者画面に出ることと、休止後に一覧から外れることを確認する。

| 画面の状況 | 確認すること |
|---|---|
| 「Googleログインの設定を確認してください。」 | Web側のFirebase設定と `localhost` の承認状態を確認する。`.env.local` を変更したら開発サーバーを再起動する。 |
| 「ログインを確認できませんでした。」 | `/health` のモードと、Web・APIのFirebaseプロジェクトID、APIで使う開発用ADCのユーザー照会権限を確認する。設定を直したらAPIと画面を再起動し、ログインを確認し直す。 |
| 「利用できる所属がありません。」 | 検証に使うFirestoreエミュレーターに、ログインしたアカウントのUIDで有効な所属があるか確認する。 |

## 合成データでクリアと本人記録を確認する

旅行者画面の撮影は端末のカメラと現在地を使う。画面では問題選択、詳細・ヒント、ログイン、挑戦開始、撮影、写真と位置の送信、判定結果の表示、「自分の記録」を開けることまでを確認できる。実カメラの写真と端末の現在地では、既定の照合と撮影範囲を満たさないため、クリア確定や初回記録の保存までは進まない。

既定の永続起動（`QUEST_DATA_MODE=durable-local`。`QUEST_DURABLE_PHOTO_MATCHER=vertex-trial` を付けない場合）では、写真照合は `server/src/demo-photo-test.ts` の一致用合成PNG（`syntheticPng`、2×2画素）と同じ内容のときだけ成功する。別の合成PNG（`otherSyntheticPng`）は別対象、それ以外はシステムエラーになる。撮影範囲は `server/src/demo-location.ts` の架空円で、中心は緯度 `0`・経度 `0`、半径 `100` m。精度の上限は `50` m。撮影・測位の新しさなどの制限は[開発用GPS範囲判定](gps-validation.md#開発用の設定)と同じ。

クリアと保存を再現する入力の例は次のとおり。

- 画像: `syntheticPng`（`server/src/demo-photo-test.ts` で生成した2×2のPNG）
- 座標: 緯度 `0`、経度 `0`、精度 `5` m 程度（中心から `100` m 以内、精度 `50` m 以下）

撮影画面にファイル選択や座標の手入力はない。審査員が実カメラと実測位だけで同じクリアを再現することは想定していない。受付・判定・記録保存までの通し確認は、同じ組み合わせを使う自動テストが担う。例は `server/test/answer-photo-storage.test.ts`。

[合成記録で一覧・写真・削除を試す](owner-discoveries.md#合成記録で一覧写真削除を試す)は `QUEST_DISCOVERIES_MODE=memory` の起動時合成記録であり、回答判定のクリア手順とは別である。Vertex試験（`QUEST_DURABLE_PHOTO_MATCHER=vertex-trial`）は別のフィクスチャを使う。[永続回答からのVertex試験](vertex-trial.md#永続回答から試す)

## モードを選ぶ

審査では画面・APIとも `durable-local`、後退では画面 `local-api`・API `demo` を指定する。

## 開発用の後退

永続側の障害切り分けや過去の操作確認に限って使う。デモ実装・データは残すが、新しい機能は足さない。

```sh
QUEST_DATA_MODE=demo NODE_ENV=development npm run dev:api
```

別ターミナルで `VITE_QUEST_DATA_SOURCE=local-api npm run dev` を実行する。メモリデータはAPI再起動で消える。`/admin-demo` は未認証・画面内だけの架空フォーム。通常の `npm run dev` も開発時はこのメモリAPI向けなので、審査では永続側の指定を省略しない。

`npm run build` → `npm run preview` は既定では静的プレビュー。永続側の実API通し確認の代わりにはしない。

## 期待する動作

- ログインなしで公開問題を選び、地域で絞り込める。
- 通信失敗・不正な返却・10秒の応答待ち超過では取得失敗と再試行を表示する。読み込み中や0件でも「自分の記録」を開ける。
- Googleログイン後やログイン状態の復元後に、最新のID tokenで`GET /api/v1/session`を呼ぶ。応答のuidが現在のFirebase利用者のuidと一致した場合だけ「ログインを確認しました」と表示する。uid・token・SDKエラーは画面やログへ出さない。
- 認証確認で401/503、不正な応答、uidの不一致、通信失敗が起きた場合は、選んだ問題を保持し、確認をやり直す操作を表示する。Googleのポップアップは自動で開き直さない。
- 「挑戦を始める」で最新tokenと公開問題ID・版を開始APIへ渡す。一致する応答を得てからカメラを開く。開始待ちは取消・10秒での打ち切りに対応し、409は問題の読み直し、429はRetry-After後の手動再試行を案内する。
- ログアウト・利用者変更・画面終了時は進行中の通信を中止し、古い応答を反映しない。

以下は開発用の後退（`demo`）の制限。認証確認後は撮影、写真と位置の開発用受付、受付状態の照会を試せる。回答からの写真判定・クリア確定・記録保存は未接続。[撮影とデモ送信の手順](camera-preview.md#ローカルapiで回答を送る)

追加の開発用設定で、本人の合成記録や、自治体の下書きから合成試験・公開・休止までを試せる。[合成記録の設定](owner-discoveries.md#合成記録で一覧写真削除を試す)・[管理画面の設定](admin-demo.md#開発用の所属問題報告を閲覧する)

## 確認

```sh
npm run check
npm --prefix server run check
```

接続のテストはHTTP応答とAuthClientを明示的に代替し、問題取得、拒否・再試行、uid不一致、利用者変更後の古い結果の破棄を確認する。サーバー側は実SDKによる不正tokenの拒否も確認する。単体テストの成功を実Google ID tokenの正常系成功として扱わない。

実Googleアカウントでの開始API正常系と撮影入口は[撮影画面の確認記録](camera-preview.md#検証と残件)を参照。当時確認した `demo` の挑戦はメモリ上の開発用データで、再起動で消える。

インストール時に見つかったサーバー依存のmoderate警告6件は、直接依存の版を維持する`npm --prefix server audit fix --ignore-scripts`で対象外の依存構成へ更新し、0件になったことを確認した。`google-gax`は5.0.8から5.0.4、`gcp-metadata`は8.1.4から8.1.2へ解決し、対象のglob/minimatch系を含む不要な依存を除去した。lockfileを共有し、各自が別々の版に更新しない。

初期の接続確認では、ブラウザからの問題取得、API停止時のエラー、再起動後の再試行での復帰、375px・320px幅の横はみ出しなしを確認した。当時の型・lint・画面105テスト・サーバー55テスト・両ビルドも成功した。

2026-11-05に実Chromeと実Googleアカウントで、Googleログイン→Firebase ID tokenのサーバー検証→現在の利用者とのuid一致を確認し、「ログインを確認しました」の表示まで成功した。再読み込み後の認証復元とサーバーでの再確認、ログアウト後の匿名表示への復帰、ログイン前後とログアウト後に同じ問題を表示できることも確認した。Auth Emulatorや代替のAuthClient・HTTP応答は使っていない。確認後はログアウト済み。アカウント名・メール・uid・token・実設定値は共有資料へ記録しない。

実スマートフォンでの操作は未検証。失効確認、組織認可、実Maps、写真判定・保存はこの確認に含まない。
