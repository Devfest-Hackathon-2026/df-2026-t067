# 実Firestoreと非公開Storageの合成データ試験

実環境で、回答受付から初回記録の保存・本人照会・写真削除までを確認する。合成画像・架空座標・試験用の代替認証を使う。受付、回答worker、保存と削除には通常のサーバー実装を使う。照合の入力と判定は固定の合成素材で、判定精度や実Googleログインは別に検証する。

## 承認する試験構成案

| 項目 | 候補 |
|---|---|
| プロジェクト | `tour-513804` |
| リージョン | 東京 `asia-northeast1` |
| Firestore | 専用の名前付きDB `quest-integration`、Standard / Native、クライアントの読み書き拒否 |
| Cloud Storage | 専用バケット `tour-513804-quest-integration`、均一なバケットアクセス、公開アクセス防止を強制 |
| 実行範囲 | ループバックHTTPで合成データの試験を1回。既存の試験用サーバー認証を使用 |
| 写真削除の条件 | 試験バケットのオブジェクト版管理・保持ポリシー・ソフト削除を無効にし、削除対象の世代が取得できなくなることを確認 |

リージョン、費用条件、API有効化とリソース作成はO-01・O-06の承認を受けてから行う。既存の試験用認証で権限不足の場合は不足した権限を記録し、IAM変更を別途確認する。本人写真を受け付ける前に保持と削除の要件O-04を決める。[未決事項](decisions.md#3-要確認下書きモック作業を止めないが関係する実接続公開前に決める)

Firestoreの構成ファイルは名前付き試験DBを対象とする。本人記録の一覧には `uid` と日時順、地域で絞る一覧には `uid`・`areaId` と日時順の索引を用意する。同じ日時の並び順にはドキュメントIDの降順を使う。[名前付きDB](https://firebase.google.com/docs/firestore/manage-databases)・[索引の並び順](https://firebase.google.com/docs/firestore/query-data/index-overview#default_ordering_and_the_name_field)

## 承認後の初回設定

以下は上記の候補が承認され、専用DBとバケットが未作成の場合の手順。実行するアカウントと対象プロジェクトを確認する。利用者や運営のデータから分離したリソースを用意する。

```sh
gcloud services enable firestore.googleapis.com --project=tour-513804
gcloud firestore databases create --project=tour-513804 \
  --database=quest-integration --location=asia-northeast1 --edition=standard --type=firestore-native
gcloud storage buckets create gs://tour-513804-quest-integration --project=tour-513804 \
  --location=asia-northeast1 --uniform-bucket-level-access --public-access-prevention --soft-delete-duration=0
npm exec --yes --package=firebase-tools@15.35.0 -- firebase deploy \
  --config firebase.cloud-trial.json --only firestore --project tour-513804
gcloud firestore indexes composite list --project=tour-513804 --database=quest-integration
```

Firestoreの2件の索引が利用可能になったことを確認する。CLIに渡す構成は専用DBのルールと索引のみ。設定と実行記録は実アカウントの認証情報から分ける。[Storageバケットの作成](https://cloud.google.com/sdk/gcloud/reference/storage/buckets/create)

## 合成回答で検証する

リポジトリのルートで、試験用ADCとNode 26.7.0 / npm 11.19.0を使う。エミュレーター用の接続先を環境変数から外す。試験は指定のDBとバケットだけに接続し、リージョン、バケットの公開・削除設定、Firestoreの匿名アクセス拒否を確認してからデータを作る。

```sh
npm --prefix server ci --ignore-scripts
QUEST_CLOUD_TRIAL_RUN=approved QUEST_CLOUD_TRIAL_LOCATION=asia-northeast1 \
  npm --prefix server run test:cloud-storage
```

1. 同じ写真と回答キーの同時送信を同じ受付IDにまとめる。
2. 撮影範囲と写真を確認し、初回記録を確定する。全件と地域指定の一覧を取得し、本人以外の写真取得と削除を拒否する。
3. 受付時のJPEGを清掃し、本人による削除後に写真の世代を取得できないことを確認する。

専用DBには試験ID付きの架空の問題や受付・削除履歴が残る。成功時には試験に使ったJPEGを世代指定で削除する。途中失敗時は試験IDから残った合成データを特定し、試験用リソースの管理者が確認する。試験後のリソース削除は対象と影響を確認してから行う。

同じシナリオを既存のループバックのFirestoreエミュレーターとGCS代替でも実行できる。

```sh
QUEST_FIRESTORE_TEST_HOST=127.0.0.1:8688 QUEST_STORAGE_TEST_HOST=127.0.0.1:9688 \
  npm --prefix server run check
```
