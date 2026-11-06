# 4人で使う共有検証環境

チームの4人が共通URLでGoogleログインし、同じ架空の問題を確認する。自治体画面 `/admin` で下書き・撮影範囲・合成素材を登録し、写真試験、確認依頼、公開・休止を行う。旅行者画面 `/` では公開中の問題と通常ヒントを確認する。設定の相談は [Issue #102](https://github.com/Devfest-Hackathon-2026/df-2026-t067/issues/102) にまとめる。

この環境では旅行者のカメラ起動、回答、本人記録、問題報告を扱わない。写真試験と下書き候補には合成素材用の処理を使う。架空の問題と自作の合成素材を用意し、個人写真や実在スポットの正解は登録しない。

## 構成と承認事項

- 共有用のWebとAPIは別のCloud Runサービス `quest-team-preview` にまとめる。Firebase Hostingの静的プレビューとローカル環境は、それぞれの起動設定を使う。
- Cloud RunのURLからログイン画面を開けるようにする。APIはFirebase IDトークンと、サーバーに設定した4人のUIDを照合する。編集と公開・休止の権限は、専用Firestoreに登録した自治体所属で確認する。
- データは名前付きFirestore `quest-team-preview` と非公開の `<プロジェクトID>-quest-team-preview` バケットに分ける。Firestoreのクライアント読み書きはすべて拒否する。Storageは均一なバケットアクセスと公開アクセス防止を使う。サーバーはバケットのプロジェクト番号と非公開設定を起動時に検査する。
- 候補は既存の開発用Google Cloudプロジェクトの東京リージョン。Cloud Runは最小0、最大1インスタンスから始める案とし、作成前にプロジェクト、リージョン、費用条件、停止担当を確認する。台数の設定に加え、Firestoreの操作と画像・イメージの保管も費用に含め、停止担当が利用額と削除を確認する。4人のうち誰を編集担当と公開担当にするかも確認する。公開・IAM・API有効化は [リポジトリの承認条件](decisions.md#3-要確認下書きモック作業を止めないが関係する実接続公開前に決める) に従う。

## 承認後の準備

1. 承認を得たAPIのうち未有効のものを有効にする。候補は Cloud Run（`run.googleapis.com`）、Firestore（`firestore.googleapis.com`）、Artifact Registry（`artifactregistry.googleapis.com`）、IAM（`iam.googleapis.com`）、Cloud Storage（`storage.googleapis.com`）。Firebaseの開発用Webアプリと同じプロジェクトに、名前付きFirestore、非公開バケット、コンテナの格納先を用意する。`firebase.team-preview.json` の対象DBを確認し、`firebase deploy --config firebase.team-preview.json --only firestore:rules --project <プロジェクトID>` でクライアント拒否ルールを適用する。
2. Cloud Runには専用の実行サービスアカウントを割り当てる。必要な権限は、対象Firestoreの読み書き、対象バケットのメタデータとオブジェクトへのアクセス、Firebaseユーザーの有効状態の照会。ローカルの資格情報やサービスアカウント鍵をイメージへ入れない。
3. Firebaseで4人のGoogleアカウントに対応するUIDを確認する。`QUEST_TEAM_UIDS` に4つをカンマ区切りで渡す。`FIREBASE_PROJECT_ID` と `QUEST_TEAM_PROJECT_NUMBER` には承認済みのプロジェクトを指定する。Cloud Runが供給する `PORT` で待ち受ける。UID一覧と資格情報はGitやIssueに記録しない。
4. 下記の初期データを作成し、`Dockerfile.team-preview` から `linux/amd64` のイメージをビルドする。[Firebase設定表](firebase-auth.md#2-各開発者の設定)の6項目を同名の `--build-arg` で渡す。初回は `VITE_GOOGLE_MAPS_API_KEY` を空にして、地域と問題の選択欄で確認できる。地図も試す場合は、共有URLのホスト名を許可したキーを設定する。サーバーはビルド時と起動時のFirebaseプロジェクトIDの一致を確認する。
5. イメージを承認済みのレジストリへ格納してCloud Runへ配置する。Cloud Runの未認証の呼び出しを許可し、ログイン画面を開けるようにする。データのAPIではFirebaseによる4人の認証を必須にする。URLのホスト名をFirebase Authenticationの承認済みドメインに追加する。`/health` が `dataMode: team-preview` を返し、招待済みアカウントで共有画面を開けることを確認する。

初回の配置では、前節のサーバー設定3項目をGit管理外の `.env.team-preview.yaml` に保存し、承認された値をシェルに設定して実行する。[Cloud Runの配置コマンド](https://cloud.google.com/sdk/gcloud/reference/run/deploy)

```sh
gcloud run deploy quest-team-preview \
  --project "$FIREBASE_PROJECT_ID" --region "$QUEST_TEAM_REGION" \
  --image "$QUEST_TEAM_IMAGE" --service-account "$QUEST_TEAM_SERVICE_ACCOUNT" \
  --env-vars-file .env.team-preview.yaml --port 8080 \
  --min-instances 0 --max-instances 1 --allow-unauthenticated
```

### 架空の地域と所属を作る

環境の管理者が初回に行う。リポジトリのルートで `npm --prefix server run build` を実行し、実行するシェルへ `NODE_ENV=production`、`QUEST_DATA_MODE=team-preview` と前節の3つの設定を渡す。4人から選んだ編集担当・公開担当のUIDを `QUEST_TEAM_EDITOR_UID` と `QUEST_TEAM_PUBLISHER_UID` に指定する。用意した専用DBと実行アカウントを確認してから次を実行する。既存データを上書きしない。

```sh
node <<'NODE'
const { createHash } = require('node:crypto')
const { initializeApp, deleteApp } = require('./server/node_modules/firebase-admin/app')
const { getFirestore } = require('./server/node_modules/firebase-admin/firestore')
const { readConfig, teamPreviewDatabase } = require('./server/dist/server/src/config.js')

async function seed() {
  const config = readConfig(process.env)
  const editor = process.env.QUEST_TEAM_EDITOR_UID
  const publisher = process.env.QUEST_TEAM_PUBLISHER_UID
  if (config.mode !== 'team-preview' || !editor || !publisher || editor === publisher ||
    !config.allowedUids.has(editor) || !config.allowedUids.has(publisher)) throw new Error('Check team roles')
  const app = initializeApp({ projectId: config.firebaseProjectId })
  try {
    const db = getFirestore(app, teamPreviewDatabase)
    const batch = db.batch()
    const areaId = 'demo-area'
    const orgId = 'demo-org'
    batch.create(db.collection('areas').doc(areaId), {
      label: '架空の検証地域', marker: { latitude: 0, longitude: 0 },
      publicGeometryJson: JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }),
    })
    for (const [uid, role] of [[editor, 'editor'], [publisher, 'publisher']]) {
      const id = createHash('sha256').update(JSON.stringify([uid, orgId])).digest('hex')
      batch.create(db.collection('memberships').doc(id), { uid, role, orgId, areaId, active: true, label: '架空の自治体' })
    }
    await batch.commit()
    console.info('共有検証用の地域と所属を作成しました。')
  } finally { await deleteApp(app) }
}
seed().catch(() => { console.error('共有検証用の初期設定に失敗しました。対象DBと既存データを確認してください。'); process.exitCode = 1 })
NODE
```

## チームでの確認

1. `/admin` を開き、編集担当が下書き・合成参考画像・撮影範囲を保存する。[合成素材の生成](admin-photo-tests.md#合成素材を生成する)の画像を使い、確認済み特徴に `合成の確認済み特徴` を入力する。同じ版で一致と別対象の試験を行い、確認を依頼する。
2. 公開担当が同じ下書きを開き、自分の画面で同じ版の一致と別対象を再試験して公開する。試験結果の選択は画面内に保持する。
3. 別の招待済みメンバーが `/` を開き、公開情報を更新して同じ問題とヒントを見る。公開担当が休止すると、更新後に問題が一覧から消える。
4. 招待外のアカウントでは、URLを知っていても一覧・画像・管理APIにアクセスできないことを確認する。自治体の所属がないメンバーは、招待されていても下書きを編集できない。検証を終えるときは停止担当がサービスを停止し、検証用データの保持・削除を確認する。
