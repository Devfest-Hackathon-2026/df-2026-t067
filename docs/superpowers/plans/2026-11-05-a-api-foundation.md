# A担当・共通API土台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans。ユーザーの方針に従い単独実行する。

**Goal:** B/Cが共有する、公開閲覧・挑戦・回答・本人記録のデータ契約とHTTPクライアントを用意する。

**Architecture:** src/shared/apiに型・検証・HTTP処理をまとめる。既存の架空プレビューは維持し、実サーバー・Firebase・AIへの自動接続は追加しない。

**Tech Stack:** 既存のTypeScript / Vitest / Fetch API。依存追加なし。

**Spec:** docs/api.md、docs/architecture.md、docs/acceptance.mdのAT-02/03/08/09/10/22。

## Global Constraints

- /api/v1、既存DTO名・結果コード・Bearer認証を引き継ぐ。
- 個人APIはキャッシュ禁止。回答POSTの自動再送・成功モックを追加しない。
- 時刻と座標の形式は検査する。未決の位置精度・経過時間の閾値は決めない。
- Google認証本体、サーバー、AI、保存、自治体の編集APIは次の作業。

## Review Focus

- 公開データへの正解・未知の項目の混入を検出する。
- 不正な位置・日時、完了前の正解、保存先のない正解を受理しない。
- tokenを公開リクエスト・別オリジン・URLへ送らない。
- 409/503の判定結果の回答IDを保ち、POSTを自動再送しない。
- 実APIにmockを混ぜず、取消を通常エラーへ潰さない。

## Task 1: データ契約

**Files:** src/shared/api/types.ts、validation.ts、validation.test.ts、testFixtures.ts

**Interfaces:** parsePublicArea、parsePublicQuest、parseChallenge、parseCaptureMetadata、parseAttemptResult、parseDiscovery、parsePage。不正データはContractError。

- [x] 正常系とReview Focusの入力検証ケースをテストし、失敗を確認する。
- [x] 型と境界検証を実装し、全テスト成功を確認する。

## Task 2: HTTPクライアント

**Files:** src/shared/api/client.ts、client.test.ts、index.ts

**Interfaces:** createApiClient({ fetch?, getIdToken?, basePath? })。公開一覧・詳細、挑戦開始、写真回答、回答照会、本人記録の一覧・詳細。失敗はApiError、取消はAbortError。

- [x] 認証・クエリ・multipart・失敗・取消・mock拒否をテストし、失敗を確認する。
- [x] 呼び出しと検証を実装し、npm run checkを通す。

## Task 3: 共有・レビュー

- [x] API設計と決定記録へ利用方法・今回の実装判断・未接続範囲を追記する。
- [x] Aはユーザー本人と役割表へ反映する。GitHubアカウント名やB〜Dは推測しない。
- [x] 差分を単独レビューし、必要な修正を検証する。
- [ ] 専用ブランチへコミットし、PRを作る。mainへはマージしない。

## 実行記録

- 着手前：npm run check成功、画面テスト3件成功（/tmp/df-t067-baseline-check.log）。
- PR #3の資料競合を解消。merge commit 6caf673のtreeは既存の検証済みアプリと同一。
- Ruling: 最初の契約は旅行者向けの6 DTOに絞る。自治体の下書き構造は後続で定義し、Dは独自の共通型を作らずAPI設計案を参照する。
- Ruling: 管理されたworktreeに直接編集できないため、同じcommitを一時領域へ展開して実装・テストし、対象差分だけworktreeへ反映する。

- Task 1: 27件の失敗を確認後、共通型と検証を実装。全30件成功。
- Task 2: 共通setupがDOMを前提としていたため、HTTPテストもjsdomへ統一（systematic-debuggingで原因確認）。21件の未実装失敗を確認後に実装。npm run check成功、全51件成功。
- Final review: self-review（ユーザーの単独実行方針）。公開項目、認証、取消、回答再送、mock分離を確認。追加の重大・重要指摘なし。
