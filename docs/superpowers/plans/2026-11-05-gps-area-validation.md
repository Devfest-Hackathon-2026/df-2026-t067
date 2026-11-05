# GPS撮影範囲判定 Implementation Plan

> **For agentic workers:** superpowers:executing-plansを使用し、ユーザー指定どおり単独実行する。

**Goal:** サーバーで位置・精度・撮影/測位時刻を検証し、範囲外と位置不確実を回答結果として区別する。範囲内だけで正解にしない。

**Architecture:** docs/architecture.md §5の球面距離と保守的な距離±精度の式を純粋関数にする。信頼されたサーバー設定から撮影範囲・上限を取得し、再送は既存受付を返して時刻鮮度を再判定しない。既定では従来の受付のみを維持し、QUEST_LOCATION_MODE=demoで合成範囲のGPS判定を有効化する。

**Tech Stack:** 既存Node 26.7.0 / npm 11.19.0 / TypeScript。新規依存・外部APIなし。

**Spec:** docs/architecture.md §5、docs/api.md、FR-06/07、AT-05/08/10/12/22。userの「続けて」に基づくA担当の次の作業。

## Global Constraints

- 真の円内: d+a <= r、真の円外: d-a > r、他は不確実。複数範囲は1つでも円内なら通過、全て円外なら範囲外。距離は6371008.8mの球面近似で、GPSの偽装・誤差の保証ではない。
- 撮影/測位が古い、許容以上の未来、両時刻の差が過大、精度上限超はLOCATION_UNCERTAIN。写真を先に固定してから測位するPR #15の順序にも対応し、時刻差は絶対値で検査する。
- 不正な入力は400 INVALID_INPUT、不正・未設定の有効化ポリシーやサーバー時計は503 SYSTEM_ERROR。サーバー設定をbodyやpublic DTOから採用しない。
- 開発用サンプル: 架空の0,0中心・半径100m、精度上限50m、撮影/測位の経過120秒、未来許容5秒、相互差30秒。QUEST_LOCATION_MODE=demo時だけ使い、本番O-03の決定としない。
- GPS不合格は200 COMPLETED/source:mockでOUTSIDE_AREA/MOVE_TO_AREAまたはLOCATION_UNCERTAIN/RETAKE。通過は202 RECEIVED/WAIT/outcome:null/source:mockのままで、画像判定worker・CORRECT・保存へ進めない。
- 共通clientは明示demo＋demoヘッダーで上記のGPS不合格だけを追加許可し、既定のmock拒否・mock正解/その他完了の拒否を維持する。
- 位置・写真は一時検証だけ。応答・保存領域・ログ・public GETへ中心/半径/距離/入力位置を出さない。実地点、実写真、AI、Firestore/Storage、画面送信、公開・課金は追加しない。

## Review Focus

- 境界の等号、精度の大きい中心点、複数範囲が混在する場合を誤って通過させない。
- 日付変更線・極付近・対蹠点で距離がNaNや長い経路にならない。
- 時間切れ後の同一再送は元の結果を維持し、別キーの新規回答に鮮度判定を適用する。
- 不正な設定を位置不確実や範囲外に隠さず、既存結果の照会・再送を壊さない。
- 開発用GPSの不合格を扱えるようにしてもmockの正解・保存を通さない。

## Task 1: 位置判定関数

Files: server/src/location.ts、server/test/location.test.ts。
- [x] 純粋関数evaluateLocation(metadata, policy, nowMs)の円内/外/不確実・時刻・複数範囲・不正入力/設定の失敗テストを確認。
- [x] 検証と球面距離・保守的な分類を実装し、型と単体テストを確認。

## Task 2: 受付と開発用モードへの接続

Files: server/src/answer-input.ts、answers.ts、server.ts、config.ts、main.ts、demo-location.ts。server/test/location-http.test.ts、config.test.tsと回答テストfixture。src/shared/api/client.tsとclient.test.ts。
- [x] 明示demoでGPS不合格、通過時の未判定維持、freshness再評価なしの再送、競合、本人以外の拒否、公開情報の非漏えいを実HTTPで確認。未接続時の5件の失敗を確認。
- [x] 入力metadataを一時的に評価へ渡し、storeは既存結果を先に返してから新規回答だけを評価する。
- [x] 設定値検査、明示モード、clientの狭い不合格結果の例外を接続する。共通clientの2件の失敗も確認してから実装。

## Task 3: 検証・共有

- [x] npm --prefix server run check（94件）とnpm run check（185件）、型・lint・build、重要な変更の単独レビューを実施。
- [x] docs/gps-validation.md、answer-intake.md、api.md、acceptance.md、decisions.md、READMEとserver/READMEへ操作・検査範囲・未実装を記録。

共有先はこのブランチの別PRとし、この依頼ではマージしない。実行用mainの一時起動でもGPS demo enabled・health 200・Firebase未設定時の回答503を確認し、終了後に停止した。実写真・実位置は利用していない。
