// Magi system JavaScript — 合議構成の柔軟化対応版

// Supabase初期化
const SUPABASE_URL = "https://azzsorczzufhmtnzotpo.supabase.co";
const SUPABASE_KEY = "sb_publishable_-3XPDW_0hzOSiPd1ECGsXA_Nd3QWkgY";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let currentUser = null;
let currentSessionId = null;

// ==========================================
// AIサービス情報（フロントエンド用）
// ==========================================
const SERVICE_INFO = {
    gemini:     { name: "Gemini",      theme: "gemini-theme",     fillClass: "gemini-fill",     color: "var(--gemini-color)" },
    groq:       { name: "Groq",        theme: "groq-theme",       fillClass: "groq-fill",       color: "var(--groq-color)" },
    openrouter: { name: "OpenRouter",  theme: "openrouter-theme", fillClass: "openrouter-fill", color: "var(--openrouter-color)" }
};

const ROLE_INFO = {
    "basic": { name: "基本分析", desc: "中立的に問題を整理" },
    "critic": { name: "批判的検討", desc: "問題点・反例・リスクを探す" },
    "alternative": { name: "別視点", desc: "普通とは違う考え方を探す" },
    "expert": { name: "専門分析", desc: "根拠・専門知識を重視" },
    "user": { name: "利用者視点", desc: "実際の生活・実行可能性を重視" }
};

// ==========================================
// 合議構成管理
// ==========================================
const DEFAULT_COUNCIL_CONFIG = {
    members: [
        { service: "gemini", role: "basic" },
        { service: "gemini", role: "critic" },
        { service: "gemini", role: "alternative" }
    ],
    chair: "gemini"
};

function getCouncilConfig() {
    const saved = localStorage.getItem("magi_council_config");
    if (saved) {
        try { 
            let config = JSON.parse(saved); 
            // マイグレーション処理
            if (config.members && config.members.length > 0 && typeof config.members[0] === 'string') {
                const defaultRoles = ["basic", "critic", "alternative", "expert", "user"];
                config.members = config.members.map((svc, i) => {
                    return { service: svc, role: defaultRoles[i % defaultRoles.length] };
                });
                saveCouncilConfig(config);
            }
            return config;
        } catch (e) { /* fallthrough */ }
    }
    return JSON.parse(JSON.stringify(DEFAULT_COUNCIL_CONFIG));
}

function saveCouncilConfig(config) {
    localStorage.setItem("magi_council_config", JSON.stringify(config));
}

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
        finalAnswerArea.classList.remove("hidden");
        councilProcessArea.classList.add("hidden");
        updateStep(5);

        // 履歴データからAIカードを復元
        // 旧形式（gemini_ans, groq_ans, openrouter_ans）との互換性を維持
        const config = getCouncilConfig();
        const historyMembers = [];

        if (msg.gemini_ans) historyMembers.push({ service: "gemini", role: "basic", answer: msg.gemini_ans });
        if (msg.groq_ans) historyMembers.push({ service: "groq", role: "critic", answer: msg.groq_ans });
        if (msg.openrouter_ans) historyMembers.push({ service: "openrouter", role: "alternative", answer: msg.openrouter_ans });

        // カードがなければ現在の構成で復元
        if (historyMembers.length === 0) {
            historyMembers.push(...config.members.map(m => ({ service: m.service, role: m.role, answer: "" })));
        }

        renderAiCards(historyMembers);
        aiGrid.classList.remove("hidden");

        historyMembers.forEach((m, i) => {
            const memberId = `member_${i + 1}`;
            if (m.answer) {
                document.getElementById(`${memberId}-content`).innerHTML = renderMarkdown(m.answer);
            }
        });
        
        // 評価と最終結果の描画
        if (msg.council_result) {
            const evals = msg.council_result.evaluations;
            if (evals) {
                // 新形式（member_1, member_2, member_3）を優先、旧形式（gemini, groq, openrouter）もフォールバック
                const evalKeys = Object.keys(evals);
                evalKeys.forEach(key => {
                    const e = evals[key];
                    if (e) showEvaluation(key, e.accuracy, e.logic, e.practicality, e.reason);
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

            // メンバーベースのデータを既存カラムにマッピング
            // 既存テーブル構造: gemini_ans, groq_ans, openrouter_ans
            const memberAnswers = { gemini_ans: "", groq_ans: "", openrouter_ans: "" };
            if (finalData.members) {
                finalData.members.forEach((m, i) => {
                    // 最初に見つかった各サービスの回答を保存
                    const colName = `${m.service_key}_ans`;
                    if (colName in memberAnswers && !memberAnswers[colName]) {
                        memberAnswers[colName] = m.answer || "";
                    }
                });
                // サービスキーでマッチしなかったメンバーの回答もフォールバック保存
                const cols = ["gemini_ans", "groq_ans", "openrouter_ans"];
                let colIdx = 0;
                finalData.members.forEach(m => {
                    const colName = `${m.service_key}_ans`;
                    if (!(colName in memberAnswers) || memberAnswers[colName]) return;
                    // すでに保存済みなのでスキップ
                });
            }

            // 評価データ（新形式のmember_1等をそのまま保存）
            const evalData = {};
            if (finalData.members) {
                finalData.members.forEach(m => {
                    evalData[m.id] = m.evaluation || {};
                });
            }

            const { error: msgError } = await supabaseClient
                .from('chat_messages')
                .insert([{
                    session_id: currentSessionId,
                    question: question,
                    gemini_ans: memberAnswers.gemini_ans,
                    groq_ans: memberAnswers.groq_ans,
                    openrouter_ans: memberAnswers.openrouter_ans,
                    council_result: {
                        evaluations: evalData,
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
            toast.style.background = "var(--openrouter-color)";
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
    // 合議構成UI
    // ==========================================
    function updateConfigSummary() {
        const config = getCouncilConfig();
        const summary = document.getElementById("config-summary");
        if (!summary) return;

        const memberNames = config.members.map(m => 
            `<span class="service-name">${SERVICE_INFO[m.service]?.name || m.service}（${ROLE_INFO[m.role]?.name || m.role}）</span>`
        ).join('<span class="separator"> / </span>');
        const chairName = `<span class="service-name">${SERVICE_INFO[config.chair]?.name || config.chair}</span>`;

        summary.innerHTML = `メンバー：${memberNames}<br><span class="arrow">↓</span><br>議長：${chairName}`;
    }

    let tempMembers = [];

    function renderConfigMembers() {
        const container = document.getElementById("config-members-container");
        if (!container) return;
        
        container.innerHTML = "";
        
        tempMembers.forEach((m, i) => {
            const row = document.createElement("div");
            row.className = "config-member-row";
            
            // Service select
            const serviceSelect = document.createElement("select");
            serviceSelect.className = "service-select";
            Object.keys(SERVICE_INFO).forEach(svc => {
                const opt = document.createElement("option");
                opt.value = svc;
                opt.textContent = SERVICE_INFO[svc].name;
                if (svc === m.service) opt.selected = true;
                serviceSelect.appendChild(opt);
            });
            serviceSelect.addEventListener("change", (e) => { tempMembers[i].service = e.target.value; updateApiPrediction(); });
            
            // Role select
            const roleSelect = document.createElement("select");
            roleSelect.className = "role-select";
            Object.keys(ROLE_INFO).forEach(role => {
                const opt = document.createElement("option");
                opt.value = role;
                opt.textContent = ROLE_INFO[role].name;
                if (role === m.role) opt.selected = true;
                roleSelect.appendChild(opt);
            });
            roleSelect.addEventListener("change", (e) => { tempMembers[i].role = e.target.value; });
            
            const label = document.createElement("label");
            label.textContent = `メンバー${i + 1}`;
            
            row.appendChild(label);
            row.appendChild(serviceSelect);
            row.appendChild(roleSelect);
            
            // 削除ボタン (最低3つは維持)
            if (tempMembers.length > 3) {
                const removeBtn = document.createElement("button");
                removeBtn.className = "btn-remove-member";
                removeBtn.textContent = "✖";
                removeBtn.title = "メンバーを削除";
                removeBtn.addEventListener("click", () => {
                    tempMembers.splice(i, 1);
                    renderConfigMembers();
                });
                row.appendChild(removeBtn);
            }
            
            container.appendChild(row);
        });
        
        const btnAdd = document.getElementById("btn-add-member");
        if (btnAdd) {
            btnAdd.style.display = tempMembers.length >= 5 ? "none" : "inline-block";
        }
        
        updateApiPrediction();
    }
    
    function updateApiPrediction() {
        const container = document.getElementById("api-usage-prediction");
        if (!container) return;
        
        const counts = {};
        tempMembers.forEach(m => { counts[m.service] = (counts[m.service] || 0) + 1; });
        const chairSvc = document.getElementById("config-chair")?.value || "gemini";
        counts[chairSvc] = (counts[chairSvc] || 0) + 1;
        
        let html = "<strong>APIリクエスト予定数（1回あたり）</strong><br>";
        Object.keys(counts).forEach(svc => {
            html += `${SERVICE_INFO[svc].name}: ${counts[svc]}回<br>`;
        });
        
        const warnings = [];
        if (counts["gemini"] >= 4) {
            warnings.push("Geminiの呼び出し回数が多いため、無料APIではリクエスト制限（429エラー）が発生しやすくなります。");
        }
        
        if (warnings.length > 0) {
            html += `<div class="warning-text">${warnings.join("<br>")}</div>`;
        }
        
        container.innerHTML = html;
    }

    const btnAddMember = document.getElementById("btn-add-member");
    if (btnAddMember) {
        btnAddMember.addEventListener("click", () => {
            if (tempMembers.length < 5) {
                tempMembers.push({ service: "gemini", role: "basic" });
                renderConfigMembers();
            }
        });
    }

    function syncConfigUI() {
        const config = getCouncilConfig();
        tempMembers = JSON.parse(JSON.stringify(config.members));
        renderConfigMembers();
        
        const ch = document.getElementById("config-chair");
        if (ch) ch.value = config.chair || "gemini";
        
        updateApiPrediction();
    }

    // 初期表示
    updateConfigSummary();
    syncConfigUI();

    document.getElementById("config-chair")?.addEventListener("change", updateApiPrediction);

    // 詳細設定ボタン
    const btnConfigToggle = document.getElementById("btn-config-toggle");
    const advancedConfig = document.getElementById("advanced-config");
    if (btnConfigToggle && advancedConfig) {
        btnConfigToggle.addEventListener("click", () => {
            advancedConfig.classList.toggle("hidden");
            syncConfigUI();
        });
    }

    // 構成保存ボタン
    const btnConfigSave = document.getElementById("btn-config-save");
    if (btnConfigSave) {
        btnConfigSave.addEventListener("click", () => {
            const config = {
                members: tempMembers,
                chair: document.getElementById("config-chair").value
            };
            saveCouncilConfig(config);
            updateConfigSummary();
            advancedConfig.classList.add("hidden");

            // 保存完了トースト
            const toast = document.createElement("div");
            toast.className = "toast";
            toast.textContent = "✅ 合議構成を保存しました";
            document.body.appendChild(toast);
            setTimeout(() => toast.classList.add("show"), 10);
            setTimeout(() => {
                toast.classList.remove("show");
                setTimeout(() => toast.remove(), 300);
            }, 2500);
        });
    }

    // ==========================================
    // AIカード動的生成
    // ==========================================
    function renderAiCards(members) {
        const grid = document.getElementById("ai-grid");
        grid.innerHTML = "";
        members.forEach((m, i) => {
            const memberId = `member_${i + 1}`;
            const info = SERVICE_INFO[m.service] || SERVICE_INFO.gemini;
            const roleName = ROLE_INFO[m.role]?.name || m.role || "基本分析";
            const card = document.createElement("div");
            card.className = `ai-card ${info.theme}`;
            card.id = `${memberId}-card`;
            card.innerHTML = `
                <div class="ai-header">
                    <h2>${info.name}</h2>
                    <span class="ai-model-label">メンバー${i + 1}（${roleName}）</span>
                    <span class="status-badge" id="${memberId}-status">待機中</span>
                </div>
                <div class="ai-content" id="${memberId}-content"></div>
                <div class="ai-evaluation hidden" id="${memberId}-eval">
                    <h4>議長AIの評価</h4>
                    <div class="eval-scores">
                        <div class="eval-score-item">
                            <span class="eval-label">正確性</span>
                            <div class="score-bar"><div class="score-fill ${info.fillClass}" style="width: 0%"></div></div>
                            <span class="score">0/10</span>
                        </div>
                        <div class="eval-score-item">
                            <span class="eval-label">論理性</span>
                            <div class="score-bar"><div class="score-fill ${info.fillClass}" style="width: 0%"></div></div>
                            <span class="score">0/10</span>
                        </div>
                        <div class="eval-score-item">
                            <span class="eval-label">実用性</span>
                            <div class="score-bar"><div class="score-fill ${info.fillClass}" style="width: 0%"></div></div>
                            <span class="score">0/10</span>
                        </div>
                    </div>
                    <div class="eval-reason"></div>
                </div>
            `;
            grid.appendChild(card);
        });
    }

    // ==========================================
    // 初回オンボーディング (Magi system起動処理)
    // ==========================================
    const onboardingModal = document.getElementById("onboarding-modal");
    const btnSkipOnboarding = document.getElementById("btn-skip-onboarding");
    const btnStartSetup = document.getElementById("btn-start-setup");

    // 起動時にキーが一つも無ければオンボーディングを表示
    if (!Object.values(getApiKeys()).some(v => v) && !sessionStorage.getItem("magi_onboarding_skipped")) {
        onboardingModal.classList.remove("hidden");
    }

    btnSkipOnboarding.addEventListener("click", () => {
        sessionStorage.setItem("magi_onboarding_skipped", "true");
        onboardingModal.classList.add("hidden");
    });

    btnStartSetup.addEventListener("click", () => {
        onboardingModal.classList.add("hidden");
        const keys = getApiKeys();
        document.getElementById("setting-gemini-key").value = keys.gemini_api_key || "";
        document.getElementById("setting-groq-key").value = keys.groq_api_key || "";
        document.getElementById("setting-openrouter-key").value = keys.openrouter_api_key || "";
        document.getElementById("settings-modal").classList.remove("hidden");
    });

    // ==========================================
    // 合議開始ボタン
    // ==========================================
    submitButton.addEventListener("click", async () => {
        const question = questionInput.value.trim();
        if (!question) {
            alert("質問を入力してください。");
            return;
        }

        const config = getCouncilConfig();
        const apiKeys = getApiKeys();

        // APIキー不足の警告チェック（.envフォールバックがあるため警告のみ）
        const requiredServices = [...new Set([...config.members, config.chair])];
        const missingServices = requiredServices.filter(s => !apiKeys[`${s}_api_key`]);
        if (missingServices.length > 0) {
            const names = missingServices.map(s => SERVICE_INFO[s]?.name || s).join(", ");
            const proceed = confirm(
                `${names} のAPIキーが設定されていません。\n\nサーバー側に.envの設定がある場合は動作します。\n続行しますか？`
            );
            if (!proceed) return;
        }

        // 初期化・UI変更
        submitButton.disabled = true;
        submitButton.textContent = "処理中...";
        
        // 合議構成に基づいてAIカードを動的生成
        renderAiCards(config.members);
        aiGrid.classList.remove("hidden");
        finalAnswerArea.classList.add("hidden");
        councilProcessArea.classList.add("hidden");
        
        // UIステータスを「AI回答生成中」に
        updateStep(1);
        
        // 全メンバーをローディング状態に
        config.members.forEach((m, i) => {
            const memberId = `member_${i + 1}`;
            setAiStatus(memberId, "loading", "回答生成中...");
        });

        // 合議プロセスフローをリセット
        resetFlowSteps();

        try {
            // バックエンドAPIへリクエスト送信（APIキー + 構成を含む）
            const response = await fetch('/api/council', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    question: question,
                    ...apiKeys,
                    members: config.members,
                    chair: config.chair
                })
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

            // メンバーの完了状態を管理（動的）
            const memberStatus = {};
            config.members.forEach((_, i) => { memberStatus[`member_${i+1}`] = false; });

            // SSE ストリーム読み込み
            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";
            let finalData = null;

            councilProcessArea.classList.remove("hidden");
            
            // 合議プロセスの収集状況を動的生成
            setFlowStep("collect", "active", "⏳ 待機中");
            const collectDetails = document.getElementById("details-collect");
            collectDetails.innerHTML = config.members.map((m, i) => {
                const name = SERVICE_INFO[m.service]?.name || m.service;
                return `<div id="ai-collect-member_${i+1}">${name} (メンバー${i+1})：⏳ 待機中</div>`;
            }).join("");
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
                                const memberId = event.id || event.ai; // "member_1", "member_2", etc.
                                setAiStatus(memberId, "loading", event.message || "回答生成中...");
                                const collectEl = document.getElementById(`ai-collect-${memberId}`);
                                if (collectEl) {
                                    const idx = parseInt(memberId.split("_")[1]) - 1;
                                    const svc = config.members[idx]?.service || config.members[idx];
                                    const svcName = SERVICE_INFO[svc]?.name || svc;
                                    collectEl.innerHTML = `${svcName} (メンバー${idx+1})：🔄 ${event.message || "回答生成中..."}`;
                                }
                            } 
                            else if (event.type === "AI_END") {
                                const memberId = event.id || event.ai;
                                memberStatus[memberId] = true;
                                if (event.success) {
                                    setAiStatus(memberId, "done", event.message || "完了");
                                    const collectEl = document.getElementById(`ai-collect-${memberId}`);
                                    if (collectEl) {
                                        const idx = parseInt(memberId.split("_")[1]) - 1;
                                        const svc = config.members[idx]?.service || config.members[idx];
                                        const svcName = SERVICE_INFO[svc]?.name || svc;
                                        collectEl.innerHTML = `${svcName} (メンバー${idx+1})：✅ ${event.message || "完了"}`;
                                    }
                                } else {
                                    setAiStatus(memberId, "error", event.message || "エラー");
                                    const collectEl = document.getElementById(`ai-collect-${memberId}`);
                                    if (collectEl) {
                                        const idx = parseInt(memberId.split("_")[1]) - 1;
                                        const svc = config.members[idx]?.service || config.members[idx];
                                        const svcName = SERVICE_INFO[svc]?.name || svc;
                                        collectEl.innerHTML = `${svcName} (メンバー${idx+1})：⚠️ ${event.message || "エラー"}`;
                                    }
                                    const contentEl = document.getElementById(`${memberId}-content`);
                                    if (contentEl && event.error) contentEl.innerHTML = renderMarkdown(event.error);
                                }
                                
                                // すべて完了したら表示を更新
                                if (Object.values(memberStatus).every(v => v)) {
                                    stopTimer();
                                    document.querySelector("#flow-collect .flow-status").innerHTML = `✅ 完了 (${currentSeconds}秒)`;
                                }
                            }
                            else if (event.type === "AI_RATE_LIMIT") {
                                const memberId = event.id || event.ai;
                                setAiStatus(memberId, "loading", `待機中 (${event.retry_after}s)...`);
                                const collectEl = document.getElementById(`ai-collect-${memberId}`);
                                if (collectEl) {
                                    const idx = parseInt(memberId.split("_")[1]) - 1;
                                    const svc = config.members[idx]?.service || config.members[idx];
                                    const svcName = SERVICE_INFO[svc]?.name || svc;
                                    collectEl.innerHTML = `${svcName} (メンバー${idx+1})：⚠️ API制限のため待機中...`;
                                }
                            }
                            else if (event.type === "AI_QUOTA_EXHAUSTED") {
                                const memberId = event.id || event.ai;
                                setAiStatus(memberId, "error", "利用上限超過");
                            }
                            else if (event.type === "COUNCIL_START") {
                                setFlowStep("evaluate", "active", event.message || "🔄 処理中...");
                                startTimer("#flow-evaluate .flow-status");
                                document.getElementById("details-evaluate").innerHTML = event.message || `
                                    議長AIが処理しています。<br>
                                    ${config.members.length}つのAI回答を比較・分析しています。
                                `;
                            }
                            else if (event.type === "COUNCIL_END") {
                                stopTimer();
                                document.querySelector("#flow-evaluate .flow-status").innerHTML = `✅ 完了 (${currentSeconds}秒)`;
                            }
                            else if (event.type === "COMPLETE") {
                                finalData = event.data;
                            }
                            else if (event.type === "ERROR") {
                                console.error("Server error:", event.message);
                                alert(`サーバーエラー: ${event.message}`);
                            }
                            
                        } catch (e) {
                            console.error("JSON parse error:", e, jsonStr);
                        }
                    }
                }
            }

            if (finalData) {
                // メンバーベースで回答を描画
                if (finalData.members) {
                    finalData.members.forEach(member => {
                        const contentEl = document.getElementById(`${member.id}-content`);
                        if (contentEl && member.answer) {
                            if (member.answer.startsWith("エラー")) {
                                contentEl.innerHTML = `<div style="color: #ef4444; padding: 10px; border-left: 3px solid #ef4444; background: rgba(239, 68, 68, 0.1); margin-top: 10px; font-weight: bold;">${escapeHtml(member.answer)}</div>`;
                                setAiStatus(member.id, "error", "エラー");
                            } else {
                                contentEl.innerHTML = renderMarkdown(member.answer);
                            }
                        }
                        if (member.evaluation) {
                            showEvaluation(member.id, member.evaluation.accuracy, member.evaluation.logic, member.evaluation.practicality, member.evaluation.reason);
                        }
                    });
                }
                
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
            const config = getCouncilConfig();
            config.members.forEach((_, i) => setAiStatus(`member_${i+1}`, "error", "通信エラー"));
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

    function setAiStatus(memberId, state, text) {
        const badge = document.getElementById(`${memberId}-status`);
        if (badge) {
            badge.className = `status-badge ${state}`;
            badge.textContent = text;
        }
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

    function showEvaluation(memberId, acc, log, pra, reason) {
        const evalSection = document.getElementById(`${memberId}-eval`);
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

    function escapeHtml(text) {
        if (!text) return "";
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    function renderMarkdown(text) {
        if (!text) return "<p>回答なし</p>";

        let html = escapeHtml(text);

        html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
        html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
        html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
        html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
        html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
        html = html.replace(/^---$/gm, '<hr>');
        html = html.replace(/\n\n+/g, '</p><p>');
        html = html.replace(/\n/g, '<br>');
        html = '<p>' + html + '</p>';
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
