# 公式参考資料と確認範囲

確認日: 2026-11-05。リンク先の提供条件・名称・料金・SDKは変わり得るため、実設定時に再確認する。以下は技術上の根拠であり、アプリの安全性や実装成功を保証する資料ではない。

## S1 — Codexの共有指示

[OpenAI: Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

AGENTS.mdをプロジェクトの共通指示として置く理由。記述だけで権限やレビューが強制されるわけではない。

## S2 — Googleログイン

[Firebase: Authenticate Using Google with JavaScript](https://firebase.google.com/docs/auth/web/google-signin)

Google認証、許可ドメイン、認証後の処理の参考。自治体の所属認可は別途実装する。

## S3 — Google Cloud側の認証と画像入力

[Google Cloud: Application Default Credentials](https://docs.cloud.google.com/docs/authentication/application-default-credentials)

[Google Cloud: Gemini画像理解](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-understanding)

サーバーのADC・実行サービスアカウント、および画像を使うモデルの確認先。画像ドキュメントはGoogle側の名称変更先へ転送される場合がある。モデルとエンドポイントは実プロジェクトで確認する。画像入力への対応は、建物照合の精度保証ではない。

## S4 — 公開・非公開文書の分離

[Firebase: Control access to specific fields](https://firebase.google.com/docs/firestore/security/rules-fields)

読み取りの文書単位の境界、サーバーライブラリがSecurity Rulesを迂回することの確認先。

## S5 — トランザクション

[Firebase: Transactions and batched writes](https://firebase.google.com/docs/firestore/manage-data/transactions)

並行変更により処理が再試行され得るため、外部AIの副作用をトランザクションへ入れない設計にする。

## S6 — 位置情報の意味と限界

[W3C: Geolocation](https://www.w3.org/TR/geolocation/)

座標・精度・時刻の定義、端末位置の保証ではないことの確認先。私有地や撮影許可の証明には使えない。

## S7 — 地図キーの保護

[Google Maps Platform security guidance](https://developers.google.com/maps/api-security-best-practices)

利用アプリ・APIの制限、環境ごとのキー管理。ブラウザ向けの利用とサーバー秘密鍵を分ける。

## S8 — 費用管理

[Google Cloud: Budgets and alerts](https://docs.cloud.google.com/billing/docs/how-to/budgets)

通知専用予算は利用停止の保証ではない。quota・アプリ上限・停止担当を合わせる。今回のイベントクレジットの適用条件はこの資料では確認できない。

## S9 — 画像保存の課金条件

[Firebase: Cloud Storage billing requirements](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)

Cloud Storage利用時のBlazeプラン要件を設定前に確認する。

## S10 — 外部素材の利用

[Google: Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies)

保存・再利用・帰属表示の条件を確認し、自前の参考写真と地図の情報を混同しない。

## リポジトリ固有の根拠

運営の元READMEにある「public」「Actions/Pages不使用」「期限後は読み取り専用」「秘密情報をコミットしない」は[README](../README.md)後半に保全した。今回の既存mainは提出用のREADME・LICENSE・.gitignoreのみだった。クラウドや実アプリの稼働は確認していない。
