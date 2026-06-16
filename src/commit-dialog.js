/**
 * @fileoverview Shared commit-dialog renderer injected into page DOM.
 * Used by both content-leetcode.js and content-gfg.js.
 * Loaded as a classic script before content scripts.
 *
 * Design: Premium macOS / Apple Vision Pro / Linear inspired glassmorphism.
 */

// ── Path helpers (mirrored from utils.js to avoid import) ──────────────────

function _lcFolderName(number, slug) {
  const padded = String(number || 0).padStart(4, "0");
  // Convert kebab-case slug to Title_Case: "koko-eating-bananas" → "Koko_Eating_Bananas"
  const clean = (slug || "unknown")
    .split(/[-_]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .replace(/^_|_$/g, "");
  return padded + "_" + clean;
}

function _gfgFolderName(title, slug) {
  const source = title || slug || "unknown";
  return source
    .trim()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join("_")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

const _EXT_MAP = {
  java: ".java", python: ".py", python3: ".py", cpp: ".cpp", "c++": ".cpp",
  c: ".c", javascript: ".js", js: ".js", typescript: ".ts", ts: ".ts",
  go: ".go", rust: ".rs", kotlin: ".kt", swift: ".swift", scala: ".scala",
  ruby: ".rb", php: ".php", csharp: ".cs", "c#": ".cs",
};
function _getExt(lang) { return _EXT_MAP[(lang || "").toLowerCase()] || ".java"; }

function _escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Main Dialog ────────────────────────────────────────────────────────────

// Declare globally on window so content scripts can call it
window.showCommitDialog = async function(meta) {
  // Prevent duplicate overlays
  if (document.getElementById("dsa-pusher-overlay")) return;

  // ── Read user's saved config to get the REAL folder names ──────────────
  let folderBase = meta.platform === "leetcode" ? "LeetCode" : "GFG";
  let repoDisplayName = "";
  try {
    const config = await chrome.storage.sync.get([
      "leetcodeFolder", "gfgFolder", "lcRepoUrl", "gfgRepoUrl"
    ]);
    if (meta.platform === "leetcode" && config.leetcodeFolder) {
      folderBase = config.leetcodeFolder;
    } else if (meta.platform === "gfg" && config.gfgFolder) {
      folderBase = config.gfgFolder;
    }
    const repoUrl = meta.platform === "leetcode" ? config.lcRepoUrl : config.gfgRepoUrl;
    if (repoUrl) {
      const match = repoUrl.match(/github\.com\/[^/]+\/([^/\s#?]+)/i);
      if (match) repoDisplayName = match[1].replace(/\.git$/, "");
    }
  } catch (_) { /* fallback to defaults */ }

  const problemFolder = meta.platform === "leetcode"
    ? _lcFolderName(meta.number, meta.slug)
    : _gfgFolderName(meta.title, meta.slug);

  const ext = _getExt(meta.language);

  const platformLabel = meta.platform === "leetcode" ? "LeetCode" : "GeeksForGeeks";
  const problemLabel  = meta.number
    ? `${String(meta.number).padStart(4, "0")}. ${meta.title}`
    : meta.title;

  const defaultMsg = meta.platform === "leetcode"
    ? `feat(leetcode): solve ${meta.number ? "#" + meta.number + " " : ""}${meta.title}`
    : `feat(gfg): solve ${meta.title}`;

  // ── Premium Colors ─────────────────────────────────────────────────────
  // Deep graphite / macOS style colors
  const diffColors = { Easy: "#34C759", Medium: "#FF9F0A", Hard: "#FF453A" }; // Apple system colors
  const diffColor = diffColors[meta.difficulty] || "#8E8E93";
  
  const platformColor = meta.platform === "leetcode" ? "#FFA116" : "#2E8B57";
  const platformBg = meta.platform === "leetcode" ? "rgba(255, 161, 22, 0.15)" : "rgba(46, 139, 87, 0.15)";

  const langNames = {
    java: "Java", python: "Python", python3: "Python 3", cpp: "C++",
    c: "C", javascript: "JavaScript", typescript: "TypeScript",
    go: "Go", rust: "Rust", kotlin: "Kotlin", swift: "Swift",
    csharp: "C#", scala: "Scala", ruby: "Ruby", php: "PHP",
  };
  const langDisplayName = langNames[meta.language] || meta.language || "Java";

  const overlay = document.createElement("div");
  overlay.id = "dsa-pusher-overlay";
  overlay.style.cssText = [
    "position:fixed", "inset:0", "background:rgba(0, 0, 0, 0.4)",
    "z-index:2147483647", "display:flex", "align-items:center",
    "justify-content:center", "font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Inter',system-ui,sans-serif",
    "backdrop-filter:blur(24px) saturate(150%)", "-webkit-backdrop-filter:blur(24px) saturate(150%)",
    "animation: dsaFadeIn 0.3s ease-out forwards"
  ].join(";");

  overlay.innerHTML = `
    <div id="dsa-pusher-card" style="
      background: rgba(30, 30, 32, 0.65);
      color: #F5F5F7;
      border-radius: 24px;
      padding: 32px;
      width: 440px;
      max-width: 92vw;
      box-shadow: 0 24px 48px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.15), 0 0 0 1px rgba(255,255,255,0.08);
      backdrop-filter: blur(40px);
      -webkit-backdrop-filter: blur(40px);
      animation: dsaSpringUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 20px;
    ">
      <style>
        @keyframes dsaFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes dsaSpringUp {
          0% { opacity: 0; transform: scale(0.92) translateY(20px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes dsaCheckDraw { to { stroke-dashoffset: 0; } }
        
        #dsa-pusher-card * { box-sizing: border-box; font-family: -apple-system,BlinkMacSystemFont,'SF Pro Text','Inter',sans-serif; }
        
        /* Premium inputs */
        .dsa-input {
          width: 100%;
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: #F5F5F7;
          border-radius: 12px;
          padding: 12px 14px;
          font-size: 13px;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          outline: none;
        }
        .dsa-input:focus {
          border-color: rgba(255, 255, 255, 0.3);
          background: rgba(0, 0, 0, 0.3);
          box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.05);
        }
        
        /* Buttons */
        .dsa-btn {
          padding: 12px;
          border-radius: 14px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          display: flex; align-items: center; justify-content: center; gap: 8px;
          border: none;
        }
        .dsa-btn-primary {
          background: #F5F5F7;
          color: #1C1C1E;
          box-shadow: 0 2px 8px rgba(255,255,255,0.1);
        }
        .dsa-btn-primary:hover { transform: scale(1.02); background: #FFFFFF; }
        .dsa-btn-primary:active { transform: scale(0.98); }
        .dsa-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        
        .dsa-btn-secondary {
          background: rgba(255, 255, 255, 0.08);
          color: #EBEBF5;
          border: 1px solid rgba(255,255,255,0.05);
        }
        .dsa-btn-secondary:hover { background: rgba(255, 255, 255, 0.12); }
        .dsa-btn-secondary:active { transform: scale(0.98); }
        
        /* Typography */
        .dsa-label {
          display: block; font-size: 11px; font-weight: 600; color: #8E8E93;
          text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;
        }
        .dsa-badge {
          font-size: 11px; font-weight: 600; padding: 4px 10px;
          border-radius: 100px; display: inline-flex; align-items: center; gap: 4px;
        }
      </style>

      <!-- HEADER -->
      <div style="display: flex; align-items: flex-start; gap: 16px;">
        <div style="width: 48px; height: 48px; border-radius: 14px; background: rgba(52, 199, 89, 0.15); display: flex; align-items: center; justify-content: center; border: 1px solid rgba(52, 199, 89, 0.3); flex-shrink: 0;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#34C759" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" style="stroke-dasharray: 50; stroke-dashoffset: 50; animation: dsaCheckDraw 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.2s forwards;"></polyline>
          </svg>
        </div>
        <div style="flex: 1;">
          <div style="font-size: 13px; font-weight: 600; color: #34C759; margin-bottom: 4px;">Accepted</div>
          <h2 style="font-size: 18px; font-weight: 700; color: #F5F5F7; margin: 0; line-height: 1.3; letter-spacing: -0.3px;">
            ${_escapeHtml(problemLabel)}
          </h2>
        </div>
      </div>

      <!-- BADGES -->
      <div style="display: flex; flex-wrap: wrap; gap: 8px;">
        <span class="dsa-badge" style="background: ${platformBg}; color: ${platformColor};">
          ${platformLabel}
        </span>
        ${meta.difficulty ? `<span class="dsa-badge" style="background: ${diffColor}1A; color: ${diffColor};">${meta.difficulty}</span>` : ""}
        <span class="dsa-badge" style="background: rgba(255,255,255,0.08); color: #EBEBF5;">
          ${_escapeHtml(langDisplayName)}
        </span>
      </div>

      <!-- REPO & FILE TREE -->
      <div style="background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 16px;">
        ${repoDisplayName ? `
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.05);">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8E8E93" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
            <span style="font-size: 13px; font-weight: 500; color: #EBEBF5;">${_escapeHtml(repoDisplayName)}</span>
          </div>
        ` : ""}
        <div style="font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.6; color: #8E8E93;">
          <div style="color: #F5F5F7;">${_escapeHtml(folderBase)}/</div>
          <div>└── <span style="color: #F5F5F7;">${_escapeHtml(problemFolder)}/</span></div>
          <div>    ├── <span style="color: #64D2FF;" id="dsa-preview-ext">solution${ext}</span></div>
          <div>    └── <span style="color: #FFD60A;">README.md</span></div>
        </div>
      </div>

      <!-- COMMIT INPUT -->
      <div>
        <span class="dsa-label">Commit Message</span>
        <textarea id="dsa-commit-msg" class="dsa-input" rows="2" style="resize: vertical; font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace; line-height: 1.4;">${defaultMsg}</textarea>
      </div>

      <!-- LANGUAGE SELECT -->
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <span class="dsa-label" style="margin: 0;">Language</span>
        <select id="dsa-lang-select" class="dsa-input" style="width: 140px; padding: 8px 12px; cursor: pointer; appearance: none; background-image: url('data:image/svg+xml;utf8,<svg fill=%22%238E8E93%22 viewBox=%220 0 24 24%22 xmlns=%22http://www.w3.org/2000/svg%22><path d=%22M7 10l5 5 5-5z%22/></svg>'); background-repeat: no-repeat; background-position: right 8px center;">
          <option value="java" ${meta.language === "java" ? "selected" : ""}>Java</option>
          <option value="python" ${meta.language === "python" ? "selected" : ""}>Python</option>
          <option value="python3" ${meta.language === "python3" ? "selected" : ""}>Python 3</option>
          <option value="cpp" ${meta.language === "cpp" ? "selected" : ""}>C++</option>
          <option value="c" ${meta.language === "c" ? "selected" : ""}>C</option>
          <option value="javascript" ${meta.language === "javascript" ? "selected" : ""}>JavaScript</option>
          <option value="typescript" ${meta.language === "typescript" ? "selected" : ""}>TypeScript</option>
          <option value="go" ${meta.language === "go" ? "selected" : ""}>Go</option>
          <option value="rust" ${meta.language === "rust" ? "selected" : ""}>Rust</option>
          <option value="kotlin" ${meta.language === "kotlin" ? "selected" : ""}>Kotlin</option>
          <option value="swift" ${meta.language === "swift" ? "selected" : ""}>Swift</option>
          <option value="csharp" ${meta.language === "csharp" ? "selected" : ""}>C#</option>
        </select>
      </div>

      <!-- ACTIONS -->
      <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 4px;">
        <button id="dsa-push-btn" class="dsa-btn dsa-btn-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
          Push to GitHub
        </button>
        
        <div style="display: flex; gap: 10px;">
          <button id="dsa-skip-btn" class="dsa-btn dsa-btn-secondary" style="flex: 1;">Save for Later</button>
          <button id="dsa-cancel-btn" class="dsa-btn" style="flex: 1; background: transparent; color: #8E8E93;">Cancel</button>
        </div>
      </div>

      <div id="dsa-status" style="font-size: 12px; min-height: 18px; text-align: center; font-weight: 500; color: #8E8E93;"></div>
    </div>
  `;

  document.body.appendChild(overlay);

  // ── Language Change Preview ──────────────────────────────────────────────
  document.getElementById("dsa-lang-select").addEventListener("change", (e) => {
    const extEl = document.getElementById("dsa-preview-ext");
    if (extEl) extEl.textContent = "solution" + _getExt(e.target.value);
  });

  // ── Cancel ────────────────────────────────────────────────────────────────
  document.getElementById("dsa-cancel-btn").onclick = () => {
    overlay.style.animation = "dsaFadeIn 0.2s ease-in reverse forwards";
    setTimeout(() => overlay.remove(), 200);
  };

  // ── Save for Later ────────────────────────────────────────────────────────
  document.getElementById("dsa-skip-btn").onclick = async () => {
    await storePending(meta);
    overlay.style.animation = "dsaFadeIn 0.2s ease-in reverse forwards";
    setTimeout(() => overlay.remove(), 200);
  };

  // ── Push ──────────────────────────────────────────────────────────────────
  document.getElementById("dsa-push-btn").onclick = async () => {
    const commitMessage = document.getElementById("dsa-commit-msg").value.trim();
    const language      = document.getElementById("dsa-lang-select").value;
    const statusEl      = document.getElementById("dsa-status");
    const btn           = document.getElementById("dsa-push-btn");

    if (!commitMessage) {
      setStatus(statusEl, "Commit message required.", "#FF9F0A");
      return;
    }

    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg> Pushing...`;
    btn.disabled  = true;
    setStatus(statusEl, "Connecting to GitHub...", "#64D2FF");
    
    // Add spin keyframe to document if missing
    if (!document.getElementById("dsa-spin-style")) {
      const style = document.createElement("style");
      style.id = "dsa-spin-style";
      style.textContent = "@keyframes spin { 100% { transform: rotate(360deg); } }";
      document.head.appendChild(style);
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "PUSH_TO_GITHUB",
        data: {
          platform:       meta.platform,
          problemNumber:  meta.number,
          problemSlug:    meta.slug,
          problemTitle:   meta.title,
          problemUrl:     meta.problemUrl,
          difficulty:     meta.difficulty,
          code:           meta.code,
          commitMessage,
          language,
        },
      });

      if (response?.success) {
        setStatus(statusEl, "Successfully pushed to GitHub!", "#34C759");
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34C759" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Done`;
        
        // Show success animation state
        const card = document.getElementById("dsa-pusher-card");
        card.style.transform = "scale(1.02)";
        card.style.boxShadow = "0 24px 48px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.15), 0 0 0 1px rgba(52, 199, 89, 0.4)";
        setTimeout(() => {
          overlay.style.animation = "dsaFadeIn 0.3s ease-in reverse forwards";
          setTimeout(() => overlay.remove(), 300);
        }, 2000);
      } else {
        setStatus(statusEl, response?.error || "Push failed.", "#FF453A");
        btn.innerHTML = "Push to GitHub";
        btn.disabled  = false;
      }
    } catch (e) {
      setStatus(statusEl, e.message, "#FF453A");
      btn.innerHTML = "Push to GitHub";
      btn.disabled  = false;
    }
  };

  // Close on backdrop click
  overlay.addEventListener("click", e => {
    const btn = document.getElementById("dsa-push-btn");
    if (e.target === overlay && !btn.disabled) {
      overlay.style.animation = "dsaFadeIn 0.2s ease-in reverse forwards";
      setTimeout(() => overlay.remove(), 200);
    }
  });
};

function setStatus(el, msg, color) {
  el.textContent = msg;
  el.style.color = color || "#8E8E93";
}

async function storePending(meta) {
  try {
    const data = await chrome.storage.local.get(["pendingPushes"]);
    const pending = data.pendingPushes || [];
    const exists = pending.some(p => p.platform === meta.platform && p.slug === meta.slug);
    if (!exists) {
      pending.push({
        platform: meta.platform,
        number: meta.number,
        slug: meta.slug,
        title: meta.title,
        difficulty: meta.difficulty,
        problemUrl: meta.problemUrl,
        code: meta.code,
        language: meta.language,
        timestamp: Date.now()
      });
      if (pending.length > 50) pending.splice(0, pending.length - 50);
      await chrome.storage.local.set({ pendingPushes: pending });
    }
  } catch (_) {}
}
