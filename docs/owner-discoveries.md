# C向け：本人記録・写真取得・削除API

T07/T08は既存の`Discovery`と共通clientを使う。ローカルAPIモードの「自分の記録」から、本人一覧、日付、詳細、写真の閲覧と削除を試せる。

通常の開発起動ではメモリーを使い、再起動で写真・記録・削除追跡が消える。永続HTTPの専用ファクトリーはFirestoreと非公開画像の読み取りも扱う。[永続HTTPからの本人記録](#永続httpからの本人記録)

## 起動と接続

既存の[ローカルAPI・Google認証設定](local-api.md)に加え、サーバーの`.env.local`へ`QUEST_DISCOVERIES_MODE=memory`を明示し、`npm run dev:api`で起動する。`VITE_`は付けない。`QUEST_DATA_MODE=demo`専用で、本番起動は引き続き拒否する。

- 未指定または`off`：認証後503 `SYSTEM_ERROR`。保存先未接続を空一覧や保存成功へ切り替えない。
- `memory`：合成記録の設定を省略すると空のストアで起動し、記録一覧は200・0件になる。回答は引き続きRECEIVEDで、GPS通過だけでは記録を作らない。
- すべての操作に毎回最新のFirebase ID tokenが必要。未ログイン401、認証設定なし503 `AUTH_UNAVAILABLE`。uidや自治体のroleをURL/bodyへ渡しても所有者にはならない。
- 記録の応答は`X-Quest-Data-Mode: demo`と`X-Quest-Records-Mode: memory`を持つ。共通clientは`expectedDataMode: 'demo'`を明示した場合だけmemoryの成功応答を受け付ける。

### 合成記録で一覧・写真・削除を試す

`QUEST_DISCOVERIES_MODE=memory`と共に`QUEST_DEMO_DISCOVERY_OWNER_UID`へテスト用GoogleアカウントのFirebase uidを設定して起動する。uidはサーバー側の`.env.local`に置く。対象アカウントでログインすると、`demo-area`の「架空のデモ記録」1件が一覧に表示される。別アカウントは空一覧で、同じIDを指定した詳細・写真・削除は404。所属権限の追加は不要。

記録は起動時に用意した合成写真と架空の位置を持ち、回答の判定とは独立している。削除後はその起動中の一覧が空になり、同じ設定で再起動すると新しい合成記録が入る。空一覧で起動する場合はuidの設定行を外す。

`npm run dev`で起動したWebの「自分の記録」を選ぶ。ログイン後にサーバーが同じ本人を確認すると、一覧から合成記録を開ける。写真は認証付きで読み出し、一覧へ戻るかアカウントを変えた時点で写真のBlob URLを解放する。日付はAsia/Tokyoで表示する。

公開問題の読み込み中・0件・取得失敗でも「自分の記録」を選べる。記録を開いている間に公開問題が読み込まれても、表示している記録へ留まる。

## Cが使うメソッド

| client | HTTP | 返却 |
|---|---|---|
| `listDiscoveries(query?, call?)` | GET `/api/v1/me/discoveries` | `Page<Discovery>` |
| `getDiscovery(discoveryId, call?)` | GET `/api/v1/me/discoveries/:id` | `Discovery` |
| `getDiscoveryPhoto(discoveryId, call?)` | GET `/api/v1/me/discoveries/:id/photo` | 認証済みJPEGの`Blob` |
| `deleteDiscovery(discoveryId, call?)` | DELETE `/api/v1/me/discoveries/:id` | 202 `{deletionId}` |
| `getDeletion(deletionId, call?)` | GET `/api/v1/me/deletions/:id` | `{deletionId, state, retryable}` |

```ts
const api = createApiClient({
  expectedDataMode: 'demo',
  getIdToken: authClient.getIdToken,
})
const controller = new AbortController()
const page = await api.listDiscoveries({ limit: 20 }, { signal: controller.signal })
const record = await api.getDiscovery(discoveryId, { signal: controller.signal })
const photo = await api.getDiscoveryPhoto(record.discoveryId, { signal: controller.signal })
const photoUrl = URL.createObjectURL(photo)
// 写真変更、画面離脱、ログアウト・利用者変更時に必ず解放する。
URL.revokeObjectURL(photoUrl)

// 実際には利用者の削除操作の後に呼ぶ。
const receipt = await api.deleteDiscovery(record.discoveryId)
const status = await api.getDeletion(receipt.deletionId)
```

### 一覧・詳細・写真

一覧は初回日時の新しい順、同日時はID順。`areaId/cursor/limit`に対応し、limitは既定20・上限100。cursorは本人と地域の組み合わせに限定し、削除等で参照先がなくなった場合は一覧を取得し直す。0件・読込中・通信失敗・保存先未接続を区別する。

他人の記録/写真は存在しないIDと同じ404。自治体の編集/公開役でも取得できない。過去記録の取得は現在の公開問題に依存せず、問題の休止や改版で本人のsnapshotを消さない。

`ownerPhoto`は認証付き取得先であり、通常の`<img src={ownerPhoto}>`だけではBearer tokenが付かない。`getDiscoveryPhoto(id)`でBlobを取得して表示する。任意の外部画像URLへID tokenを送らない。clientは固定の同一オリジンAPIを使い、リダイレクトを拒否し、JPEG・2 MiB・Content-Length・シグネチャを確認する。長さ不明のstreamも2 MiBで打ち切る。

画面は本人uidごとに状態を分け、問題切替・ログアウト・利用者変更・画面離脱で中止する。AbortSignalだけに依存せず、応答世代を確認して古い結果を表示しない。写真URLは不要になった時点で解放する。保存日時はUTC、日付表示は既存方針のAsia/Tokyoを使う。

### 削除の扱い

記録詳細の「記録を削除」で確認を開き、「記録と写真を削除する」で送信する。受付後に状態を照会し、`completed`を受け取ると写真を解放して一覧を読み直す。受付IDを得た後に通信が途切れたときは、削除状態の再確認だけを行う。

DELETEの202は削除受付で、完了表示は`getDeletion`の`state: completed`を確認してからにする。状態は`pending / completed / failed`。`retryable`は失敗後の再試行可否で、completedではfalse。

開発用メモリーでは記録・写真の参照を同時に除去し、追跡状態をcompletedにする。同じ本人・記録への二重DELETEは同じdeletionIdを返し、他人や未知のIDは404。容量上限や保存先の障害では、未削除をcompletedにしない。通信断では自動で繰り返さず、既知のdeletionIdがあればまず照会する。

実Storageの削除や孤立画像清掃、アカウント削除、期限削除と所要時間は未実装。この一時ストアの削除完了を実クラウドの削除保証にしない。

## Aの保存処理との接続境界

`server/src/discoveries.ts`の`DemoDiscoveryStore.saveFirstClear(uid, input, verification)`は**サーバー内部用**。HTTPの記録作成・編集ルートはなく、ブラウザの`isCorrect`や日時を受け取って記録を作れない。

呼出元の回答処理は、本人認証・回答ID/所有者・公開版/休止・GPS/写真判定を確認し、記録確定の直前にも状態を再確認する。`input.photo`は`preparePhoto`で正規化済みのJPEG bytesを渡す。これらの本番検証をストアの引数だけで代替しない。

placeId・対象名・紹介snapshot・revealedLocationは登録済みの非公開版から取得し、クライアントの申告を採用しない。撮影位置やcapturedAtを正解座標・初回クリア日時へ転用しない。

- verificationはサーバーの`location: WITHIN_AREA`と`photo: MATCH`だけが保存へ進める。実際の判定や公開状態の取得はこのストアに含めない。
- ID・初回日時・ownerPhoto取得先はサーバーで決め、uid+placeIdで1件にする。別の並行回答や再送は最初の写真/日時/snapshotを上書きしない。
- 戻り値は`{source: 'mock', created, discovery}`。一時保存であり、実保存確定・CORRECTへ変換しない。既存のmock正解拒否は維持する。
- 記録は最大256件・写真合計32 MiB、1枚2 MiB。削除追跡も最大256件。上限では429で拒否し、既存の記録や写真を追い出さない。
- `DiscoveryRepository`は一覧/詳細/写真/削除/追跡の所有者付き境界。実永続化の追加時は保存mode、認証失効、処理途中の回復とO-04を別途実装・確認する。現実装に実DBへ接続する設定はない。

保存先の設定を変えることで、Cは空一覧・未接続・合成記録の詳細を同じサーバー境界で確認できる。

[開発用回答処理](answer-processing.md)で、受付の所有者/challenge/digest・GPS・写真照合を確認してから、このストアへ保存する内部接続を追加した。既存記録の内部lookupはfindByPlaceOwnedで本人だけに限定する。HTTP回答からの起動・実保存・CORRECTは依然として未接続。

## 検証範囲

FR-08/14、AT-10/11/12/19/21/22/24の一部を対象に、実ローカルHTTPと共通clientで所有者分離、初回の一意性、写真取得、地域/本人別ページング、二重削除、上限、保存先障害を検証する。テストの認証検証器と写真は代替・合成であり、実Googleでの本人記録、実写真、実スマートフォン、Firestore/Storage保存/削除は未検証。

2026-11-05の検証：Web `npm run check` は19ファイル238テスト・型/lint/build成功。写真検証PR #26を取り込んだmain `2c43933`上のserver checkは136テスト・型/lint/build成功。相対リンクと差分検査も成功。単独の自己レビューを実施し、第三者レビューは未実施。

## 永続HTTPからの本人記録

`createDurableAnswerServer` は回答から作られた本人の記録をFirestoreから読み取り、同じ一覧・詳細・写真のURLで返す。一覧は本人と指定地域に絞り、確定日時と記録IDの順でページを分ける。カーソルは同じ本人・地域でだけ利用できる。写真は本人確認後に非公開バケットの保存済み世代を読み出す。応答にバケットや世代番号は含めない。

ローカルのFirestoreエミュレーターとGCS代替環境で、回答で作られた記録、日時が同じ記録のページング、他人・未ログインの拒否、休止後の本人閲覧を確認する。本番の `discoveries` 一覧には `uid` と `firstClearedAt` 降順、地域別では `uid`・`areaId` と `firstClearedAt` 降順に対応する複合インデックスが必要。本番でのインデックス作成と検証は残件。[Firestoreインデックス](https://firebase.google.com/docs/firestore/query-data/index-overview)

永続HTTPの削除と削除状況は未接続で503を返す。通常の開発起動では従来のメモリー上の削除を使う。[永続HTTPの組み立て](answer-intake.md#永続httpの組み立て)
