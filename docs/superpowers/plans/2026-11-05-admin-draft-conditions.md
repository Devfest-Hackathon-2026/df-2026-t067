# Dの撮影条件とクリア後情報の共有契約

PR #30の確定した画面/要件に共有下書きAPIを合わせ、DのAPI接続待ちを減らす。PR #33の素材APIとは別の小さな変更にする。

- [x] requiresBoat/requiresPaidFacilityを共通の真偽値型へ揃え、旧6交通手段を廃止する。
- [x] access/hours/promoComment/explanationをafterClearへ分離して保存/取得する。旧材料項目を黙って移動/破棄しない。
- [x] 管理プレビューの型だけを共有型から参照し、画面の表示・認証・自動保存・公開は変更しない。
- [x] 非公開情報の公開DTO拒否、作成/更新と既存素材/記録/回答を検証し、資料とPR/Issueを更新する。

検証：PR #32までを含むmain b27d1e2と統合し、Web261（22ファイル）/server159テスト・型/lint/build成功。保存後GETでの復元と公開APIの200応答を確認した。重要差分を単独で自己レビューし、第三者レビューは未実施。PublicQuestと通常ヒントのDTOは変更していない。
