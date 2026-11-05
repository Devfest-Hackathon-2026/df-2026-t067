# 挑戦開始APIの開発用実装

`POST /api/v1/challenges`を追加した。既存のFirebase ID token検証と共通Challenge DTO/clientを使い、利用者と公開デモ問題・版をサーバーで結び付ける。[撮影画面](camera-preview.md)は`local-api`モードでこの開始APIの成功後に開く。写真・GPSの送信、回答・判定・クリア保存はまだ追加していない。

## 入力と返却

認証は`Authorization: Bearer ...`。ブラウザの状態やbodyのuidではなく、Firebase Admin SDKが検証したuidを所有者にする。Firebase未設定は503 AUTH_UNAVAILABLE、認証情報の欠落・不正は401 UNAUTHENTICATED。

Content-Typeは`application/json`（UTF-8のcharset指定も可）。bodyは次の2項目だけを許可する。

```json
{ "questId": "demo-quest", "expectedVersion": 1 }
```

IDは既存の公開APIと同じ1〜128文字、版は正の安全な整数。uid / orgId / role / createdAt / challengeId / isCorrect等の追加項目やクエリは400 INVALID_INPUTで拒否する。圧縮bodyとJSON以外は415 HTTP_ERROR、UTF-8・JSONの不正は400、4KiB超は413 MEDIA_TOO_LARGE、body受信の5秒超過は408 HTTP_ERROR。

現在の公開デモ一覧にない問題は404 NOT_FOUND、公開版とexpectedVersionが異なる場合は409 QUEST_CHANGED。休止や既クリア状態を扱う実データのアダプターはまだない。

初回は201、同じuid・問題ID・版の再要求は200で同じChallengeを返す。応答断後の再操作や同時要求でも、同じ一時挑戦を再利用する。

```json
{
  "challengeId": "server-generated-id",
  "questId": "demo-quest",
  "version": 1,
  "createdAt": "2026-11-05T00:00:00.000Z"
}
```

上記ID・日時は説明用。実際のIDはサーバーのUUID、日時はサーバー時計のUTC。uid・組織情報・token・正解・写真は返さない。成功・失敗とも既存のデモ識別ヘッダー、requestId、no-storeを維持する。

## C担当から呼ぶ

[ローカルAPI接続手順](local-api.md)でAPIとViteを起動し、既存の共通clientを使う。新しいfetch処理やChallenge型をコピーしない。

```ts
const api = createApiClient({
  getIdToken: () => authClient.getIdToken(),
  expectedDataMode: 'demo',
})
const challenge = await api.createChallenge({
  questId: selectedQuest.questId,
  expectedVersion: selectedQuest.version,
})
```

`selectedQuest`は公開APIから得た問題ID・版を保持したもの。画面は`ChallengeCapture`から共通clientを呼び、返却の問題ID・版も一致する場合だけカメラを開く。返却されたchallengeIdを将来の写真送信に引き渡す設計で、クライアントの時刻・uidからIDを組み立てない。401は認証の再確認、409は問題の再取得、429はRetry-Afterに従う。clientはPOSTを自動で再送しない。

## 一時領域と制限

`DemoChallengeStore`は**開発用のプロセス内メモリ**。最大256件で、サーバー再起動ですべて消える。永続保存や本人のクリア記録ではない。容量上限では503 SYSTEM_ERROR（retryable: false）を返し、既存の挑戦の再取得は可能。開発環境の再起動でリセットする。

正常な入力の開始要求は、再要求を含めて利用者ごとに60秒の窓で10回まで。超過は429 RATE_LIMITEDとRetry-Afterを返す。窓の管理領域も最大256利用者で、期限切れを除去する。これらは開発用リソース保護の値であり、本番の回数・保存期間・失効方針の決定ではない。

所有者付き取得の内部メソッド`getOwned`は別uid・不明IDならnullを返す。HTTPの`GET /challenges/:id`や写真回答は未実装。将来の回答処理では所有者だけでなく、公開状態・版・既クリア・回答IDの冪等性も再確認する必要がある。

## 検証と未検証

`npm --prefix server run check`で、実HTTPを使う開始・再要求・同時要求・所有者分離・回数制限・容量制限・JSON境界・遅い本文・切断・再起動を確認する。正常系のID token検証境界は明示的な代替で、実GoogleアカウントのPOST正常系ではない。ブラウザと実Googleを使った既存のGET /session確認とは区別する。

2026-11-05、実Googleログイン済みのChromeから同じローカルAPIへのPOST正常系を確認した。開始後の撮影画面と、終了後の開始済み表示を確認し、token・uid・実写真を検証資料へ残していない。

実Firestore/Storage、挑戦の永続化、写真送信、GPS、AI判定、クリア確定、組織認可は未実装または未検証。デモの本番起動・Auth Emulatorは引き続き拒否する。クラウド設定・API有効化・課金・デプロイは行わない。
