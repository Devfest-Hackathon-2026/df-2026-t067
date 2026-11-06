# 開発用の回答受付API

`POST /api/v1/challenges/:challengeId/answers`で本人の挑戦に写真とCaptureMetadataを結び付け、`GET /api/v1/attempts/:attemptId`でその受付を照会する。`local-api`の撮影画面から、開発用の受付と位置判定を試せる。この開発用受付では写真照合workerと画像保存は未接続。[ローカル画面の手順](camera-preview.md#ローカルapiで回答を送る)

## 受付と照会

両APIともFirebase ID tokenが必要。サーバーに認証設定がなければ503 AUTH_UNAVAILABLE、認証情報がないか不正な場合は401を返す。別の利用者の挑戦・受付を指定した場合も、存在しないIDを指定した場合も404 NOT_FOUNDを返す。queryは受け付けない。本文のuid・orgId・isCorrect等を権限や正解の根拠にしない。

POSTではmultipart/form-dataで、photoのファイル1つとmetadataのJSON文字列1つだけを送る。フィールドが重複、追加、不足している場合や、metadataがFileの場合は拒否する。Content-Typeの境界はFormData/fetchに任せる。

Idempotency-Keyは可視ASCIIの1〜128文字で必須。同じuid＋challengeId＋keyについて、同じ画像bytes・MIME・正規化metadataなら同じ受付ID・結果を返す。multipartの境界・ファイル名・JSONキー順は同一性に影響しない。異なる写真・位置・日時等を同じキーで送ると409 IDEMPOTENCY_CONFLICT。新しい写真には新しいキーを使う。同時送信でも登録は1件となる。

公開デモ問題の存在と版を受付直前に再確認する。古い版は409 QUEST_CHANGED、休止した問題への回答は409 QUEST_UNAVAILABLE。[開発用の公開と休止](api.md#18-開発用の公開と休止)

既定モードの初回・同内容の再送は202、公開中の同じ版に対する本人のGETは200で受付結果を返す。未判定の回答は、休止中の照会で409 QUEST_UNAVAILABLE、再公開などで版が変わった後の照会で409 QUEST_CHANGEDとなる。画面はどちらも待機を終了し、QUEST_CHANGEDでは最新版を取得する。[GPS demoモード](gps-validation.md)で確定した範囲外・位置不確実は、休止や改版の後も本人の照会で元の結果を返す。位置条件の通過は次の受付状態のまま。

```json
{
  "attemptId": "server-generated-id",
  "state": "RECEIVED",
  "outcome": null,
  "nextAction": "WAIT",
  "source": "mock"
}
```

これは**開発用の受付確認**。workerがないため時間が経ってもRECEIVEDから進まない。自動ポーリングや「判定中」「正解」「保存済み」の表示には接続しない。写真を保持しないので、後から実判定の待ち行列として利用できず、処理の接続後には新しい回答が必要になる。

共通DTO/clientを使う。既定clientはmockを引き続き拒否する。expectedDataMode:demoと成功応答のX-Quest-Data-Mode:demoがそろった受付と、GPS demoのOUTSIDE_AREA/MOVE_TO_AREA・LOCATION_UNCERTAIN/RETAKEだけを狭い例外として許可する。mockの正解・その他完了・PROCESSING等はこの設定でも拒否する。実接続の失敗からmockへ切り替えない。

```ts
const api = createApiClient({
  getIdToken: () => authClient.getIdToken(),
  expectedDataMode: 'demo',
})
const receipt = await api.submitAnswer({ challengeId, photo, metadata, idempotencyKey })
const sameReceipt = await api.getAttempt(receipt.attemptId)
```

撮影画面は写真と位置を確認した後、利用者の明示操作でこのclientを呼ぶ。サーバーは明示的demoモードとlocalhostに限る。

## 入力と開発用の上限

| 対象 | 制限・失敗 |
|---|---|
| 写真 | JPEG/PNG/WebP、空でない、4MiB以下。非対応MIMEは415 HTTP_ERROR、シグネチャ不一致・空は400 INVALID_INPUT |
| 画像検査の範囲 | [実デコードと正規化](photo-match.md)を接続。JPEG/PNG/WebP、破損・多フレーム・画素上限を検査し、向きを画素へ反映してEXIF等を除去。nativeの処理上限も適用 |
| metadata | UTF-8換算4KiB以下。共通検証で項目・緯度経度・非負精度・UTC日時を確認。時刻鮮度・精度上限・範囲は明示的GPS demoモードで追加検査 |
| 本文 | 全体4MiB＋16KiB以下。Content-Lengthとchunked受信量を確認。超過は413 MEDIA_TOO_LARGE |
| メディア | multipart以外・圧縮は415、壊れたmultipart・不正JSON・追加項目は400。Content-TypeとIdempotency-Keyの重複は400 |
| 受信 | 本文受信5秒で408 HTTP_ERROR。同時4件。上限は429、Retry-After:1 |
| 利用者ごとの要求 | 所有者・キー確認後の受信試行は、不正本文・再送も含め10回/60秒。超過429とRetry-After。認証・所有者・キーで拒否した要求は含めない |
| 受付領域 | 最大256件。上限503 SYSTEM_ERROR。既存受付の照会・再送で内容を上書きしない。回数管理も最大256利用者 |

本番O-03の決定ではなく、ローカルのメモリ・受信を保護する値。本文切断・時間切れ・検証失敗では期限と受信枠を解放する。multipartは[Node標準のRequest/FormData](https://nodejs.org/api/globals.html)で上限付き受信後に解析し、依存追加はない。

## 保存と未実装

写真・位置・ファイル名は入力の検証に一時的に使い、受付メモリには所有者・挑戦とキーの索引・問題IDと版・入力SHA-256・受信日時・受付結果を残す。画像bytes、緯度経度、metadata自体は保持せず、ディスク、ログ、外部AI、Firebaseへ出さない。GETは受付結果またはエラーを返す。プロセス終了で消え、再起動後の照会は404となる。

開発用HTTPから実写真照合worker、実データの撮影範囲、Firestore/Storageへの保存は未接続。サーバー内部のFirestore受付と処理再開は下記を参照。

## Firestoreの永続受付

認証済みの呼び出し側が `prepareAnswerIntake` へ本人・挑戦・回答キー・入力digestを渡す。既存の回答なら同じ結果を返す。新規の場合は同じ組み合わせから決まる回答IDと、入力digestに紐づく非公開の保存先 `answer-photos/{attemptId}/incoming-{digest}.jpg` を返す。

呼び出し側は正規化したJPEGをその保存先に用意し、画像のgenerationを確認してから `acceptDurableAnswer` を呼ぶ。受付は所有者・公開状態・版と、サーバー設定の利用者別上限をもう一度確認する。新規受付と上限のカウントは同じトランザクションで書く。同じ回答の再送では受付数を増やさず、同じキーの入力違いは409で拒否する。

本人照会は回答状態と結果を返す。位置・撮影情報・画像参照は処理リースを持つ内部workerが読み、確定時に撮影情報を削除する。照合済みデータと画像の保存後は処理を再開できる。[処理再開と回答確定](answer-processing.md#firestoreでの処理再開と回答確定)

`AnswerPhotoStorage` はサーバーから渡す非公開バケットを使う。同じ保存先にオブジェクトがある場合は、初回のgenerationを変えず、同じ正規化JPEGの再送だけを受け付ける。確定済みの受付画像は定期清掃の対象になる。受付不成立などで残った画像の清掃、本番の上限値と保持期間は残件。[画像の保存と検証](answer-processing.md#非公開jpegの保存)

## 永続HTTPの組み立て

`createDurableAnswerServer` は、認証検証器、Firestore、非公開画像の保存先、開始・受付上限、アップロード枠を明示して組み立てる。既存のセッション・挑戦開始・回答POST・本人照会のURLと入力形式を使う。回答受付とジョブの回収時刻を同じFirestore書き込みで保存する。ジョブ投入関数も渡した場合は、保存を確認してから即時投入を依頼する。

即時投入に失敗した場合は503を返し、保存済みの受付を保持する。同じ回答の再送で画像や受付を増やさず即時投入を再度依頼できる。再送が来ない場合もサーバー側の回収対象に残る。重複したジョブ実行はworkerのリースで抑える。本人照会ではジョブを起動しない。結果を確定した回答の再送は保存済み結果を返す。[ジョブの回収](answer-processing.md#回答ジョブの回収)

通常の起動コマンドから `durable-local` を選ぶと、公開カタログ、永続HTTP、定期回収を一緒に起動できる。Web画面の同じモードで公開問題を選び、認証確認後にその版で挑戦する。ローカルの通しテストでは代替認証、合成JPEG、Firestoreエミュレーター、ループバックのGCS代替サーバーで、挑戦・回答送信・本人照会と本人記録の取得・削除を確認する。本番環境への接続は残件。[永続APIの起動](../server/README.md#永続apiをローカルで起動する)

## 検証

`npm --prefix server run check`で、実HTTPと合成画像・架空座標を使い、受付・再送・同時送信・競合・所有者分離・multipart境界・サイズ・時間・回数・容量・切断後の枠解放・版変更を検証する。認証検証器は明示的な代替で、実Googleによる写真送信ではない。`npm run check`で共通clientのdemo受付・GPS不合格の限定許可、mock正解拒否と既存画面を確認する。

対応はFR-05/07/08、AT-10/12/18/21/22の一部。[受け入れ条件](acceptance.md)の実画像保存・正解・現地・組織分離の完了を意味しない。画像デコードは合成画像で確認済み。実スマートフォン、実Google token＋実写真/GPSの送信、実AI・実DBは未検証。
