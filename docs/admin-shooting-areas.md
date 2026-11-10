# D向け：非公開撮影範囲の保存・取得

A03で撮影範囲の中心を設定するAPI。Dの画面では共通の`CaptureZone`とclientを使う。操作にはGoogleログインと既存の[所属と管理下書き](team-api-handoffs.md)の設定が必要。

永続モードではFirestoreに保存する。検証用モックではメモリーに保持し、再起動すると消える。実地点の正解座標を公開リポジトリ・ログ・通常の旅行者APIへ置かない。

## 呼び出しと返却

| client | HTTP | 返却/操作 |
|---|---|---|
| getShootingAreas(orgId, questId, call?) | GET `/api/v1/orgs/:orgId/quests/:questId/shooting-areas` | ManagedShootingAreas |
| updateShootingAreas(orgId, questId, input, call?) | PUT 同上 | 全範囲を置換し、更新後のManagedShootingAreasを返す |

`ManagedShootingAreas`は`{orgId, questId, draftRevision, zones, source}`。`source`は永続モードでは`real`、検証用モックでは`mock`。共通clientは`expectedDataMode: 'demo'`を明示した接続でのみ`mock`を受け付け、`orgId`・`questId`とPUT後のrevisionを検査する。Bearer tokenは毎回最新を取得し、キャッシュ・リダイレクトを拒否する。

`CaptureZone`は`{latitude, longitude, radiusMeters}`。既存のサーバーGPS処理も同じ型を参照する。latitudeは有限数値±90、longitudeは±180。新しいPUTの`radiusMeters`は全地点で数値の`1000`のみ。文字列や他の半径は400で拒否する。0〜10地点までで、空配列は設定解除。本文上限4 KiB。余分なrole/orgId/status/isCorrect等も400で拒否する。

精度・時刻と写真照合の既存の正解条件は維持する。`configured`は1,000mの範囲が保存された状態で、現地の安全性や撮影可能性は人が別途確認する。

## Dの保存手順

既存の認証付きclientから、選択中のorgId/questIdに対して取得する。

```ts
const current = await api.getShootingAreas(orgId, questId, { signal })
// editedZonesはCaptureZone[]の画面内入力。公開プレビューへ渡さない。
const saved = await api.updateShootingAreas(orgId, questId, {
  expectedDraftRevision: current.draftRevision,
  zones: editedZones,
}, { signal })
// saved.draftRevisionを、本文編集にも使う現在のrevisionへ反映する。
```

範囲更新と本文/素材IDの更新は**同じdraftRevision**を使う。成功するたび1増える。古いrevisionの更新は409 DRAFT_CONFLICTとなり、ほかの編集を上書きしない。競合時は画面の入力を保持し、本文と範囲の最新版を取得して差分を人が確認してから再保存する。本文更新で範囲を消さず、範囲更新で本文を消さない。

PUTは全範囲の置換で、同じ空配列の保存でもrevisionが進む。通信断・取消はサーバーの変更を巻き戻さない。自動PUT再試行で解決せず、GETで保存済みの値とrevisionを確認する。

通常の管理一覧/詳細には、範囲値の代わりに`shootingAreaStatus`を返す。未設定は`unconfigured`、保存済みの旧半径を含む下書きは`needs-review`。GETで旧値を保持し、担当者が明示的に確認して1,000mで保存するまで新規公開を止める。公開済みの古い版の範囲はその版のまま判定に用いる。座標・半径は専用GET/PUTの応答だけに含める。[対象スポットとの区別](admin-municipal-locations.md)

## 認可と判定への境界

未認証401、未所属403。他組織の所属でその組織のURLから別組織のquestIdを指定しても404。PUTは本文読取り前と、同期変更の直前に所属を再確認し、取消後の保存を拒否する。editor/publisherとも既存下書き編集権限として利用でき、新しい自治体権限は付与しない。

範囲を保存すると新しい版の下書きになる。開発用の公開を実行するまでは、公開中の版の撮影範囲を使う。[開発用の公開と休止](api.md#18-開発用の公開と休止)

## 検証

2026-11-06：`npm run check`は23ファイル266テスト、`npm --prefix server run check`は188テスト、双方の型/lint/buildが成功。設定/復元/解除、本文とのrevision競合、所属取消/組織分離、型違い/上限/欠けた配列、専用応答の本人/版結合、設定中の公開GET・通常管理一覧/詳細への非混入を検証した。最初の未実装による失敗と欠けた配列の赤テストを確認して修正。PUTの共通request型への追加後に全体を検証した。

差分・相対リンクと重要変更の自己レビューを実施。第三者レビュー、実Googleでの管理操作、実自治体所属、実地点/半径の適切さ・実スマホ、実永続保存・公開/判定は未検証。実Vertexの追加送信・課金/IAM/外部公開変更は行っていない。

## ローカル管理画面

開発サーバーの `/admin-local` で所属する組織を選び、保存済みの問題にある「撮影範囲を設定」を開く。現在の非公開範囲と下書き版を取得して、最大10地点を編集できる。空にして保存すると設定を解除する。版が変わった場合は入力を保持し、明示操作で最新版を読み直す。[管理画面の起動手順](admin-demo.md#開発用の所属問題報告を閲覧する)
