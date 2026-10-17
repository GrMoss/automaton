/**
 * Single-page UI for the web console. No build step, no dependencies.
 * All agent-generated text is rendered with textContent, never innerHTML.
 * (Written without backticks or dollar-brace so it can live in a template literal.)
 */
export const PAGE_HTML = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Automaton Console</title>
<style>
  :root {
    --bg: #f6f7f9; --surface: #ffffff; --line: #e3e6ea; --text: #1b1f24; --muted: #5d6671;
    --accent: #3b5bdb; --ok: #1f8f4e; --warn: #b7791f; --bad: #c0392b; --code: #f0f2f5;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #101216; --surface: #181b21; --line: #2a2f38; --text: #e8eaed; --muted: #9aa3ae;
      --accent: #7c93ff; --ok: #4cc287; --warn: #e0b04f; --bad: #ef7d70; --code: #20242c;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    padding: 14px 16px; background: var(--surface); border-bottom: 1px solid var(--line); }
  header h1 { font-size: 17px; margin: 0; }
  .pill { padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600;
    border: 1px solid var(--line); }
  .pill.running { color: var(--ok); border-color: var(--ok); }
  .pill.sleeping { color: var(--accent); border-color: var(--accent); }
  .pill.low_compute, .pill.critical { color: var(--warn); border-color: var(--warn); }
  .pill.dead { color: var(--bad); border-color: var(--bad); }
  .meta { color: var(--muted); font-size: 12px; }
  .spacer { flex: 1; }
  main { max-width: 1200px; margin: 0 auto; padding: 16px; display: grid; gap: 16px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .stat, .card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; }
  .stat { padding: 12px 14px; }
  .stat .k { color: var(--muted); font-size: 12px; }
  .stat .v { font-size: 22px; font-weight: 650; margin-top: 2px; }
  .cols { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 16px; align-items: start; }
  @media (max-width: 860px) { .cols { grid-template-columns: 1fr; } }
  .card h2 { font-size: 13px; margin: 0; padding: 12px 14px; border-bottom: 1px solid var(--line);
    text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .card .body { padding: 8px 14px 14px; }
  .empty { color: var(--muted); padding: 14px 0; }
  .turn { border-bottom: 1px solid var(--line); padding: 10px 0; }
  .turn:last-child { border-bottom: 0; }
  .turn .top { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; color: var(--muted); font-size: 12px; }
  .turn .think { margin: 6px 0 0; white-space: pre-wrap; word-break: break-word; }
  .tag { background: var(--code); padding: 1px 7px; border-radius: 6px; font-size: 12px; color: var(--text); }
  details { margin-top: 6px; }
  summary { cursor: pointer; color: var(--accent); font-size: 12px; }
  pre { background: var(--code); padding: 8px 10px; border-radius: 8px; overflow-x: auto;
    font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; margin: 6px 0 0; }
  .err { color: var(--bad); }
  textarea { width: 100%; min-height: 84px; resize: vertical; padding: 10px; border-radius: 8px;
    border: 1px solid var(--line); background: var(--bg); color: var(--text); font: inherit; }
  textarea:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button { margin-top: 8px; padding: 8px 16px; border-radius: 8px; border: 0; cursor: pointer;
    background: var(--accent); color: #fff; font: inherit; font-weight: 600; }
  button:disabled { opacity: .5; cursor: default; }
  .row { display: flex; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
  .row:last-child { border-bottom: 0; }
  .deny { color: var(--bad); } .allow { color: var(--ok); } .quarantine { color: var(--warn); }
  .msg { padding: 8px 0; border-bottom: 1px solid var(--line); }
  .msg:last-child { border-bottom: 0; }
  .msg .t { color: var(--muted); font-size: 12px; }
  #status { font-size: 12px; color: var(--muted); margin-left: 10px; }
  .field { display: block; margin: 10px 0; font-size: 12px; color: var(--muted); }
  .field input, .field select { display: block; width: 100%; margin-top: 4px; padding: 8px 10px;
    border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font: inherit; }
  .field input:focus-visible, .field select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .chip { padding: 0 8px; border-radius: 999px; font-size: 11px; border: 1px solid var(--line); margin-left: 6px; }
  .chip.on { color: var(--ok); border-color: var(--ok); }
  button.ghost { background: transparent; color: var(--muted); border: 1px solid var(--line); margin-left: 6px; }
  #setStatus { margin-left: 8px; }
  .steps { list-style: none; padding: 0; margin: 0 0 8px; display: grid; gap: 4px; }
  .steps li { display: flex; gap: 8px; align-items: center; }
  .dot { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--line); display: inline-block; flex: none; }
  .dot.ok { background: var(--ok); border-color: var(--ok); }
  .hidden { display: none !important; }
  button.small { margin: 0; padding: 4px 12px; font-size: 13px; }
  button.danger { background: var(--bad); }
  .or { color: var(--muted); font-size: 12px; margin: 10px 0 2px; }
  #log { max-height: 260px; overflow: auto; }
  .lead { margin: 0 0 8px; color: var(--muted); }
  #banner { display: none; padding: 10px 16px; background: var(--bad); color: #fff; }
</style>
</head>
<body>
<div id="banner"></div>
<header>
  <h1 id="name">Automaton</h1>
  <span id="state" class="pill">...</span>
  <span class="meta" id="model"></span>
  <span class="spacer"></span>
  <span class="pill" id="agentPill">agent: ...</span>
  <button id="agentBtn" class="small" disabled>...</button>
  <span class="meta" id="updated"></span>
</header>
<main>
  <section class="card hidden" id="onboard"><h2>Bắt đầu</h2>
    <div class="body">
      <ol class="steps">
        <li><span class="dot" id="dotCfg"></span><span>1. Tạo cấu hình và ví cho agent</span></li>
        <li><span class="dot" id="dotKey"></span><span>2. Kết nối Conway (API key)</span></li>
        <li><span class="dot" id="dotRun"></span><span>3. Chạy agent</span></li>
      </ol>
      <p class="meta" id="obErr" style="display:none"></p>
      <div id="cfgForm" class="hidden">
        <label class="field">Tên agent
          <input id="obName" type="text" maxlength="64" autocomplete="off" placeholder="vd: my-automaton">
        </label>
        <label class="field">Genesis prompt (nhiệm vụ gốc của agent)
          <textarea id="obGenesis" maxlength="8000" placeholder="Mô tả agent là ai và nên làm gì. Nên chọn nhiệm vụ vô hại."></textarea>
        </label>
        <label class="field">Địa chỉ ví của bạn (creator, 0x...)
          <input id="obCreator" type="text" autocomplete="off" spellcheck="false" placeholder="0x... (dùng ví không có tài sản)">
        </label>
        <label class="field">Anthropic API key (tùy chọn)
          <input id="obAnthropic" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-...">
        </label>
        <label class="field">OpenAI API key (tùy chọn)
          <input id="obOpenai" type="password" autocomplete="off" spellcheck="false" placeholder="sk-...">
        </label>
        <label class="field">Ollama URL (tùy chọn)
          <input id="obOllama" type="text" autocomplete="off" spellcheck="false" placeholder="http://localhost:11434">
        </label>
        <button id="obCreate">Tạo cấu hình &amp; ví</button>
        <p class="meta">Ví mới được tạo trên máy bạn. Hạn mức chi tiêu dùng mặc định (chỉnh trong file cấu hình nếu cần).</p>
      </div>
      <div id="keyForm" class="hidden">
        <p class="lead">Agent cần một Conway API key mới chạy được. Có hai cách:</p>
        <button id="obProvision">Đăng ký tự động với Conway</button>
        <p class="or">hoặc nhập key bạn đã có</p>
        <label class="field">Conway API key
          <input id="obConwayKey" type="password" autocomplete="off" spellcheck="false" placeholder="cnwy_k_...">
        </label>
        <button id="obSaveKey" class="ghost" style="margin-left:0">Lưu key</button>
      </div>
      <div id="runForm" class="hidden">
        <p class="lead">Mọi thứ đã sẵn sàng.</p>
        <button id="obRun">Chạy agent</button>
      </div>
    </div>
  </section>
  <section class="stats" id="stats"></section>
  <div class="cols">
    <section class="card"><h2>Hoạt động gần đây</h2><div class="body" id="turns"></div></section>
    <div style="display:grid; gap:16px">
      <section class="card"><h2>Gửi tin cho agent</h2>
        <div class="body">
          <textarea id="msg" maxlength="4000" placeholder="Nhắn cho agent (với tư cách người tạo)..."></textarea>
          <div><button id="send">Gửi</button><span id="status"></span></div>
        </div>
      </section>
      <section class="card hidden" id="fundCard"><h2>Nạp tiền</h2>
        <div class="body">
          <p class="meta">Địa chỉ ví của agent (mạng <b id="fundNet">Base</b>, token USDC):</p>
          <pre id="fundAddr">...</pre>
          <div><button id="copyAddr" class="small">Sao chép địa chỉ</button>
            <button id="refreshFund" class="small ghost">Làm mới số dư</button>
            <span class="meta" id="fundStatus"></span></div>
          <div class="row"><span>Credit Conway</span><span id="fundCredits">—</span></div>
          <div class="row"><span>USDC trong ví</span><span id="fundUsdc">—</span></div>
          <p class="meta">Chỉ nạp số tiền bạn chấp nhận mất. Sao lưu file ví trước khi nạp (xem lệnh backup). Số dư chỉ cập nhật khi bạn bấm Làm mới.</p>
        </div>
      </section>
      <section class="card"><h2>Cài đặt model &amp; key</h2>
        <div class="body">
          <p class="meta" id="setErr" style="display:none"></p>
          <label class="field">Model dùng cho agent
            <select id="setModel"></select>
          </label>
          <label class="field">Anthropic API key <span class="chip" id="chipAnthropic"></span>
            <input id="setAnthropic" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-... (để trống = giữ nguyên)">
          </label>
          <label class="field">OpenAI API key <span class="chip" id="chipOpenai"></span>
            <input id="setOpenai" type="password" autocomplete="off" spellcheck="false" placeholder="sk-... (để trống = giữ nguyên)">
          </label>
          <label class="field">Ollama URL
            <input id="setOllama" type="text" autocomplete="off" spellcheck="false" placeholder="http://localhost:11434">
          </label>
          <div>
            <button id="saveSettings">Lưu cài đặt</button>
            <button id="clearAnthropic" class="ghost" type="button">Xóa Anthropic key</button>
            <span id="setStatus" class="meta"></span>
          </div>
          <p class="meta">Key chỉ được ghi vào file cấu hình trên máy bạn, không bao giờ hiển thị lại. Cần khởi động lại agent để áp dụng.</p>
        </div>
      </section>
      <section class="card"><h2>Hộp thư</h2><div class="body" id="inbox"></div></section>
      <section class="card"><h2>Quyết định policy</h2><div class="body" id="policy"></div></section>
      <section class="card"><h2>Agent con</h2><div class="body" id="children"></div></section>
    </div>
  </div>
  <section class="card"><h2>Log agent</h2><div class="body"><pre id="log">Chưa có log.</pre></div></section>
</main>
<script>
(function () {
  var token = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  var banner = document.getElementById("banner");

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function fail(message) { banner.style.display = "block"; banner.textContent = message; }
  function cents(n) { return "$" + ((Number(n) || 0) / 100).toFixed(2); }
  function when(s) {
    if (!s) return "";
    var d = new Date(/Z|[+-]\\d\\d:?\\d\\d$/.test(s) ? s : s.replace(" ", "T") + "Z");
    return isNaN(d) ? String(s) : d.toLocaleString();
  }
  function short(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) + "..." : s; }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "x-console-token": token }, opts.headers || {});
    return fetch(path, opts).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error || r.statusText);
        return j;
      });
    });
  }

  function renderStats(o) {
    var box = document.getElementById("stats");
    clear(box);
    var alive = 0, total = 0;
    (o.children || []).forEach(function (c) { total += c.n; if (["dead", "failed", "cleaned_up"].indexOf(c.status) < 0) alive += c.n; });
    var deny = 0, allow = 0;
    (o.policyDecisions || []).forEach(function (d) { if (d.decision === "deny") deny = d.n; if (d.decision === "allow") allow = d.n; });
    [
      ["Số lượt chạy", o.turnCount],
      ["Chi phí hôm nay", cents(o.todayInferenceCostCents)],
      ["Tổng chi phí lượt", cents(o.totalCostCents)],
      ["Tin chờ xử lý", o.pendingInbox],
      ["Policy cho phép / chặn", allow + " / " + deny],
      ["Agent con (sống/tổng)", alive + " / " + total]
    ].forEach(function (p) {
      var s = el("div", "stat");
      s.appendChild(el("div", "k", p[0]));
      s.appendChild(el("div", "v", p[1]));
      box.appendChild(s);
    });
  }

  function renderOverview(o) {
    var c = o.config || {};
    document.getElementById("name").textContent = c.name || "Automaton";
    var st = document.getElementById("state");
    st.textContent = o.agentState;
    st.className = "pill " + o.agentState;
    document.getElementById("model").textContent = [c.inferenceModel, c.walletAddress ? short(c.walletAddress, 12) : ""].filter(Boolean).join(" · ");
    document.getElementById("updated").textContent = "Cập nhật " + new Date().toLocaleTimeString();
    renderStats(o);
  }

  function renderTurns(list) {
    var box = document.getElementById("turns");
    clear(box);
    if (!list.length) { box.appendChild(el("div", "empty", "Chưa có lượt chạy nào.")); return; }
    list.forEach(function (t) {
      var d = el("div", "turn");
      var top = el("div", "top");
      top.appendChild(el("span", "tag", t.state));
      if (t.inputSource) top.appendChild(el("span", "tag", "từ: " + t.inputSource));
      top.appendChild(el("span", "", when(t.timestamp)));
      if (t.costCents) top.appendChild(el("span", "", cents(t.costCents)));
      d.appendChild(top);
      if (t.thinking) d.appendChild(el("p", "think", short(t.thinking, 600)));
      var calls = Array.isArray(t.toolCalls) ? t.toolCalls : [];
      if (calls.length || t.input) {
        var det = document.createElement("details");
        det.appendChild(el("summary", "", calls.length + " tool call" + (calls.length === 1 ? "" : "s") + (t.input ? " · có input" : "")));
        if (t.input) det.appendChild(el("pre", "", short(t.input, 2000)));
        calls.forEach(function (c) {
          var text = c.name + "(" + short(JSON.stringify(c.arguments), 300) + ")";
          det.appendChild(el("pre", "", text));
          if (c.error) det.appendChild(el("pre", "err", c.error));
          else if (c.result) det.appendChild(el("pre", "", short(c.result, 800)));
        });
        d.appendChild(det);
      }
      box.appendChild(d);
    });
  }

  function renderInbox(list) {
    var box = document.getElementById("inbox");
    clear(box);
    if (!list.length) { box.appendChild(el("div", "empty", "Chưa có tin nào.")); return; }
    list.slice(0, 12).forEach(function (m) {
      var d = el("div", "msg");
      d.appendChild(el("div", "t", short(m.fromAddress, 14) + " · " + when(m.receivedAt) + " · " + (m.status || "")));
      d.appendChild(el("div", "", short(m.content, 300)));
      box.appendChild(d);
    });
  }

  function renderPolicy(list) {
    var box = document.getElementById("policy");
    clear(box);
    if (!list.length) { box.appendChild(el("div", "empty", "Chưa có quyết định nào.")); return; }
    list.slice(0, 15).forEach(function (p) {
      var r = el("div", "row");
      r.appendChild(el("span", "", p.toolName));
      r.appendChild(el("span", p.decision, p.decision));
      r.title = p.reason || "";
      box.appendChild(r);
    });
  }

  function renderChildren(list) {
    var box = document.getElementById("children");
    clear(box);
    if (!list.length) { box.appendChild(el("div", "empty", "Chưa có agent con.")); return; }
    list.forEach(function (c) {
      var r = el("div", "row");
      r.appendChild(el("span", "", c.name));
      r.appendChild(el("span", "meta", c.status + " · " + cents(c.fundedAmountCents)));
      box.appendChild(r);
    });
  }

  function refresh() {
    Promise.all([
      api("/api/overview"), api("/api/turns?limit=30"), api("/api/inbox?limit=12"),
      api("/api/policy?limit=15"), api("/api/children"), api("/api/agent/logs?lines=80")
    ]).then(function (r) {
      banner.style.display = "none";
      renderOverview(r[0]); renderTurns(r[1]); renderInbox(r[2]); renderPolicy(r[3]); renderChildren(r[4]);
      renderLog(r[5].log);
      renderAgent(r[0].agentProcess, r[0].setup);
      renderOnboard(r[0].setup, r[0].agentProcess);
      renderFundVisibility(r[0].setup);
    }).catch(function (e) {
      fail(token ? "Không tải được dữ liệu: " + e.message : "Thiếu token. Mở lại bằng đường dẫn in ra ở terminal.");
    });
  }

  var send = document.getElementById("send");
  var msg = document.getElementById("msg");
  var status = document.getElementById("status");
  send.addEventListener("click", function () {
    var content = msg.value.trim();
    if (!content) return;
    send.disabled = true;
    status.textContent = "Đang gửi...";
    api("/api/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content })
    }).then(function () {
      msg.value = "";
      status.textContent = "Đã gửi. Agent sẽ đọc ở lượt kế tiếp.";
      refresh();
    }).catch(function (e) {
      status.textContent = "Lỗi: " + e.message;
    }).then(function () { send.disabled = false; });
  });


  // ─── Onboarding + agent control ──────────────────────────────
  var obErr = document.getElementById("obErr");
  var onboard = document.getElementById("onboard");
  var agentBtn = document.getElementById("agentBtn");
  var agentPill = document.getElementById("agentPill");
  var lastAgent = { running: false };

  function obFail(e) { obErr.style.display = "block"; obErr.className = "err"; obErr.textContent = e.message; }
  function obClear() { obErr.style.display = "none"; }
  function dot(id, on) { document.getElementById(id).className = "dot" + (on ? " ok" : ""); }

  function renderOnboard(setup, agent) {
    var ready = setup.hasConfig && setup.hasConwayKey && agent.running;
    onboard.classList.toggle("hidden", ready);
    dot("dotCfg", setup.hasConfig);
    dot("dotKey", setup.hasConwayKey);
    dot("dotRun", agent.running);
    document.getElementById("cfgForm").classList.toggle("hidden", setup.hasConfig);
    document.getElementById("keyForm").classList.toggle("hidden", !setup.hasConfig || setup.hasConwayKey);
    document.getElementById("runForm").classList.toggle("hidden", !(setup.hasConfig && setup.hasConwayKey && !agent.running));
  }

  function renderAgent(agent, setup) {
    lastAgent = agent;
    agentPill.textContent = agent.running ? "agent: đang chạy" : "agent: đã dừng";
    agentPill.className = "pill " + (agent.running ? "running" : "dead");
    agentBtn.textContent = agent.running ? "Dừng" : "Chạy agent";
    agentBtn.className = "small" + (agent.running ? " danger" : "");
    agentBtn.disabled = !agent.running && !(setup.hasConfig && setup.hasConwayKey);
  }

  function startAgentNow(btn) {
    obClear();
    if (btn) btn.disabled = true;
    return api("/api/agent/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(refresh).catch(obFail).then(function () { if (btn) btn.disabled = false; });
  }

  agentBtn.addEventListener("click", function () {
    agentBtn.disabled = true;
    var p;
    if (lastAgent.running) {
      p = api("/api/agent/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        .then(function (r) {
          if (!r.stopped && confirm("Agent chưa dừng sau vài giây. Buộc dừng ngay?")) {
            return api("/api/agent/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) });
          }
        });
    } else {
      p = api("/api/agent/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    }
    p.then(refresh).catch(function (e) { onboard.classList.remove("hidden"); obFail(e); });
  });

  document.getElementById("obRun").addEventListener("click", function (ev) { startAgentNow(ev.target); });

  document.getElementById("obCreate").addEventListener("click", function (ev) {
    var btn = ev.target;
    obClear();
    btn.disabled = true;
    api("/api/setup/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: document.getElementById("obName").value,
        genesisPrompt: document.getElementById("obGenesis").value,
        creatorAddress: document.getElementById("obCreator").value,
        anthropicApiKey: document.getElementById("obAnthropic").value,
        openaiApiKey: document.getElementById("obOpenai").value,
        ollamaBaseUrl: document.getElementById("obOllama").value
      })
    }).then(function () {
      ["obAnthropic", "obOpenai"].forEach(function (id) { document.getElementById(id).value = ""; });
      refresh(); loadSettings(true);
    }).catch(obFail).then(function () { btn.disabled = false; });
  });

  document.getElementById("obProvision").addEventListener("click", function (ev) {
    var btn = ev.target;
    if (!confirm("Việc này ký một thông điệp bằng ví của agent và gửi tới api.conway.tech để tạo API key. Tiếp tục?")) return;
    obClear();
    btn.disabled = true;
    api("/api/setup/provision", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(refresh).catch(obFail).then(function () { btn.disabled = false; });
  });

  document.getElementById("obSaveKey").addEventListener("click", function (ev) {
    var btn = ev.target;
    var input = document.getElementById("obConwayKey");
    obClear();
    btn.disabled = true;
    api("/api/setup/conway-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: input.value })
    }).then(function () { input.value = ""; refresh(); }).catch(obFail).then(function () { btn.disabled = false; });
  });

  function renderLog(text) {
    var pre = document.getElementById("log");
    var stick = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
    pre.textContent = text || "Chưa có log.";
    if (stick) pre.scrollTop = pre.scrollHeight;
  }


  // ─── Funding ─────────────────────────────────────────────────
  var fundCard = document.getElementById("fundCard");
  var fundShown = false;
  function loadFunding() {
    var st = document.getElementById("fundStatus");
    st.textContent = "Đang đọc...";
    api("/api/funding").then(function (f) {
      document.getElementById("fundAddr").textContent = f.address;
      document.getElementById("fundNet").textContent = f.network;
      document.getElementById("fundCredits").textContent = f.creditsCents === null ? ("không đọc được: " + f.creditsError) : cents(f.creditsCents);
      document.getElementById("fundUsdc").textContent = f.usdc === null ? ("không đọc được: " + f.usdcError) : (Number(f.usdc).toFixed(2) + " USDC");
      st.textContent = "Cập nhật " + new Date().toLocaleTimeString();
    }).catch(function (e) { st.textContent = "Lỗi: " + e.message; });
  }
  document.getElementById("refreshFund").addEventListener("click", loadFunding);
  document.getElementById("copyAddr").addEventListener("click", function () {
    var text = document.getElementById("fundAddr").textContent;
    var st = document.getElementById("fundStatus");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { st.textContent = "Đã sao chép."; },
        function () { st.textContent = "Không sao chép được, hãy chọn và copy thủ công."; });
    } else { st.textContent = "Trình duyệt không cho sao chép, hãy copy thủ công."; }
  });
  function renderFundVisibility(setup) {
    fundCard.classList.toggle("hidden", !setup.hasConfig);
    if (setup.hasConfig && !fundShown) { fundShown = true; loadFunding(); }
  }

  // ─── Settings ────────────────────────────────────────────────
  var setErr = document.getElementById("setErr");
  var setStatus = document.getElementById("setStatus");
  var fAnthropic = document.getElementById("setAnthropic");
  var fOpenai = document.getElementById("setOpenai");
  var fOllama = document.getElementById("setOllama");
  var fModel = document.getElementById("setModel");
  var editing = false; // do not clobber the form while the user is typing

  function chip(id, on) {
    var c = document.getElementById(id);
    c.textContent = on ? "đã cấu hình" : "chưa có";
    c.className = "chip" + (on ? " on" : "");
  }

  function loadSettings(force) {
    if (editing && !force) return;
    api("/api/settings").then(function (s) {
      setErr.style.display = "none";
      chip("chipAnthropic", s.anthropicConfigured);
      chip("chipOpenai", s.openaiConfigured);
      fOllama.value = s.ollamaBaseUrl || "";
      clear(fModel);
      (s.models || []).forEach(function (m) {
        var o = el("option", "", m.displayName + " (" + m.provider + ")");
        o.value = m.modelId;
        if (m.modelId === s.inferenceModel) o.selected = true;
        fModel.appendChild(o);
      });
    }).catch(function (e) {
      setErr.style.display = "block";
      setErr.textContent = e.message;
    });
  }

  [fAnthropic, fOpenai, fOllama, fModel].forEach(function (f) {
    f.addEventListener("input", function () { editing = true; });
  });

  function saveSettings(payload, done) {
    setStatus.textContent = "Đang lưu...";
    api("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function () {
      fAnthropic.value = ""; fOpenai.value = "";
      editing = false;
      setStatus.textContent = "Đã lưu. Khởi động lại agent để áp dụng.";
      loadSettings(true);
    }).catch(function (e) {
      setStatus.textContent = "Lỗi: " + e.message;
    }).then(function () { if (done) done(); });
  }

  var saveBtn = document.getElementById("saveSettings");
  saveBtn.addEventListener("click", function () {
    var payload = { inferenceModel: fModel.value, ollamaBaseUrl: fOllama.value.trim() };
    if (fAnthropic.value.trim()) payload.anthropicApiKey = fAnthropic.value.trim();
    if (fOpenai.value.trim()) payload.openaiApiKey = fOpenai.value.trim();
    saveBtn.disabled = true;
    saveSettings(payload, function () { saveBtn.disabled = false; });
  });
  document.getElementById("clearAnthropic").addEventListener("click", function () {
    if (confirm("Xóa Anthropic key khỏi file cấu hình?")) saveSettings({ anthropicApiKey: null });
  });

  refresh();
  loadSettings(true);
  setInterval(refresh, 5000);
  setInterval(function () { loadSettings(false); }, 15000);
})();
</script>
</body>
</html>`;
