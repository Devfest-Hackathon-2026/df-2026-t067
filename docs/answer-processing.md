# A向け：開発用の回答処理接続

`server/src/answer-processing.ts`の`DemoAnswerProcessor`は、受付・GPS・写真照合・本人記録ストアをつなぐ**サーバー内部用の部品**。FR-06/07/08、AT-10/12/18/19/22の部分実装として、合成画像と代替matcherで検証する。

HTTPハンドラー・main・環境変数からは起動しない。既存の回答POST/本人照会は引き続きRECEIVEDか開発用GPS不合格を返す。旅行者の実写真をVertexへ送信せず、CORRECTを返さず、実Firestore/Storage・永続ジョブ・公開を有効にしない。

## 内部の受け渡し

`new DemoAnswerProcessor(options).process(uid, attemptId, input)`を使う。これはHTTPの追加ルートではない。

| 入力/依存 | 条件 |
|---|---|
| uid / attemptId | 認証済みの利用者と、既存DemoAnswerStoreで発行した回答ID。所有者とchallengeの両方を確認する |
| input | 同じサーバーのreadAnswerInputが返したdigest・metadata・正規化済みphotoを、そのまま渡す。ブラウザのdigest/isCorrect/座標を判定済み情報として採用しない |
| answers / challenges | 同じ受付に使った開発用ストア。getAcceptedOwnedは所有者付きのchallengeId・digest・最初の受信日時・結果だけを内部へ返す。写真/GPSを受付ストアへ保存しない |
| discoveries | 同じDemoDiscoveryStore。本人APIと共有すれば内部処理で作った合成記録を本人だけが取得できる |
| currentQuest(questId) | サーバー専用の同期lookup。公開中の版、placeId、非公開の参考写真/確認済み特徴/GPS条件/記録snapshotを供給する。公開DTOやクライアント申告から作らない |
| authorize(uid) | サーバー側で所有者の認証有効性を再確認し、確認できた場合だけtrue。失効はfalse、確認障害は例外。実接続時は呼出しごとに期限を設けた本人確認が必要 |
| matcher | 既存PhotoMatcher。未設定・不正出力・通信障害はSYSTEM_ERROR。検証では代替matcherのみ使用した |

PrivateAnswerVersionを公開GET、通常ヒント、PRやログへ出さない。登録の下書きと公開版のサーバー側管理は別に実装する必要があり、この部品へdraftを自動転用しない。

## 処理と再送

1. 受付の所有者・challenge・digestを確認し、再認証する。入力を検証・コピーしてから処理する。
2. 同じ回答の並行実行と再送は、同一インスタンスの同じPromise/結果へまとめる。digestまたはmetadata/写真が変わればIDEMPOTENCY_CONFLICT。
3. 公開状態と版を確認し、既存の本人記録があればAIを省略する。新規のGPS判定は処理時の時計ではなく、受付に保存した最初の受信日時を使う。範囲外・不確実ならmatcherを呼ばない。
4. 実デコード済み写真を既存comparePhotosへ渡し、provider呼出し直前にも認証・公開版を再確認する。期限を過ぎてから認証が終わっても送信しない。
5. 照合後にもう一度再認証し、公開/休止・版・private snapshotの不変性を確認する。WRONG_TARGETとIMAGE_UNCERTAINは保存しない。
6. MATCHだけを既存saveFirstClearへ渡す。公開状態の最後の同期検査からメモリーストアの同期変更までawaitを挟まない。uid+placeIdの一意性で初回写真・サーバー日時を保つ。

成功結果は`{source:'mock', outcome:'SAVED_IN_MEMORY' | 'ALREADY_SAVED_IN_MEMORY', discoveryId}`。不合格は同じsourceとOUTSIDE_AREA/LOCATION_UNCERTAIN/WRONG_TARGET/IMAGE_UNCERTAIN。これはAttemptResultではなく、HTTPへ変換・返却しない。写真照合が成功しても、開発用メモリーを実保存やCORRECTと扱わない。

既定の同時処理は1件、設定上限4件。処理/結果キャッシュは既定256件で設定上限も256件、満杯では新規処理を429で拒否する。既存の結果照会は可能。matcherの時間切れは既存comparePhotosの上限10秒を使う。中止を無視するmatcherは実際に終了するまで同時数の枠を保持し、遅いMATCHで保存しない。

失敗結果も同じ回答にキャッシュし、同じ回答の再送でAIを自動再実行しない。保存失敗からのチェックポイント再開は未実装。再試行方針を別途実装するまで失敗を成功へ変更しない。削除済み記録への元回答の再送も、写真を復活させない。

## 残る接続と検証

実HTTPの回答受付からの起動、処理状態の更新、永続leaseとチェックポイント、画像/DBをまたぐ回復と孤立画像の清掃、実Firestore/Storage、実写真/Vertexの利用条件を残す。本番では公開状態/版/所有者/初回一意キーと回答の最終結果を同じtransactionで確認・確定し、外部AIはtransactionの外で呼ぶ。このメモリー上の同期性を本番DBの原子性へ転用しない。初回処理の共有も同一インスタンス内だけで、複数プロセスの課金一意性を保証しない。

2026-11-06：`npm --prefix server run check`は173テスト・型/lint/build成功。合成画像でGPS→代替照合→メモリー保存→実ローカルHTTPの本人記録/写真取得を確認した。別人拒否・同時再送/初回不変・既存記録時のAI省略・取消後の遅い送信/保存の拒否・認証失効・休止/改版/同一版の私的情報変更・保存失敗を検証した。Web/共有型/依存は変更せず、PR #34の261テスト・型/lint/build成功を再利用。自己レビューを実施し、第三者レビュー・実Vertexの追加送信・実Googleでの回答処理・実スマホ・実写真精度・永続保存は未検証。
