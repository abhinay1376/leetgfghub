/** @fileoverview LeetGFGHub v3.0 Popup Controller */
import { initTheme } from "./src/theme-service.js";
import { computeAnalytics } from "./src/sync-service.js";

// ── Init ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const msg = (type, data) => chrome.runtime.sendMessage({ type, data });
const toast = (txt, dur = 2500) => {
  const el = $("toast"); el.textContent = txt; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), dur);
};

let STATE = { token: null, user: null, config: {}, repos: [], history: [], selectedRepo: null, lcFolder: null, gfgFolder: null };

async function init() {
  const cfg = await chrome.storage.sync.get(["githubToken","githubUser","lcRepoUrl","gfgRepoUrl","leetcodeFolder","gfgFolder","onboarded","theme"]);
  await initTheme(cfg.theme || "dark");
  STATE.token = cfg.githubToken || null;
  STATE.user = cfg.githubUser || null;
  STATE.config = cfg;
  if (cfg.githubToken && cfg.onboarded) {
    showMain();
  } else {
    const ob = await chrome.storage.local.get(["_obStep"]);
    showOnboarding(ob._obStep || 0);
  }
}

// ── Onboarding ────────────────────────────────────────────────────────────
const TOTAL_STEPS = 7;
let currentStep = 0;

function showOnboarding(step = 0) {
  $("screen-onboarding").classList.add("active");
  $("screen-main").classList.remove("active");
  // Show skip if already configured
  if (STATE.config.githubToken) $("btn-skip-onboarding").classList.remove("hidden");
  buildDots(); goStep(step);
}

function buildDots() {
  const el = $("progress-dots"); el.innerHTML = "";
  for (let i = 0; i < TOTAL_STEPS; i++) {
    const d = document.createElement("div"); d.className = "dot"; d.id = `dot-${i}`; el.appendChild(d);
  }
}

async function goStep(n) {
  document.querySelectorAll(".wizard-step").forEach(s => s.classList.remove("active"));
  const el = $(`step-${n}`); if (el) el.classList.add("active");
  currentStep = n;
  await chrome.storage.local.set({ _obStep: n });
  for (let i = 0; i < TOTAL_STEPS; i++) {
    const d = $(`dot-${i}`);
    if (!d) continue;
    d.className = "dot" + (i < n ? " done" : i === n ? " active" : "");
  }
  if (n === 4) loadRepos();
  if (n === 5) loadFolders("lc");
  if (n === 6) loadFolders("gfg");
  if (n === 7) renderSummary();
}

// Step nav bindings
$("btn-get-started").onclick = () => goStep(1);
$("btn-skip-onboarding").onclick = showMain;
$("btn-open-github").onclick = () => { chrome.tabs.create({ url: "https://github.com/settings/tokens/new?description=LeetGFGHub&scopes=repo" }); goStep(2); };
$("btn-step1-back").onclick = () => goStep(0);
$("btn-step1-next").onclick = () => goStep(2);
$("btn-step2-back").onclick = () => goStep(1);
$("btn-step2-next").onclick = () => goStep(3);
$("btn-step3-back").onclick = () => goStep(2);
$("btn-step4-back").onclick = () => goStep(3);
$("btn-step5-back").onclick = () => goStep(4);
$("btn-step6-back").onclick = () => goStep(5);
$("btn-start-syncing").onclick = finishOnboarding;

// Token eye
$("btn-token-eye").onclick = () => {
  const inp = $("token-input");
  inp.type = inp.type === "password" ? "text" : "password";
};

// Paste from clipboard
$("btn-paste-clipboard").onclick = async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) { $("token-input").value = text.trim(); toast("Token pasted!"); }
  } catch { $("token-input").focus(); toast("Paste manually — clipboard access denied"); }
};

// Verify token
$("btn-verify-token").onclick = async () => {
  const token = $("token-input").value.trim();
  if (!token) return setVerifyState("error", "Please enter a token");
  setVerifyState("loading", "Verifying…");
  const res = await msg("VERIFY_PAT", { token });
  if (res?.success) {
    STATE.token = token; STATE.user = res.user;
    await chrome.storage.sync.set({ githubToken: token, githubUser: res.user });
    setVerifyState("success", `Connected as @${res.user.login}`);
    $("verify-avatar").src = res.user.avatarUrl || "";
    $("verify-name").textContent = res.user.name || res.user.login;
    $("verify-login").textContent = "@" + res.user.login;
    $("profile-mini-wrap").classList.remove("hidden");
    setTimeout(() => goStep(4), 1000);
  } else {
    setVerifyState("error", res?.error || "Invalid token. Check permissions.");
  }
};

function setVerifyState(type, text) {
  const el = $("verify-state"); el.className = `verify-state ${type}`; el.classList.remove("hidden");
  const icons = { loading: `<div class="spinner spinner-sm"></div>`, success: "✅", error: "❌" };
  el.innerHTML = `${icons[type]}<span>${text}</span>`;
}

// ── Repo Picker ───────────────────────────────────────────────────────────
async function loadRepos() {
  $("repo-list").innerHTML = `<div class="picker-empty"><div class="spinner" style="margin:0 auto 8px"></div>Loading…</div>`;
  const res = await msg("LIST_USER_REPOS");
  if (!res?.success) { $("repo-list").innerHTML = `<div class="picker-empty text-red">${res?.error || "Failed"}</div>`; return; }
  STATE.repos = res.repos || [];
  renderRepoList(STATE.repos);
  $("repo-search").oninput = e => renderRepoList(STATE.repos.filter(r => r.name.toLowerCase().includes(e.target.value.toLowerCase())));
}

function renderRepoList(repos) {
  const el = $("repo-list");
  if (!repos.length) { el.innerHTML = `<div class="picker-empty">No repositories found</div>`; return; }
  el.innerHTML = repos.map(r => `
    <div class="picker-item" data-repo='${JSON.stringify(r)}' role="button" tabindex="0" aria-label="${r.fullName}">
      <div class="picker-item-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
      <div class="flex-1 truncate"><div class="text-semi truncate" style="font-size:13px">${r.name}</div><div class="caption truncate">${r.fullName}</div></div>
      ${r.private ? `<span class="badge badge-muted lock-icon">Private</span>` : ""}
    </div>`).join("");
  el.querySelectorAll(".picker-item").forEach(item => {
    const select = () => {
      el.querySelectorAll(".picker-item").forEach(i => i.classList.remove("selected"));
      item.classList.add("selected");
      STATE.selectedRepo = JSON.parse(item.dataset.repo);
      $("btn-step4-next").disabled = false;
    };
    item.onclick = select; item.onkeydown = e => e.key === "Enter" && select();
  });
}

$("btn-step4-next").onclick = async () => {
  if (!STATE.selectedRepo) return;
  const r = STATE.selectedRepo;
  await chrome.storage.sync.set({ lcRepoUrl: `https://github.com/${r.fullName}`, gfgRepoUrl: `https://github.com/${r.fullName}`, repoName: r.name, selectedRepo: r });
  STATE.config = { ...STATE.config, lcRepoUrl: `https://github.com/${r.fullName}`, gfgRepoUrl: `https://github.com/${r.fullName}` };
  goStep(5);
};

// ── Folder Picker ─────────────────────────────────────────────────────────
async function loadFolders(platform) {
  const listId = platform === "lc" ? "lc-folder-list" : "gfg-folder-list";
  const nextBtn = platform === "lc" ? "btn-step5-next" : "btn-step6-next";
  $(listId).innerHTML = `<div class="picker-empty"><div class="spinner" style="margin:0 auto 8px"></div>Loading…</div>`;
  if (!STATE.selectedRepo) { $(listId).innerHTML = `<div class="picker-empty">No repo selected</div>`; return; }
  const { owner, name: repo } = STATE.selectedRepo;
  const res = await msg("LIST_REPO_FOLDERS_V2", { owner, repo });
  const folders = res?.folders || [];
  renderFolderList(listId, nextBtn, platform, folders);
}

function renderFolderList(listId, nextBtnId, platform, folders) {
  const el = $(listId);
  if (!folders.length) { el.innerHTML = `<div class="picker-empty">No folders found — create one below</div>`; $(nextBtnId).disabled = true; return; }
  el.innerHTML = folders.map(f => `
    <div class="picker-item" data-folder="${f}" role="button" tabindex="0" aria-label="${f}">
      <div class="picker-item-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
      <div class="text-semi" style="font-size:13px">${f}</div>
    </div>`).join("");
  el.querySelectorAll(".picker-item").forEach(item => {
    const select = () => {
      el.querySelectorAll(".picker-item").forEach(i => i.classList.remove("selected"));
      item.classList.add("selected");
      if (platform === "lc") STATE.lcFolder = item.dataset.folder;
      else STATE.gfgFolder = item.dataset.folder;
      $(nextBtnId).disabled = false;
    };
    item.onclick = select; item.onkeydown = e => e.key === "Enter" && select();
  });
}

// New folder inputs
$("btn-lc-new-folder").onclick = () => { $("lc-new-folder-row").classList.toggle("hidden"); $("lc-new-folder-input").focus(); };
$("btn-lc-create-folder").onclick = () => { const v = $("lc-new-folder-input").value.trim(); if (v) { STATE.lcFolder = v; $("btn-step5-next").disabled = false; toast(`Folder "${v}" will be created on first push`); } };
$("btn-gfg-new-folder").onclick = () => { $("gfg-new-folder-row").classList.toggle("hidden"); $("gfg-new-folder-input").focus(); };
$("btn-gfg-create-folder").onclick = () => { const v = $("gfg-new-folder-input").value.trim(); if (v) { STATE.gfgFolder = v; $("btn-step6-next").disabled = false; toast(`Folder "${v}" will be created on first push`); } };

$("btn-step5-next").onclick = async () => {
  if (!STATE.lcFolder) return;
  await chrome.storage.sync.set({ leetcodeFolder: STATE.lcFolder });
  goStep(6);
};
$("btn-step6-next").onclick = async () => {
  if (!STATE.gfgFolder) return;
  await chrome.storage.sync.set({ gfgFolder: STATE.gfgFolder });
  goStep(7);
};

function renderSummary() {
  const r = STATE.selectedRepo || {};
  $("setup-summary").innerHTML = `
    <div class="row-between"><span class="caption">GitHub Account</span><span class="text-semi" style="font-size:13px">@${STATE.user?.login || "—"}</span></div>
    <div class="divider"></div>
    <div class="row-between"><span class="caption">Repository</span><span class="text-semi truncate" style="font-size:13px;max-width:160px">${r.fullName || "—"}</span></div>
    <div class="divider"></div>
    <div class="row-between"><span class="caption">LeetCode Folder</span><span class="badge badge-lc">${STATE.lcFolder || "—"}</span></div>
    <div class="divider"></div>
    <div class="row-between"><span class="caption">GFG Folder</span><span class="badge badge-gfg">${STATE.gfgFolder || "—"}</span></div>`;
}

async function finishOnboarding() {
  await chrome.storage.sync.set({ onboarded: true });
  await chrome.storage.local.remove(["_obStep"]);
  showMain();
}

// ── Main App ──────────────────────────────────────────────────────────────
function showMain() {
  $("screen-onboarding").classList.remove("active");
  $("screen-main").classList.add("active");
  loadDashboard(); loadHistory(); renderProjects(); renderSettings();
}

// Nav
document.querySelectorAll(".nav-item").forEach(btn => {
  btn.onclick = () => {
    const page = btn.dataset.page;
    document.querySelectorAll(".nav-item").forEach(b => { b.classList.remove("active"); b.removeAttribute("aria-current"); });
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    btn.classList.add("active"); btn.setAttribute("aria-current", "page");
    $(`page-${page}`).classList.add("active");
    $("page-title").textContent = { dashboard: "Dashboard", history: "History", projects: "Projects", settings: "Settings" }[page] || page;
  };
});

// ── Dashboard ─────────────────────────────────────────────────────────────
async function loadDashboard() {
  const data = await chrome.storage.local.get(["pushHistory"]);
  const history = data.pushHistory || [];
  const stats = computeAnalytics(history);
  const el = $("dashboard-content");
  const lc = stats.leetcode, gfg = stats.gfg;
  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-val" style="color:var(--orange)">🔥 ${stats.currentStreak}</div>
        <div class="stat-label">Current Streak</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">🏆 ${stats.longestStreak}</div>
        <div class="stat-label">Longest Streak</div>
      </div>
      <div class="stat-card stat-wide">
        <div class="row-between" style="margin-bottom:8px">
          <div><div class="stat-val">${stats.totalSolved}</div><div class="stat-label">Total Solved</div></div>
          <div class="row row-2">
            <span class="badge badge-lc">LC ${lc}</span>
            <span class="badge badge-gfg">GFG ${gfg}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="diff-row">
      <div class="diff-chip"><div class="val text-green">${stats.easy}</div><div class="lbl text-green">Easy</div></div>
      <div class="diff-chip"><div class="val text-orange">${stats.medium}</div><div class="lbl text-orange">Medium</div></div>
      <div class="diff-chip"><div class="val text-red">${stats.hard}</div><div class="lbl text-red">Hard</div></div>
    </div>
    <div>
      <div class="label">Activity</div>
      <div class="card">${renderHeatmap(stats.solvedDates)}</div>
    </div>
    <div>
      <div class="label">Recent</div>
      <div class="card">${renderRecent(history.slice(-5).reverse())}</div>
    </div>`;
}

function renderHeatmap(dates) {
  const set = new Set(dates);
  const today = new Date(); today.setHours(0,0,0,0);
  const cells = [];
  for (let i = 51; i >= 0; i--) {
    const col = [];
    for (let d = 6; d >= 0; d--) {
      const dt = new Date(today); dt.setDate(dt.getDate() - (i * 7 + d));
      const key = dt.toISOString().split("T")[0];
      col.push(`<div class="heatmap-cell${set.has(key) ? " l4" : ""}" title="${key}"></div>`);
    }
    cells.push(`<div class="heatmap-col">${col.join("")}</div>`);
  }
  return `<div class="heatmap-wrap">${cells.join("")}</div>`;
}

function renderRecent(items) {
  if (!items.length) return `<div class="caption text-center" style="padding:12px">No solutions yet</div>`;
  return items.map(e => {
    const color = e.platform === "leetcode" ? "var(--lc)" : "var(--gfg)";
    const diff = { easy: "badge-green", medium: "badge-orange", hard: "badge-red" }[(e.difficulty||"").toLowerCase()] || "badge-muted";
    return `<div class="activity-item">
      <div class="activity-dot" style="background:${color}"></div>
      <div class="flex-1 truncate"><div class="text-semi truncate" style="font-size:13px">${e.title||e.slug}</div></div>
      ${e.difficulty ? `<span class="badge ${diff}" style="font-size:10px">${e.difficulty}</span>` : ""}
    </div>`;
  }).join("");
}

// ── History ───────────────────────────────────────────────────────────────
async function loadHistory() {
  const data = await chrome.storage.local.get(["pushHistory"]);
  STATE.history = (data.pushHistory || []).reverse();
  renderHistoryList(STATE.history);
  $("history-search").oninput = e => {
    const q = e.target.value.toLowerCase();
    renderHistoryList(STATE.history.filter(h => (h.title||h.slug||"").toLowerCase().includes(q)));
  };
}

function renderHistoryList(items) {
  const el = $("history-list");
  if (!items.length) { el.innerHTML = `<div class="picker-empty">No history yet</div>`; return; }
  el.innerHTML = items.map(e => {
    const plat = e.platform === "leetcode" ? { label: "LC", bg: "var(--lc-m)", col: "var(--lc)" } : { label: "GFG", bg: "var(--gfg-m)", col: "var(--gfg)" };
    const diff = { easy: "badge-green", medium: "badge-orange", hard: "badge-red" }[(e.difficulty||"").toLowerCase()] || "badge-muted";
    const date = e.timestamp ? new Date(e.timestamp).toLocaleDateString("en-IN", { month: "short", day: "numeric" }) : "";
    return `<div class="history-item">
      <div class="history-icon" style="background:${plat.bg};color:${plat.col}">${plat.label}</div>
      <div class="flex-1 truncate">
        <div class="text-semi truncate" style="font-size:13px">${e.title||e.slug}</div>
        <div class="caption">${date} · ${e.language||""}</div>
      </div>
      ${e.difficulty ? `<span class="badge ${diff}" style="font-size:10px">${e.difficulty}</span>` : ""}
    </div>`;
  }).join("");
}

// ── Projects ──────────────────────────────────────────────────────────────
async function renderProjects() {
  const cfg = await chrome.storage.sync.get(["lcRepoUrl","gfgRepoUrl","leetcodeFolder","gfgFolder","selectedRepo"]);
  const repo = cfg.selectedRepo || {};
  $("projects-content").innerHTML = `
    <div class="repo-hero stack stack-3">
      <div class="row-between">
        <div>
          <div class="text-semi">${repo.fullName || "No repository"}</div>
          <div class="caption mt-1">Branch: ${repo.branch || "main"}</div>
        </div>
        <span class="badge ${repo.private ? "badge-muted" : "badge-blue"}">${repo.private ? "Private" : "Public"}</span>
      </div>
      ${cfg.leetcodeFolder ? `<div class="row-between"><span class="caption">LeetCode Folder</span><span class="badge badge-lc">${cfg.leetcodeFolder}</span></div>` : ""}
      ${cfg.gfgFolder ? `<div class="row-between"><span class="caption">GFG Folder</span><span class="badge badge-gfg">${cfg.gfgFolder}</span></div>` : ""}
    </div>
    <div class="stack stack-2">
      <button class="btn btn-ghost btn-full" id="btn-open-repo">Open Repository ↗</button>
      <button class="btn btn-ghost btn-full" id="btn-change-repo">Change Repository</button>
    </div>`;
  $("btn-open-repo")?.addEventListener("click", () => repo.fullName && chrome.tabs.create({ url: `https://github.com/${repo.fullName}` }));
  $("btn-change-repo")?.addEventListener("click", () => { showOnboarding(4); });
}

// ── Settings ──────────────────────────────────────────────────────────────
async function renderSettings() {
  const cfg = await chrome.storage.sync.get(["githubUser","githubToken","lcRepoUrl","selectedRepo","theme","onboarded"]);
  const user = cfg.githubUser || {};
  const repo = cfg.selectedRepo || {};
  $("settings-content").innerHTML = `
    <div class="settings-section">
      <div class="settings-section-title">GitHub Account</div>
      <div class="card row row-3" style="margin-bottom:4px">
        <img class="avatar" src="${user.avatarUrl||""}" alt="Avatar" onerror="this.style.display='none'">
        <div class="flex-1"><div class="text-semi" style="font-size:13px">${user.name||"—"}</div><div class="caption">@${user.login||"—"}</div></div>
        <span class="badge badge-green">✓ Connected</span>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Repository</div>
      <div class="settings-row"><div class="settings-row-left"><div class="settings-row-lbl">Repository</div><div class="settings-row-val truncate">${repo.fullName||"Not set"}</div></div></div>
      <div class="settings-row"><div class="settings-row-left"><div class="settings-row-lbl">Branch</div><div class="settings-row-val">${repo.branch||"main"}</div></div></div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Appearance</div>
      <div class="settings-row row-between">
        <div class="settings-row-left"><div class="settings-row-lbl">Theme</div></div>
        <select id="theme-select" class="input" style="width:120px;padding:6px 10px">
          <option value="dark" ${(cfg.theme||"dark")==="dark"?"selected":""}>Dark</option>
          <option value="light" ${cfg.theme==="light"?"selected":""}>Light</option>
          <option value="system" ${cfg.theme==="system"?"selected":""}>System</option>
        </select>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Actions</div>
      <div class="stack stack-2">
        <button class="btn btn-ghost btn-full" id="btn-generate-token">Generate New Token ↗</button>
        <button class="btn btn-ghost btn-full" id="btn-reconnect">Reconnect GitHub</button>
        <button class="btn btn-danger btn-full" id="btn-disconnect">Disconnect</button>
      </div>
    </div>`;
  $("theme-select").onchange = async e => {
    const { initTheme } = await import("./src/theme-service.js");
    initTheme(e.target.value);
    await chrome.storage.sync.set({ theme: e.target.value });
  };
  $("btn-generate-token").onclick = () => chrome.tabs.create({ url: "https://github.com/settings/tokens/new?description=LeetGFGHub&scopes=repo" });
  $("btn-reconnect").onclick = () => showOnboarding(3);
  $("btn-disconnect").onclick = async () => {
    if (!confirm("Disconnect GitHub? Your local history will be preserved.")) return;
    await chrome.runtime.sendMessage({ type: "AUTH_LOGOUT" });
    await chrome.storage.local.remove(["_obStep"]);
    showOnboarding(0);
  };
}

// ── Sync button ───────────────────────────────────────────────────────────
$("btn-sync-now").onclick = async () => {
  const btn = $("btn-sync-now"); btn.disabled = true;
  btn.querySelector("svg").style.animation = "spin .7s linear infinite";
  const res = await msg("SYNC_FROM_REPO");
  btn.disabled = false; btn.querySelector("svg").style.animation = "";
  if (res?.success) { toast(`Synced ${res.count || 0} solutions`); loadDashboard(); loadHistory(); }
  else toast(res?.error || "Sync failed");
};

init();
