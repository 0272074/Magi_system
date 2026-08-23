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

class RateLimitExhausted(Exception):
    def __init__(self, delay: float):
        self.delay = delay

class DailyQuotaExhausted(Exception):
    pass

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

class CouncilRequest(BaseModel):
    question: str
    gemini_api_key: Optional[str] = None
    groq_api_key: Optional[str] = None
    openrouter_api_key: Optional[str] = None
    # 合議構成（省略時はデフォルト: Gemini×3 + 議長Gemini）
    members: Optional[list[dict]] = None
    chair: Optional[str] = None

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
        error_str = str(e)
        print(f"\n[Gemini API エラー詳細]\nエラー内容: {error_str}\n")
        if "PerDay" in error_str or "Daily" in error_str or "GenerateRequestsPerDay" in error_str:
            raise DailyQuotaExhausted("Gemini APIの無料利用上限に達した可能性があります。")
        if "429" in error_str or "ResourceExhausted" in error_str:
            delay = 30.0
            match = re.search(r'retry in ([\d\.]+)s', error_str)
            if match:
                try:
                    delay = float(match.group(1)) + 1.0
                except ValueError:
                    pass
            raise RateLimitExhausted(delay)
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
        error_str = str(e)
        print(f"\n[Groq API エラー詳細]\nエラー内容: {error_str}\n")
        if "429" in error_str:
            delay = 30.0
            match = re.search(r'retry in ([\d\.]+)s', error_str)
            if match:
                try:
                    delay = float(match.group(1)) + 1.0
                except ValueError:
                    pass
            raise RateLimitExhausted(delay)
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
        error_str = str(e)
        print(f"\n[OpenRouter API エラー詳細]\nエラー内容: {error_str}\n")
        if "429" in error_str:
            delay = 30.0
            match = re.search(r'retry in ([\d\.]+)s', error_str)
            if match:
                try:
                    delay = float(match.group(1)) + 1.0
                except ValueError:
                    pass
            raise RateLimitExhausted(delay)
        return "エラー: OpenRouter APIで問題が発生しました。APIキーが正しいか確認してください。"
    except Exception as e:
        print(f"[OpenRouter 予期せぬエラー] {type(e).__name__}: {e}")
        return "エラー: OpenRouterとの通信に失敗しました。APIキーの有効性を確認してください。"

# ==========================================
# AIサービスと役割の定義
# ==========================================
AI_SERVICES = {
    "gemini": {
        "name": "Gemini",
        "get_answer": get_gemini_answer,
    },
    "groq": {
        "name": "Groq",
        "get_answer": get_groq_answer,
    },
    "openrouter": {
        "name": "OpenRouter",
        "get_answer": get_openrouter_answer,
    },
}

AI_ROLES = {
    "basic": {
        "name": "基本分析",
        "instruction": "問題を中立的かつ論理的に整理し、主要な論点を幅広く検討してください。"
    },
    "critic": {
        "name": "批判的検討",
        "instruction": "前提や論理に誤りがないかを慎重に検討し、反対意見や見落とされている問題点も指摘してください。"
    },
    "alternative": {
        "name": "別視点",
        "instruction": "一般的な回答とは異なる視点から問題を検討し、見落とされやすい考え方や選択肢を提示してください。"
    },
    "expert": {
        "name": "専門分析",
        "instruction": "専門家の立場から、根拠・因果関係・具体例を重視して分析してください。事実と推測を区別してください。"
    },
    "user": {
        "name": "利用者視点",
        "instruction": "実際にこの問題について判断する利用者の立場から、実用性や具体的なメリット・デメリットを重視してください。"
    }
}

async def generate_council_decision(question: str, answers: list, members: list, chair_service: str = "gemini", api_key: Optional[str] = None) -> dict:
    """合議メンバーの回答を評価し、最終回答をJSONで生成する（議長AI）"""
    
    # 議長サービスに応じたAPIキーの取得
    default_keys = {
        "gemini": default_gemini_api_key,
        "groq": default_groq_api_key,
        "openrouter": default_openrouter_api_key,
    }
    key = api_key or default_keys.get(chair_service)
    if not key:
        return None
    
    # 回答セクションを動的に構築
    answer_sections = ""
    for i, (m, ans) in enumerate(zip(members, answers)):
        service = m["service"]
        role = m.get("role", "basic")
        service_name = AI_SERVICES[service]["name"]
        role_name = AI_ROLES.get(role, AI_ROLES["basic"])["name"]
        
        answer_sections += f"\n【AI {i+1}】\nサービス：{service_name}\n役割：{role_name}\n"
        if ans.startswith("エラー"):
            answer_sections += f"状態：回答取得失敗\n理由：{ans}\n"
        else:
            answer_sections += f"回答：\n{ans}\n"
    
    # 評価スキーマを動的に構築
    eval_entries = []
    for i in range(len(answers)):
        eval_entries.append(f'    "member_{i+1}": {{ "accuracy": int, "logic": int, "practicality": int, "reason": "評価理由" }}')
    eval_schema = ",\n".join(eval_entries)
    
    prompt = f"""あなたはAI合議室の「議長」です。ユーザーからの質問に対し、{len(answers)}つのAIが独立して回答を生成しました。
各AIの回答を客観的に評価（正確性、論理性、実用性の観点で各10点満点）し、最も妥当な要素を組み合わせて「最終的な統合回答」を作成してください。

【統合時の重要ルール】
・各AIのサービス名（例：Geminiだから正しい、等）そのものを根拠として回答の優劣を判断してはいけません。
・各回答の内容、根拠、論理性、および担当した「役割」を踏まえて比較してください。
・複数の回答が一致している場合でも、それだけを理由に正しいと判断せず、必要に応じて根拠を検討してください。
・一部のAIがエラーにより回答できなかった場合は、利用可能な回答だけを用いて合議してください。
・事実として確認できない内容を断定しないこと。
・情報源が提示されていない場合、存在しない出典を勝手に作らないこと。

[ユーザーの質問]
{question}
{answer_sections}
必ず以下のJSONスキーマに完全に従って出力してください。マークダウンの```json等の装飾は一切含めないでください。
{{
  "evaluations": {{
{eval_schema}
  }},
  "final_decision": {{
    "trust_level": "高/中/低 のいずれか",
    "content": "最終的な統合回答のマークダウンテキスト。詳細かつ丁寧に記述すること。",
    "reasons": ["採用したポイント1", "採用したポイント2", "意見の相違点に関する見解"]
  }}
}}"""

    # フォールバック用の評価結果を構築
    fallback_evals = {}
    for i in range(len(answers)):
        fallback_evals[f"member_{i+1}"] = {"accuracy": 0, "logic": 0, "practicality": 0, "reason": "API制限によるフォールバック"}

    try:
        chair_name = AI_SERVICES[chair_service]["name"]
        logging.info(f"COUNCIL_{chair_service.upper()}_PROCESS_START")
        print(f"[COUNCIL_{chair_service.upper()}_REQUEST]")

        if chair_service == "gemini":
            # --- Gemini 議長（既存ロジックを維持）---
            if api_key:
                genai.configure(api_key=api_key)
            model = genai.GenerativeModel('gemini-3.5-flash', generation_config={"response_mime_type": "application/json"})
            
            import google.api_core.exceptions
            
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
                        raise e
            
            parsed = json.loads(response.text)

        elif chair_service == "groq":
            # --- Groq 議長 ---
            client = AsyncGroq(api_key=key)
            response = await client.chat.completions.create(
                messages=[
                    {"role": "system", "content": "あなたはAI合議システムの議長です。指示に従い、必ず指定されたJSONスキーマのみを出力してください。"},
                    {"role": "user", "content": prompt}
                ],
                model="qwen/qwen3.6-27b",
                temperature=0.3,
                max_tokens=4096,
                timeout=60.0
            )
            raw_content = response.choices[0].message.content
            # <think>タグを除去
            clean_content = re.sub(r'<think>.*?(</think>|$)', '', raw_content, flags=re.DOTALL).strip()
            parsed = json.loads(clean_content if clean_content else raw_content)

        elif chair_service == "openrouter":
            # --- OpenRouter 議長 ---
            client = AsyncOpenAI(base_url="https://openrouter.ai/api/v1", api_key=key)
            response = await client.chat.completions.create(
                messages=[
                    {"role": "system", "content": "あなたはAI合議システムの議長です。指示に従い、必ず指定されたJSONスキーマのみを出力してください。"},
                    {"role": "user", "content": prompt}
                ],
                model="google/gemma-4-31b-it:free",
                temperature=0.3,
                max_tokens=4096,
                timeout=60.0
            )
            raw_content = response.choices[0].message.content
            # ```json ... ``` を除去
            cleaned = re.sub(r'```json\s*', '', raw_content)
            cleaned = re.sub(r'```\s*$', '', cleaned).strip()
            parsed = json.loads(cleaned)

        else:
            logging.error(f"Unknown chair service: {chair_service}")
            return {"evaluations": fallback_evals, "final_decision": {"trust_level": "低", "content": f"不明な議長サービス: {chair_service}", "reasons": ["設定エラー"]}}

        print(f"[COUNCIL_{chair_service.upper()}_RESPONSE]")
        print("[COUNCIL_JSON_PARSE]")
        logging.info("COUNCIL_RESPONSE_PARSE_END")
        print("[COUNCIL_END]")
        logging.info(f"COUNCIL_{chair_service.upper()}_PROCESS_END")
        return parsed

    except Exception as e:
        print(f"[議長AI] エラー: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return {
            "evaluations": fallback_evals,
            "final_decision": {
                "trust_level": "低",
                "content": f"議長AI（{AI_SERVICES.get(chair_service, {}).get('name', chair_service)}）でエラーが発生したため、評価は実施できませんでした。",
                "reasons": [f"{type(e).__name__}: {str(e)}"]
            }
        }

    

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
        async def wrap_ai(member_id: str, service: str, role: str, func, question: str, api_key: Optional[str]):
            role_info = AI_ROLES.get(role, AI_ROLES["basic"])
            role_name = role_info["name"]
            role_instruction = role_info["instruction"]
            
            await send_event(f"AI_START", id=member_id, service=service, role=role, role_name=role_name, stage="ai_answer", message=f"{AI_SERVICES[service]['name']}（{role_name}）の回答生成開始")
            
            final_question = f"以下の質問について回答してください。\n\n【質問】\n{question}\n\n【あなたの役割】\n{role_name}\n\n{role_instruction}"
            
            for attempt in range(2):
                try:
                    res = await func(final_question, api_key)
                    await send_event(f"AI_END", id=member_id, service=service, role=role, role_name=role_name, success=True, stage="ai_answer", message=f"{AI_SERVICES[service]['name']}（{role_name}）の回答生成完了")
                    return res
                except RateLimitExhausted as e:
                    if attempt == 0:
                        print(f"[{member_id}] 429短時間制限: {e.delay}秒待機して再試行します...")
                        await send_event(f"AI_RATE_LIMIT", id=member_id, service=service, type="short_term", retry_after=e.delay)
                        await asyncio.sleep(e.delay)
                    else:
                        print(f"[{member_id}] 再試行後も429エラーが発生")
                        err_msg = "エラー: 短時間の利用制限により取得できませんでした。"
                        await send_event(f"AI_END", id=member_id, success=False, error=err_msg, stage="ai_answer", message=f"{AI_SERVICES[service]['name']}（{role_name}）の回答生成エラー")
                        return err_msg
                except DailyQuotaExhausted as e:
                    print(f"[{member_id}] 日次上限超過: {e}")
                    await send_event(f"AI_QUOTA_EXHAUSTED", id=member_id, service=service, type="daily")
                    err_msg = "エラー: 日次の利用上限に達した可能性があります。"
                    await send_event(f"AI_END", id=member_id, success=False, error=err_msg, stage="ai_answer", message=f"{AI_SERVICES[service]['name']}（{role_name}）の回答生成エラー")
                    return err_msg
                except Exception as e:
                    err_msg = f"エラー: {e}"
                    await send_event(f"AI_END", id=member_id, success=False, error=err_msg, stage="ai_answer", message=f"{AI_SERVICES[service]['name']}（{role_name}）の回答生成エラー")
                    return err_msg

        # バックグラウンド処理関数
        async def background_task():
            try:
                # 合議構成の取得（デフォルト: Gemini×3 + 議長Gemini）
                members = req.members or [
                    {"service": "gemini", "role": "basic"},
                    {"service": "gemini", "role": "critic"},
                    {"service": "gemini", "role": "alternative"}
                ]
                chair_service = req.chair or "gemini"
                
                MEMBER_REQUEST_DELAY = 2.0

                # APIキーのマッピング
                api_keys = {
                    "gemini": req.gemini_api_key,
                    "groq": req.groq_api_key,
                    "openrouter": req.openrouter_api_key,
                }

                # バリデーション: 無効なサービス名チェック
                for m in members:
                    if m.get("service") not in AI_SERVICES:
                        await send_event("ERROR", message=f"不明なAIサービス: {m.get('service')}")
                        await q.put(None)
                        return
                if chair_service not in AI_SERVICES:
                    await send_event("ERROR", message=f"不明な議長サービス: {chair_service}")
                    await q.put(None)
                    return

                # サービスごとのタスクグループ化
                service_tasks = {}
                for i, m in enumerate(members):
                    member_id = f"member_{i+1}"
                    service = m["service"]
                    role = m.get("role", "basic")
                    if service not in service_tasks:
                        service_tasks[service] = []
                    
                    service_tasks[service].append({
                        "id": member_id,
                        "role": role,
                        "index": i
                    })
                
                # サービス単位で直列実行するヘルパー
                async def run_service_tasks(service, tasks):
                    func = AI_SERVICES[service]["get_answer"]
                    key = api_keys.get(service)
                    results = []
                    for i, t in enumerate(tasks):
                        if i > 0:
                            await asyncio.sleep(MEMBER_REQUEST_DELAY)
                        print(f"[COUNCIL_MEMBER_START] member={t['id']} service={service} role={t['role']}")
                        res = await wrap_ai(t["id"], service, t["role"], func, req.question, key)
                        print(f"[COUNCIL_MEMBER_END] member={t['id']} status={'error' if res.startswith('エラー') else 'success'}")
                        results.append((t["index"], res))
                    return results

                # 全サービスグループを並行実行
                gather_tasks = [run_service_tasks(svc, tasks) for svc, tasks in service_tasks.items()]
                grouped_results = await asyncio.gather(*gather_tasks)
                
                # インデックス順に並べ替え
                answers = [None] * len(members)
                for res_list in grouped_results:
                    for idx, ans in res_list:
                        answers[idx] = ans

                # 議長AI
                chair_name = AI_SERVICES[chair_service]["name"]
                chair_key = api_keys.get(chair_service)
                await send_event("COUNCIL_START", stage="council", message=f"議長AI {chair_name} が{len(members)}つのAI回答を比較・分析しています")
                council_result = await generate_council_decision(req.question, answers, members, chair_service, chair_key)
                
                if not council_result:
                    fallback_evals = {}
                    for i in range(len(members)):
                        fallback_evals[f"member_{i+1}"] = {"accuracy": 0, "logic": 0, "practicality": 0, "reason": "評価エラー"}
                    council_result = {
                        "evaluations": fallback_evals,
                        "final_decision": {
                            "trust_level": "評価不能",
                            "content": "議長AIによる評価中にエラーが発生しました。各AIの個別回答のみ表示します。",
                            "reasons": ["システムエラー"]
                        }
                    }
                await send_event("COUNCIL_END", stage="council", message="議長AI完了")
                
                # メンバーベースのデータ構造で返却
                members_data = []
                for i, (m, ans) in enumerate(zip(members, answers)):
                    member_id = f"member_{i+1}"
                    service = m["service"]
                    role = m.get("role", "basic")
                    members_data.append({
                        "id": member_id,
                        "service": AI_SERVICES[service]["name"],
                        "service_key": service,
                        "role": role,
                        "role_name": AI_ROLES.get(role, AI_ROLES["basic"])["name"],
                        "answer": ans,
                        "evaluation": council_result["evaluations"].get(member_id, {})
                    })

                final_data = {
                    "status": "success",
                    "members": members_data,
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
