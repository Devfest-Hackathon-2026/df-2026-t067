# API・共通データ契約案 v0.3

サーバーは未実装の提案。旅行者向けの共通型・実行時検証・HTTPクライアントは[初期実装](#8-最初の共通api実装)を用意した。変更時は画面とテストも同じPRで更新する。基底は`/api/v1`。HTTPの形はFunctions上のAPIを想定する。

## 1. 共通ルール

- 公開閲覧以外はFirebase ID tokenを`Authorization: Bearer ...`で送信し、サーバーで検証する。URL/bodyに渡されたuidは採用しない。
- 日時はUTCのRFC3339、UIはAsia/Tokyoで日付表示する初期案。初回クリア日時はサーバーの確定時刻。
- 緯度経度はWGS84の数値、距離と精度はm。NaN・無限・範囲外・不正時刻を拒否する。
- 個人データのGETは認可と`Cache-Control: private, no-store`。ページングと件数上限を持つ。
- 通常の未クリア応答は公開allowlistを使う。内部オブジェクトをそのままJSON化しない。
- エラーは`{ error: { code, message, requestId, retryable } }`。コードだけで画面分岐し、messageに内部パス・正解・認証情報を載せない。

## 2. 主要DTO

| DTO | 必須項目 |
|---|---|
| PublicArea | areaId, label, publicGeometry, marker, publishedCount |
| PublicQuest | questId, version, title, clue, areaId, optionalHintImage, visitConditions, hintCount |
| Challenge | challengeId, questId, version, createdAt |
| CaptureMetadata | capturedAt, position: { latitude, longitude, accuracyMeters, measuredAt } |
| AttemptResult | attemptId, state, outcome, nextAction, source, optionalDiscoveryId |
| Discovery | discoveryId, placeId, questId, questVersion, firstClearedAt, placeName, descriptionSnapshot, ownerPhoto, revealedLocation |
| ManagedQuest | questId, orgId, draftRevision, publishedVersion, status, draft内容、確認状態 |

`outcome`は完了前null。`source`はreal / mock（mockは独立した検証環境のみ）。写真URLは認可付き取得先または短命URL。PublicQuestにはplaceIdに紐付く内部情報、参考全景、撮影中心・半径、正解名を含めない。

## 3. 閲覧・旅行者API

| Method / Path | 認証 | 入力・返却 |
|---|---|---|
| GET /areas | 不要 | bbox, zoom, cursor, limit → items: PublicArea[], nextCursor |
| GET /quests | 不要 | areaId, cursor, limit → items: PublicQuest[], nextCursor |
| GET /quests/:questId | 不要 | 公開中のPublicQuest。非公開は404または公開可能な休止通知のみ |
| GET /quests/:questId/hints/:index | 不要 | 通常の段階ヒント。利用条件はヒントに隠さない |
| POST /quests/:questId/reveal | 不要 | 明示的な最終案内を要求 → 対象名と撮影案内のみ（提案仕様） |
| POST /challenges | 必要 | questId, expectedVersion → 201 Challenge。未公開・版違い・既存発見を確認 |
| POST /challenges/:challengeId/answers | 必要 | multipartでphotoとCaptureMetadata。Idempotency-Key必須 → AttemptResult |
| GET /attempts/:attemptId | 必要 | 本人の結果・処理状態のみ。通信中断後も同じ結果を照会 |
| GET /me/discoveries | 必要 | 地域・ページ指定 → 本人の発見一覧 |
| GET /me/discoveries/:discoveryId | 必要 | 本人のDiscovery。公開中でなくても過去記録は基本保持 |
| DELETE /me/discoveries/:discoveryId | 必要 | 202でdeletionIdを返す。画像を含む削除を追跡 |
| GET /me/deletions/:deletionId | 必要 | 本人の削除状態pending / completed / failed。再試行可能性を返す |
| POST /reports | 必要 | questId, category, text → 受付ID。他人の写真を添付しない |

写真はブラウザから取得したBlobを提出する。一般旅行者にはライブラリ選択を通常回答導線として提供しないが、ブラウザだけで実撮影・無加工を完全証明できるとはしない。

## 4. 回答結果とHTTP

| 状態／コード | HTTPの目安 | 取り扱い |
|---|---|---|
| PROCESSING | 202 | 完了待ち。attemptIdを保持してGET照会 |
| CORRECT | 200 | 画像と初回記録の保存が確定済み |
| ALREADY_CLEARED | 200 | 既存記録を返す。今回画像で上書きしない |
| OUTSIDE_AREA | 200 | 範囲外。AI未実行。通常応答に距離・正解中心を含めない |
| LOCATION_UNCERTAIN | 200 | GPS精度・時刻不足。再測位・再撮影へ |
| WRONG_TARGET | 200 | 別対象。秘密を漏らさないヒント導線 |
| IMAGE_UNCERTAIN | 200 | 画像の情報不足。再撮影へ |
| QUEST_UNAVAILABLE | 409 | 休止・終了・撮影不可条件 |
| QUEST_CHANGED | 409 | 公開版が変わった。新しいchallengeへ |
| SYSTEM_ERROR | 503 | AI・保存等の処理障害。成功や不正解に偽装しない |
| INVALID_INPUT / MEDIA_TOO_LARGE | 400 / 413 | 型・画像・値の検査失敗 |
| UNAUTHENTICATED / FORBIDDEN | 401 / 403 | 再認証／権限不足 |
| RATE_LIMITED | 429 | Retry-After等で再試行時期を案内 |
| IDEMPOTENCY_CONFLICT | 409 | 同じキーで別の写真・位置を送った |

## 5. 冪等性・回復

最初の受理時にuid＋challengeId＋Idempotency-Keyを一意化し、画像bytesとmetadataのhashを保存する。同一内容の再送では既存attemptを返す。写真や位置を更新する場合は新しいキーを使う。

新規回答の位置時刻は初回受信時に検証し、既存回答の再照会で再び現在時刻との差を判定しない。再ログインでも所有者を確認する。過去の結果照会だけで再訪記録を作らない。

内部stateはRECEIVED → PROCESSING → IMAGE_EVALUATED → COMMITTING → COMPLETED。画像・DBの途中失敗では処理段階とリース期限から再開する。最終結果未保存のまま「正解」を返さない。DB確定後の応答断は同じ結果へ回復する。

システムエラーでもattemptIdがある場合はまずGET照会する。新しい回答でやり直すのは旧処理の状態確認後。ストレージの孤立画像を清掃する処理は有効なDiscovery参照を確認する。

## 6. 自治体向けAPI

全てGoogle認証＋activeな所属と役割が必要。組織をまたぐアクセスを拒否する。

| Method / Path | 必要役割 | 内容 |
|---|---|---|
| GET /orgs/:orgId/quests | 編集・公開 | 自組織の一覧 |
| POST /orgs/:orgId/quests | 編集・公開 | 対象・公開エリア・撮影地点群・素材・根拠で下書き作成 |
| PATCH /orgs/:orgId/quests/:questId | 編集・公開 | expectedDraftRevisionと編集項目。競合なら409 |
| POST /orgs/:orgId/assets | 編集・公開 | 参考写真等。用途・権利確認、容量検査を経てassetId発行 |
| POST /orgs/:orgId/quests/:questId/generate | 編集・公開 | 登録済みの素材と根拠から下書き生成。自動公開しない |
| POST /orgs/:orgId/quests/:questId/test | 編集・公開 | 特定draftRevisionと試験写真で照合。発見記録は作らない |
| POST /orgs/:orgId/quests/:questId/submit-review | 編集・公開 | 確認待ちへ。素材・利用条件の不足を示す |
| POST /orgs/:orgId/quests/:questId/publish | 公開 | expectedDraftRevision、確認項目、該当版の試験記録で公開 |
| POST /orgs/:orgId/quests/:questId/pause | 公開・運営 | 理由を記録し、新規挑戦と進行中の確定を禁止 |

素材・assetId・questIdの所有組織を全て検証する。生成結果を任意スクリプト・URL命令として実行しない。公開後に編集しても、旧公開版はそのまま保持して新しい下書きだけを変える。

## 7. 担当間で固定する前に確認するもの

通信方式・エンドポイント名・stateの保存先・画像上限等はこの提案を基準に共同で固定する。初期実装の共通型PRで決め、画面担当とサーバー担当が個別に名前や意味を変えない。URL・認証情報・本番値は本資料に埋め込まない。

## 8. 最初の共通API実装

入口は[src/shared/api/index.ts](../src/shared/api/index.ts)。B/Cは独自にDTO・結果コード・fetch処理をコピーせず、ここから利用する。Dの自治体向け下書き構造と編集APIは後続で具体化する。

- 共通型：PublicArea / PublicQuest / Challenge / CaptureMetadata / AttemptResult / Discovery / Page。
- parse関数は値と許可する項目を検査し、契約違反をContractErrorにする。公開データに正解等の項目が混じった場合も検出する。サーバーが公開前に情報を除外する責務は引き続き必要。
- 公開エリアはPolygon / MultiPolygonの経度・緯度ペア。閉じた外周と穴を表す。座標は有限値・経度±180・緯度±90。形状の自己交差等の地理的検証は未実装。
- visitConditionsは表示用文字列、versionは1以上の整数、件数とヒント数は0以上の整数。画像はルート相対URLまたはHTTPS URL。
- 撮影時刻は実在するUTC日時、測位精度は0以上。経過時間・精度上限・画像上限はO-03で決定し、サーバーで検証する。
- AttemptResultは内部処理段階と同じ5状態を使用する。完了前はoutcome=null。CORRECT / ALREADY_CLEAREDはoptionalDiscoveryIdを必須にする。nextActionの操作名は画面接続時に共通で決め、未知の文字列を任意URLや命令として扱わない。

createApiClientは生成しただけでは通信しない。公開閲覧はlistAreas / listQuests / getQuest、認証後はcreateChallenge / submitAnswer / getAttempt / listDiscoveries / getDiscoveryを使う。各メソッドの最後の引数にsignalを渡すと取消できる。

認証実装後に、最新のFirebase ID tokenを返すgetIdToken関数を生成時に渡す。公開APIではこの関数を呼ばず、保護APIでは毎回呼ぶ。キャッシュとリダイレクトは無効。接続先は同一オリジンのパスだけを受け付ける。

submitAnswerにはchallengeId・photo（空でないBlob）・metadata・idempotencyKeyを渡す。multipartのphotoとmetadata、Idempotency-Keyへ変換する。位置や写真を変えた場合は別のキーにする。通信失敗時は自動再送せず、既知のattemptIdがあれば先にgetAttemptで照会する。

409のQUEST_CHANGED / QUEST_UNAVAILABLE、503のSYSTEM_ERRORも、正しいAttemptResultなら回答IDを保って返す。エラー封筒はApiError（code / status / requestId / retryable / retryAfterSeconds）へ変換し、サーバーのmessageは表示用エラーへ転記しない。実APIからのsource: mockは拒否する。

この実装にはサーバー、Googleログイン、AI判定、データ保存、自治体編集API、ヒント取得APIは含まれない。既存の架空プレビューへの自動接続も行わない。
