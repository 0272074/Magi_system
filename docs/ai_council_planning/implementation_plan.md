# AI合議室 新構成（Gemini・Groq・OpenRouter）移行計画

ご指示に基づき、OpenAI（GPT）を除外し、新たに「Groq」と「OpenRouter」を追加して3AI構成とするための調査と変更計画を作成しました。
※この計画書ではまだ実際のコード変更は行っていません。

## 1. 現在のコード構造と変更対象

**1.1 現在のコード構造**
- バックエンド(`main.py`): FastAPIで構築。非同期でAPIリクエストを並列実行(`asyncio.gather`)し、JSONを返却。
- フロントエンド(`index.html`, `style.css`, `script.js`): Fetch APIを用いてバックエンドと通信し、DOMを更新するSPA構造。

**1.2 削除または変更が必要なOpenAI関連コード**
- `main.py`: `openai`ライブラリのインポート、クライアント初期化、`get_gpt_answer`関数、及びエンドポイント内の並列呼び出しからGPTを除外。
- `index.html` & `style.css`: GPT用のUIカード(`.gpt-theme`など)を削除。
- `script.js`: ステータス更新やデータ描画のループ(`["gpt", "gemini"]`)から `"gpt"` を削除。

**1.3 Gemini関連コードの変更点**
- モデル名は直前の調査で確認した `gemini-3.5-flash` をそのまま使用。
- 3AIのうちの「AI 1」としてUI上の配置（左端）などを調整。

**1.4 Groq追加に必要なファイル**
- バックエンド: `requirements.txt` に公式の `groq` パッケージを追加し、`main.py` に `get_groq_answer` 関数を実装。
- フロントエンド: HTML, CSS, JS に Groq用の枠と処理を追加。

**1.5 OpenRouter追加に必要なファイル**
- バックエンド: OpenRouterはOpenAI APIと完全互換であるため、現在インストールされている `openai` パッケージを流用可能（`base_url="https://openrouter.ai/api/v1"` を指定）。新たに `get_openrouter_answer` 関数を追加。
- フロントエンド: HTML, CSS, JS に OpenRouter用の枠と処理を追加。

**1.6 .envの変更内容**
- 既存の `OPENAI_API_KEY` は削除せずにそのまま残します。
- 新たに `GROQ_API_KEY` と `OPENROUTER_API_KEY` の2行を追加設定していただく構造にします。

---

## 2. モデルの選定理由と利用制限

公式情報およびAPI互換性を調査し、以下のモデルを推奨します。

**AI 1: Gemini**
- **推奨モデル**: `gemini-3.5-flash`
- **選定理由**: Google公式の現在利用可能な最新・最速モデルであり、無料枠の範囲で `generateContent` を安定してサポートしているため。

**AI 2: Groq**
- **推奨モデル**: `llama-3.3-70b-versatile` (または `llama3-8b-8192`)
- **選定理由**: Groqの特長である「圧倒的な生成速度」を活かせるMeta社の最新Llamaシリーズ。70Bモデルは無料枠でも論理推論能力が非常に高く、合議の一員として優秀です。

**AI 3: OpenRouter**
- **推奨モデル**: `mistralai/mistral-7b-instruct:free`
- **選定理由**: Gemini(Google系)やGroq(Meta/Llama系)とは異なる**「Mistral系」のモデル**を選ぶことで、AIごとの視点や思考の偏りを防ぎ、合議室として「多様な意見」を引き出すのに最適だからです。末尾に `:free` が付くため完全無料で利用可能です。

**無料枠・利用制限に関する注意点**
GroqやOpenRouterの無料モデルは、1分あたりのリクエスト数（RPM）やトークン数（TPM）に上限が設定されている場合があります。3つのAIを同時に叩く現在の並列設計（`asyncio.gather`）であれば高速に処理できますが、API側の一時的な制限（429エラー等）に備え、すでに組み込んでいるエラーハンドリング機能（画面を止めずにエラーメッセージを返す仕組み）が非常に役立ちます。

---

## 3. 実装のPhase計画

今後の実装は、安全性を確保するために以下のPhaseに分けて進めることを推奨します。

- **Phase A (クリーンアップ)**: OpenAI(GPT)関連のコードを削除し、一旦「Gemini単独」で正常に動作する状態に整理する。
- **Phase B (Groq連携)**: Groq APIの接続処理とUIを追加し、2AI（Gemini + Groq）での並列動作を確認する。
- **Phase C (OpenRouter連携)**: OpenRouter APIの接続処理とUIを追加し、最終的な3AI構成の並列回答取得システムを完成させる。
