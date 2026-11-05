# 画面とローカルAPIを接続する

2026-11-05。PR #6/#7の次のA担当作業。地図は静的なプレビューのまま、APIの架空の1問を取得し、Googleログイン後のID tokenをサーバーで確認する。実Maps・DB・写真判定・保存には接続しない。

## モードを選ぶ

| `.env.local`の設定 | 動作 |
|---|---|
| 未設定・空・`VITE_QUEST_DATA_SOURCE=preview` | 既存の画面内サンプルを表示。問題取得・サーバー認証確認の通信なし |
| `VITE_QUEST_DATA_SOURCE=local-api` | Vite開発サーバーで、ローカルAPIから`demo-quest`を取得 |
| 不明な値・本番ビルドでの`local-api` | 表示設定エラー。プレビューに自動で切り替えず、APIも呼ばない |

APIモードでは「ローカルAPI・デモ」をPC・スマホの両方に表示する。取得した問題のIDと`X-Quest-Data-Mode: demo`を検証する。地図マーカーの位置は架空の配置で、APIの公開地域の実座標や正解位置ではない。

`npm run build`の成果物を`npm run preview`で確認する場合は、先に`VITE_QUEST_DATA_SOURCE=preview`へ戻してビルドする。実APIを一般公開するためのモードや配信設定は、この段階では追加していない。

## 2つのターミナルで起動する

ルートの`.env.local`で`VITE_QUEST_DATA_SOURCE=local-api`を指定する。実設定はGitへ追加しない。

Googleログインも試す場合は[認証ガイド](firebase-auth.md)の6項目を設定し、サーバー用に**同じプロジェクトのID**を`FIREBASE_PROJECT_ID`へ設定する。サービスアカウント鍵は不要。認証を試さず公開問題だけを見る場合は、`FIREBASE_PROJECT_ID`の行を省略する。空文字の行は不正な設定としてサーバー起動を止める。

ターミナル1（リポジトリのルート）：

```sh
npm ci
npm --prefix server ci --ignore-scripts
QUEST_DATA_MODE=demo NODE_ENV=development npm run dev:api
```

サーバーをビルドして、127.0.0.1:8787で起動する。`dev:api`はNodeの`--env-file-if-exists=.env.local`でルートの実設定を読み込む。デモの指定を省略した起動、本番モード、Auth Emulatorは拒否する。以前のシェルで設定した環境変数がある場合は`.env.local`より優先されるので、意図しない設定は解除する。

ターミナル2（同じルート）：

```sh
npm run dev
```

[localhost:5173](http://localhost:5173/)を開く。5173が別の作業で使用中なら、その作業を止めず、明示的に`npm run dev -- --port 5174`で起動して[localhost:5174](http://localhost:5174/)を開く。Firebaseの許可ドメインに合わせ、ブラウザでは`127.0.0.1`ではなく`localhost`を使う。

Viteが`/api`だけを固定のローカルサーバーへproxyする。共通clientの同一originパスを維持し、サーバーへ広いCORS許可は追加しない。Viteのpreviewや本番の配信設定にはproxyを追加していない。設定を変更したらViteを再起動する。終了は両ターミナルで **Ctrl+C**。

## 期待する動作

- ログインなしで「架空のデモ問題 A」を取得し、開ける。接続確認用の1問で、サーバーにある全問題の一覧ではない。
- 読み込み中はマーカー選択を無効にする。通信失敗・不正な返却・10秒の応答待ち超過ではエラーと「問題を再読み込み」を表示する。画面内の別サンプルへ自動で戻さない。
- Googleログイン後・状態復元後は、最新のID tokenで`GET /api/v1/session`を呼ぶ。返却uidと現在のFirebase利用者が一致した場合だけ「ログインを確認しました」と表示する。uid・token・SDKエラーは画面やログへ出さない。
- 認証確認が401/503・不正返却・uid不一致・通信失敗になった場合、問題を保持して確認の再試行を出す。Googleのポップアップを勝手に開き直さない。
- ログアウト・利用者変更・画面終了時は進行中の通信を中止し、古い応答を反映しない。

ログイン確認は署名・issuer・audience・期限の確認まで。認証確認後は[撮影と写真確認の画面](camera-preview.md)を試せる。失効・ユーザー無効化の追加照会、自治体所属の認可、写真送信・回答・クリア確定・本人記録は未実装。ログイン確認の成功を、これらの成功として扱わない。

## 確認

```sh
npm run check
npm --prefix server run check
```

接続のテストはHTTP応答とAuthClientを明示的に代替し、問題取得、拒否・再試行、uid不一致、利用者変更後の古い結果の破棄を確認する。サーバー側は実SDKによる不正tokenの拒否も確認する。単体テストの成功を実Google ID tokenの正常系成功として扱わない。

インストール時に見つかったサーバー依存のmoderate警告6件は、直接依存の版を維持する`npm --prefix server audit fix --ignore-scripts`で対象外の依存構成へ更新し、0件になったことを確認した。`google-gax`は5.0.8から5.0.4、`gcp-metadata`は8.1.4から8.1.2へ解決し、対象のglob/minimatch系を含む不要な依存を除去した。lockfileを共有し、各自が別々の版に更新しない。

今回のローカル確認では、ブラウザからの問題取得、API停止時のエラー、再起動後の再試行での復帰、375px・320px幅の横はみ出しなしを確認した。型・lint・画面105テスト・サーバー55テスト・両ビルドも成功。

2026-11-05に実Chromeと実Googleアカウントで、Googleログイン→Firebase ID tokenのサーバー検証→現在の利用者とのuid一致を確認し、「ログインを確認しました」の表示まで成功した。再読み込み後の認証復元とサーバーでの再確認、ログアウト後の匿名表示への復帰、ログイン前後とログアウト後に同じ問題を表示できることも確認した。Auth Emulatorや代替のAuthClient・HTTP応答は使っていない。確認後はログアウト済み。アカウント名・メール・uid・token・実設定値は共有資料へ記録しない。

実スマートフォンでの操作は未検証。失効確認、組織認可、実Maps、写真判定・保存はこの確認に含まない。
