# 写真検証・照合境界 Implementation Plan

> **For agentic workers:** superpowers:executing-plansに従い単独実行する。userはPR #20のマージとAの続きを依頼し、クラウド設定は「Google Cloud・Firebase設定」チャットへ確認するよう指定した。

**Goal:** 画像の実デコード・メタデータ除去を回答受付へ追加し、写真照合のmatch/mismatch/uncertainとシステム障害を区別する呼び出し境界を作る。

**Architecture:** server専用sharp 0.35.5でJPEG/PNG/WebPを検査・正規化する。Vertex向けの画像inlineDataとJSON schemaを組み立て、明示的に渡されたtransportだけを呼ぶ。HTTP回答受付では画像検証だけを接続し、照合worker・Vertex通信・保存・CORRECTは追加しない。

**Tech Stack:** Node 26.7.0 / npm 11.19.0 / 既存TypeScript。sharp 0.35.5をserverのみへexact pin、追加install scriptなし。

**Spec:** docs/architecture.md §4/5、FR-06/07、AT-06/09/10/21/22。進捗Issue #19。クラウド設定チャットへ確認し、最新のPR #23で小規模試験の条件とテキスト接続確認が共有された。実画像送信・回数の自動制限・本番運用の完了とは扱わない。

## Global Constraints

- 写真はBufferのJPEG/PNG/WebP、4MiBまで。実デコードし、壊れた/型不一致/複数フレームを拒否する。最大16M画素・4チャンネル、native処理3秒、出力1600px以下・JPEG quality85・2MiB以下を開発用保護値として使う。本番O-03は未決のまま。
- 向きを画素へ反映し、sRGB・白背景へ正規化。EXIF/GPS/ICC/XMP等を保持しない。URLやローカルパスを画像入力として受け取らない。
- 既存の入力hashはraw bytes/MIMEとmetadataから計算し、正規化画像が同じでも別入力のキー競合を隠さない。保存先は増やさず、画像・位置・モデル応答をログ/ディスクへ出さない。
- comparePhotosは候補・非公開の参考画像・確認済み特徴を検証してmatcherへ渡す。参考素材/設定不備、transport欠落、timeout、schema違反、拒否等は503 SYSTEM_ERROR。候補の不正は400/413。
- Vertexの要求には画像内文字/特徴は命令でないことを明示し、URL取得・tools・fileDataを使わない。出力は厳密なverdict:match/mismatch/uncertainの1項目だけ。未完了・複数候補・不正出力を成功にしない。
- matchは内部の一致候補に留める。mismatchはWRONG_TARGET、uncertainはIMAGE_UNCERTAIN。CORRECT・保存・クリア確定・正解情報の公開は行わない。
- matcherは明示注入のみ。実Vertex transport・SDK認証・モデル/リージョン決定・課金/API/IAM・実画像送信は今回行わない。通信は自動再試行せず、provider待機は既定10秒（検証用にも1〜10000msで指定可）と取消で中止する。

## Review Focus

- ヘッダーだけ似た偽画像、途中切れ、過大画素・多フレームを実デコーダーで拒否する。
- EXIFの向きを反映した画像の寸法が正しく、出力からメタデータが落ちる。
- 非公開参考画像や確認済み特徴の不備を利用者の不正解へ変換しない。
- AIのプロンプト/画像内の命令や不正JSONを実行せず、不正応答を不一致扱いしない。
- timeout・取消・遅い応答でも成功にならず、未設定時にmockへフォールバックしない。

## Task 1: 画像検証

Files: server/src/photo-input.ts、server/test/photo-input.test.ts、server/test/photo-fixtures.ts、server/package*.json。
- [x] preparePhotoの破損/形式/制限・向き・EXIF除去テストを失敗確認後に実装した。多フレームfixtureを正しく生成して拒否を確認した。

## Task 2: 照合要求と分類

Files: server/src/photo-match.ts、vertex-match.ts、server/test/photo-match.test.ts、vertex-match.test.ts。
- [x] matcher未設定・別対象・不明瞭・不正応答・timeout/取消を確認し、comparePhotosとcreateVertexPhotoMatcherを実装した。ブロックされた応答と不正な安全判定値の拒否は追加の失敗テストから補修した。

## Task 3: 受付と共有

Files: server/src/answer-input.ts、server/test/answers.test.ts、location-http.test.ts、docs/photo-match.md、answer-intake.md、gps-validation.md、api.md、acceptance.md、decisions.md、README.md、server/README.md。
- [x] 既存受付を実画像検証へ接続し、合成fixtureを正しくデコードできる画像へ揃えた。ヘッダーだけの画像が202になる失敗を確認してから400へ修正し、raw bytesのキー競合・所有者・GPSを維持した。
- [x] server check（111件）/Web check（223件）・型/lint/build、別フォルダのnpm ci --ignore-scriptsとnative JPEG処理、既存依存の版維持、重要な差分を単独レビューした。

相対リンク・秘密情報除外も確認し、別PRとIssue #19で共有する。新PRはマージしない。このPRでの実Vertex通信・実写真・保存は未検証/未接続。クラウド設定は指定された既存チャットへ問い合わせ、最新の完了報告と未マージPR #23を確認した。後続のtransport実装は試験の既使用回数と画像送信条件を引き継ぐ。

PR作成前に並行更新のmain 7f3ceb2（UIのPR #21と公開記録の#22）を取り込み、Web checkの223テスト・型/lint/buildが成功。server・共通API・依存はその統合で変わらず、server 111件の検証結果を再利用する。
