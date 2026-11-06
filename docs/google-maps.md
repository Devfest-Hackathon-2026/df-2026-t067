# Google Maps JavaScript API

旅行者画面の地図にはGoogle Mapsを使い、最初に日本列島付近を表示します。地図の表示に位置情報の許可は不要です。問題の座標やマーカーはAPIへ渡しません。

## ローカル設定

1. Google CloudでMaps JavaScript APIを有効にしたブラウザ用キーを準備します。キーをアプリの秘密鍵と混同せず、必ずウェブサイト制限とAPI制限を設定してください。
2. `.env.example`を参考に、リポジトリ直下へ`.env.local`を作り、`VITE_GOOGLE_MAPS_API_KEY`にキーを設定します。
3. 開発中はHTTPリファラーを`http://localhost:5173/*`と`http://127.0.0.1:5173/*`に限定します。公開時は実際に使うHTTPSドメインだけを追加します。API制限はMaps JavaScript APIだけにします。
4. Viteを再起動して反映します。`.env.local`はコミットしません。`VITE_`値はブラウザへ配布されます。

キーを設定していないときは「Google Mapsの設定が必要です」と表示します。地図が表示されなくても問題は閲覧できます。

通信に失敗したときやタイムアウトしたときは、再試行のボタンを表示します。認証に失敗したときはSDKを使い直さず、設定を確認してからページを読み直すよう案内します。認証失敗やタイムアウトの詳細、キー値は画面やログに表示しません。

## 確認範囲

ローダーのキー注入・script重複防止・callback、通信失敗後の再試行、タイムアウト時の後始末、地図生成中の認証失敗と画面再表示でも失敗を保持することを外部通信なしでテストします。実際の地図表示、Cloud設定、HTTPリファラー制限、請求設定は未検証です。地図APIの設定・有効化や課金はこの変更では行っていません。

公式資料：[Maps JavaScript APIの直接読み込み](https://developers.google.com/maps/documentation/javascript/load-maps-js-api)、[認証失敗イベント](https://developers.google.com/maps/documentation/javascript/events)。
