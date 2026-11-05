# Vertex写真照合の小規模試験 Implementation Plan

> **For agentic workers:** superpowers:executing-plansに従い単独実行。ユーザーはPR #23/#26の確認・マージと、Aの次の作業を依頼済み。

**Goal:** 承認済み試験設定でVertexへの実通信と永続回数制限を実装し、権利・個人情報の懸念がない合成画像で照合を確認する。

**Architecture:** 既存のVertexMatchRequestと厳密な応答検証を再利用する。ADCでトークンだけを取得し、Node fetchで固定REST宛先へ1回送信する。HTTP回答APIからは呼ばず、ローカル専用CLIから試験する。台帳の排他ロックと送信前の永続加算により、同時実行1・総計20回を守る。

**Tech Stack:** 既存Node 26.7.0/npm 11.19.0/TypeScript/sharp。google-auth-libraryは既存推移依存11.3.3をserverの直接依存として固定し、ブラウザへ入れない。

**Spec:** [試験設定](../../vertex-trial.md)、D-13、[写真照合](../../photo-match.md)、Issue #19。

## Global Constraints / Review Focus

- project/model/locationは承認済みのtour-513804 / gemini-3.8-flash / globalだけ。URLの注入・別プロバイダーへの切替・リダイレクト・推論の自動再試行なし。
- 台帳は開発時に既使用1回を引き継ぎ、画像試験後は確認済み5回を新規初期値にも反映する。既存ファイルの上書き・自動作成/リセットなし。APIへ送る前に1回加算し、失敗/取消でも返金しない。破損/欠落/ロック残りは送信停止。
- 台帳は所有者専用の通常ファイル、写真/位置/認証情報を記録しない。同じ絶対パスの台帳を全実行者で共有する。他PC/別台帳を横断する保証はない。
- ADCトークン・SDKエラー・モデル生出力をログへ出さない。応答を小さく制限し、通信時間切れ/取消/不正応答は成功やWRONG_TARGETへ変換しない。
- thinking LOW、出力1024token、通信期限30秒を試験用に採用する。モデル互換性を実測し、必要な調整は根拠を残す。一般回答worker/保存/CORRECTは今回接続しない。

## Task 1: 台帳とtransport

Files: server/src/vertex-trial-ledger.ts、vertex-transport.ts、server/test/vertex-trial.test.ts、server/package*.json。
- [x] 台帳の再初期化/破損拒否、再起動後の回数維持、20回到達後の送信拒否、同時実行拒否、失敗でも加算のテストを失敗確認後に実装。
- [x] 固定REST/ADC/試験用生成設定、再試行なし、非200/リダイレクト/過大応答/取消の安全な失敗、送信前の回数加算をテストして実装。

## Task 2: ローカル試験と共有

Files: server/src/vertex-trial-cli.ts、server/README.md、docs/vertex-trial.md、photo-match.md、acceptance.md、decisions.md、README.md、.gitignore。
- [x] 明示initと合成match/mismatch/uncertainだけのCLIを追加。個人写真・URL・任意プロジェクトを受け取らない。生成設定を調整可能にする代わりに、承認済み試験値をtransportで固定する。
- [x] server check（139件・型/lint/build）成功。Webは今回変更せず、PR #26マージ前の230件・型/lint/buildを再利用する。
- [x] 同一台帳で合成画像4回（1回失敗を含む）を送信し、MATCH/WRONG_TARGET/IMAGE_UNCERTAINを確認。初回テキスト分と合わせて5/20回。初回uncertain失敗の原因は確定できず、診断付き1回で200/STOP/約2.2秒の成功を確認した。生の応答は保存していない。
- [ ] 別PRを作成し、Issue #19にマージ済み範囲/レビュー待ち/残件を反映。新PRはマージしない。

Ruling: CLIの新規台帳初期値は試験後の5回へ更新し、既存共有台帳はそのまま使う。初期の1回を残すと、新規設定時に既使用の画像4回を落とすため。実パスはGit対象外の.env.localだけに追加する。
