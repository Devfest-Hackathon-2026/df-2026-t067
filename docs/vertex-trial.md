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

100円のCloud側制限と20回のアプリ側回数制限は別の仕組み。現在のアプリに、今回の20回を自動で制限する機能が実装されたという意味ではない。実装前の手動接続確認も台帳で数え、上限を共有する。

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
| 今回の試験台帳 | 1回使用／最大20回、残り19回。後続の実行者はこの使用分を引き継ぐ |

これは認証・モデル・エンドポイントの接続確認。画像送信、照合精度、A担当のサーバーtransport、利用回数の自動制限、費用の実請求・クレジット適用は未検証。

接続先のRESTパス：

```text
https://aiplatform.googleapis.com/v1/projects/tour-513804/locations/global/publishers/google/models/gemini-3.8-flash:generateContent
```

## A担当への引き継ぎ

Cloud/API/認証/費用設定はこの資料で共有し、アプリ側のtransport、回数制限、画像照合の接続はA担当が実装する。実値を読んでいない環境変数を追加しただけで接続済みにしない。

1. モデル・location・課金先を固定し、1回のAPI送信ごとに再試行も含めて数える。今回の台帳に使った回数を加算する。
2. 認証・API・画像の条件が揃ってから少数の試験を行う。失敗時に別のプロバイダーや成功モックへ切り替えない。
3. Gemini 3.8 Flashのthinkingは`LOW`・`MEDIUM`・`HIGH`に対応し、`MINIMAL`は非対応。短いJSONでも出力上限と時間制限の妥当性を実測する。128トークンで十分とは未確認。
4. 接続成功と写真判定精度は分けて報告する。不鮮明・別対象・通信障害・位置不確実を一つの不正解へまとめない。位置条件と写真条件の両方をサーバーで確認する製品要件は維持する。

## 確認に使った公式資料

- [Gemini 3.8 Flashのモデル仕様](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-flash)
- [モデルの提供場所・データ処理の制約](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations)
- [モデル料金](https://cloud.google.com/model-garden/pricing)
- [Cloud Billingの利用額上限](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps)
- [ADCの設定方法](https://docs.cloud.google.com/docs/authentication/provide-credentials-adc)

価格・対象サービス・モデルの提供条件は変更され得る。引換クレジットが今回のVertex利用へ適用されるかは未確認。
