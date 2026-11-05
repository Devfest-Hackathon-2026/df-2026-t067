# 開発用の回答受付API

`POST /api/v1/challenges/:challengeId/answers`と`GET /api/v1/attempts/:attemptId`を追加した。[挑戦開始API](challenge-start.md)で作った本人の挑戦へ写真・CaptureMetadataを結び付ける段階。**画面の送信操作・判定worker・画像保存は未接続**である。

## 受付と照会

両APIともFirebase ID tokenが必要。未設定は503 AUTH_UNAVAILABLE、欠落・不正認証は401。別利用者の挑戦・受付と不明IDは同じ404 NOT_FOUND。queryは許可せず、本文のuid・orgId・isCorrect等を権限や正解の根拠にしない。

POSTはmultipart/form-dataでphotoファイル1つとmetadataのJSON文字列1つだけを送る。同じ名前の重複、追加・不足、metadataのFile化を拒否する。Content-Typeの境界はFormData/fetchに任せ、手動設定しない。

Idempotency-Keyは可視ASCIIの1〜128文字で必須。同じuid＋challengeId＋keyについて、同じ画像bytes・MIME・正規化metadataなら202で同じ受付IDを返す。multipartの境界・ファイル名・JSONキー順は同一性に影響しない。異なる写真・位置・日時等を同じキーで送ると409 IDEMPOTENCY_CONFLICT。新しい写真には新しいキーを使う。同時送信でも登録は1件となる。

公開デモ問題の存在と版を受付直前に再確認する。古い版は409 QUEST_CHANGED、公開一覧にない問題への挑戦参照は409 QUEST_UNAVAILABLE。実データの休止・既クリア・時間鮮度のアダプターは未実装で、本番の受付条件を満たす意味ではない。

初回・同内容の再送は202、本人のGETは200で同じ結果を返す。

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

共通DTO/clientを使う。既定clientはmockを引き続き拒否する。expectedDataMode:demoと成功応答のX-Quest-Data-Mode:demoがそろい、RECEIVED・WAIT・outcome:nullの受付だけを狭い例外として許可する。mockの完了・正解・PROCESSING等はこの設定でも拒否する。実接続の失敗からmockへ切り替えない。

```ts
const api = createApiClient({
  getIdToken: () => authClient.getIdToken(),
  expectedDataMode: 'demo',
})
const receipt = await api.submitAnswer({ challengeId, photo, metadata, idempotencyKey })
const sameReceipt = await api.getAttempt(receipt.attemptId)
```

これはC担当の後続接続用で、現在の画面から実写真・現在地を送信する実装ではない。サーバーも従来どおり明示的demoモード・localhost限定で、本番・Auth Emulator起動を拒否する。

## 入力と開発用の上限

| 対象 | 制限・失敗 |
|---|---|
| 写真 | JPEG/PNG/WebP、空でない、4MiB以下。非対応MIMEは415 HTTP_ERROR、シグネチャ不一致・空は400 INVALID_INPUT |
| 画像検査の範囲 | MIMEと先頭シグネチャのみ。実画像デコード、破損・画素数検査、EXIF除去・安全な再エンコードは未実装で、照合・保存前に必要 |
| metadata | UTF-8換算4KiB以下。共通検証で項目・緯度経度・非負精度・UTC日時を確認。時刻鮮度、精度上限、範囲判定は後続 |
| 本文 | 全体4MiB＋16KiB以下。Content-Lengthとchunked受信量を確認。超過は413 MEDIA_TOO_LARGE |
| メディア | multipart以外・圧縮は415、壊れたmultipart・不正JSON・追加項目は400。Content-TypeとIdempotency-Keyの重複は400 |
| 受信 | 本文受信5秒で408 HTTP_ERROR。同時4件。上限は429、Retry-After:1 |
| 利用者ごとの要求 | 所有者・キー確認後の受信試行は、不正本文・再送も含め10回/60秒。超過429とRetry-After。認証・所有者・キーで拒否した要求は含めない |
| 受付領域 | 最大256件。上限503 SYSTEM_ERROR。既存受付の照会・再送で内容を上書きしない。回数管理も最大256利用者 |

本番O-03の決定ではなく、ローカルのメモリ・受信を保護する値。本文切断・時間切れ・検証失敗では期限と受信枠を解放する。multipartは[Node標準のRequest/FormData](https://nodejs.org/api/globals.html)で上限付き受信後に解析し、依存追加はない。

## 保存と未実装

写真・位置・ファイル名は入力の検証に一時的に使い、受付メモリには所有者・挑戦とキーの索引・入力SHA-256・受付結果だけを残す。画像bytes、緯度経度、metadata自体は保持せず、ディスク、ログ、外部AI、Firebaseへ出さない。GETもそれらを返さない。プロセス終了で消え、再起動後の照会は404となる。

写真照合、時刻鮮度・位置精度・範囲判定、クリア確定、Firestore/Storage、本人記録、組織認可、実際の公開・休止処理は未実装。保存リージョン・モデル・料金・削除期間等の未決事項をこのPRで確定しない。

## 検証

`npm --prefix server run check`で、実HTTPと合成1px画像・架空座標を使い、受付・再送・同時送信・競合・所有者分離・multipart境界・サイズ・時間・回数・容量・切断後の枠解放・版変更を検証する。認証検証器は明示的な代替で、実Googleによる写真送信ではない。`npm run check`で共通clientのdemo受付例外・mock完了拒否と既存画面を確認する。

対応はFR-05/07/08、AT-10/12/18/21/22の一部。[受け入れ条件](acceptance.md)の実画像保存・正解・現地・組織分離の完了を意味しない。実スマートフォン、実Google token＋実写真/GPSの送信、画像デコード、実AI・実DBは未検証。
