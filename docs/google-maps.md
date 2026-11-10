# Google Maps JavaScript API

旅行者画面の地図にはGoogle Mapsを使い、日本列島付近を初期表示します。地図表示時に位置情報の許可は求めず、「現在地へ戻る」を押した場合だけ単発で位置情報を取得します。取得した座標はGoogle Mapsの中心表示に使われ、アプリには保存しません。位置情報がGoogle Mapsへ送信される旨の案内は常駐表示せず、そのセッションで初めて現在地取得を行う際に、取得結果のステータス表示の中で一度だけ示します（D-28）。durable-localモードでは公開APIの探索地域境界（GeoJSON `Polygon` / `MultiPolygon`）を地図に表示し、タップすると地域選択・問題一覧・URLを更新します。選択地域が変わると検証済みの公開境界全体へ表示範囲を合わせ、同じ地域の更新では利用者の地図移動を保ちます。SDKの境界描画に失敗した場合は地図と一覧を使える状態にして、地域境界の再試行を表示します。問題座標、正解位置、参考写真は地図へ渡しません。demoモードでは架空の地域座標を地図に表示しません。

初期ズームは5、アプリ内の拡大上限は20、縮小下限は5です（D-67。D-41 で 3 から 4.5 に上げたものを、ちらつき対策として整数の 5 に変更）。SDKの`minZoom`/`maxZoom`、拡大・縮小ボタンのdisabled状態とズーム値のclampは同じ定数を使います。現在地へ戻る操作後はズーム14で表示します。上限20はアプリ操作の上限で、表示できる地図の細かさは地域・地図データに依存します。

移動範囲は制限しません。かつては `restriction`（北緯23〜46.5度・東経122〜147度、strictBoundsなし）と国外を薄く落とすベールで日本専用の見た目を作っていましたが、restriction はピン選択時のフィットで中心が差し替わる不具合の原因となったため撤去し、ベールも飾りだけが残ったため撤去しました（D-41 の各追記）。日本向けの見え方は、初期表示の日本全体フィットと縮小下限 5 で保ちます。

## ローカル設定

1. Google CloudでMaps JavaScript APIを有効にしたブラウザ用キーを準備します。キーをアプリの秘密鍵と混同せず、必ずウェブサイト制限とAPI制限を設定してください。
2. `.env.example`を参考に、リポジトリ直下へ`.env.local`を作り、`VITE_GOOGLE_MAPS_API_KEY`にキーを設定します。
3. 開発中はHTTPリファラーを`http://localhost:5173/*`と`http://127.0.0.1:5173/*`に限定します。公開時は実際に使うHTTPSドメインだけを追加します。API制限はMaps JavaScript APIだけにします。
4. Viteを再起動して反映します。`.env.local`はコミットしません。`VITE_`値はブラウザへ配布されます。

キーを設定していないときは「Google Mapsの設定が必要です」と表示します。地図が表示されなくても問題は閲覧できます。

通信に失敗したときやタイムアウトしたときは、再試行のボタンを表示します。認証に失敗したときはSDKを使い直さず、設定を確認してからページを読み直すよう案内します。認証失敗やタイムアウトの詳細、キー値は画面やログに表示しません。

## 確認範囲

ローダーのキー注入・script重複防止・callback、通信失敗後の再試行、タイムアウト時の後始末、地図生成中の認証失敗と画面再表示でも失敗を保持することをテストします。公開境界のGeoJSON座標順・穴・選択クリック・古い図形の破棄・demo非表示・SDKレイヤー例外後の再試行・選択地域への範囲合わせと同地域再描画時の表示維持、現在地取得の許可拒否・取得失敗・遅延応答の無視、初期ズーム5・現在地表示ズーム14・12を超える拡大・上限20と下限3をMaps SDK/Geolocationモックで確認します。実際の地図表示、ズーム20での実地図の詳細度、実測位、Cloud設定、HTTPリファラー制限、請求設定は未検証です。地図APIの設定・有効化や課金はこの変更では行っていません。

公式資料：[Maps JavaScript APIの直接読み込み](https://developers.google.com/maps/documentation/javascript/load-maps-js-api)、[認証失敗イベント](https://developers.google.com/maps/documentation/javascript/events)。

## 管理画面の住所候補

- `durable-local` と共有検証モードでは、4ステップのSTEP 1で地図を開き、施設アイコンや位置を選ぶ。住所を照会する場合はPlace IDまたは座標を、所属確認付きの `POST /api/v1/orgs/:orgId/spot-address` に送る。入力にURLや下書きの内容は含めない。既存の下書き・公開・旅行者向けAPIは同じ契約で動作する。
- Google Geocoding API v4の固定HTTPSホストを使い、リダイレクトを拒否する。Place IDと座標の両方がある場合、応答のIDが異なるか位置が約50mを超えて離れていれば候補を返さない。座標のみの照会では付近の住所を参考表示する。外部通信は4.5秒・応答本文32 KiBまで。1プロセスあたり同時4件、毎分全体30件・同一利用者6件に制限する。
- サーバーキーは設定済み（2026-11-09、D-68）。Geocoding API（`geocoding-backend.googleapis.com`）をプロジェクトで有効化し、Viteの地図表示キーと分離したサーバー専用キー（表示名「Tourism Quest Server Geocoding」）のAPI制限を Geocoding API だけに設定した。キーは Secret Manager（`quest-geocoding-api-key`）に保管し、Cloud Run の環境変数 `QUEST_GOOGLE_GEOCODING_API_KEY` として secret 参照で注入する。デプロイワークフローは image と labels だけを更新するため、再デプロイで上書きされない。キーが未設定または形式不正なら住所照会を無効にし（応答は `unavailable`）、管理画面では手入力できる。キー値、送信座標、候補住所をアプリのログ・保存先に記録しない。
- 料金の前提（2026-11-09 に公式料金表で確認）：Geocoding は Essentials SKU で毎月 10,000 件まで無料、超過分は 1,000 件あたり $5.00（10,001〜100,000 件）。想定利用は管理画面からの手動照会のみで、アプリ内制限が実効上限になるため通常は無料枠内に収まる見込み。詳細は D-68。
- 応答は `private, no-store`。候補はGoogle Mapsの出典を添えて表示し、下書きや公開版には転記しない。Googleの保存条件に合わせ、保存欄は自治体が独自に確認した情報に使う。出典表示は候補表示に実装済み。本番公開時の利用規約・プライバシーポリシーの整備は別途行う。
- 運用者が Places API (New) の利用と費用を確認し、制限したブラウザキーで利用を許可した環境に限り、`VITE_GOOGLE_MAPS_PLACES_PICKER=true` で施設アイコンの名称と住所も照会する。候補は入力欄の外に参考情報として表示し、保存値には入れない。地図右下の「現在地へ戻る」はブラウザの位置情報を取得して地図を移動する操作。スポットを登録するには地図上で場所を選ぶ。未設定時は既存の住所照会のみを使う。
- 短縮URL（`maps.app.goo.gl`／旧 `goo.gl/maps`）の自動展開は行わない。実装する場合は、許可ホストの確認・DNS検証・回数とサイズの上限などの安全契約（D-68）に従う。

[場所IDの住所照会](https://developers.google.com/maps/documentation/geocoding/places-geocoding)・[逆ジオコーディング](https://developers.google.com/maps/documentation/geocoding/reverse-geocoding)・[利用条件と出典](https://developers.google.com/maps/documentation/geocoding/policies)
