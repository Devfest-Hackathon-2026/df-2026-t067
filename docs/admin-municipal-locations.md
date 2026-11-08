# A03の探索エリア・対象スポット・撮影範囲

| 項目 | 保存・表示の範囲 |
| --- | --- |
| 探索エリア | サーバーで所属に結び付けた行政区域。公開地域には既存の `PublicArea` を使う |
| 対象スポット | A03で確認する名称・住所・位置。下書きと本人のクリア後案内に保持する |
| 撮影範囲 | 撮影者が立つ位置を別に指定。非公開の各中心から半径1,000m |

## 行政区域を準備する

出典は国土交通省の[国土数値情報（行政区域）N03](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2025.html)。2026年版の提供開始は[公式のお知らせ](https://nlftp.mlit.go.jp/ksj_news.html)を参照する。投入する都道府県・年度の配布ページと添付メタデータで使用許諾条件を確認する。[利用規約](https://nlftp.mlit.go.jp/ksj/other/agreement.html)に従い、出典と加工の事実を表示する。年度ごとの個別条件・第三者の権利を確認し、登録と公開は運営の承認後に行う。

1. 承認した配布データをGISツールでWGS84（経度、緯度順）のGeoJSON `FeatureCollection` へ変換する。`N03_007` は対象年度の5桁コードを文字列で保持する。政令市全体と行政区は別の対象として扱い、コードを推測して合算しない。
2. `npm --prefix server run build` 後に、`node server/dist/server/src/prepare-n03-area.js <GeoJSONファイル> <5桁コード> <西暦年> <自治体名> <代表点緯度> <代表点経度>` を実行する。出力はFirestore登録用の `areaId` と `data` のJSON。コードに一致する全ポリゴンを集約し、飛び地・島・内周を保持する。形状がない、壊れている、またはFirestoreの保存容量に収まらない場合は処理を止める。
3. 運営が出力の自治体名、コード、区域、代表点を確認し、`areas/{areaId}` に `data` を登録する。所属レコードに同じ `areaId` と `municipalityCode` を設定する。年度更新時は別の `areaId` を用意し、既存の公開版が使う区域文書は保存する。

管理画面の通常操作に区域座標の入力はない。`GET /me/memberships` の `exploration` が名前・コード・出典種別・年度または `source: 'unavailable'` を返す。作成時と新規公開時にサーバーが所属と区域を再照合し、エリアのIDやコードをフォームから受け取らない。所属変更で既存下書きとエリアが食い違った場合は確認が必要。新規作成した下書きと公開版には参照元・年度を保持する。

既存の合成検証を続ける場合、運営が対象の架空区域に限って `boundarySource: 'fixture'` を設定し、所属には実自治体コードを設定しない。ローカルの既知の合成シードだけを起動時にタグ付けする。共有環境の既存データは運営が確認する。N03実データ、共有環境の設定、外部サービスの有効化は未実施。

## 対象スポットを登録する

A03の共有URL欄は、許可したGoogle MapsのHTTPS URLから明示座標やPlace IDを候補として読む。`@緯度,経度` は地図中心なので対象位置に使わない。リンク先へアクセスせず、短縮URLの展開や任意の転送先への通信は行わない。短縮リンクはGoogle Mapsで開いた後のURLを貼るか、管理地図・数値入力で位置を指定する。

スポット名と住所は自治体自身が資料や現地で確認した情報を入力する。位置・名称・住所の確認を選択すると保存できる。編集すると再確認が必要になる。Google Mapsの表示には既存のキーを使い、未設定時も数値入力で続行できる。[Maps URL仕様](https://developers.google.com/maps/documentation/urls/get-started)・[Places APIの保存条件](https://developers.google.com/maps/documentation/places/web-service/policies)を参照する。Places・逆ジオコーディングは未接続。住所等のAPIレスポンスの永続保存は行わず、導入時に利用条件、保存期間、キー、課金を確認する。

## A・B・Cへの受け渡し

- A担当は `areas` の出典・年度・コード、`memberships` のコード、既存 `areaId` の対応と、追加する管理応答 `OrgMembership.exploration` をレビューする。新規保存の1,000m検証、旧下書きの `needs-review`、新規公開の拒否も対象。公開中の旧版を移行バッチで変更する必要はない。
- B担当は既存の `PublicArea` の `publicGeometry` を使える。公開地図での区域描画と出典表示は別作業。
- C担当は既存の `GET /me/discoveries/:id` の `afterClear.spot`（任意）から `name`、`address`、`position`、`googlePlaceId`（任意）を取得できる。既存の `placeId` が識別子。最初にクリアした公開版を保存し、旧記録は同じ版から補う。地図リンクは固定のMaps検索URLに位置をエンコードし、Place IDがあれば `query_place_id` を付ける。入力されたURLを保存・再表示しない。未クリアAPIや本人記録の一覧には `afterClear.spot` を含めない。旧版では `spot` を省略できる。
