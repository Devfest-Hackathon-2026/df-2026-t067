# 回答受付API Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans; 本件はユーザー指定どおり単独で実行する。

**Goal:** 開発用APIで写真・CaptureMetadataを本人の挑戦に結び付けて受け付け、同じ回答を再送しても同じ受付結果を返す。

**Architecture:** 既存のFirebase認証・Challenge所有者検証と共通DTO/clientを使う。multipartはNode標準Request.formDataで解析する前に受信量・時間・同時数を制限する。画像・位置そのものを保存せず、正規化した入力のSHA-256と所有者付き受付結果だけを上限付きメモリで管理する。

**Tech Stack:** Node 26.7.0、npm 11.19.0、既存TypeScript/Node HTTP/crypto。依存追加なし。

**Spec:** docs/api.md §3/5、docs/requirements.md FR-05/07/08、AGENTS.md。ユーザーの「流れで進める」依頼に基づく回答受付の段階。判定・保存成功を返さない。

## Global Constraints

- POST /challenges/:id/answersとGET /attempts/:idを実装する。認証は既存検証器。queryやbodyからuid・権限を採用しない。
- 開発用受付は202、AttemptResultはRECEIVED/outcome:null/nextAction:WAIT/source:mock。判定worker未接続で自動進行しない。共有clientは既定でmockを拒否し、明示したexpectedDataMode:demoかつdemoヘッダーの受付状態だけを例外にする。mockの完了結果は許可しない。
- Idempotency-Keyは可視ASCIIの1〜128文字。uid＋challengeId＋keyを一意とし、同じ写真bytes・正規化metadataは同じ結果、違う内容は409 IDEMPOTENCY_CONFLICT。既存受付の再送は将来の時間鮮度判定を再適用しない。
- 写真はJPEG/PNG/WebP、4MiBまで。multipart全体4MiB＋16KiB、metadataは4KiB、受信5秒、受付256件・利用者10要求/60秒・受信同時4件。いずれも開発用保護値で、本番のO-03を確定しない。MIMEとシグネチャを確認するが画像デコード・画素数検査は後続。
- 写真・正確な位置・ファイル名・token・内部エラーをログ／ディスク／応答へ出さない。受付のhash・所有者・キーはプロセス内だけ。再起動すると消える。
- 写真/GPSの画面送信、実Googleによる写真送信、外部AI、Firestore/Storage、公開・課金・クリア確定、実データの休止処理は追加しない。現在の公開デモ問題と版は受付時に再確認する。

## Review Focus

- 別利用者・不明挑戦／受付は区別しない404。GETも毎回認証する。
- 同時送信・異なるmultipart境界・metadataキー順でも同一内容の再送は増殖しない。
- 本文が切れた／大きい／遅い場合も期限と受信枠を解放し、次の要求を処理できる。
- 容量や回数制限は既存受付の内容を上書きせず、明示的エラーとRetry-Afterを返す。
- mock受付例外でmock正解やdemoヘッダーなしの応答を許容しない。

## Task 1: 共通clientの開発用受付境界

Files: src/shared/api/client.ts、client.test.ts。
- [x] 明示demoのみのRECEIVED許可、既定・ヘッダーなし・mock完了の拒否テストを追加し、失敗を確認。
- [x] 狭い受付デコードの例外を実装し、型・対象テストを確認。

## Task 2: サーバー受付・所有者照会・冪等性

Files: server/src/answer-input.ts、answers.ts、request-body.ts、json-body.ts、server.ts、server/test/answers.test.ts。
- [x] 実HTTPで受付・再送・同時送信・所有者分離・入力境界・上限・切断を検証。未実装ルートが404となる失敗を確認。
- [x] 既存の受信処理を共用し、multipart検証とhash、上限付き受付領域、ルートを実装。
- [x] サーバー全体のcheckで既存の認証・公開GET・挑戦開始も確認。

## Task 3: 資料と共有

Files: docs/answer-intake.md、api.md、acceptance.md、decisions.md、README.md、server/README.md。
- [x] 接続方法、RECEIVEDから進まないこと、未実装・上限・破棄の境界を記録。
- [x] npm run check（180件）、npm --prefix server run check（81件）、型・lint・build、差分・リンク・秘密情報除外を確認し、重要な変更を単独レビュー。

共有はこのブランチの別PRとし、マージは行わない。認証は代替検証器、画像・位置は合成データだけ。切断テストでは通常のsocketエラーを失敗扱いしていた待機方法を修正してからサーバー全体を再実行した。
