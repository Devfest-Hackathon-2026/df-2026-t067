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

100円のCloud側制限と20回のアプリ側回数制限は別の仕組み。下記CLIは共有台帳による回数制限を実装した。CLIを通さない手動呼び出しや他PCの呼び出しまで自動で集計する仕組みではないため、試験全体の上限を共有する。

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

server専用の`createVertexTrialTransport`はADCでトークンを取得し、上記の固定RESTパスへNode fetchで1回だけPOSTする。推論の自動再試行・リダイレクト・別モデルへの切替はない。thinking LOW、最大出力1024token、全体30秒、JSON応答64KiB以内を試験用の保護値として使う。通常のHTTP回答APIやブラウザからは呼ばない。

台帳は秘密や写真を含まないJSONで、所有者専用0600の通常ファイルだけを扱う。初期化は明示コマンドだけで、現在確認済みの既使用5回を引き継ぎ、既存ファイルを上書きしない（開発中の最初の台帳は既使用1回から開始し、画像試験4回を加算済み）。送信前に加算・fsyncし、失敗や取消でも枠を戻さない。mkdirによる排他を通信完了まで保持し、20回到達・欠落・破損・他モデルの台帳・権限不備・ロック残りでは送信しない。異常終了時は安全側に停止し、台帳と残った通信を確認するまでロックを消さない。

同じMacの全worktree/プロセスで**同じ絶対パス**を使う。別の台帳の作成・複製・削除で残数を戻さない。ローカルファイルの排他であり、他PCやCLI外のリクエストを横断する分散上限ではない。既に共有台帳があれば初期化を飛ばしてそのパスを使う。

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

### 画像試験の記録（2026-11-05）

| 合成入力 | 実Vertexの結果 |
|---|---|
| 同じ赤い塔の図形2枚 | MATCH |
| 赤い塔と青い橋の図形 | WRONG_TARGET |
| 赤い塔と灰色一色・初回 | エラーで終了。詳細を取得していないため原因は確定できず、成功扱いしない |
| 同じ灰色入力・診断付き1回 | HTTP 200 / STOP、IMAGE_UNCERTAIN。約2.2秒 |

画像試験は4回送信（うち1回失敗）、初回テキスト1回と合わせて**使用済み5/20回、残り15回**。失敗分も加算し、台帳の排他解放を確認した。診断ではHTTP状態・終了理由・応答の長さだけを確認し、生のモデル出力や画像は保存していない。権利を確認した合成図形の少数試験であり、実スポット・別角度・不鮮明な実写真の精度評価ではない。

単体テストでは合成応答を使い、台帳の再初期化/上限/破損/権限不備/ロック残り、別プロセスからの再開、同時送信拒否、失敗時の加算、認証待ち/通信の期限と取消、非JSON/過大応答/ブロック/署名・非終了の扱いを確認する。ネットワークの自動再試行はない。

## 確認に使った公式資料

- [Gemini 3.8 Flashのモデル仕様](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-flash)
- [モデルの提供場所・データ処理の制約](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations)
- [モデル料金](https://cloud.google.com/model-garden/pricing)
- [Cloud Billingの利用額上限](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps)
- [ADCの設定方法](https://docs.cloud.google.com/docs/authentication/provide-credentials-adc)
- [generateContentの要求・応答とthinking設定](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/models/inference)

価格・対象サービス・モデルの提供条件は変更され得る。引換クレジットが今回のVertex利用へ適用されるかは未確認。
