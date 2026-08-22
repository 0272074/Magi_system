# Web検証機能削除タスクリスト

- `[ ]` `main.py` の修正
    - `[ ]` `web_verification` のインポート削除
    - `[ ]` `generate_council_decision` 関数の引数およびプロンプトからWeb検証を削除
    - `[ ]` `run_council` での `run_web_verification_flow` の呼び出しおよび関連SSEイベント送信の削除
    - `[ ]` `COMPLETE` イベントの `web_verification` 削除
- `[ ]` `web_verification.py` の削除
- `[ ]` `static/index.html` の修正
    - `[ ]` Web検証セクション (`#web-verification-area`) の削除
    - `[ ]` フローの検証ステップ (`#flow-verify`) の削除
- `[ ]` `static/script.js` の修正
    - `[ ]` Web検証フローUI関連のJSコード削除
    - `[ ]` SSEイベント (VERIFY_*) ハンドリング削除
- `[ ]` 動作検証
    - `[ ]` アプリの起動確認
    - `[ ]` ブラウザでのテスト完了
