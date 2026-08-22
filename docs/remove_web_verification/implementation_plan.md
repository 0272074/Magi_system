# Web検証機能の削除（白紙化）実装計画

Web事後検証プロセスにおいて、APIキーのクォータ制限（429エラー等）によるエラーや遅延が頻出するため、Web検証（ファクトチェック）機能自体を一度白紙に戻し、元のシンプルな合議フローに復元します。

## ユーザー確認事項

> [!IMPORTANT]
> - 本修正により、Web事実検証（検索およびGroqによるファクトチェック）は実行されなくなります。
> - UI上の「ファクトチェック中」や「Web事実検証結果」のセクションも非表示または削除されます。
> - 議長AIの統合回答は、Web検証結果を加味しない以前の形に戻ります。

## 変更内容

---

### バックエンド (FastAPI)

#### [MODIFY] [main.py](file:///C:/Users/big_b/.gemini/antigravity/scratch/ai_council/main.py)
- `web_verification` モジュールのインポート削除。
- `generate_council_decision` 関数の引数およびプロンプトからWeb検証結果に関する記述を削除。
- `run_council` 内の `background_task` での `run_web_verification_flow` の呼び出しを削除し、SSEイベント（`FACT_EXTRACT_START`等）の送信を削除。
- 最終完了データ（`COMPLETE`イベントのデータ）から `web_verification` の値を削除または `None` とする。

#### [DELETE] [web_verification.py](file:///C:/Users/big_b/.gemini/antigravity/scratch/ai_council/web_verification.py)
- Web検証用のファイル自体を削除（または読み込まれないように廃止）。

---

### フロントエンド (HTML / JS / CSS)

#### [MODIFY] [index.html](file:///C:/Users/big_b/.gemini/antigravity/scratch/ai_council/static/index.html)
- Web検証セクション (`#web-verification-area`) を削除。
- 合議プロセスフローの中の「検証ステップ」 (`#flow-verify`) を削除。

#### [MODIFY] [script.js](file:///C:/Users/big_b/.gemini/antigravity/scratch/ai_council/static/script.js)
- `flowSteps.verify` や `#flow-verify` 関連 of html elements を削除。
- SSEイベントの処理ロジックから `WEB_VERIFY_START`, `FACT_EXTRACT_START`, `FACT_EXTRACT_END`, `VERIFY_PROGRESS`, `WEB_VERIFY_END`, `WEB_VERIFY_UNAVAILABLE` などのハンドリングを削除。
- 最終結果描画処理からWeb事実検証結果の表示部分を削除。

---

## 検証計画

### 手動テスト
1. `uvicorn` サーバーを再起動します。
2. ブラウザで `http://127.0.0.1:8001/` にアクセスします。
3. 質問を入力して送信し、以下の点を確認します：
   - 合議プロセスフローのステップが「AI回答の収集」→「回答の評価・比較」→「回答の統合」の3ステップになっていること。
   - Web事実検証エリアが表示されず、エラーなく議長AIの統合回答が出力されること。
