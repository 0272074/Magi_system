# Magi system

3つの異なるAI（Gemini, Groq/Llama3, OpenRouter/Claude3等）に対して同時に質問を投げかけ、各AIからの回答を「議長AI（Gemini）」が比較・評価・統合して最終回答を導き出すWebアプリケーションです。

## 特徴
- **マルチAI合議**: Gemini, Groq, OpenRouter(Claude) を同時に呼び出し、多角的な視点から回答を生成。
- **BYOK (Bring Your Own Key)**: ユーザー自身が各AIのAPIキーをブラウザ上から設定可能（サーバーに保存されません）。
- **Google SSO & 履歴保存**: Supabaseを利用したGoogleアカウントログインに対応。過去の合議履歴は自動的にクラウドデータベースへ保存されます。
- **軽量アーキテクチャ**: FastAPIによるシンプルなバックエンドと、Vanilla JS (CDN経由のSupabase連携) によるフロントエンド。

## ローカルでの動かし方

### 1. リポジトリのクローンと環境構築
```bash
git clone <repository-url>
cd ai_council

# 仮想環境の作成と有効化 (推奨)
python -m venv venv
# Windows: venv\Scripts\activate
# Mac/Linux: source venv/bin/activate

# 依存パッケージのインストール
pip install -r requirements.txt
```

### 2. 環境変数の設定 (オプション)
デフォルトで使用するAPIキーを `.env` ファイルに設定できます。設定しなくてもブラウザ上の「⚙️設定」から入力可能です。
プロジェクトルートに `.env` を作成し、以下を記述します。
```env
GEMINI_API_KEY=your_gemini_key
GROQ_API_KEY=your_groq_key
OPENROUTER_API_KEY=your_openrouter_key
```

### 3. サーバーの起動
```bash
uvicorn main:app --host 127.0.0.1 --port 8001
```
ブラウザで `http://127.0.0.1:8001` にアクセスしてください。

---

## Supabase のセットアップ (必須)

このアプリはログイン機能とチャット履歴機能に **Supabase** を利用しています。
ご自身で公開・利用する際は、Supabaseダッシュボードで以下のセットアップを行ってください。

### 1. プロジェクトの作成とキーの設定
- Supabaseで新規プロジェクトを作成します。
- 発行された `Project URL` と `anon public key` をコピーし、`static/script.js` の先頭にある以下の定数を書き換えてください。
  ```javascript
  const SUPABASE_URL = "あなたの_SUPABASE_URL";
  const SUPABASE_KEY = "あなたの_SUPABASE_KEY";
  ```

### 2. データベースの構築
Supabaseの **SQL Editor** を開き、以下のスクリプトを実行してテーブルとアクセス権限(RLS)を作成します。
```sql
-- 1. チャットセッションを管理するテーブル
CREATE TABLE public.chat_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. セッション内のメッセージを管理するテーブル
CREATE TABLE public.chat_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID REFERENCES public.chat_sessions(id) ON DELETE CASCADE NOT NULL,
    question TEXT NOT NULL,
    gemini_ans TEXT,
    groq_ans TEXT,
    openrouter_ans TEXT,
    council_result JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS (Row Level Security) の設定
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own sessions." ON public.chat_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view their own sessions." ON public.chat_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own sessions." ON public.chat_sessions FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert messages into their sessions." ON public.chat_messages FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.chat_sessions WHERE chat_sessions.id = session_id AND chat_sessions.user_id = auth.uid()));
CREATE POLICY "Users can view messages of their sessions." ON public.chat_messages FOR SELECT USING (EXISTS (SELECT 1 FROM public.chat_sessions WHERE chat_sessions.id = session_id AND chat_sessions.user_id = auth.uid()));
CREATE POLICY "Users can delete messages of their sessions." ON public.chat_messages FOR DELETE USING (EXISTS (SELECT 1 FROM public.chat_sessions WHERE chat_sessions.id = session_id AND chat_sessions.user_id = auth.uid()));
```

### 3. Google ログイン (OAuth) の設定
1. Google Cloud Console にて新しい「OAuth クライアント ID」を作成します。
   - 「承認済みのリダイレクト URI」には、`https://[あなたのプロジェクトの参照ID].supabase.co/auth/v1/callback` を指定します。
2. Supabase のダッシュボードから `Authentication > Providers` を開き、**Google** を有効化します。
3. 発行された Google の Client ID と Client Secret を入力して保存します。

---

## 本番環境へのデプロイ
Render や Railway 等のプラットフォームにデプロイする場合、以下の点にご注意ください。

1. **Supabase URL Configuration**
   Supabaseの `Authentication > URL Configuration` 画面で、`Site URL` をデプロイ先の公開URL（例: `https://my-app.onrender.com`）に変更してください。
2. **Google Cloud Console の更新**
   Google OAuth クライアント設定の「承認済みの JavaScript 発生元」にも公開URLを追加してください。

ソースコードの変更は不要です（フロントエンドは相対パス `/api/council` でバックエンドと通信します）。
