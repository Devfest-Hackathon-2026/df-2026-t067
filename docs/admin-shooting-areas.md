# D向け：非公開撮影範囲の保存・取得

A03の地点・半径を設定するための開発用API。Dは共有CaptureZoneとclientを使い、独自の座標型・fetch・版番号を増やさない。既存の[所属と管理下書き](team-api-handoffs.md)が前提で、Googleログインだけでは操作できない。

この変更でDの既存操作デモは自動接続しない。保存先は開発用メモリーで、再起動すると下書きと範囲が消える。実地点の正解座標を公開リポジトリ・ログ・通常の旅行者APIへ置かない。検証に使った値は架空の地点だけ。

## 呼び出しと返却

| client | HTTP | 返却/操作 |
|---|---|---|
| getShootingAreas(orgId, questId, call?) | GET `/api/v1/orgs/:orgId/quests/:questId/shooting-areas` | ManagedShootingAreas |
| updateShootingAreas(orgId, questId, input, call?) | PUT 同上 | 全範囲を置換し、更新後のManagedShootingAreasを返す |

`ManagedShootingAreas`は`{orgId, questId, draftRevision, zones, source:'mock'}`。共通型は将来のrealを区別するが、現在のサーバー実装はmockだけ。共通clientはexpectedDataMode:'demo'を明示した接続でのみmockを受け付け、orgId/questIdとPUT後のrevisionを検査する。Bearer tokenは毎回最新を取得し、キャッシュ・リダイレクトを拒否する。

`CaptureZone`は`{latitude, longitude, radiusMeters}`。既存のサーバーGPS処理も同じ型を参照する。latitudeは有限数値±90、longitudeは±180、radiusMetersは有限の正数。文字列から数値へ補正しない。0〜10地点までで、空配列は設定解除。本文上限4 KiB。余分なrole/orgId/status/isCorrect等を入力へ混ぜると400で拒否する。

入力検証は開発用の形式検査だけ。実半径・精度・時刻の本番条件O-03、公開地域内の配置、現地の安全性・撮影可能性は確定しない。configuredは形式上の範囲が登録された状態で、試験済み・公開可能という意味を持たない。

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

通常の管理一覧/詳細には、範囲値の代わりにshootingAreaStatus:'unconfigured' | 'configured'を返す。未設定/空配列ではunconfigured。座標・半径は専用GET/PUTの応答だけに含め、公開プレビュー・通常ヒントへ渡さない。

## 認可と判定への境界

未認証401、未所属403。他組織の所属でその組織のURLから別組織のquestIdを指定しても404。PUTは本文読取り前と、同期変更の直前に所属を再確認し、取消後の保存を拒否する。editor/publisherとも既存下書き編集権限として利用でき、新しい自治体権限は付与しない。

範囲を保存してもstatusはdraft、publishedVersionはnullのまま。[内部回答処理](answer-processing.md)のcurrentQuestや公開問題へ下書きの範囲を自動転用しない。公開版の固定・試験確認・休止と実回答への接続は別作業。Cloud・本番GPS設定・実保存・実Vertex・実クリア確定を有効にしない。

## 検証

2026-11-06：`npm run check`は23ファイル266テスト、`npm --prefix server run check`は188テスト、双方の型/lint/buildが成功。設定/復元/解除、本文とのrevision競合、所属取消/組織分離、型違い/上限/欠けた配列、専用応答の本人/版結合、設定中の公開GET・通常管理一覧/詳細への非混入を検証した。最初の未実装による失敗と欠けた配列の赤テストを確認して修正。PUTの共通request型への追加後に全体を検証した。

差分・相対リンクと重要変更の自己レビューを実施。第三者レビュー、実Googleでの管理操作、実自治体所属、実地点/半径の適切さ・実スマホ、実永続保存・公開/判定は未検証。実Vertexの追加送信・課金/IAM/外部公開変更は行っていない。
