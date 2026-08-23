import os
import asyncio
import re
import json
from typing import Optional
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import google.generativeai as genai
from google.api_core.exceptions import GoogleAPIError
from groq import AsyncGroq, GroqError
from openai import AsyncOpenAI, OpenAIError
import traceback
import logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

# 環境変数の読み込み (.env ファイルがあれば読み込まれる)
# ローカル開発時のフォールバックとして使用
load_dotenv()

# ==========================================
# デフォルトのAPIキー（環境変数からのフォールバック用）
# ==========================================
default_gemini_api_key = os.getenv("GEMINI_API_KEY")
default_groq_api_key = os.getenv("GROQ_API_KEY")
default_openrouter_api_key = os.getenv("OPENROUTER_API_KEY")

# デフォルトキーでの初期設定（フォールバック時に使用）
if default_gemini_api_key:
    genai.configure(api_key=default_gemini_api_key)

# リクエストのデータモデル
class CouncilRequest(BaseModel):
    question: str
    gemini_api_key: Optional[str] = None
    groq_api_key: Optional[str] = None
    openrouter_api_key: Optional[str] = None

# FastAPIインスタンスの作成
app = FastAPI()

async def get_gemini_answer(question: str, api_key: Optional[str] = None) -> str:
    """Gemini APIを呼び出して回答を取得する関数"""
    key = api_key or default_gemini_api_key
    if not key:
        return "エラー: GEMINI_API_KEY が設定されていません。画面右上の⚙️設定からAPIキーを入力してください。"
    
    try:
        # ユーザー提供のキーがある場合は都度設定
        if api_key:
            genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-3.5-flash')
        prompt = f"指示: ユーザーの質問について、別の視点も考慮しながら正確で論理的な回答を作成してください。\n\n質問: {question}"
        
        response = await model.generate_content_async(prompt)
        return response.text
    except GoogleAPIError as e:
        print(f"\n[Gemini API エラー詳細]")
        print(f"エラー内容: {e}\n")
        return "エラー: Gemini APIで問題が発生しました。APIキーが正しいか確認してください。"
    except Exception as e:
        print(f"[Gemini 予期せぬエラー] {type(e).__name__}: {e}")
        return "エラー: Geminiとの通信に失敗しました。APIキーの有効性を確認してください。"

async def get_groq_answer(question: str, api_key: Optional[str] = None) -> str:
    """Groq APIを呼び出して回答を取得する関数"""
    key = api_key or default_groq_api_key
    if not key:
        return "エラー: GROQ_API_KEY が設定されていません。画面右上の⚙️設定からAPIキーを入力してください。"
    
    try:
        # リクエストごとにクライアントを生成（ユーザーキー対応）
        client = AsyncGroq(api_key=key)
        response = await client.chat.completions.create(
            messages=[
                {"role": "system", "content": "ユーザーの質問に対して、論理的かつ正確に、わかりやすく回答してください。"},
                {"role": "user", "content": question}
            ],
            model="qwen/qwen3.6-27b",
            temperature=0.7,
            max_tokens=4096,
            timeout=30.0
        )
        raw_content = response.choices[0].message.content
        clean_content = re.sub(r'<think>.*?(</think>|$)', '', raw_content, flags=re.DOTALL).strip()
        return clean_content if clean_content else raw_content
    except GroqError as e:
        print(f"\n[Groq API エラー詳細]")
        print(f"エラー内容: {e}\n")
        return "エラー: Groq APIで問題が発生しました。APIキーが正しいか確認してください。"
    except Exception as e:
        print(f"[Groq 予期せぬエラー] {type(e).__name__}: {e}")
        return "エラー: Groqとの通信に失敗しました。APIキーの有効性を確認してください。"

async def get_openrouter_answer(question: str, api_key: Optional[str] = None) -> str:
    """OpenRouter APIを呼び出して回答を取得する関数"""
    key = api_key or default_openrouter_api_key
    if not key:
        return "エラー: OPENROUTER_API_KEY が設定されていません。画面右上の⚙️設定からAPIキーを入力してください。"
    
    try:
        # リクエストごとにクライアントを生成（ユーザーキー対応）
        client = AsyncOpenAI(base_url="https://openrouter.ai/api/v1", api_key=key)
        response = await client.chat.completions.create(
            messages=[
                {"role": "system", "content": "ユーザーの質問に対して、論理的かつ正確に、わかりやすく回答してください。ユーザーの質問が日本語の場合は、必ず日本語で回答してください。"},
                {"role": "user", "content": question}
            ],
            model="google/gemma-4-31b-it:free",
            temperature=0.7,
            max_tokens=4096,
            timeout=15.0
        )
        return response.choices[0].message.content
    except OpenAIError as e:
        print(f"\n[OpenRouter API エラー詳細]")
        print(f"エラー内容: {e}\n")
        return "エラー: OpenRouter APIで問題が発生しました。APIキーが正しいか確認してください。"
    except Exception as e:
        print(f"[OpenRouter 予期せぬエラー] {type(e).__name__}: {e}")
        return "エラー: OpenRouterとの通信に失敗しました。APIキーの有効性を確認してください。"

async def generate_council_decision(question: str, gemini_ans: str, groq_ans: str, openrouter_ans: str, api_key: Optional[str] = None) -> dict:
    """3つのAIの回答を評価し、最終回答をJSONで生成する（議長AI: Gemini）"""
    key = api_key or default_gemini_api_key
    if not key:
        return None
    
    prompt = f"""
あなたはAI合議室の「議長」です。ユーザーからの質問に対し、3つのAIが独立して回答を生成しました。
各AIの回答を客観的に評価（正確性、論理性、実用性の観点で各10点満点）し、最も妥当な要素を組み合わせて「最終的な統合回答」を作成してください。

【統合時の重要ルール】
・事実として確認できない内容を断定しないこと
・回答者間で意見が一致していても、それだけを根拠に正しいと判断しないこと
・医学、科学、法律、制度、最新情報などについては特に慎重に判断すること
・「3AIが一致した」ことと「事実として正しい」ことを区別すること
・不確かな情報は「不確かである」と明示すること
・情報源が提示されていない場合、存在しない出典を勝手に作らないこと

[ユーザーの質問]
{question}

[AI 1 (Gemini) の回答]
{gemini_ans}

[AI 2 (Groq/Qwen) の回答]
{groq_ans}

[AI 3 (OpenRouter/Nemotron) の回答]
{openrouter_ans}

必ず以下のJSONスキーマに完全に従って出力してください。マークダウンの```json等の装飾は一切含めないでください。
{{
  "evaluations": {{
    "gemini": {{ "accuracy": int, "logic": int, "practicality": int, "reason": "評価理由" }},
    "groq": {{ "accuracy": int, "logic": int, "practicality": int, "reason": "評価理由" }},
    "openrouter": {{ "accuracy": int, "logic": int, "practicality": int, "reason": "評価理由" }}
  }},
  "final_decision": {{
    "trust_level": "高/中/低 のいずれか",
    "content": "最終的な統合回答のマークダウンテキスト。詳細かつ丁寧に記述すること。",
    "reasons": ["採用したポイント1", "採用したポイント2", "意見の相違点に関する見解"]
  }}
}}
"""
    try:
        logging.info("COUNCIL_GEMINI_PROCESS_START")
        print("[COUNCIL_GEMINI_REQUEST]")
        # ユーザー提供のキーがある場合は都度設定
        if api_key:
            genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-3.5-flash', generation_config={"response_mime_type": "application/json"})
        
        import google.api_core.exceptions
        import re
        import asyncio
        
        for attempt in range(2):
            try:
                logging.info("COUNCIL_GEMINI_API_CALL_START")
                response = await model.generate_content_async(prompt)
                logging.info("COUNCIL_GEMINI_API_CALL_END")
                break
            except google.api_core.exceptions.ResourceExhausted as e:
                if attempt == 0:
                    delay = 60.0
                    match = re.search(r'retry in ([\d\.]+)s', str(e))
                    if match:
                        try:
                            delay = float(match.group(1)) + 1.0
                        except ValueError:
                            pass
                    print(f"[議長AI] 429 API制限エラー。{delay:.1f}秒待機して再試行します...")
                    await asyncio.sleep(delay)
                else:
                    print("[議長AI] 再試行後も429エラーが発生しました。フォールバックします。")
                    print("[議長AI] 再試行後もエラーが発生しました。フォールバックします。")
                    raise e
                    
        print("[COUNCIL_GEMINI_RESPONSE]")
        print("[COUNCIL_JSON_PARSE]")
        logging.info("COUNCIL_RESPONSE_PARSE_START")
        parsed = json.loads(response.text)
        logging.info("COUNCIL_RESPONSE_PARSE_END")
        print("[COUNCIL_END]")
        logging.info("COUNCIL_GEMINI_PROCESS_END")
        return parsed
    except google.api_core.exceptions.ResourceExhausted as e:
        # Gemini API quota exceeded – fallback to a minimal council result
        print(f"[議長AI] 429 クォータエラー: {e}. フォールバック結果を返します。")
        fallback_result = {
            "evaluations": {
                "gemini": {"accuracy": 0, "logic": 0, "practicality": 0, "reason": "API制限によるフォールバック"},
                "groq": {"accuracy": 0, "logic": 0, "practicality": 0, "reason": "API制限によるフォールバック"},
                "openrouter": {"accuracy": 0, "logic": 0, "practicality": 0, "reason": "API制限によるフォールバック"}
            },
            "final_decision": {
                "trust_level": "低",
                "content": "議長AIのGeminiがクォータ制限に達したため、評価は実施できませんでした。",
                "reasons": ["Gemini API quota exceeded"]
            }
        }
        return fallback_result
    

# APIエンドポイント
@app.post("/api/council")
async def run_council(req: CouncilRequest, request: Request):
    async def event_generator():
        q = asyncio.Queue()

        # イベント送信用のヘルパー関数
        async def send_event(event_type: str, **kwargs):
            # Add UTC timestamp to each SSE event
            from datetime import datetime
            ts = datetime.utcnow().isoformat() + "Z"
            payload = {"type": event_type, "timestamp": ts, **kwargs}
            await q.put(json.dumps(payload))

        # AI回答取得のラッパー関数
        async def wrap_ai(ai_id: str, func, *args):
            await send_event(f"AI_START", ai=ai_id, stage="ai_answer", message=f"{ai_id} の回答生成開始")
            try:
                res = await func(*args)
                await send_event(f"AI_END", ai=ai_id, success=True, stage="ai_answer", message=f"{ai_id} の回答生成完了")
                return res
            except Exception as e:
                await send_event(f"AI_END", ai=ai_id, success=False, error=str(e), stage="ai_answer", message=f"{ai_id} の回答生成エラー")
                return f"エラー: {e}"

        # バックグラウンド処理関数
        async def background_task():
            try:
                # 3AI 同時取得（ユーザー提供のAPIキーを渡す）
                ai_tasks = [
                    wrap_ai("gemini", get_gemini_answer, req.question, req.gemini_api_key),
                    wrap_ai("groq", get_groq_answer, req.question, req.groq_api_key),
                    wrap_ai("openrouter", get_openrouter_answer, req.question, req.openrouter_api_key)
                ]
                g_ans, gr_ans, o_ans = await asyncio.gather(*ai_tasks)

                # 議長AI（Geminiのキーを使用）
                await send_event("COUNCIL_START", stage="council", message="議長AI Gemini が3つのAI回答を比較・分析しています")
                council_result = await generate_council_decision(req.question, g_ans, gr_ans, o_ans, req.gemini_api_key)
                
                if not council_result:
                    council_result = {
                        "evaluations": {
                            "gemini": { "accuracy": 0, "logic": 0, "practicality": 0, "reason": "評価エラー" },
                            "groq": { "accuracy": 0, "logic": 0, "practicality": 0, "reason": "評価エラー" },
                            "openrouter": { "accuracy": 0, "logic": 0, "practicality": 0, "reason": "評価エラー" }
                        },
                        "final_decision": {
                            "trust_level": "評価不能",
                            "content": "議長AIによる評価中にエラーが発生しました。各AIの個別回答のみ表示します。",
                            "reasons": ["システムエラー"]
                        }
                    }
                await send_event("COUNCIL_END", stage="council", message="議長AI完了")
                
                final_data = {
                    "status": "success",
                    "results": {
                        "gemini": {"answer": g_ans, "evaluation": council_result["evaluations"].get("gemini", {})},
                        "groq": {"answer": gr_ans, "evaluation": council_result["evaluations"].get("groq", {})},
                        "openrouter": {"answer": o_ans, "evaluation": council_result["evaluations"].get("openrouter", {})}
                    },
                    "final_decision": council_result["final_decision"]
                }
                await send_event("COMPLETE", data=final_data)
                logging.info("COUNCIL_PROCESS_END")
                
            except Exception as e:
                import traceback
                traceback.print_exc()
                await send_event("ERROR", message=str(e))
            finally:
                await q.put(None)  # 終了シグナル

        task = asyncio.create_task(background_task())

        try:
            while True:
                if await request.is_disconnected():
                    task.cancel()
                    break
                
                # クライアント切断をチェックしつつ、Queueから要素を取り出す
                # is_disconnected() はポーリングしないと検知できないため timeout つきの get() を使用
                try:
                    data_str = await asyncio.wait_for(q.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                if data_str is None:
                    break
                yield f"data: {data_str}\n\n"
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(event_generator(), media_type="text/event-stream")

# 静的ファイルの配信
app.mount("/", StaticFiles(directory="static", html=True), name="static")
