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

PrivateAnswerVersionを公開GET、通常ヒント、PRやログへ出さない。開発用の自治体公開では `getPublishedAnswerMaterial(questId, version)` が、現に公開中の指定版に固定した組織ID、参考素材ID、確認済み特徴、撮影範囲を返す。下書き編集の影響を受けず、休止・改版で旧版の参照を止める。開発用の回答受付ではこのうち撮影範囲を利用する。照合時の参考画像の取得と、本人記録の対象ID・クリア後情報を含む `PrivateAnswerVersion` の組み立ては残件。

## 処理と再送

1. 受付の所有者・challenge・digestを確認し、再認証する。入力を検証・コピーしてから処理する。
2. 同じ回答の並行実行と再送は、同一インスタンスの同じPromise/結果へまとめる。digestまたはmetadata/写真が変わればIDEMPOTENCY_CONFLICT。
3. 公開状態と版を確認し、既存の本人記録があればAIを省略する。新規のGPS判定は処理時の時計ではなく、受付に保存した最初の受信日時を使う。範囲外・不確実ならmatcherを呼ばない。
4. 実デコード済み写真を既存comparePhotosへ渡し、provider呼出し直前にも認証・公開版を再確認する。期限を過ぎてから認証が終わっても送信しない。
5. 照合後にもう一度再認証し、公開/休止・版・private snapshotの不変性を確認する。WRONG_TARGETとIMAGE_UNCERTAINは保存しない。
6. MATCHだけを既存saveFirstClearへ渡す。公開状態の最後の同期検査からメモリーストアの同期変更までawaitを挟まない。uid+placeIdの一意性で初回写真・サーバー日時を保つ。

成功結果は`{source:'mock', outcome:'SAVED_IN_MEMORY' | 'ALREADY_SAVED_IN_MEMORY', discoveryId}`。不合格は同じsourceとOUTSIDE_AREA/LOCATION_UNCERTAIN/WRONG_TARGET/IMAGE_UNCERTAIN。これはAttemptResultではなく、HTTPへ変換・返却しない。写真照合が成功しても、開発用メモリーを実保存やCORRECTと扱わない。

既定の同時処理は1件、設定上限4件。処理/結果キャッシュは既定256件で設定上限も256件、満杯では新規処理を429で拒否する。既存の結果照会は可能。matcherの時間切れは既存comparePhotosの上限10秒を使う。中止を無視するmatcherは実際に終了するまで同時数の枠を保持し、遅いMATCHで保存しない。

MATCH前の失敗結果は同じ回答にキャッシュし、同じ回答の再送でAIを自動再実行しない。削除済み記録への元回答の再送も、写真を復活させない。

### 照合済み回答の保存再開

MATCH後は、公開版のfingerprintと記録snapshot・正規化JPEGをメモリーのチェックポイントへ保持する。保存段階で503かつretryable:true（再認証の一時障害を含む）が発生した場合だけ、同じprocess呼出しを再送して保存を再開できる。AIやGPSの時刻判定は再実行しない。保存障害を受け取った後に、自動の再試行ループを回す実装は追加していない。

再開時も所有者/challenge・digest・metadata/写真の一致を確認し、保存直前に再認証と公開状態/版・private snapshotを検査する。保存が失敗する途中に来た同時再送はその実行を共有し、実行が終わってからだけ保存再開を許可する。保存後の応答断では既存の本人記録を返し、写真・日時を上書きしない。この場合の内部結果はALREADY_SAVED_IN_MEMORYとなる。

本人の認証失効、challenge失効、休止/改版・private情報変更や再試行不可の保存障害では、チェックポイントを解放して失敗をキャッシュする。別人の照会や入力違いで元の所有者のチェックポイントを破棄しない。実行中の本人確認・版確認も引き続き行う。

候補写真はproviderを呼ぶ前に正規化後のサイズを予約し、再開待ちと処理中の予約量を合計で制限する。maximumCheckpointBytesの既定/上限は32 MiB。写真1枚は既存正規化の2 MiB上限。容量不足はAIを呼ばず429となり、ほかの写真が解放された後に同じ回答で再試行できる。成功・写真不合格・致命的失敗で予約を解放し、一時保存障害だけが再開用写真を保持する。この上限はcheckpoint候補の予約量であり、デコーダーやmatcher内部の作業メモリーを含むプロセス全体の上限ではない。

保持先は同じインスタンスのメモリーだけで、再起動するとチェックポイントも消える。保持期限・永続化・孤立画像清掃は本番のO-04と合わせて別途実装する。実利用者の写真でこの開発用保持を運用しない。

## 残る接続と検証

開発用のメモリー処理は同一インスタンス内で実行を共有する。永続受付、リース取得と確定はFirestoreの内部処理で行える。実HTTPからの起動、孤立画像の清掃、実Firestore/Storage、実写真/Vertexの利用条件は残件。[Firestoreの永続受付](answer-intake.md#firestoreの永続受付)

2026-11-06：`npm --prefix server run check`は173テスト・型/lint/build成功。合成画像でGPS→代替照合→メモリー保存→実ローカルHTTPの本人記録/写真取得を確認した。別人拒否・同時再送/初回不変・既存記録時のAI省略・取消後の遅い送信/保存の拒否・認証失効・休止/改版/同一版の私的情報変更・保存失敗を検証した。Web/共有型/依存は変更せず、PR #34の261テスト・型/lint/build成功を再利用。自己レビューを実施し、第三者レビュー・実Vertexの追加送信・実Googleでの回答処理・実スマホ・実写真精度・永続保存は未検証。

同日の保存再開追加後、server checkは182テスト・型/lint/build成功。一時保存障害/保存後応答断・照合後の認証確認障害からの回復、障害確定中の同時再送、再開前の失効/休止/改版/入力違い、写真予約の上限と成功/致命的失敗での解放を確認した。初回の保存再開・challenge失効・障害確定中の再送の赤テストを確認して修正した。Web/共有型/依存は引き続き差分がなく261件の検証を再利用。自己レビューを実施し、実サービスと第三者レビューの未確認範囲は維持する。

## Firestoreでの処理再開と回答確定

認証済みworkerは所有者・回答ID・入力digestとリース時間を指定し、`claimAnswerWork` で受付済みの回答を取得する。処理中のリースが有効な間は他のworkerへ作業を渡さない。期限はFirestoreの読み取り時刻から計算する。各段階でリース、本人の挑戦と公開中の版を再確認する。

| 保存された段階 | リース取得後の作業 |
|---|---|
| `RECEIVED` | `PROCESSING` に進め、位置と写真を確認する |
| `PROCESSING` でリース切れ | 送信済みか判別できないため、`retryVerification: true` を指定した場合に限り照合を再試行する |
| `IMAGE_EVALUATED` | `recordAnswerMatch` で保存した `WITHIN_AREA` と `MATCH` を使い、非公開の正規化JPEGを `answer-photos/{attemptId}/record.jpg` に用意する |
| `COMMITTING` | `recordAnswerPhoto` で保存した画像generationを使い、`commitVerifiedAnswer` を呼ぶ |
| `COMPLETED` | 保存済みの結果を返す |

照合済みデータと画像generationの同じリースでの再送は同じ状態を保ち、保存後に異なるgenerationへ差し替えられない。リース交代後は古いworkerの書き込みを拒否する。画像の存在・書き込み結果の確認はworker側で行う。外部AIの再試行予算は実worker側で管理する。

トランザクションは回答、本人の挑戦、現在の公開版、非公開の `questVersions/{questId}:{version}`、本人の初回記録を読み直す。期限切れまたは別リース、休止・改版、版や対象が一致しない照合済みデータは確定できない。`uid` と `placeId` から決めたキーで初回日時・写真参照・クリア後の情報を作成し、同じトランザクションで回答を `CORRECT` にする。既存の初回記録は上書きせず `ALREADY_CLEARED`。確定済みの同じ回答は、所有者とdigestを確認して保存済み結果を返す。外部AI・Storageの操作はトランザクションの外で行う。

クライアントアクセスを拒否したローカルFirestoreエミュレーターで、同時リース取得、途中状態からの再開、別問題から同じ場所への同時確定、同一回答の再送、別人の分離、休止・改版・リース交代・不正な照合済みデータを検証する。専用のエミュレーターを `demo-t067-finalization`、`127.0.0.1:8688` で起動した場合は次のコマンドで実行できる。[Firestoreエミュレーターの接続方法と差異](https://firebase.google.com/docs/emulator-suite/connect_firestore)

```sh
QUEST_FIRESTORE_TEST_HOST=127.0.0.1:8688 npm --prefix server run check
```

通常起動からの呼び出し、孤立画像の清掃、実Firestore/Storageの検証は残件。現在の開発用HTTPはこの処理を呼ばない。

## 非公開JPEGの保存

`AnswerPhotoStorage` にサーバー用の非公開バケットを渡し、認可済みの処理から使う。受付には入力digestに紐づくパスを使い、記録には同じ回答の `record.jpg` を使う。どちらも `ifGenerationMatch: 0` で初回だけ書き、既存のオブジェクトはサイズとSHA-256が同じ場合に同じgenerationを返す。記録画像には受付時の正規化JPEGを使う。[Cloud Storageの前提条件](https://docs.cloud.google.com/storage/docs/request-preconditions)

読み取りは記録したgenerationを指定し、JPEG形式・2 MiB上限・ハッシュを検証する。利用中のNode SDKで正確に表せないgenerationは拒否する。画像参照や認可済みの画像本体を返す経路は、本人確認後のHTTPに接続する。

ローカル検証ではFirestoreエミュレーターと、メモリー上の `fake-gcs-server` 1.56.1をループバックに起動する。合成JPEGで同時再送、別内容の上書き拒否、旧generationの拒否、受付から初回記録の参照までを検証する。[fake-gcs-server](https://github.com/fsouza/fake-gcs-server)

```sh
QUEST_FIRESTORE_TEST_HOST=127.0.0.1:8688 QUEST_STORAGE_TEST_HOST=127.0.0.1:9688 npm --prefix server run check
```

## 永続回答worker

`runDurableAnswer` に本人の認証を再確認する関数、公開版に対応する位置条件と非公開の照合素材の取得関数、matcherを渡す。本人の記録が既にあれば初回写真を維持して `ALREADY_CLEARED` にする。新規の位置判定には受付時刻を使い、`OUTSIDE_AREA` と `LOCATION_UNCERTAIN` では照合素材を取得しない。

matcherを呼ぶ直前に本人・公開版・リースを再確認する。`WRONG_TARGET` と `IMAGE_UNCERTAIN` は区別して保存し、記録は作らない。照合サービスの障害は `SYSTEM_ERROR` を返し、照合中のリースと結果未確定の状態を保つ。照合結果を保存した後の画像書き込み障害は、後から画像保存へ戻って再開できる。確定と不合格結果の保存時には撮影情報を削除する。

両方のローカル代替環境と合成JPEG・代替matcherで、位置判定、4種類の不合格、既存記録での照合省略、照合直前の休止、照合障害、写真保存からの再開を確認する。挑戦・受付・照会のHTTPは専用の組み立てから利用できる。実サービス用の素材取得・matcher、ジョブ実行と通常の起動への接続、写真の清掃は残件。[永続HTTP](answer-intake.md#永続httpの組み立て)
