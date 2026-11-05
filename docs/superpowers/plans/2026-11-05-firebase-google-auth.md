# Firebase接続・Googleログイン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans。今回も単独実行する。

**Goal:** .env.localの設定でFirebase Authenticationへ接続し、問題を保持したGoogleログイン・取消・ログアウト・状態復元を提供する。

**Architecture:** 設定の読込、Firebase SDKとの接続、Reactの表示を分ける。認証状態はFirebaseのobserverを参照し、アプリ独自に成功を保存しない。

**Tech Stack:** Firebase 13.2.0 / React / TypeScript / Vitest。

**Spec:** docs/screens.mdのT02/T03/T04、docs/acceptance.mdのAT-03、ユーザー提供の設定ファイルと今回の依頼。

## Global Constraints

- 実設定は.env.localのみ。設定ファイル・値・token・個人メールをGitHubへ追加しない。
- Googleログインは明示操作から開始する。閲覧に認証を必須にしない。
- 成功・取消・失敗後も選択中の問題を保持する。写真判定・保存の成功を作らない。
- Firebase管理設定・クラウドの課金・デプロイは変更しない。
- 既存の共通APIはPR #4で共有済み。今回の認証は別PRにする。

## Review Focus

- 設定なし・一部不足でSDKを初期化しない。
- ポップアップを開く前のawaitで利用者のクリックを失わない。
- session復元前に未ログインと断定せず、最新のFirebase ID tokenを使う。
- キャンセル・ポップアップ拒否・権限ドメイン・通信失敗を安全な日本語で案内する。
- 画面やログにtoken、Firebaseの生エラー、メール等を転記しない。

## Tasks

- [x] 設定・SDK接続のテストを先に失敗させ、必要な6設定とAuthClientを実装する。
- [x] 問題保持・成功・取消・失敗・再ログイン不要・ログアウトのUIテストを先に失敗させ、画面へ接続する。
- [x] .env.example、ローカル起動・許可ドメイン・テスト手順と未検証の範囲を更新する。
- [x] npm run check、設定値のGit除外と差分内の実値不在を確認する。
- [x] 実設定でSDKの起動とGoogle認証画面への接続をブラウザ確認する。
- [x] 差分を単独レビューし、専用ブランチの別PRとして共有する差分を用意する。

## 実行記録

- 公開認証設定の読み取りでlocalhostが許可されていることを確認。127.0.0.1は許可対象にないため、確認URLにはlocalhostを使う。
- Ruling: ローカル開発ではGoogleのポップアップ方式を採用する。redirect方式の別オリジン保存領域への依存を避ける。スマートフォンのポップアップ操作は実機で別途検証する。
- Ruling: Googleログイン後も撮影・写真判定・記録は未実装と案内する。架空の問題で認証の動作を確認し、実サーバーへ挑戦成功を送らない。

- 設定とSDK境界24件、UI 6件を実装前に失敗させてから実装。既存を含む全81件、型・lint・build成功。
- Chromeで本人によるGoogleアカウント選択・確認後にログイン成功。同じ問題の保持、再読み込み後の復元、ログアウトまで確認。
- Google確認画面の待ち時間があり、ウィンドウを前面へ出した後に完了。原因は断定していない。

- Final: npm ci成功、全83テスト・型・lint・build成功（/tmp/df-t067-firebase-final-check.log）。実設定6値が全stagedファイルに含まれず、.env.localがGit対象外であること、相対リンク38件を確認。
- Final review: self-review（ユーザーの単独実行方針）。状態復元を待つtoken取得、既存appの接続先不一致、ログアウト失敗の回帰テストを追加。重大・重要な未対応指摘なし。
- Ruling: @firebase/util / protobufjsの追加インストールスクリプトを明示的に無効化。今回のブラウザAuthでは不要であり、この条件の新規インストールと実認証を確認した。今後それらの別機能を使うときは再確認する。
