# API・共通データ契約案 v0.3

旅行者向けの共通型・実行時検証・HTTPクライアントは[初期実装](#8-最初の共通api実装)、公開GETと認証確認は[ローカルAPIの土台](#9-ローカルapiの土台)、挑戦開始・回答受付は同節の開発用実装を用意した。段階ヒント・自治体の所属確認/下書き保存は[接続手順](team-api-handoffs.md)の開発用実装を追加した。それ以外のサーバー機能は未実装の提案。変更時は画面とテストも同じPRで更新する。基底は`/api/v1`。HTTPの形はFunctions上のAPIを想定する。

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
| GET /quests/:questId/hints/:index | 不要 | expectedVersion必須、indexは1始まり → QuestHint。版違いは409 QUEST_CHANGED。利用条件はヒントに隠さない |
| POST /quests/:questId/reveal | 不要 | 明示的な最終案内を要求 → 対象名と撮影案内のみ（提案仕様） |
| POST /challenges | 必要 | questId, expectedVersion → 初回201 Challenge。同じ利用者・問題・版の再要求は200で再利用。開発用の実装範囲は[挑戦開始API](challenge-start.md)を参照。実データでは未公開・版違い・既存発見を確認する |
| POST /challenges/:challengeId/answers | 必要 | multipartでphotoとCaptureMetadata。Idempotency-Key必須 → AttemptResult |
| GET /attempts/:attemptId | 必要 | 本人の結果・処理状態のみ。通信中断後も同じ結果を照会 |
| GET /me/discoveries | 必要 | 地域・ページ指定 → 本人の発見一覧 |
| GET /me/discoveries/:discoveryId | 必要 | 本人のDiscovery。公開中でなくても過去記録は基本保持 |
| GET /me/discoveries/:discoveryId/photo | 必要 | 本人のJPEG。共通clientはBearer付きで取得してBlobを返す |
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
| GET /orgs/:orgId/assets/:assetId | 編集・公開 | 自組織の素材メタデータのみ |
| GET /orgs/:orgId/assets/:assetId/photo | 編集・公開 | 自組織の認証付きJPEG。public_hint用途でも自動公開しない |
| POST /orgs/:orgId/quests/:questId/generate | 編集・公開 | 保存済みの版に対する下書き候補。開発用実装は19節 |
| POST /orgs/:orgId/quests/:questId/test | 編集・公開 | 特定draftRevisionと試験写真で照合。発見記録は作らない |
| POST /orgs/:orgId/quests/:questId/submit-review | 編集・公開 | `expectedDraftRevision`を指定し、確認待ちの下書きまたは不足項目を返す。詳細は17節 |
| POST /orgs/:orgId/quests/:questId/publish | 公開 | expectedDraftRevision、確認項目、該当版の試験記録で公開。開発用実装は18節 |
| POST /orgs/:orgId/quests/:questId/pause | 公開・運営 | 理由を記録し、新規挑戦と進行中の確定を禁止。開発用実装は18節 |

素材・assetId・questIdの所有組織を全て検証する。生成結果を任意スクリプト・URL命令として実行しない。公開後に編集しても、旧公開版はそのまま保持して新しい下書きだけを変える。

## 7. 担当間で固定する前に確認するもの

通信方式・エンドポイント名・stateの保存先・画像上限等はこの提案を基準に共同で固定する。初期実装の共通型PRで決め、画面担当とサーバー担当が個別に名前や意味を変えない。URL・認証情報・本番値は本資料に埋め込まない。

## 8. 最初の共通API実装

入口は[src/shared/api/index.ts](../src/shared/api/index.ts)。B/Cは独自にDTO・結果コード・fetch処理をコピーせず、ここから利用する。Dの自治体向け下書き構造と開発用編集APIは[接続手順](team-api-handoffs.md)・`src/shared/api/admin.ts`を参照する。

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

最初の共通APIにはAI判定・データ保存は含まれない。後続の段階ヒント・開発用自治体下書きAPIは[接続手順](team-api-handoffs.md)に追加範囲を記録する。Googleログインは[認証ガイド](firebase-auth.md)の別実装で、getIdTokenを介して接続できる。架空の問題を実サーバーへ送信して成功扱いにする処理は追加しない。

## 9. ローカルAPIの土台

`server/`はブラウザ側と別のNode.jsパッケージ。[起動・環境変数・制限](../server/README.md)を参照する。既存のPublicArea / PublicQuest / Pageと境界検証を再利用し、共通型を複製しない。明示した`QUEST_DATA_MODE=demo`だけで動作し、架空の2地域・3問を返す。実サービスの失敗をデモ成功に切り替える処理はない。

| 実装したGET | 認証・返却 |
|---|---|
| `/health` | 認証不要。`status: ok`、`dataMode: demo`、`fictionalData: true`、`auth: configured / unconfigured`。configuredは設定の有無で、実認証の成功を意味しない |
| `/api/v1/areas` | 認証不要。公開地域のPage。bbox・zoom・cursor・limitを検証 |
| `/api/v1/quests` | 認証不要。公開問題のPage。areaId・cursor・limitを検証 |
| `/api/v1/quests/:questId` | 認証不要。PublicQuest。存在しなければ404 |
| `/api/v1/session` | Firebase ID token必須。検証済みの`{ uid: string }`だけを返す、認証接続確認用の追加エンドポイント |

sessionはCookieやサーバーセッションを作らず、クエリ・bodyのuid / orgId / roleを認証の根拠にしない。Firebase Admin SDKで署名・issuer・audience・有効期限を検証する。設定なしやSDK障害は503 AUTH_UNAVAILABLE、認証情報の欠落・不正は401 UNAUTHENTICATEDを返す。設定なしの場合はトークンの有無を問わず503。Auth Emulatorは起動時と検証時に拒否する。

**失効・無効化された利用者の照会は未実装**（`verifyIdToken(token, false)`）。この認証確認は自治体の所属・権限確認ではない。DB・画像・管理操作を追加するときは、失効確認の方針と操作ごとの認可を別途実装・検証する。現時点では永続化やクリア確定は行わず、挑戦の管理は開発用の一時領域に限る。実Google ID tokenを使ったGET /sessionの正常系は、2026-11-05にChromeから確認済み。確認範囲は[接続手順](local-api.md#確認)に記録する。

一覧のlimitは既定20、1〜100。IDは英数字で始まる英数字・`_`・`-`の1〜128文字。cursorは同じリソース・フィルター内だけ有効。bboxは公開ポリゴンの外接範囲で絞り、日付変更線をまたぐ範囲も扱う。zoomは0〜24の入力検証だけで、件数集約は行わない。公開GETの未知・重複クエリは400。sessionのクエリは無視する。

すべての応答に`X-Quest-Data-Mode: demo`、サーバー生成の`X-Request-Id`、`Cache-Control: private, no-store`を付ける。エラーは既存の封筒形式。公開一覧・詳細・session・受付照会はGET、挑戦開始・回答受付はPOSTだけを受け付け、異なるメソッドは405、未実装ルートは404。CORSの一括許可は追加せず、localhostだけで待ち受ける。

検証は[`server.test.ts`](../server/test/server.test.ts)で公開情報のallowlist・ページング・境界入力・認証時のuid優先を、[`firebase-auth.test.ts`](../server/test/firebase-auth.test.ts)でSDKとの境界・失敗時の拒否を確認する。HTTP入力やSDKエラーの詳細をログへ出さない。SDK境界の代替テストと、実SDKによる不正トークンの拒否テストを区別している。

Firestore / Storage、写真判定・本人記録・自治体API・クラウド公開はこの段階に含まない。[開発用の挑戦開始](challenge-start.md)と[回答受付・再送・本人照会](answer-intake.md)はプロセス内の一時領域で実装した。明示的な[GPS demoモード](gps-validation.md)では、サーバー設定の範囲・精度・撮影/測位時刻を検査し、範囲外/位置不確実は200の不合格結果となる。通過は202 RECEIVED/source:mockのままで画像保持・写真判定workerはない。共通clientはdemo接続・demoヘッダーの受付とGPS不合格だけを例外にし、mock正解・その他完了を拒否する。ルートの`npm run check`と`npm --prefix server run check`を両方実行する。

回答画像の[実デコード・正規化と写真照合の呼び出し部品](photo-match.md)を追加した。公開APIのDTO/結果は増やさず、HTTP受付には画像検査だけを接続する。MATCHは内部の一致候補であり、実Vertex通信・照合worker・保存・CORRECTは未接続。

### 9-1. 開発用のWeb接続

[接続手順](local-api.md)の`local-api`モードだけで、画面は`GET /quests/demo-quest`を呼ぶ。公開閲覧にtokenを送らない。サーバー全体の一覧や実Mapsとの接続は後続作業。既定の`preview`モードは問題取得・サーバー認証確認を行わない。

共通clientに`getSession()`と`SessionIdentity { uid: string }`を追加。保護APIと同じ経路で毎回最新のID tokenを取得し、余分なclaimや空・128文字超のuidを拒否する。画面は現在のFirebase利用者とuidを照合し、不一致を成功にしない。

`createApiClient({ expectedDataMode: 'demo' })`を指定した開発用接続では、成功応答の`X-Quest-Data-Mode: demo`を必須にする。未指定の既存clientの動作は維持する。画面の通信は10秒で中止し、明示的な再試行を用意する。ログアウトや利用者変更後の古い応答は破棄する。実tokenの正常系と認証復元・ログアウトはChromeで確認済み。失効確認と組織認可は未実装のまま区別する。

## 10. B/Dへの追加接続

[team-api-handoffs.md](team-api-handoffs.md)が呼び出し例・設定・制約の正本。`QuestHint`とDの`OrgMembership / ManagedQuestDraft / ManagedQuest / ManagedAsset`を共通exportし、`DRAFT_CONFLICT`をエラーコードへ追加した。認証済み`GET /me/memberships`、自組織だけの一覧/作成/詳細/全下書き置換を追加する。写真試験は16節、開発用の公開・休止は18節、下書き候補は19節を参照する。下書きは開発用一時領域に保存する。

## 11. Cへの本人記録API接続

[owner-discoveries.md](owner-discoveries.md)が起動・client・保存境界の正本。既存Discoveryを使う本人一覧/詳細に、認証付きJPEG Blob取得と削除受付/追跡を追加した。`DeletionReceipt`は`{deletionId}`、`DeletionStatus`は`{deletionId, state: pending|completed|failed, retryable}`。HTTPから記録作成・編集は提供しない。

既定は保存先未接続の503。`QUEST_DISCOVERIES_MODE=memory`を明示したときだけ開発用ストアを起動し、記録応答に`X-Quest-Records-Mode: memory`を付ける。共通clientは明示demo接続の場合だけmemoryを受け付ける。設定で本人1人に合成記録を用意できる。回答からの記録作成、実DB/Storage、CORRECTは未接続。[合成記録の設定](owner-discoveries.md#合成記録で一覧写真削除を試す)

## 12. Dへの用途別写真素材API

[admin-assets.md](admin-assets.md)に設定・入力・再送・下書きへの接続を記録する。`OrgAssetMetadata`と`UploadedOrgAsset`を追加し、`uploadOrgAsset / getOrgAsset / getOrgAssetPhoto`を共通clientから利用できる。serverは所属を確認して既存の画像検証で正規化し、用途・組織付きIDを発行する。`QUEST_ADMIN_ASSETS_MODE=memory`の明示設定だけが開発用写真を一時保存し、既定は503。素材API自体に実Storage/AI/公開は含まない。PR #30の新しい下書き項目は次節の共有契約を参照する。

## 13. PR #30に対応する管理下書き契約

`ManagedQuestDraft.materials`はname/evidence・requiresBoat/requiresPaidFacility・price/photoNote/photoRights。旧6交通手段と旧materialsのaccess/hoursは廃止して拒否する。クリア後用のaccess/hours/promoComment/explanationは必須の`afterClear`へ分離し、管理APIで作成/更新/取得する。空文字は未完成下書きとして保存でき、条件の真偽値を文字列から補正しない。

共有型はShootingConditions/AfterClearContent。管理プレビューの型もこれを参照する。PublicQuest/通常ヒント/未クリア用データへafterClearを追加せず、登録・本人記録・公開のAPIを混同しない。詳しいpayloadと旧clientからの注意は[接続手順](team-api-handoffs.md)を参照。

## 14. 回答処理の内部接続

[answer-processing.md](answer-processing.md)に、既存受付→GPS→写真照合→開発用本人記録のサーバー内部接続を記録する。所有者/challenge/digestと受信日時を結び、同じ回答の処理を共有し、AI呼出し直前・保存直前に認証と公開状態/版を再確認する。記録成功は内部のSAVED_IN_MEMORY/ALREADY_SAVED_IN_MEMORYで、公開AttemptResultへ変換しない。HTTPルート・client・環境変数は追加せず、現在のPOST/GET結果とmock正解拒否を維持する。実VertexのHTTP起動・永続保存・CORRECTは後続。

照合済み回答の再試行可能な保存障害は、上限付きメモリーcheckpointから同じprocess呼出しで保存だけを再開できる。AIを再実行せず、本人と公開版を再確認する。プロセス再起動後の回復や永続leaseとは区別する。

## 15. Dの非公開撮影範囲

[admin-shooting-areas.md](admin-shooting-areas.md)が入力・認可・競合・接続の正本。GET/PUT `/orgs/:orgId/quests/:questId/shooting-areas`を追加し、getShootingAreas/updateShootingAreasで利用する。共有CaptureZoneは既存GPSと共用し、座標・半径は専用の管理応答だけに含める。本文と同じdraftRevisionで全置換/解除し、通常の管理応答はshootingAreaStatusのみ。18節の開発用公開版に範囲を固定する。実地点の閾値はO-03で扱う。

## 16. Dの写真判定試験

[admin-photo-tests.md](admin-photo-tests.md)にPOST `/orgs/:orgId/quests/:questId/test`の接続口を定義する。共通clientのtestManagedQuestは写真・権利説明・expectedDraftRevisionと試験キーを送り、版付きPhotoTestResultを受け取る。参考用途/組織・所属/版を照合前後に確認し、同じキーの処理を共有する。試験結果の用途は開発用の確認と18節の公開操作に限る。既定は照合未接続の503。開発用fixtures設定では指定の合成画像で試験できる。

## 17. Dの下書き確認依頼

共通clientの`submitManagedQuestReview(orgId, questId, expectedDraftRevision)`は、保存済みの版に対して確認を依頼する。編集者と公開担当者が自組織の下書きに使える。応答は200の`ReviewSubmission`で、`quest`に管理用の最新版、`missing`に不足項目のフィールド名を返す。古い版は409 `DRAFT_CONFLICT`。

開発用の確認対象は対象名、根拠、写真権利の説明、同組織の参考素材、撮影範囲、タイトル、問題文、3本のヒント、試験と同じ条件を満たす確認済み特徴。任意のヒント画像を指定した場合は組織と用途も確認する。不足があれば`draft`、揃えば`review_pending`。同じ版の再送で版番号は進まない。本文・素材ID・撮影範囲を編集すると新しい版の`draft`へ戻る。確認待ちは開発用の私的な状態で、試験合格・公開承認は後段で扱う。

## 18. 開発用の公開と休止

開発サーバーの架空データ専用。自組織の`publisher`のみ実行でき、本文の受信後にも所属と役割を確認する。両操作は200で`ManagedQuest`を返す。

- `publishManagedQuest(orgId, questId, input)` は`expectedDraftRevision`、`matchTestId`、`mismatchTestId`と`confirmations`を送る。確認項目は`fictionalData`、`visitConditions`、`photoRights`、`shootingArea`、`testCases`の全てが`true`。公開担当者が架空データ・訪問条件・画像の権利と公開範囲・撮影範囲・試験ケースを確認する。
- 現在の確認待ち下書きと、同じ組織・問題・下書き版でサーバーが記録した`MATCH`と`WRONG_TARGET`が必要。正規化後に同じ画像の試験は使えない。版違いは409 `DRAFT_CONFLICT`、確認不足は409 `REVIEW_REQUIRED`、試験不足は409 `PHOTO_TEST_REQUIRED`。任意の公開ヒント画像は同組織の`public_hint`素材で、参考写真と同じ正規化画像は拒否する。
- 公開時に問題文、訪問条件、段階ヒント、任意のヒント画像、非公開撮影範囲を版へ固定する。旅行者の一覧・詳細には公開項目だけを返す。ヒント画像は公開中の版を指定した`GET /quests/:questId/hint-image?expectedVersion=...`でJPEGを取得する。下書き編集後も旅行者は旧公開版を使い、再公開時に新しい版へ切り替わる。
- `pauseManagedQuest(orgId, questId, {expectedPublishedVersion, reason})` は空白を除いた1〜1000文字の理由を記録する。休止中は公開GETから外し、新規挑戦・回答受付は409 `QUEST_UNAVAILABLE`。同じ版・理由の再送は重ねて休止しない。初回の休止でdraftRevisionを進めるため、再公開には新しい版の確認依頼と写真試験が必要。再公開後、旧版の挑戦での回答は409 `QUEST_CHANGED`。

`publishedVersion`は公開中の版番号または`null`。旧版を公開しながら下書きを編集・提出する場合は`status`が`draft`または`review_pending`でも版番号を持つ。公開状態、最新の版と試験結果はメモリーに保持する。合成画像の試験は明示fixtures設定で使える。実AI照合、永続版履歴、実データの公開、旅行者の写真照合と確定処理は未接続。

## 19. A04の下書き候補

`generateManagedQuestDraft(orgId, questId, expectedDraftRevision)` は、保存済みの下書き版に対してPOST `/orgs/:orgId/quests/:questId/generate`を呼ぶ。bodyは`{expectedDraftRevision}`のみ。自組織の編集者・公開担当者が利用でき、受信後も所属と版を検査する。

200の`DraftSuggestion`は`{orgId, questId, draftRevision, content, source}`。`content`は既存の下書きと同じ5項目で、タイトル・問題文・3本のヒント・確認済み特徴・作成根拠メモを持つ。候補を受け取った画面で対象の版と編集中の内容を確認し、採用した内容を既存の下書き保存APIへ渡す。候補を取得するだけでは保存、改版、確認依頼、公開は起きない。

既定は未接続の503 `SYSTEM_ERROR`。開発用の`QUEST_ADMIN_DRAFT_MODE=fixtures`と`QUEST_ADMIN_ASSETS_MODE=memory`を明示すると、対象名・根拠・写真権利が入力済みで、同組織の参考用途に登録した合成`match.png`がある版に、固定の候補を`source:mock`で返す。外部AIを呼ばない。版違いは409 `DRAFT_CONFLICT`、素材・確認材料の不足は400 `INVALID_INPUT`。[合成素材の用意](admin-photo-tests.md#合成素材で公開休止を試す)
