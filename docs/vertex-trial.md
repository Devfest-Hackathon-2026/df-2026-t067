# Vertex AI接続の試験設定

2026-11-05、ユーザーが次の条件を承認した。アプリ全体の本番設定ではなく、A担当の写真照合を実接続する前の小規模な試験に適用する。

## 合意した条件

| 項目 | 試験用の値・扱い |
|---|---|
| Google Cloudプロジェクト | `tour-513804`（`tourism-quest-dev`） |
| 接続先 | Vertex AIの`aiplatform.googleapis.com`。管理画面ではAgent Platform APIと表示される |
| モデルID | `gemini-3.8-flash`。別モデル・Google AI Studioへの自動切替はしない |
| モデルのlocation | `global`。日本国内だけで処理する保証はない |
| 試験費用の目標 | 100円。クレジットで無料になることを前提にしない |
| 呼び出し回数 | 接続確認と再試行も含め、今回の試験全体で最大20回。初期は同時実行1、自動再試行なし |
| 送信画像 | 権利を確認でき、人物・個人情報を含まない試験用画像だけ。一般利用者の写真送信は別途判断する |

`global`はモデルへの接続先の指定であり、Firestore・Storage・Cloud Runの作成先を決めるものではない。実画像による照合精度、撮影許可、保存期間、一般公開向けのプライバシー説明は未確定のまま。

## Cloud側の設定

- 対象プロジェクトで`aiplatform.googleapis.com`のステータス「有効」を確認済み。
- 月次の利用額上限`tourism-quest-vertex-trial-100jpy`を作成済み。対象はこのプロジェクトのVertex AIだけ、100円、通知は50%・80%・100%。管理画面の状態は「構成済み」。
- この上限はクレジット・割引を引く前の推定利用額を基準にする。反映に時間差があり、100円超過を厳密に防ぐものではない。毎月リセットされ、停止していた利用も再開される。試験終了時は利用停止・上限の扱いを管理者が確認する。
- 既存のプロジェクト全体の月1,000円の通知予算は維持する。こちらは利用を停止しない。
- Google Cloud CLI 592.0.0を試験用Macへ導入した。ローカル認証と実リクエストの確認状況は下記に記録する。

Cloud側の100円は推定利用額の上限設定で、アプリ側の20回は試験回数の制限。下記のCLIは共有台帳を使って回数を制限する。CLIを通さない手動呼び出しや他PCからの呼び出しは自動で集計されないため、試験全体の上限はチームで共有する。

共有検証の回答試験（D-15）を有効化する場合は、同じ20回の上限を名前付きFirestoreのカウンタ（`vertexTrialCounters/vertex-photo-2026-11-05`）で数える。有効化の前に共有台帳の使用数をカウンタへ引き継ぎ、以後は台帳とカウンタの合算が20回を超えないよう、送信する側を一本化して管理する。手順は[共有検証の回答試験](team-preview.md#回答試験4人限定)を参照。

## 認証と接続確認

ADC（Application Default Credentials）は、サーバー用SDKがローカルの認証情報を見つける仕組み。Firebase CLIのログイン、旅行者のGoogleログインとは別。

ユーザーの明示承認により、このMacではGoogle公式Auth Libraryへ個人アカウントのCloudアクセスを許可する。ローカルADCは当該アカウントの既存権限で動き、Vertex AIだけに限定されない。認証情報はGit・PR・チャット・ブラウザ用の`VITE_`設定へ渡さない。他メンバーへファイルを配布しない。本番は実行サービスアカウント等を別途設計し、長期秘密鍵を新規発行しない。

2026-11-05 22:48 JST、ローカルADCの保存、課金・割当先プロジェクト`tour-513804`、ファイル権限0600を確認した。秘密の値は記録しない。

| 実接続の確認 | 結果 |
|---|---|
| 入力 | 接続確認用の短い合成テキスト。写真なし |
| API | `generateContent`、HTTP 200 |
| 応答モデル | `gemini-3.8-flash` |
| 応答 | `{"status":"ok"}`、終了理由`STOP` |
| 設定 | 同時実行1、自動再試行0、thinking `LOW`、最大出力1,024トークン、JSON形式 |
| 利用量 | 入力67・出力5、計72トークン |
| 初回テキスト確認時の台帳 | 1回使用／最大20回。最新の使用分は下の画像試験記録を参照 |

このテキスト試験だけでは画像照合の精度や回数制限を検証していない。後続のtransportと画像試験は下記を参照。費用の実請求・クレジット適用は未検証。

接続先のRESTパス：

```text
https://aiplatform.googleapis.com/v1/projects/tour-513804/locations/global/publishers/google/models/gemini-3.8-flash:generateContent
```

## A担当への引き継ぎ

Cloud/API/認証/費用設定とA担当の試験用transport/回数制限はこの資料で共有する。回答worker・保存の接続は後続。実値を読んでいない環境変数を追加しただけで接続済みにしない。

1. モデル・location・課金先を固定し、1回のAPI送信ごとに再試行も含めて数える。今回の台帳に使った回数を加算する。
2. 認証・API・画像の条件が揃ってから少数の試験を行う。失敗時に別のプロバイダーや成功モックへ切り替えない。
3. Gemini 3.8 Flashのthinkingは`LOW`・`MEDIUM`・`HIGH`に対応し、`MINIMAL`は非対応。短いJSONでも出力上限と時間制限の妥当性を実測する。128トークンで十分とは未確認。
4. 接続成功と写真判定精度は分けて報告する。不鮮明・別対象・通信障害・位置不確実を一つの不正解へまとめない。位置条件と写真条件の両方をサーバーで確認する製品要件は維持する。

## ローカルの画像試験

server専用の`createVertexTrialTransport`はADCでトークンを取得し、上記の固定RESTパスへNode fetchで1回だけPOSTする。推論の自動再試行・リダイレクト・別モデルへの切替はない。thinking LOW、最大出力1024token、全体30秒、JSON応答64KiB以内を試験用の保護値として使う。CLIと明示した永続回答の試験モードで使う。

台帳は秘密や写真を含まないJSONで、所有者専用0600の通常ファイルだけを扱う。初期化は明示コマンドだけで、現在確認済みの既使用5回を引き継ぎ、既存ファイルを上書きしない（開発中の最初の台帳は既使用1回から開始し、画像試験4回を加算済み）。送信前に加算・fsyncし、失敗や取消でも枠を戻さない。mkdirによる排他を通信完了まで保持し、20回到達・欠落・破損・他モデルの台帳・権限不備・ロック残りでは送信しない。異常終了時は安全側に停止し、台帳と残った通信を確認するまでロックを消さない。

同じMacの全worktreeとプロセスで**同じ絶対パス**を使う。別の台帳の作成・複製・削除で残数を戻さない。この台帳は同じローカルファイルを使うCLIとworkerの送信を数える。別PCや台帳を通らない送信は集計できない。既存の共有台帳は初期化せずに使う。

CLIはリポジトリルートの`.env.local`があれば読み込む（明示した環境変数が優先）。担当Aの環境には共有台帳の実パスを`QUEST_VERTEX_TRIAL_LEDGER`として保存済みで、Gitには含めない。別worktreeで試す場合も同じ実パスを引き継ぐ。

共有台帳は既に作成済み。以下は台帳を引き継げない場合に、管理担当が最新の既使用回数を確認して一度だけ設定する例。5回以降に追加の試験があれば、初期値も更新してから実行する：

```sh
mkdir -p .vertex-trial
export QUEST_VERTEX_TRIAL_LEDGER="$PWD/.vertex-trial/ledger.json"
export NODE_ENV=development
npm --prefix server ci --ignore-scripts
npm --prefix server run build
npm --prefix server run vertex:trial -- init
```

続いて少数の試験を1つずつ行う。コマンド1回ごとに台帳を使う。`.vertex-trial/`はGit対象外で、ADCファイルもGit/メンバー間で配布しない。

```sh
npm --prefix server run vertex:trial -- match
npm --prefix server run vertex:trial -- mismatch
npm --prefix server run vertex:trial -- uncertain
```

CLIはコードで生成した架空の図形だけを使い、写真ファイル・URL・任意プロジェクトを引数に受け取らない。結果は内部のMATCH/WRONG_TARGET/IMAGE_UNCERTAINで、CORRECTや本人記録を作らない。認証/通信/不正応答時は失敗で終了し、生のSDKエラー・応答・トークン・画像をログへ出さない。

### 永続回答から試す

開発環境の `durable-local` で `QUEST_DURABLE_PHOTO_MATCHER=vertex-trial` を明示すると、回答workerが同じtransportを使う。CLIで使っている `QUEST_VERTEX_TRIAL_LEDGER` と既存のADCが必要。FirestoreとGCSの接続先はループバックのまま使う。[永続APIの起動手順](../server/README.md#永続apiをローカルで起動する)

workerは非公開の参考JPEGを世代指定で取得する。正規化後の参考・回答の両画像と特徴がコード内の合成画像に一致するときだけ送信する。対象外の画像や特徴はVertexへの認証・通信の前に拒否する。回答の判定にはVertexの応答を使う。

赤い塔を使う場合は、サーバーのビルド後にリポジトリのルートで下記を実行する。出力した `match.png` を参考画像と一致する回答に使い、`features.txt` の内容を下書きの確認済み特徴に設定する。`mismatch.png` は別対象、`uncertain.png` は確認困難な図形。ローカルの参考・回答画像を確認した後、CLIと同じJPEGを送る。

```sh
fixture_dir=$(mktemp -d /tmp/quest-vertex-fixtures.XXXXXX)
node - "$fixture_dir" <<'NODE'
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { renderVertexTrialFixture, vertexTrialCases, vertexTrialFeatures } =
  require('./server/dist/server/src/vertex-trial-fixtures.js')
const dir = process.argv[2]
Promise.all(vertexTrialCases.map(async (kind) => {
  writeFileSync(join(dir, kind + '.png'), await renderVertexTrialFixture(kind))
})).then(() => {
  writeFileSync(join(dir, 'features.txt'), vertexTrialFeatures.join('\n'))
  console.log(dir)
}).catch(() => { process.exitCode = 1 })
NODE
```

自動テストではFirestoreとGCSの代替環境で、受付、参考画像取得、固定REST宛ての要求、台帳の加算、本人記録まで確認する。Vertexの応答はテスト用に代替する。

### 永続回答での実Vertex確認（2026-11-06）

FirestoreとGCSはローカルの代替環境、Google認証はテスト用の代替を使った。2×2の合成画像では実VertexがHTTP 200で `IMAGE_UNCERTAIN` を返した。赤い塔の合成画像ではHTTP 200で一致し、回答workerが `CORRECT` を確定した。本人の写真取得・削除と、別の利用者からの取得拒否まで確認した。

回答workerからの送信は各1回で、共有台帳は5/20回から7/20回になった。どちらも合成画像による結果。実写真での精度と実クラウド上の保存は未検証。

### 画像試験の記録（2026-11-05）

| 合成入力 | 実Vertexの結果 |
|---|---|
| 同じ赤い塔の図形2枚 | MATCH |
| 赤い塔と青い橋の図形 | WRONG_TARGET |
| 赤い塔と灰色一色・初回 | エラーで終了。詳細を取得していないため原因は確定できず、成功扱いしない |
| 同じ灰色入力・診断付き1回 | HTTP 200 / STOP、IMAGE_UNCERTAIN。約2.2秒 |

この時点の画像試験は4回送信（うち1回失敗）、初回テキスト1回と合わせて**使用済み5/20回**。失敗分も加算し、台帳の排他解放を確認した。診断ではHTTP状態・終了理由・応答の長さだけを確認した。権利を確認した合成図形での試験で、実スポット・別角度・不鮮明な実写真の精度は未検証。

単体テストでは合成応答を使い、台帳の再初期化/上限/破損/権限不備/ロック残り、別プロセスからの再開、同時送信拒否、失敗時の加算、認証待ち/通信の期限と取消、非JSON/過大応答/ブロック/署名・非終了の扱いを確認する。ネットワークの自動再試行はない。

## A04の合成生成を試す

生成用途での送信を承認した後に、既存の共有台帳を指定して、永続ローカルAPIへ `QUEST_DURABLE_DRAFT_GENERATOR=vertex-trial` を追加する。通常の永続起動手順と実Googleログイン、編集者または公開担当者の開発用所属が必要。[永続APIの起動](local-api.md#永続apiをローカルで起動する)

1. 上記の赤い塔の `match.png` を参考画像として登録する。対象名は `赤い塔（合成）`、根拠は次の3行を使い、写真の利用権を記入して保存する。
2. A04で「保存済み版の候補を取得」を1回選ぶ。Vertexの候補にタイトル・問題文・3本のヒント・特徴・メモが表示されることを確認する。
3. 取得前後の下書き版が同じことを確認する。候補の内容を確認したら、必要に応じて編集欄へ取り込んで保存する。

```text
赤い縦長の塔
三角の屋根
縦に並ぶ白い窓が2つ
```

外部送信は一致した合成JPEGとコード内の確認済み事実に限定する。撮影地点や自治体のメモ、利用権欄の内容はリクエストに含めない。生成結果は指定のJSON構造、長さ、3本のヒント、事実の参照番号をサーバーで確認する。表現の根拠確認は担当者が行う。[Vertexの構造化出力](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/control-generated-output)

照合と同じ台帳で送信前に加算し、失敗・取消も1回として扱う。生成モードを選ぶ操作は写真照合のモードとは独立している。外部送信の試験が未実施の間は、ローカルの代替応答での検証として扱う。

同じ塔でA05の写真照合試験を続ける場合は、上記の塔用の照合モードを選び、下書きの確認済み特徴を `features.txt` の照合試験用の値に整えてから保存する。生成候補の特徴は担当者が確認する下書きで、試験用に固定した照合条件とは別に扱う。

## 確認に使った公式資料

- [Gemini 3.8 Flashのモデル仕様](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-flash)
- [モデルの提供場所・データ処理の制約](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations)
- [モデル料金](https://cloud.google.com/model-garden/pricing)
- [Cloud Billingの利用額上限](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps)
- [ADCの設定方法](https://docs.cloud.google.com/docs/authentication/provide-credentials-adc)
- [generateContentの要求・応答とthinking設定](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/models/inference)

価格・対象サービス・モデルの提供条件は変更され得る。引換クレジットが今回のVertex利用へ適用されるかは未確認。
