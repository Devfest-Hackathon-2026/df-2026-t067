# B/D向けのAPI接続手順

BとDが画面を接続するとき、Aの追加実装を待つ作業を減らすための手順。既存の共通clientを使う。写真照合とVertex設定は別の作業で進める。[進捗Issue #19](https://github.com/Devfest-Hackathon-2026/df-2026-t067/issues/19)

メモリー版は `QUEST_DATA_MODE=demo` でlocalhostに起動する。再起動で下書きが消える。Firestoreエミュレーターに下書きを保存する場合は `durable-local` を使う。操作の範囲は以下の各節を参照。検証には架空の素材を使う。

C向けの本人記録一覧/詳細・写真・削除は[本人記録API接続手順](owner-discoveries.md)を参照する。保存先未接続を空一覧や保存成功へ置き換えず、記録を作るHTTPは提供しない。

## B：段階ヒント

```ts
import { createApiClient } from '../src/shared/api'
const api = createApiClient({ expectedDataMode: 'demo' })
const quest = await api.getQuest('demo-quest')
const hint = await api.getHint({
  questId: quest.questId,
  expectedVersion: quest.version,
  index: 1,
}, { signal: controller.signal })
// hint: { questId, version, index, text }
```

- `GET /api/v1/quests/:questId/hints/:index?expectedVersion=N`。認証不要でtokenを送らない。
- indexは**1始まり**。画面は`1〜quest.hintCount`の通常ヒントを明示操作で1つずつ取得する。架空の3問には各3つの通常ヒントがある。
- 版違いは409 `QUEST_CHANGED`。詳細を取得し直し、旧版のヒント表示を破棄する。不存在・範囲外の番号は404 `NOT_FOUND`、不正な値は400 `INVALID_INPUT`。
- 取得に失敗した場合、ヒントが0件の場合、まだ取得していない場合を区別する。問題の切り替え、再取得、画面離脱ではAbortSignalを使い、画面側でも現在の要求に対応しない応答を破棄する。
- 通常ヒントは本文だけ。正解名・座標・参考全景を自動追加しない。明示的最終案内`reveal`は未実装で404。第3ヒントをrevealの代用にしない。訪問条件は通常の詳細に表示する。
- Bの画面自体はこの変更に含めない。このclientを既存T02へ接続できる。

管理APIで公開した問題の`shootingConditions`は、公開した版の船上・海上と有料施設内の条件を持つ。T02とDのA05で同じラベル付きアイコンを表示する。項目のない問題やfalseの条件にはアイコンを表示しない。料金・撮影注意は通常の詳細で読める。[公開版の項目](api.md#18-開発用の公開と休止)

## D：所属と下書き保存

入口は`src/shared/api/index.ts`、追加の型は`src/shared/api/admin.ts`。DのA03の素材項目とA04の`DraftFields`に合わせた構造で、別のDTOをコピーして作らない。

| client | HTTP | 返却 |
|---|---|---|
| `listMemberships(query?, call?)` | GET `/me/memberships` | `Page<OrgMembership>` |
| `listManagedQuests(orgId, query?, call?)` | GET `/orgs/:orgId/quests` | `Page<ManagedQuest>` |
| `getManagedQuest(orgId, questId, call?)` | GET `/orgs/:orgId/quests/:questId` | `ManagedQuest` |
| `createManagedQuest(orgId, draft, call?)` | POST `/orgs/:orgId/quests` | 初回201 `ManagedQuest` |
| `updateManagedQuest(orgId, questId, input, call?)` | PATCH `/orgs/:orgId/quests/:questId` | 200 `ManagedQuest` |

全て毎回最新のFirebase ID tokenを送信する。`createApiClient({ expectedDataMode: 'demo', getIdToken: authClient.getIdToken })`を使う。生成しただけでは通信しない。list系は`cursor/limit`（既定20、上限100）でページングする。

### 永続の所属・下書きをローカルで試す

`durable-local` では既存の `GET /me/memberships`、下書き一覧・取得・作成・更新、撮影範囲の取得・更新を使える。API clientは `expectedDataMode: 'durable-local'` と署名済みIDトークンを使う。Firestoreエミュレーターへの所属登録は永続素材APIと共通。新規作成時は所属で設定した公開エリアを使う。[永続素材の所属登録](admin-assets.md#永続素材をローカルで試す)

本文と撮影範囲を `quests/{questId}` に保存する。どちらを更新するときも同じ `expectedDraftRevision` を確認し、成功時に1進める。保存時の所属確認と更新は同じトランザクションで行う。素材IDには自組織で保存が確定した同じ用途の素材を指定する。撮影範囲の座標・半径を返すのは専用の管理APIだけ。旅行者向けの公開カタログには公開版の別文書が必要。

`submitManagedQuestReview` で保存済みの下書きを確認依頼できる。所属、下書きの版番号、素材の保存状態を同じトランザクションで確認する。必要項目がそろえば `review_pending` を保存し、不足があれば `draft` と不足項目を返す。同じ下書きの再送では版番号は進まない。[確認項目](api.md#17-dの下書き確認依頼)

同じ起動モードで合成素材の写真試験を実行し、試験した下書きの版に結果を保存できる。[永続の写真試験](admin-photo-tests.md#永続の写真試験をローカルで試す)

自組織の公開担当者は同じ起動モードで `publishManagedQuest` と `pauseManagedQuest` を使える。公開には確認待ちの下書き、同じ版の一致と別対象の試験、公開担当者の確認が必要。編集中も旅行者には公開済みの版を返す。休止すると旅行者の一覧とヒントから外れ、挑戦開始と回答受付が止まる。[公開と休止の入力](api.md#18-開発用の公開と休止)

管理画面の接続と実環境での通し確認は後続。

### 開発用の所属を設定する

1. `server/demo-admin-memberships.example.json`を**リポジトリ外のローカルファイル**へコピーする。
2. 自分のFirebase uidを`uid`へ設定し、架空の`demo-org`と`demo-area`を使う。実自治体の所属設定ではない。Googleログインだけで所属が作られることはない。
3. `.env.local`に`QUEST_DATA_MODE=demo`、既存の`FIREBASE_PROJECT_ID`、`QUEST_DEMO_MEMBERSHIPS_FILE=/絶対パス/local-memberships.json`を設定する。`VITE_`を付けない。既存の[認証・API接続設定](local-api.md)も使う。
4. `npm run dev:api`と`npm run dev`で起動し、Dの認証済み接続から呼び出す。既存の`/admin-demo`は未認証の端末内デモのままで、自動接続しない。

未設定の所属は一覧が空、管理操作は403 `FORBIDDEN`。未ログイン401、Firebase未設定503 `AUTH_UNAVAILABLE`。所属設定ファイルが読めない・不正なら503 `SYSTEM_ERROR`で拒否し、成功デモへ切り替えない。

`active: false`へ変更すると次の操作から拒否する。ファイルは要求ごとに読み直し、本文受信後の保存直前にも再確認する。役割は`editor`または`publisher`。両方が下書き編集と確認依頼を利用でき、`publisher`は開発用の公開・休止も利用できる。実サービスの所属・失効確認は別の実装・検証が必要。

### 入力と保存結果

```ts
const draft: ManagedQuestDraft = {
  materials: {
    name: '', evidence: '', requiresBoat: false, requiresPaidFacility: false,
    price: '', photoNote: '', photoRights: '',
  },
  content: {
    title: '', question: '', hints: ['', '', ''],
    verifiedFeatures: '', draftingNotes: '',
  },
  afterClear: { access: '', hours: '', promoComment: '', explanation: '' },
  referenceAssetId: null,
  hintAssetId: null,
}
const created = await api.createManagedQuest(orgId, draft)
const saved = await api.updateManagedQuest(orgId, created.questId, {
  expectedDraftRevision: created.draftRevision,
  draft: editedDraft,
})
```

- `OrgMembership`は`{orgId, label, role, areaId}`。uidやactiveを画面から返送して認可しない。公開エリアは所属側の設定で決め、bodyのorgId/areaId/role/statusは拒否する。
- `materials`はA03に対応。`requiresBoat`（船上・海上）と`requiresPaidFacility`（有料施設内）は必須のbooleanで、falseは画面の未選択状態。料金priceと撮影制約photoNoteは挑戦前用。`content`はA04の項目でhintsは3要素。未完成の空欄を保存でき、保存成功は公開可能との判定ではない。
- `afterClear`はクリア後用の`access / hours / promoComment / explanation`。管理APIで保存・復元するが、PublicQuest・通常ヒントへ追加しない。アクセス/時間/コメントは2000文字、解説は4000文字まで。
- 旧`availableModes / requiredModes`と`materials.access / materials.hours`は受け付けない。旧入力を黙って変換・破棄せず400で拒否する。動作中の旧APIと新しいclientを混ぜない。サーバー再起動では開発用の記録・下書きが消えるため、保持が必要な入力は先に担当者が退避する。
- `ManagedQuest`は`questId, orgId, areaId, draftRevision, publishedVersion, status:'draft' | 'review_pending' | 'published' | 'paused', shootingAreaStatus:'unconfigured' | 'configured', draft, source:'mock'`。IDとrevisionはサーバーが発行する。旅行者GETには公開版の専用DTOだけを返す。
- 上限はHTTP本文64 KiB、名称/タイトル200文字、本文/根拠/メモ4000文字、各ヒント/その他素材欄2000文字。開発用の入力保護で、本番O-03を確定しない。下書きは自治体100件・全体1000件で新規作成を停止する。
- 更新は**draft全体の置換**。現在のrevisionを指定し、成功時に1増える。同時保存は片方だけが成功し、もう片方は409 `DRAFT_CONFLICT`。画面の編集中データを保持して最新版を取得し、人が差分を確認してから再保存する。競合時の自動上書きは禁止。
- 新規作成は自動再送しない。通信断ではまず一覧を確認して二重作成を避ける。再起動時の消失、保存容量、通信失敗を永続保存成功と表示しない。

### 画像・試験・公開の境界

- `referenceAssetId`は用途`reference`、`hintAssetId`は用途`public_hint`の登録素材だけ。同じ組織・用途をサーバーで検証する。他自治体、未知のID、参考写真の公開流用は400で拒否する。
- ローカル管理画面の「公開ヒント画像を設定」は、利用権付きの別素材を `public_hint` として登録し、保存済みの版に参照を設定または解除する。公開後はT02の「ヒント画像を見る」で開ける。[管理画面の手順](admin-demo.md#開発用の所属問題報告を閲覧する)
- assetの基底型は`{assetId, orgId, purpose}`。写真の受付・認可付き取得は[素材API](admin-assets.md)で追加した。明示memory設定で写真を登録し、返されたassetIdを保存できる。未設定なら両方nullのままにする。`File`、blob URL、data URLをassetIdとして送らない。実Storage保存ではない。
- 非公開の撮影地点/半径は[専用の管理API](admin-shooting-areas.md)で取得/全置換する。通常の管理応答は設定状態だけを持つ。configuredでも現地確認・試験・公開の完了と扱わない。
- 素材APIは未設定503・明示memoryのみ。生成候補の取得、保存、試験、確認依頼、開発用の公開は別操作として扱う。

## 検証範囲

`npm run check`と`npm --prefix server run check`を実行する。実HTTPと共通clientで通常ヒント・版競合・認証・所属取消・組織/素材分離・同時保存・入力上限を確認する。Firebase verifierをテスト用境界に置き換えた管理APIテストであり、実Googleログイン、実スマートフォン、実自治体権限、実画像・実クラウド保存の確認ではない。

2026-11-05の実行結果：Web `npm run check` は18ファイル230テスト・型/lint/build成功。server `npm --prefix server run check` は108テスト・型/lint/build成功。新規の所属取消・保存競合・公開DTO分離などを実HTTPで確認した。差分の自己レビューを実施し、相対リンクと`git diff --check`も成功。第三者レビューと実Firebase所属接続は未実施。

### PR #30の管理画面との対応

A03の2条件はmaterials.requiresBoat/requiresPaidFacility、アクセス・時間・コメント・解説はafterClearへ明示的にまとめる。管理プレビューは共通のShootingConditions/AfterClearContent型を参照する。画面の自動保存・所属ログイン・実公開はこの契約追加で有効にならない。PublicQuestの通常レスポンスは今回変更しない。

PR #32までを含むmain b27d1e2と統合後、`npm run check`は22ファイル261テスト、`npm --prefix server run check`は159テスト、両方の型/lint/buildが成功。新項目の作成/更新/GET復元、旧項目の拒否、公開GETへの非混入を確認した。自己レビュー・相対リンク・差分検査も実施。実Googleでの管理操作、実自治体所属、永続保存、実公開、実スマートフォン、第三者レビューは未実施。

### A03の非公開撮影範囲

`getShootingAreas / updateShootingAreas`と共通CaptureZoneを追加した。PUTは最大10地点の全置換、空配列で解除し、本文と同じdraftRevisionを更新する。競合や応答断では編集中の値を保持し、本文と範囲の最新版を確認する。[手順と制約](admin-shooting-areas.md)を使い、Dの画面を接続できる。Web266/server188テスト・型/lint/build成功。画面の自動接続、実地点・本番GPS閾値や公開/判定は追加しない。

### A05の写真試験

`testManagedQuest`は保存済みのreference素材・確認済み特徴を使い、試験写真と権利説明・revision・キーを受け取る。古い版や所属取消では結果を返さず、同じキーの照合を共有する。Dは未接続・失敗・一致候補を区別する。既定は照合未接続の503で、fixtures設定で指定の合成素材を試せる。[写真試験と起動手順](admin-photo-tests.md)

### A04の生成候補

保存済みの版を`generateManagedQuestDraft`へ渡す。候補表示には`source:mock`を明示し、編集中の値の置換は利用者が確認してから行う。候補取得後に下書きや画面内の編集状態が変わった場合は古い候補を破棄する。既定は503で、開発用fixtures設定と指定の参考素材で接続を試せる。[起動設定と応答型](api.md#19-a04の下書き候補)

`/admin-local` のA04でこの候補を取得・確認できる。候補は表示した時点の保存済み版に結び付き、保存して版が進むと前の候補は表示されない。[管理画面の手順](admin-demo.md#開発用の所属問題報告を閲覧する)

### A06への確認依頼

`submitManagedQuestReview(orgId, questId, expectedDraftRevision)`を保存済みの版で呼ぶ。`missing`が空なら`review_pending`へ進み、値があれば対応する入力欄へ戻る。[確認項目と状態遷移](api.md#17-dの下書き確認依頼)を参照。提出後の保存は同じ下書きを新しい版の`draft`へ戻す。試験合格と公開担当者の承認は別工程。

### A06/A07の開発用公開と休止

`publisher`の操作から`publishManagedQuest`と`pauseManagedQuest`を呼ぶ。公開は確認待ちのrevision・同じ版の一致と別対象の試験ID・全確認項目を送る。409では下書きの版、確認依頼、試験のどれを更新するか結果コードで区別する。公開中の表示は`publishedVersion`で判定し、編集状態の`status`と分ける。休止成功後は返された新しいdraftRevisionを採用し、古い試験IDを破棄する。[入力と結果コード](api.md#18-開発用の公開と休止)

開発サーバーのfixtures設定と `/admin-local` の「試験と公開確認」で、合成写真の試験から確認依頼と公開を試せる。公開一覧・ヒント・挑戦と回答受付の境界はローカルHTTPで検証する。本番公開は別途確認する。[合成素材で公開・休止を試す](admin-photo-tests.md#合成素材で公開休止を試す)

## BのT02とDのA07で問題報告を接続する

ローカルAPIモードのT02で「問題を報告」を開き、ログイン確認後に分類と架空の本文を入力して「デモ報告を送信」を押す。画面は`submitReport`を使い、同じ内容の再試行ではキーを保持する。Dは開発用の公開担当者として`listManagedReports`で自組織の報告を確認できる。報告本文は利用者の入力としてテキスト表示し、受付と休止の操作を分ける。[設定と入力](api.md#20-開発用の問題報告)

`durable-local` のT02では「報告を送信」で同じAPIを使う。Firestoreに報告を保存し、別サーバーからの再送に同じ受付IDを返す。公開担当者は自組織の報告を新着順に確認できる。[永続ローカルの起動](local-api.md#モードを選ぶ)
