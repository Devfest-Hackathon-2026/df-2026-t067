# D向け写真判定試験API

目的はA05の写真試験APIのA待ちを解消すること。[管理APIのtest](../../api.md)、[A05の境界](../../admin-demo.md#a05-管理画面内の旅行者向け表示確認)とFR-11/12・AT-09/15/16/21/22の部分として単独実装する。

POST `/orgs/:orgId/quests/:questId/test`でphotoとmetadata（expectedDraftRevision/photoRights）を受け付ける。既存の所属・素材・multipart・画像デコード・comparePhotosを使い、試験ID・組織/問題/下書きrevision・写真照合結果だけを返す。sourceは開発用mock。発見記録/回答受付/公開資格を作らない。

- [x] 共有metadata/result parserと実HTTPの未実装テストを確認する（Web1失敗/1成功、server既存188成功/新規1失敗）。
- [x] client・所属/組織/素材用途・revision確認を追加する。確認済み特徴は下書きの非空行1〜20個・各300文字以内として受け取り、黙って切り詰めない。
- [x] 同じキーの入力hash/処理/結果を共有し、上限128件・照合1件と受付の既存レート制限を適用する。期限後のprovider/認可待ちも実際に終わるまで照合枠を保持する。
- [x] 所属取消・下書き変更・入力競合・照合結果の区別・非露出・記録非作成・取消と遅い結果を検証。Web24ファイル271件/server201件・型/lint/build成功。差分/リンク/自己レビューと接続資料を準備した。

単独で重要差分をレビュー。第三者レビューと実サービス確認は未実施。最後の追加はサーバーテストだけで、Web271件の検証を再利用した。PR/Issueの実際の作成・マージ状態はGitHubを参照する。

通常のmain/envから照合器を有効にしない。ServerOptionsへの明示注入だけを試験で使い、未設定は503。実Vertexの追加送信・写真・課金/IAM/公開・保存・CORRECT、Dの画面接続・公開前の試験資格は残す。
