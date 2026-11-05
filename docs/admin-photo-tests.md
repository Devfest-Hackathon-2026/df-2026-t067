# D向け：下書き版に結び付く写真試験API

A05の接続口として、POST `/api/v1/orgs/:orgId/quests/:questId/test`と共通clientのtestManagedQuestを追加した。保存済み参考写真・確認済み特徴と試験写真を照合し、結果を特定draftRevisionへ結び付ける。FR-11/12、AT-09/15/16/21/22の部分実装。

**通常起動の照合は未接続で503。** main.tsや環境変数から実Vertexを有効にする設定は追加していない。開発/testのcreateServerでServerOptions.adminPhotoTestへmatcherを明示注入したときだけ試験する。検証は合成画像と代替matcherだけで行い、実サービスの利用には既存の試験条件・回数台帳と承認に沿う接続が別途必要。

## Dの呼び出し

既存の[所属・下書き](team-api-handoffs.md)と[用途別素材](admin-assets.md)のclientを使う。まずreference用途のassetIdと確認済み特徴を下書きへ保存し、返されたrevisionを指定する。

```ts
const result = await api.testManagedQuest(orgId, questId, {
  expectedDraftRevision: saved.draftRevision,
  photo: selectedTestPhoto,
  photoRights: rightsDescription,
  idempotencyKey: testKey,
}, { signal })
```

testKeyは明示的に新しい試験を始める際に作り、同じ送信/照会では保持する。利用者・組織・問題・写真・権利説明・下書き版が変わる場合は新しいキーを使う。共通clientは毎回最新tokenを取得し、org/quest/revision・明示demo接続と応答sourceを検査する。

HTTPはmultipartのphotoとmetadataだけ。metadataはPhotoTestMetadataの`{expectedDraftRevision, photoRights}`で、写真権利の説明は非空・2000文字まで、metadataのUTF-8全体は4 KiBまで。画像はJPEG/PNG/WebP・4 MiBまで、既存の実デコード・EXIF除去・1600px/2 MiBへの正規化を通す。ファイル名、role/orgId/isCorrect等を認可や正解の根拠にしない。

draft.content.verifiedFeaturesは、改行ごとにtrimした非空行を1〜20個、各300文字以内の確認済み特徴として使う。入力を黙って切り詰めない。範囲外の書式・未設定reference・public_hint用途・他組織の参考素材は400で拒否する。空欄下書きの保存自体は従来どおり可能。

## 結果の扱い

成功応答は200のPhotoTestResult：`{testId, orgId, questId, draftRevision, outcome, source:'mock'}`。共通型は将来のrealと区別できるが、現在のサーバーは開発用mockだけ。

| outcome | 意味 |
|---|---|
| MATCH | 参考写真との一致候補 |
| WRONG_TARGET | 別対象 |
| IMAGE_UNCERTAIN | 写真だけでは確認困難 |

provider障害・不正schema・時間切れは503 SYSTEM_ERRORで、別対象に変換しない。参考写真、特徴、権利説明、モデルの自由記述、正解座標、本人写真URLは応答へ含めない。

試験は下書きを変更せず、旅行者のchallenge/attempt/discoveryを作らない。MATCHはCORRECTや公開前の試験合格・公開資格にならない。撮影範囲/GPS・現地の安全性は別項目。公開に使う試験記録・ケース網羅と確認フローは後続であり、このAPIは合格フラグを保存しない。

画面内で編集した時点で以前の表示結果を無効化し、新しく保存したrevisionとキーで試験する。サーバーでも本文読取り後、provider呼出し直前、照合後、応答直前に所属とrevisionを再確認する。変更は409 DRAFT_CONFLICT、所属取消は403。入力を保持し、最新版を確認してからやり直す。遅い応答は画面側でも操作世代・組織/問題/版を確認して破棄する。

## 再送・上限・取消

Idempotency-KeyはASCII可視文字1〜128文字。同一uid/org/quest/keyの同じ写真bytes・MIME・metadataは同じ処理/結果へまとめる。画像の正規化前bytesもhashへ含め、入力違いは409 IDEMPOTENCY_CONFLICT。下書き改版後に古い結果を再利用しない。

結果・障害キャッシュは同一インスタンスの最大128件、照合は同時1件。満杯では新規試験を429で拒否するが、同じ版の既存キーは再照会できる。受付には既存回答受付と共有する利用者10要求/60秒・全体同時4受付の既定上限も適用し、再照会でも受付上限は守る。これらはVertexの永続回数台帳の代わりではない。

通信断では同じキーで既存結果を確認し、明示的な再試験は新しいキーを使う。失敗を同じキーでAI再実行せず、自動再試行ループは追加しない。照合期限は既存comparePhotosの既定10秒・最大10秒。取消をproviderへ伝え、中止を無視するproviderや認可待ちは実際に終わるまで照合枠を保持する。照合中の取消/期限超過で確定した失敗を、後から届いたMATCHで上書きしない。取消は完了済み処理の巻き戻しや費用の返却ではない。

候補写真は処理中だけで、素材/記録へ保存せずログへも出さない。キャッシュもメモリーだけで再起動すると消える。プロセスをまたぐ結果照会・一般利用者の実写真・本番の保持/削除O-04・実公開/判定は残る。

## 検証

2026-11-06：`npm run check`は24ファイル271テスト、`npm --prefix server run check`は201テスト、双方の型/lint/build成功。実装前のparser/HTTP 404の赤テストを確認。実HTTPと共通clientで同時再送/入力競合、組織・参考用途分離、所属取消/改版、結果分類、未接続503、記録非作成、キャッシュ/受付/照合上限、取消と期限後の遅いprovider/認可待ちを確認した。相対リンク/差分検査・重要差分の単独自己レビューを実施。

第三者レビュー、実Googleでの管理操作/実所属・実スマホ、実写真/モデル精度、実Vertex接続、永続保存・公開資格は未検証。実Vertexへの追加送信、課金/IAM/外部公開の変更は行っていない。Dの既存操作デモも自動接続しない。
