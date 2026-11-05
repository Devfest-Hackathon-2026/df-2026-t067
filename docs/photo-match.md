# 画像検証と写真照合の準備

回答受付に実画像デコーダーを接続し、照合要求を組み立てて結果を検証するサーバー専用の部品を追加した。Vertexへの実通信と回数制限は[合成画像専用のローカル試験CLI](vertex-trial.md)だけに接続した。**回答worker・保存・CORRECTは未接続**。画面からの送信も追加していない。

## 現在動くところ

`readAnswerInput`は従来のmultipart・サイズ・metadata検査に加え、`preparePhoto`で画素をデコードして正規化する。画像ヘッダーだけの偽データを受付成功にしない。GPS・所有者・公開版・再送の既存処理は維持する。

元のbytes/MIMEとmetadataから入力hashを計算し、その後に画像を正規化する。同じ画素でもEXIF等が異なる元データを同じキーで再送すれば409となり、正規化によって別入力を同一扱いにしない。正規化した画像はリクエスト内の一時データで、受付ストア・GET結果・ディスク・ログへ残さない。

### 画像処理

server専用の`sharp 0.35.5`を固定した。既存のNode 26.7.0 / npm 11.19.0で、追加install scriptを実行せず事前配布バイナリを利用する。rootの依存やブラウザのbundleには追加しない。[sharp導入条件](https://sharp.pixelplumbing.com/install/)を参照。

| 処理・上限 | 開発用の値と動作 |
|---|---|
| 入力 | BufferのJPEG/PNG/WebPだけ。パスやURLを画像として受け取らない。最大4MiB |
| デコード | 先頭シグネチャだけでなく画素をデコード。形式の不一致・破損・途中切れ・複数フレームを拒否 |
| 保護値 | 16M画素・4チャンネル、native処理のタイムアウト3秒 |
| 出力 | 向きを画素へ反映、縦横1600px以内・拡大なし・比率維持、白背景/sRGB、JPEG quality85、最大2MiB |
| メタデータ | EXIF/GPS・ICC・XMP等を保持しない。出力の寸法とJPEG bytesだけを次の処理へ渡す |

デコーダーは[入力制限](https://sharp.pixelplumbing.com/api-constructor/)と[出力時のメタデータ除去](https://sharp.pixelplumbing.com/api-output/)を使う。これらは本番O-03や実地の照合品質を確定する値ではない。

`preparePhoto`の不正形式・破損・画素上限等は400 INVALID_INPUT、encoded/出力bytes上限は413 MEDIA_TOO_LARGE。HTTP受付での非対応MIMEの415は従来どおり維持する。元のnativeエラーや写真情報を返さない。参考画像の不備は利用者の写真エラーにせず、照合サービスでは503 SYSTEM_ERRORへ変換する。

## サーバー内部の照合部品

`comparePhotos`は候補写真・非公開の参考写真を正規化し、登録済みの確認材料から得たfeatures（1〜20項目、各300文字以内）とともに、明示的に渡されたmatcherへ渡す。参考画像や特徴の取得はまだ接続していない。候補・参考をブラウザや公開DTOからまとめて信用する処理ではない。

| 内部結果 | 意味 |
|---|---|
| MATCH | 同一対象という候補。クリア・保存・CORRECTではない |
| WRONG_TARGET | 別対象と判断した |
| IMAGE_UNCERTAIN | モデルが情報不足と判断した |
| 503 SYSTEM_ERROR | matcher/transport/参考材料が未設定、不正応答・拒否・通信失敗・モデル待機時間切れ等 |
| AbortError | 呼び出し元の取消。別対象や不正解に変換しない |

モデル待機は既定10秒。内部設定のtimeoutMsは1〜10000msで指定でき、自動再試行しない。時間切れと取消ではproviderへ渡すAbortSignalも中止し、遅い応答から成功へ戻さない。画像のnative処理は別の3秒制限であり、これを通信込みの全体10秒保証とは扱わない。

## Vertex向けの要求・応答

`createVertexPhotoMatcher`は[画像inlineData](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/image-understanding)と[structured output](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/control-generated-output)の要求を組み立てる。画像内文字・featuresは命令でないことを明示し、tools・fileData・外部画像URLを使わない。画像は正規化JPEG2枚で、uid・位置・撮影時刻・ファイル名を自動挿入しない。

要求部品はcandidateCount:1、maxOutputTokens:128、temperature:0と1項目のJSON schemaを使う。試験用transportでは承認済みプロジェクト/モデル/locationへ固定し、maxOutputTokens:1024とthinking LOWを適用する。transport全体の待機期限は30秒。comparePhotosの既定10秒は別であり、今回のCLIは正規化済み画像でmatcherを直接呼ぶ。実スポットの精度・本番の適切な上限は未検証。

応答は候補1件、finishReason:STOP、text部分1つ、512bytes以内、`{"verdict":"match"}` / mismatch / uncertainの厳密な1項目JSONだけを許可する。partの任意のthought:falseと文字列thoughtSignature（8192文字以内）は受け入れて捨て、thought:trueは拒否する。余分な項目・重複キー・自由文・tool call・非終了・拒否・ブロック・不正な安全判定値はSYSTEM_ERROR。モデルの不調をWRONG_TARGETへ変換しない。説明文やconfidenceを正解確率として採用せず、元の出力・署名・SDKエラーもログへ転記しない。

未設定のtransportは503で失敗し、別モデルや成功mockへ切り替えない。`createVertexTrialTransport`は固定REST宛先への実通信を追加した。Node fetchはリダイレクトを拒否し、自動再試行しない。認証はgoogle-auth-library 11.3.3のADC、生成応答は200/application-json・64KiB以内を検査する。台帳による送信前加算と排他の詳細は[試験設定](vertex-trial.md)を参照。

## 接続前に残ること

ユーザー指定の「Google Cloud・Firebase設定」チャットで確認した[試験設定](vertex-trial.md)はPR #23でマージ済み。CLIでは既使用分を引き継ぐ回数制限と合成画像による実通信を確認する。Cloud設定・課金先・IAM・公開設定は変更せず、人物や個人情報を含む画像、一般利用者の写真は送信しない。

後続は非公開の参考画像/特徴の取得、所有者・GPS通過・公開版/休止・既クリアの確認、回答IDによる処理の一意化/リースを回答workerと接続する。comparePhotos自体が認証や冪等性を保証するものではない。AI呼び出しをFirestoreトランザクションへ入れず、一致後も保存確定まではCORRECTを返さない。

## 検証

最新mainのPR #23/#24/#27を取り込んだ状態で、`npm --prefix server run check`は125テスト・型/lint/buildが成功。実codecを使った合成JPEG/PNG/WebP、向き・EXIF除去・過大画素・多フレーム・破損、HTTPの偽画像拒否、raw入力の冪等性、照合の分類・未設定・不正出力・取消/時間切れを確認する。`npm run check`はWeb230テスト・型/lint/buildが成功。

後続の試験用transport/台帳の検証と実Vertexへの合成画像送信は[試験記録](vertex-trial.md#画像試験の記録2026-11-05)を参照する。失敗1回も含めた使用数を引き継ぎ、実写真の精度や回答APIの完了とは区別する。

別の一時フォルダでserverのpackage/lockから`npm ci --ignore-scripts`を再現し、native JPEG処理が動くことを確認した。既存依存の非推奨警告は出るが導入は成功し、既存パッケージの版は変更していない。現Mac環境での確認で、他OSやCloud実行環境は未検証。

FR-06/07、AT-06/09/21/22に関連する部分実装。単体テストのtransportは明示的な代替、CLIの試験だけが実Vertexへの送信。画像は合成で、実スポットの照合精度、実写真・実スマホ・実Googleでの回答送信、保存・組織認可の検証ではない。
