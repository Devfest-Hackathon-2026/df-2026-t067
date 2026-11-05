# D向け：用途別の写真素材API

Issue #19の写真とassetIdの受け渡し待ちに対応する。既存のGoogle認証・[所属/下書きAPI](team-api-handoffs.md)と画像検証を再利用する。写真はserverでデコード・向き補正・縮小し、EXIF等を除いたJPEGを保存する。

**保存先は明示した開発用メモリーだけ。再起動で画像・assetId・再送受付は消える。** 実Storage、AI生成/判定、公開、期限削除は未接続。実利用者・実地点の素材をこの開発ストアへ投入しない。

## 設定

既存の`QUEST_DATA_MODE=demo`、`FIREBASE_PROJECT_ID`と`QUEST_DEMO_MEMBERSHIPS_FILE`に加え、サーバーの`.env.local`へ`QUEST_ADMIN_ASSETS_MODE=memory`を設定し、`npm run dev:api`で起動する。`VITE_`は付けない。既定のoffは認証・所属確認後503 `SYSTEM_ERROR`で未接続を示し、成功モックへ切り替えない。

すべてGoogle ID tokenとactiveな編集/公開の所属が必要。利用者の自己申告では所属を作れない。同じ自治体の有効な担当者は素材を共有でき、他自治体の素材は取得・下書きへの参照とも拒否する。POSTでは本文受信前、デコード前、保存直前に所属を確認する。

## clientとHTTP

| client | HTTP | 返却 |
|---|---|---|
| `uploadOrgAsset(orgId, input, call?)` | POST `/api/v1/orgs/:orgId/assets` | 新規201・同一再送200 `UploadedOrgAsset` |
| `getOrgAsset(orgId, assetId, call?)` | GET `/api/v1/orgs/:orgId/assets/:assetId` | `UploadedOrgAsset` |
| `getOrgAssetPhoto(orgId, assetId, call?)` | GET `/api/v1/orgs/:orgId/assets/:assetId/photo` | 認証付きJPEGの`Blob` |

```ts
const api = createApiClient({ expectedDataMode: 'demo', getIdToken: authClient.getIdToken })
// 選択した写真・用途・権利説明ごとに1回生成し、再送では維持する。
const idempotencyKey = crypto.randomUUID()
const asset = await api.uploadOrgAsset(orgId, {
  photo: selectedFile,
  purpose: 'reference',
  photoRights: photoRightsText,
  idempotencyKey,
}, { signal: controller.signal })
const blob = await api.getOrgAssetPhoto(orgId, asset.assetId)
const url = URL.createObjectURL(blob)
// プレビューの置換・終了・ログアウト時に解放する。
URL.revokeObjectURL(url)
const saved = await api.updateManagedQuest(orgId, questId, {
  expectedDraftRevision: currentRevision,
  draft: { ...currentDraft, referenceAssetId: asset.assetId },
})
```

POSTのmultipartは`photo`とJSON文字列`metadata`の2項目だけ。metadataは`{purpose, photoRights}`で、orgId/uid/role/assetId/URL等を混ぜない。Idempotency-Keyは必須で、1〜128文字の空白を含まないASCII。clientがmultipart boundaryを付けるのでContent-Typeを手で設定しない。

返却は`{assetId, orgId, purpose, photoRights, contentType:'image/jpeg', width, height, byteLength, source:'mock'}`。assetIdはserverが生成する。原画像・filename・EXIF・位置情報を応答へ含めない。応答は`X-Quest-Data-Mode: demo`と`X-Quest-Assets-Mode: memory`を持ち、共通clientは明示demoだけで受け付ける。

photoRightsは出典・利用権について人が確認した説明で、非空・2000文字まで。入力しただけでserverが権利を法的に確認できたとは扱わない。画像内の文字や権利説明を命令として実行しない。

## 用途と下書き

- `reference`：非公開の参考写真。返されたIDを`referenceAssetId`へ設定する。
- `public_hint`：公開用の部分ヒントとして別途用意・確認した画像。IDを`hintAssetId`へ設定する。
- serverは下書き保存時に存在・所有組織・用途を確認する。参考assetIdをhintAssetIdへ入れると400。同じ写真を公開用に自動複製しない。
- public_hintという用途でも、現段階の取得先は認可付きのみ。公開DTO・公開URLへ自動追加しない。公開操作は未実装。
- ブラウザのblob URL、File、data URLや外部URLをassetIdへ代入しない。写真は`getOrgAssetPhoto`でtoken付き取得し、Blobを表示する。

通常のserver起動では素材台帳と下書きの検証を接続済み。独自の`DemoAdminStore`を注入する場合は`assetLookup`に同じ`DemoAssetStore.metadata`を渡し、別の素材台帳を作らない。

## 再送・取消・エラー

同じ本人・自治体・キーと元画像bytes/MIME・用途・権利説明なら同じassetIdを返す。写真/用途/権利説明を変える場合は新しいキーにする。変更なしの再送は容量上限後も元の素材を返し、並行再送も増殖させない。同じキーで内容が違うと409 `IDEMPOTENCY_CONFLICT`。

応答不明時は同じ写真・metadata・キーを保持し、利用者の再試行で元の結果を回復する。自動再送しない。取消がserverの取り消し完了を保証するものとは扱わない。ログアウト・所属変更・画面離脱では中止し、遅い応答を破棄する。権限取消は403、他自治体/未知のassetIdは404、破損は400、非対応MIMEは415、サイズ超過は413、回数/容量上限は429。

## 開発用の上限

入力はJPEG/PNG/WebPの4 MiB以内、metadataは4 KiB以内、全体は4 MiB+16 KiB。既存`preparePhoto`の16M画素・単一フレーム・3秒のnative保護、向き補正・1600px・EXIF除去・JPEG2 MiBを使う。元画像は登録ストアへ残さず、正規化画像だけを保持する。

既定は本人10要求/分、同時受信/検証2件、自治体32素材、全体128素材、画像合計32 MiB。失敗時も受信枠を解放し、既存素材を上限超過で追い出さない。これらは開発用保護値で、本番O-03/O-04は未確定。削除APIと永続化は別途実装する。

## 範囲と確認

この変更は素材APIと既存assetIdへの接続だけ。Dの既存UIは自動接続しない。PR #30の撮影条件2項目・クリア後紹介/解説は共通型の調整が別途必要で、この素材APIから既存公開フィールドへ流用しない。

FR-09、AT-13/16/21/22の開発用部分として、実HTTPでデコード・用途・組織分離・権限取消・再送・容量/回数を確認する。共有multipart reader抽出後も回答のraw入力hash・冪等性・画像検証を検証する。実Googleでの素材操作、実スマホ、実Storage、実素材の権利、公開/生成/判定は未検証。

2026-11-05の確認：Web `npm run check` は20ファイル245テスト、server checkは158テストと型/lint/buildが成功。画像処理後の所属取消、画像合計bytes、再送・組織/用途分離、既存回答/本人記録/Vertex試験の回帰を確認。相対リンク・差分検査・自己レビューを実施。実サービスと第三者レビューは未実施。

PR #29/#30を含む最新main `1e66758`へ統合し、Web245テストを再確認。serverと共通APIは統合前後で同一のため、server158テストの結果を再利用した。
