// AI合議室 JavaScript (Gemini, Groq, OpenRouter版)

// Supabase初期化
const SUPABASE_URL = "https://azzsorczzufhmtnzotpo.supabase.co";
const SUPABASE_KEY = "sb_publishable_-3XPDW_0hzOSiPd1ECGsXA_Nd3QWkgY";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let currentUser = null;
let currentSessionId = null;

document.addEventListener("DOMContentLoaded", () => {
    const submitButton = document.getElementById("submit-button");
    const questionInput = document.getElementById("question-input");
    
    const aiGrid = document.getElementById("ai-grid");
    const finalAnswerArea = document.getElementById("final-answer-area");
    const councilProcessArea = document.getElementById("council-process-area");
    
    const steps = [
        document.getElementById("step-1"),
        document.getElementById("step-2"),
        document.getElementById("step-3"),
        document.getElementById("step-4"),
        document.getElementById("step-5")
    ];

    // 合議プロセスフローのステップ要素
    const flowSteps = {
        collect: document.getElementById("flow-collect"),
        evaluate: document.getElementById("flow-evaluate"),
        synthesize: document.getElementById("flow-synthesize")
    };

    // ==========================================
    // Supabase Auth & History
    // ==========================================
    const authLoginBtn = document.getElementById("auth-login");
    const authLogoutBtn = document.getElementById("auth-logout");
    const userProfile = document.getElementById("user-profile");
    const userAvatar = document.getElementById("user-avatar");
    const historyLoginPrompt = document.getElementById("history-login-prompt");
    const historyList = document.getElementById("history-list");
    const historyEmpty = document.getElementById("history-empty");
    const btnNewChat = document.getElementById("btn-new-chat");

    // 認証状態の監視
    supabaseClient.auth.onAuthStateChange((event, session) => {
        currentUser = session?.user || null;
        updateAuthUI();
        if (currentUser) {
            loadHistory();
        } else {
            historyList.innerHTML = "";
            historyEmpty.style.display = "none";
            historyLoginPrompt.style.display = "block";
        }
    });

    function updateAuthUI() {
        if (currentUser) {
            authLoginBtn.classList.add("hidden");
            userProfile.classList.remove("hidden");
            userAvatar.src = currentUser.user_metadata?.avatar_url || "https://ui-avatars.com/api/?name=User&background=random";
            historyLoginPrompt.style.display = "none";
        } else {
            authLoginBtn.classList.remove("hidden");
            userProfile.classList.add("hidden");
            historyLoginPrompt.style.display = "block";
            historyEmpty.style.display = "none";
        }
    }

    authLoginBtn.addEventListener("click", async () => {
        await supabaseClient.auth.signInWithOAuth({ provider: 'google' });
    });

    authLogoutBtn.addEventListener("click", async () => {
        await supabaseClient.auth.signOut();
        currentSessionId = null;
        startNewChat();
    });

    btnNewChat.addEventListener("click", () => {
        startNewChat();
    });

    function startNewChat() {
        currentSessionId = null;
        questionInput.value = "";
        aiGrid.classList.add("hidden");
        finalAnswerArea.classList.add("hidden");
        councilProcessArea.classList.add("hidden");
        updateStep(1);
        submitButton.disabled = false;
        submitButton.textContent = "合議開始";
        
        // サイドバーの選択状態をクリア
        document.querySelectorAll(".history-item").forEach(item => item.classList.remove("active"));
    }

    // 履歴を読み込む
    async function loadHistory() {
        if (!currentUser) return;
        const { data, error } = await supabaseClient
                    .from('chat_sessions')
            .select('id, title, created_at')
            .order('created_at', { ascending: false });
        
        if (error) {
            console.error("履歴取得エラー:", error);
            return;
        }

        historyList.innerHTML = "";
        if (data.length === 0) {
            historyEmpty.style.display = "block";
        } else {
            historyEmpty.style.display = "none";
            data.forEach(session => {
                const li = document.createElement("li");
                li.className = "history-item";
                if (session.id === currentSessionId) li.classList.add("active");
                li.innerHTML = `
                    <div class="history-title">${escapeHtml(session.title)}</div>
                    <div class="history-date">${new Date(session.created_at).toLocaleString()}</div>
                `;
                li.addEventListener("click", () => loadSession(session.id));
                historyList.appendChild(li);
            });
        }
    }

    // セッションを読み込んで表示する
    async function loadSession(sessionId) {
        if (!currentUser) return;
        currentSessionId = sessionId;
        
        // アクティブ状態更新
        document.querySelectorAll(".history-item").forEach(item => item.classList.remove("active"));
        loadHistory(); // 再描画して選択状態を反映
        
        const { data, error } = await supabaseClient
                    .from('chat_messages')
            .select('*')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: true });

        if (error || data.length === 0) {
            console.error("メッセージ取得エラー:", error);
            return;
        }

        const msg = data[data.length - 1]; // 最後のメッセージを表示
        questionInput.value = msg.question;
        
        // 再描画
        aiGrid.classList.remove("hidden");
        finalAnswerArea.classList.remove("hidden");
        councilProcessArea.classList.add("hidden");
        updateStep(5);

        // AI回答の描画
        if (msg.gemini_ans) document.getElementById("gemini-content").innerHTML = renderMarkdown(msg.gemini_ans);
        if (msg.groq_ans) document.getElementById("groq-content").innerHTML = renderMarkdown(msg.groq_ans);
        if (msg.openrouter_ans) document.getElementById("openrouter-ans")?.innerHTML || (document.getElementById("openrouter-content").innerHTML = renderMarkdown(msg.openrouter_ans));
        
        // 評価と最終結果の描画
        if (msg.council_result) {
            const evals = msg.council_result.evaluations;
            if (evals) {
                ["gemini", "groq", "openrouter"].forEach(ai => {
                    const e = evals[ai];
                    if (e) showEvaluation(ai, e.accuracy, e.logic, e.practicality, e.reason);
                });
            }
            const fd = msg.council_result.final_decision;
            if (fd) {
                document.querySelector("#trust-level span").textContent = fd.trust_level;
                document.getElementById("final-content").innerHTML = renderMarkdown(fd.content);
                document.getElementById("council-details").innerHTML = (fd.reasons || []).map(r => `<li>${escapeHtml(r)}</li>`).join("");
            }
        }
    }

    async function saveChatToSupabase(question, finalData) {
        if (!currentUser) return;

        try {
            // 新規セッションなら作成
            if (!currentSessionId) {
                const title = question.length > 20 ? question.substring(0, 20) + "..." : question;
                const { data: sessionData, error: sessionError } = await supabaseClient
                    .from('chat_sessions')
                    .insert([{ user_id: currentUser.id, title: title }])
                    .select('id')
                    .single();
                
                if (sessionError) throw sessionError;
                currentSessionId = sessionData.id;
            }

            // メッセージを保存
            const { error: msgError } = await supabaseClient
                .from('chat_messages')
                .insert([{
                    session_id: currentSessionId,
                    question: question,
                    gemini_ans: finalData?.results?.gemini?.answer || "",
                    groq_ans: finalData?.results?.groq?.answer || "",
                    openrouter_ans: finalData?.results?.openrouter?.answer || "",
                    council_result: {
                        evaluations: {
                            gemini: finalData?.results?.gemini?.evaluation || {},
                            groq: finalData?.results?.groq?.evaluation || {},
                            openrouter: finalData?.results?.openrouter?.evaluation || {}
                        },
                        final_decision: finalData?.final_decision || {}
                    }
                }]);
            
            if (msgError) throw msgError;

            // 履歴リストを更新
            loadHistory();
        } catch (e) {
            console.error("Supabase保存エラー:", e);
            const toast = document.createElement("div");
            toast.className = "toast";
            toast.style.background = "var(--openrouter-color)"; // Red color for error
            toast.textContent = "⚠️ 履歴の保存に失敗しました";
            document.body.appendChild(toast);
            setTimeout(() => toast.classList.add("show"), 10);
            setTimeout(() => {
                toast.classList.remove("show");
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }
    }

    // ==========================================
    // APIキー管理 (localStorage)
    // ==========================================
    const API_KEY_STORAGE = {
        gemini: "ai_council_gemini_key",
        groq: "ai_council_groq_key",
        openrouter: "ai_council_openrouter_key"
    };

    function getApiKeys() {
        return {
            gemini_api_key: localStorage.getItem(API_KEY_STORAGE.gemini) || null,
            groq_api_key: localStorage.getItem(API_KEY_STORAGE.groq) || null,
            openrouter_api_key: localStorage.getItem(API_KEY_STORAGE.openrouter) || null
        };
    }

    function saveApiKeys(gemini, groq, openrouter) {
        if (gemini) localStorage.setItem(API_KEY_STORAGE.gemini, gemini);
        else localStorage.removeItem(API_KEY_STORAGE.gemini);
        if (groq) localStorage.setItem(API_KEY_STORAGE.groq, groq);
        else localStorage.removeItem(API_KEY_STORAGE.groq);
        if (openrouter) localStorage.setItem(API_KEY_STORAGE.openrouter, openrouter);
        else localStorage.removeItem(API_KEY_STORAGE.openrouter);
    }

    function clearApiKeys() {
        Object.values(API_KEY_STORAGE).forEach(k => localStorage.removeItem(k));
    }

    // 設定ボタンの状態更新（キーが設定済みかどうか）
    function updateSettingsButtonState() {
        const keys = getApiKeys();
        const btn = document.getElementById("settings-button");
        const hasAnyKey = Object.values(keys).some(v => v);
        btn.classList.toggle("has-keys", hasAnyKey);
    }
    updateSettingsButtonState();

    // ==========================================
    // 初回オンボーディング (Magi system起動処理)
    // ==========================================
    const onboardingModal = document.getElementById("onboarding-modal");
    const btnSkipOnboarding = document.getElementById("btn-skip-onboarding");
    const btnStartSetup = document.getElementById("btn-start-setup");

    // 起動時にキーが一つも無ければオンボーディングを表示（ただしセッションストレージで一度スキップした場合は出さない）
    if (!Object.values(getApiKeys()).some(v => v) && !sessionStorage.getItem("magi_onboarding_skipped")) {
        onboardingModal.classList.remove("hidden");
    }

    btnSkipOnboarding.addEventListener("click", () => {
        sessionStorage.setItem("magi_onboarding_skipped", "true");
        onboardingModal.classList.add("hidden");
    });

    btnStartSetup.addEventListener("click", () => {
        onboardingModal.classList.add("hidden");
        // 設定モーダルを開く処理
        const keys = getApiKeys();
        document.getElementById("setting-gemini-key").value = keys.gemini_api_key || "";
        document.getElementById("setting-groq-key").value = keys.groq_api_key || "";
        document.getElementById("setting-openrouter-key").value = keys.openrouter_api_key || "";
        document.getElementById("settings-modal").classList.remove("hidden");
    });

    submitButton.addEventListener("click", async () => {
        const question = questionInput.value.trim();
        if (!question) {
            alert("質問を入力してください。");
            return;
        }

        // 初期化・UI変更
        submitButton.disabled = true;
        submitButton.textContent = "処理中...";
        aiGrid.classList.remove("hidden");
        finalAnswerArea.classList.add("hidden");
        councilProcessArea.classList.add("hidden");
        
        // UIステータスを「AI回答生成中」に
        updateStep(1);
        
        // 全AIをローディング状態に
        ["gemini", "groq", "openrouter"].forEach(ai => {
            setAiStatus(ai, "loading", "回答生成中...");
            clearAiContent(ai);
        });

        // 合議プロセスフローをリセット
        resetFlowSteps();

        try {
            // バックエンドAPIへリクエスト送信（APIキーを含む）
            const apiKeys = getApiKeys();
            const response = await fetch('/api/council', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ question: question, ...apiKeys })
            });

            if (!response.ok) {
                throw new Error(`APIエラー: ${response.status}`);
            }

            // タイマー管理
            let activeTimerInterval = null;
            let currentSeconds = 0;
            const startTimer = (selector) => {
                if (activeTimerInterval) clearInterval(activeTimerInterval);
                currentSeconds = 0;
                activeTimerInterval = setInterval(() => {
                    currentSeconds++;
                    const el = document.querySelector(selector);
                    if (el) {
                        el.innerHTML = `🔄 処理中... ${currentSeconds}秒` + 
                            (currentSeconds >= 60 ? `<br><span style="color:#ef4444;font-size:0.85em;">通常より時間がかかっています。処理は継続しています。</span>` : 
                            (currentSeconds >= 30 ? `<br><span style="color:#f59e0b;font-size:0.85em;">※外部AIからの応答を待っています。処理は継続しています。</span>` : ""));
                    }
                }, 1000);
            };
            const stopTimer = () => {
                if (activeTimerInterval) clearInterval(activeTimerInterval);
            };

            // AIの完了状態を管理
            const aiStatus = { gemini: false, groq: false, openrouter: false };

            // SSE ストリーム読み込み
            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";
            let finalData = null;

            councilProcessArea.classList.remove("hidden");
            
            // 初期の待機中UIセットアップ
            setFlowStep("collect", "active", "⏳ 待機中");
            document.getElementById("details-collect").innerHTML = `
                <div id="ai-collect-gemini">Gemini：⏳ 待機中</div>
                <div id="ai-collect-groq">Groq：⏳ 待機中</div>
                <div id="ai-collect-openrouter">OpenRouter：⏳ 待機中</div>
            `;
            startTimer("#flow-collect .flow-status");

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split('\n\n');
                buffer = parts.pop();

                for (const part of parts) {
                    if (part.startsWith("data: ")) {
                        const jsonStr = part.slice(6);
                        try {
                            const event = JSON.parse(jsonStr);
                            
                            if (event.type === "AI_START") {
                                const aiName = event.ai;
                                setAiStatus(aiName, "loading", event.message || "回答生成中...");
                                document.getElementById(`ai-collect-${aiName}`).innerHTML = `${aiName}：🔄 ${event.message || "回答生成中..."}`;
                            } 
                            else if (event.type === "AI_END") {
                                const aiName = event.ai;
                                aiStatus[aiName] = true;
                                if (event.success) {
                                    setAiStatus(aiName, "done", event.message || "完了");
                                    document.getElementById(`ai-collect-${aiName}`).innerHTML = `${aiName}：✅ ${event.message || "完了"}`;
                                } else {
                                    setAiStatus(aiName, "error", event.message || "エラー");
                                    document.getElementById(`ai-collect-${aiName}`).innerHTML = `${aiName}：⚠️ ${event.message || "タイムアウト (合議は継続)"}`;
                                    const contentEl = document.getElementById(`${aiName}-content`);
                                    contentEl.innerHTML = renderMarkdown(event.error);
                                }
                                
                                // すべて完了したら表示を更新
                                if (aiStatus.gemini && aiStatus.groq && aiStatus.openrouter) {
                                    stopTimer();
                                    document.querySelector("#flow-collect .flow-status").innerHTML = `✅ 完了 (${currentSeconds}秒)`;
                                }
                            }
                            else if (event.type === "COUNCIL_START") {
                                setFlowStep("evaluate", "active", event.message || "🔄 処理中...");
                                startTimer("#flow-evaluate .flow-status");
                                document.getElementById("details-evaluate").innerHTML = event.message || `
                                    議長AI Gemini が処理しています。<br>
                                    3つのAI回答を比較・分析しています。
                                `;
                            }
                            else if (event.type === "COUNCIL_END") {
                                stopTimer();
                                document.querySelector("#flow-evaluate .flow-status").innerHTML = `✅ 完了 (${currentSeconds}秒)`;
                            }
                            else if (event.type === "COMPLETE") {
                                finalData = event.data;
                            }
                            
                        } catch (e) {
                            console.error("JSON parse error:", e, jsonStr);
                        }
                    }
                }
            }

            if (finalData) {
                // 回答の描画
                ["gemini", "groq", "openrouter"].forEach(ai => {
                    const ans = finalData.results[ai].answer;
                    if (!ans.startsWith("エラー")) {
                        const contentEl = document.getElementById(`${ai}-content`);
                        contentEl.innerHTML = renderMarkdown(ans);
                    }
                    const evalData = finalData.results[ai].evaluation;
                    showEvaluation(ai, evalData.accuracy, evalData.logic, evalData.practicality, evalData.reason);
                });
                

                
                updateStep(4);
                setFlowStep("synthesize", "active", "✅ 完了");
                document.getElementById("details-synthesize").innerHTML = "最終回答の生成が完了しました。";
                
                finalAnswerArea.classList.remove("hidden");
                const fd = finalData.final_decision;
                document.querySelector("#trust-level span").textContent = fd.trust_level;
                document.getElementById("final-content").innerHTML = renderMarkdown(fd.content);
                const reasonsHtml = fd.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join("");
                document.getElementById("council-details").innerHTML = reasonsHtml;
                
                finalAnswerArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
                submitButton.disabled = false;
                submitButton.textContent = "もう一度合議する";

                // Supabaseへ保存
                saveChatToSupabase(question, finalData);
            }

        } catch (error) {
            console.error(error);
            alert("通信中にエラーが発生しました。");
            submitButton.disabled = false;
            submitButton.textContent = "合議開始";
            ["gemini", "groq", "openrouter"].forEach(ai => setAiStatus(ai, "error", "通信エラー"));
        }
    });

    // ================================================
    // ステータス管理ユーティリティ
    // ================================================

    function updateStep(activeIndex) {
        steps.forEach((step, index) => {
            if (index <= activeIndex) {
                step.classList.add("active");
            } else {
                step.classList.remove("active");
            }
        });
    }

    function setAiStatus(ai, state, text) {
        const badge = document.getElementById(`${ai}-status`);
        if (badge) {
            badge.className = `status-badge ${state}`;
            badge.textContent = text;
        }
    }

    function clearAiContent(ai) {
        const content = document.getElementById(`${ai}-content`);
        const evalSection = document.getElementById(`${ai}-eval`);
        if (content) content.innerHTML = "";
        if (evalSection) evalSection.classList.add("hidden");
    }

    // ================================================
    // 合議プロセスフロー管理
    // ================================================

    function resetFlowSteps() {
        Object.values(flowSteps).forEach(el => {
            if (!el) return;
            el.classList.remove("active", "done");
            el.querySelector(".flow-status").textContent = "⏳ 待機中";
            const details = el.querySelector(".flow-details");
            if (details) details.innerHTML = "";
        });
    }

    function setFlowStep(key, state, statusText) {
        const el = flowSteps[key];
        if (!el) return;
        el.classList.remove("active", "done");
        if (state) el.classList.add(state);
        el.querySelector(".flow-status").textContent = statusText;
    }

    // ================================================
    // 評価表示（スコアバーアニメーション付き）
    // ================================================

    function showEvaluation(ai, acc, log, pra, reason) {
        const evalSection = document.getElementById(`${ai}-eval`);
        if (!evalSection) return;
        
        evalSection.classList.remove("hidden");
        
        const scoreItems = evalSection.querySelectorAll(".eval-score-item");
        const scores = [acc, log, pra];
        
        scoreItems.forEach((item, index) => {
            const scoreValue = scores[index] || 0;
            const scoreSpan = item.querySelector(".score");
            const scoreFill = item.querySelector(".score-fill");
            
            scoreSpan.textContent = `${scoreValue}/10`;
            // スコアバーのアニメーション（幅をパーセントで設定）
            setTimeout(() => {
                scoreFill.style.width = `${scoreValue * 10}%`;
            }, 100 + index * 150);
        });
        
        evalSection.querySelector(".eval-reason").textContent = reason;
    }

    // ==========================================
    // テキスト安全変換ユーティリティ
    // ==========================================

    /**
     * HTMLエスケープ: AIの回答に含まれる <, >, &, " をHTMLエンティティに変換し、
     * DOMが壊れないようにする。
     */
    function escapeHtml(text) {
        if (!text) return "";
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 簡易マークダウンレンダラー: AIの回答テキストを安全なHTMLに変換する。
     * まずHTMLエスケープしてから、限定的なマークダウン記法をHTMLに変換する。
     */
    function renderMarkdown(text) {
        if (!text) return "<p>回答なし</p>";

        // 1. HTMLエスケープ（安全のため必ず最初に実行）
        let html = escapeHtml(text);

        // 2. コードブロック (```...```)
        html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

        // 3. インラインコード (`...`)
        html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

        // 4. 見出し (### → h4, ## → h3, # → h2) — 行頭のみ
        html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

        // 5. 太字 (**...**)
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

        // 6. 斜体 (*...*)
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

        // 7. 箇条書き (行頭の - または * または 数字.)
        html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
        html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
        // 連続する<li>を<ul>で囲む
        html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

        // 8. 水平線 (---)
        html = html.replace(/^---$/gm, '<hr>');

        // 9. 改行の処理: 連続する空行は段落の区切り、それ以外は<br>
        html = html.replace(/\n\n+/g, '</p><p>');
        html = html.replace(/\n/g, '<br>');

        // 10. 全体を<p>で囲む
        html = '<p>' + html + '</p>';

        // 11. 空の<p>タグを除去
        html = html.replace(/<p>\s*<\/p>/g, '');

        return html;
    }
    
    // ==========================================
    // 設定モーダル
    // ==========================================
    const settingsModal = document.getElementById("settings-modal");
    const settingsButton = document.getElementById("settings-button");
    const settingsClose = document.getElementById("settings-close");
    const settingsSave = document.getElementById("settings-save");
    const settingsClear = document.getElementById("settings-clear");

    // モーダルを開く
    settingsButton.addEventListener("click", () => {
        const keys = getApiKeys();
        document.getElementById("setting-gemini-key").value = keys.gemini_api_key || "";
        document.getElementById("setting-groq-key").value = keys.groq_api_key || "";
        document.getElementById("setting-openrouter-key").value = keys.openrouter_api_key || "";
        settingsModal.classList.remove("hidden");
    });

    // モーダルを閉じる
    settingsClose.addEventListener("click", () => {
        settingsModal.classList.add("hidden");
    });
    settingsModal.addEventListener("click", (e) => {
        if (e.target === settingsModal) settingsModal.classList.add("hidden");
    });

    // 保存
    settingsSave.addEventListener("click", () => {
        saveApiKeys(
            document.getElementById("setting-gemini-key").value.trim(),
            document.getElementById("setting-groq-key").value.trim(),
            document.getElementById("setting-openrouter-key").value.trim()
        );
        updateSettingsButtonState();
        settingsModal.classList.add("hidden");

        // 保存完了トースト
        const toast = document.createElement("div");
        toast.className = "toast";
        toast.textContent = "✅ APIキーを保存しました";
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add("show"), 10);
        setTimeout(() => {
            toast.classList.remove("show");
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    });

    // クリア
    settingsClear.addEventListener("click", () => {
        if (confirm("すべてのAPIキーを削除しますか？")) {
            clearApiKeys();
            document.getElementById("setting-gemini-key").value = "";
            document.getElementById("setting-groq-key").value = "";
            document.getElementById("setting-openrouter-key").value = "";
            updateSettingsButtonState();
        }
    });

    // パスワード表示切り替え
    document.querySelectorAll(".btn-toggle-visibility").forEach(btn => {
        btn.addEventListener("click", () => {
            const input = document.getElementById(btn.dataset.target);
            if (input.type === "password") {
                input.type = "text";
                btn.textContent = "🙈";
            } else {
                input.type = "password";
                btn.textContent = "👁️";
            }
        });
    });

});
