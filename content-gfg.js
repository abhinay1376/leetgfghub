/**
 * @fileoverview GeeksForGeeks content script (Manifest V3)
 *
 * Detects accepted submissions on geeksforgeeks.org and triggers the commit dialog.
 * Runs at document_idle on https://www.geeksforgeeks.org/*
 *
 * Trigger contract:
 *   - ONLY fires when a NEW accepted result appears in the DOM
 *   - Never fires on WA/TLE/CE or when viewing historical accepted results
 *   - Requires proof of active submission (submit click / pending state)
 *   - Deduplicates using a content-hash stored in sessionStorage
 */
(() => {
  let lastUrl            = location.href;
  let pushed             = false;
  let debounce           = null;
  let seenPendingState   = false;  // Proves this is a live submission, not historical

  // ── Deduplication ─────────────────────────────────────────────────────────
  // GFG does not expose a numeric submission ID in the URL like LeetCode.
  // Instead, we hash (problemSlug + code-snippet) to create a dedup key.

  function _getDedupeKey() {
    // Slug from URL
    const pathParts = location.pathname.split("/").filter(Boolean);
    const slug = [...pathParts].reverse().find(p => !/^\d+$/.test(p)) || "unknown";

    // Grab a snippet of the editor code (first 200 chars) to distinguish re-submissions
    let codeSnippet = "";
    const cmLines = document.querySelectorAll('.CodeMirror-line');
    if (cmLines.length > 0) {
      codeSnippet = Array.from(cmLines).slice(0, 5).map(l => l.innerText).join("").substring(0, 200);
    }
    if (!codeSnippet) {
      const aceLines = document.querySelectorAll('.ace_line');
      if (aceLines.length > 0) {
        codeSnippet = Array.from(aceLines).slice(0, 5).map(l => l.innerText).join("").substring(0, 200);
      }
    }
    if (!codeSnippet) {
      const viewLines = document.querySelectorAll('.view-lines .view-line');
      if (viewLines.length > 0) {
        codeSnippet = Array.from(viewLines).slice(0, 5).map(l => l.innerText).join("").substring(0, 200);
      }
    }

    return slug + "::" + codeSnippet;
  }

  function isAlreadyProcessed(key) {
    if (!key) return false;
    try {
      const seen = JSON.parse(sessionStorage.getItem("_lgfg_gfg_seen") || "[]");
      return seen.includes(key);
    } catch (_) { return false; }
  }

  function markProcessed(key) {
    if (!key) return;
    try {
      const seen = JSON.parse(sessionStorage.getItem("_lgfg_gfg_seen") || "[]");
      if (!seen.includes(key)) {
        seen.push(key);
        // Keep only the last 100 to avoid unbounded growth
        if (seen.length > 100) seen.splice(0, seen.length - 100);
        sessionStorage.setItem("_lgfg_gfg_seen", JSON.stringify(seen));
      }
    } catch (_) {}
  }

  // ── Problem metadata extraction ──────────────────────────────────────────

  function getProblemMeta() {
    // Title — GFG uses various class names across redesigns
    const titleEl =
      document.querySelector('.problems_header_content__title__L2cB2') ||
      document.querySelector('h3.problem-tab__title') ||
      document.querySelector('.problemPageTitle') ||
      document.querySelector('[class*="problem-statement"] h1') ||
      document.querySelector('h1');
    const title = _sanitizeTitle(titleEl?.innerText?.trim() || document.title.split("|")[0].trim());

    // Slug from URL — last non-empty path segment that is NOT digits-only
    // GFG problem URLs: /problems/floor-in-a-sorted-array/1
    const pathParts = location.pathname.split("/").filter(Boolean);
    const slug = [...pathParts].reverse().find(p => !/^\d+$/.test(p)) || "unknown";

    // Difficulty
    const diffEl =
      document.querySelector('.problems_header_content__difficulty__I5R5V') ||
      document.querySelector('[class*="difficulty"]') ||
      document.querySelector('[class*="Difficulty"]');
    const difficulty = diffEl?.innerText?.trim().replace(/difficulty:/i, "").trim() || undefined;

    // Problem URL
    const problemUrl = "https://www.geeksforgeeks.org/problems/" + slug + "/1";

    return { title, slug, difficulty, problemUrl };
  }

  /**
   * Remove trailing status words GFG appends to problem titles.
   * e.g. "Floor In A Sorted Array | Solved" → "Floor In A Sorted Array"
   */
  function _sanitizeTitle(raw) {
    if (!raw) return "Unknown";
    return raw
      .replace(/\s*[|–\-]\s*(solved|accepted|correct|passed|submission|practice).*$/i, "")
      .replace(/\s*(solved|\(solved\)|\[solved\])\s*$/i, "")
      .trim();
  }

  // ── Code extraction (Injected Script) ────────────────────────────────────

  function getCodeFromPageContext() {
    return new Promise((resolve) => {
      // 1. Try to find code block in submission details
      const codeTags = document.querySelectorAll('pre code, .submission-code, [class*="submitted-code"]');
      for (const tag of codeTags) {
        if (tag.innerText.trim().length > 0) {
          return resolve(tag.innerText);
        }
      }

      // 2. Try CodeMirror DOM scraping first (most reliable on GFG)
      const cmLines = document.querySelectorAll('.CodeMirror-line');
      if (cmLines.length > 0) {
        const code = Array.from(cmLines).map(l => l.innerText).join("\n");
        if (code.trim().length > 0) return resolve(code);
      }

      // 3. Try ACE editor DOM
      const aceLines = document.querySelectorAll('.ace_line');
      if (aceLines.length > 0) {
        const code = Array.from(aceLines).map(l => l.innerText).join("\n");
        if (code.trim().length > 0) return resolve(code);
      }

      // 4. Try Monaco view-lines DOM
      const viewLines = document.querySelectorAll('.view-lines .view-line');
      if (viewLines.length > 0) {
        const code = Array.from(viewLines).map(l => l.innerText).join("\n");
        if (code.trim().length > 0) return resolve(code);
      }

      // 5. Ask the MAIN world bridge (src/page-bridge.js) for editor value — no CSP violation
      const eventId = "gfg-code-fetch-" + Date.now() + Math.random().toString(36).substring(2);

      const listener = (event) => {
        if (
          event.data &&
          event.data.source === "DSA_BRIDGE_RESPONSE" &&
          event.data.type === "EDITOR_CODE" &&
          event.data.eventId === eventId
        ) {
          window.removeEventListener("message", listener);
          resolve(event.data.code || "");
        }
      };

      window.addEventListener("message", listener);
      window.postMessage({ source: "DSA_BRIDGE_REQUEST", type: "GET_EDITOR_CODE", eventId }, "*");

      // Fallback timeout
      setTimeout(() => {
        window.removeEventListener("message", listener);
        resolve("");
      }, 2000);
    });
  }

  // ── Language detection ───────────────────────────────────────────────────

  function getLanguage() {
    const langEl =
      document.querySelector('.problems_select_language__2WVxn') ||
      document.querySelector('[class*="language-select"] option:checked') ||
      document.querySelector('.active-lang') ||
      document.querySelector('.ui.dropdown.search.selection > .text');
    const raw = langEl?.innerText?.trim().toLowerCase() || "java";
    const map = { "c++": "cpp", "python": "python", "python3": "python", "java": "java", "javascript": "javascript" };
    return map[raw] || raw || "java";
  }

  // ── Acceptance detection ─────────────────────────────────────────────────

  /**
   * Returns true ONLY if the current submission result shows a definitive
   * "Accepted" / "Correct" verdict AND there is no pending/running state visible.
   */
  function isAccepted() {
    // Guard: if we see any "running" / "compiling" indicators, it's not final yet
    const bodyText = document.body.innerText;
    if (
      bodyText.includes("Running...") ||
      bodyText.includes("Compiling...") ||
      bodyText.includes("Processing...") ||
      bodyText.includes("Submitting...")
    ) {
      return false;
    }

    // Method 1: Look for the known GFG success container classes
    if (document.querySelector('.problems_correct_tab__ZSygD, [class*="successMessage"], [class*="problems_success"], [class*="OutputContainer_success"]')) {
      return true;
    }

    // Method 2: Text-based scan — only trust it when a visible result element is present
    if (
      bodyText.includes("Problem Solved Successfully") ||
      bodyText.includes("Congratulations, you have passed") ||
      bodyText.includes("Your solution is correct") ||
      bodyText.includes("Correct Answer")
    ) {
      const resultArea = document.querySelector('[class*="correct"], [class*="success"], [class*="output"]');
      if (resultArea) {
        const rect = resultArea.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return true;
      }
      return false;
    }

    return false;
  }

  // ── Pending state detection ───────────────────────────────────────────────

  function isPendingState() {
    const bodyText = document.body.innerText;
    return (
      bodyText.includes("Running...") ||
      bodyText.includes("Compiling...") ||
      bodyText.includes("Processing...") ||
      bodyText.includes("Submitting...")
    );
  }

  // ── Submit action detection ───────────────────────────────────────────────
  // Detect when the user clicks Submit on GFG.

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn && !btn.closest('#dsa-pusher-overlay')) {
      const text = btn.textContent.trim().toLowerCase();
      if (text.includes('submit') || text.includes('run & submit')) {
        seenPendingState = true;
      }
    }
    // GFG submit buttons may also be non-button elements
    const submitEl = e.target.closest('[class*="submit"], [class*="Submit"]');
    if (submitEl && !submitEl.closest('#dsa-pusher-overlay')) {
      seenPendingState = true;
    }
  }, true);

  function onProblemPage() {
    return location.pathname.includes("/problems/");
  }

  // ── MutationObserver ─────────────────────────────────────────────────────

  const observer = new MutationObserver(() => {
    const currentUrl = location.href;

    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      pushed  = false;
      seenPendingState = false;  // Reset on navigation to new page
      clearTimeout(debounce);
      debounce = null;
    }

    // Gate 1: must be on a problem page
    if (!onProblemPage()) return;

    // Track pending states — if we see Running.../Compiling..., this is live
    if (isPendingState()) seenPendingState = true;

    // Gate 2: must have proof this is a live submission (not historical)
    if (!seenPendingState) return;

    // Gate 3: must not have already triggered for this URL visit
    if (pushed) return;

    // Gate 4: must show an accepted verdict
    if (!isAccepted()) return;

    // Gate 5: dedup — check if this exact submission was already processed
    const dedupeKey = _getDedupeKey();
    if (isAlreadyProcessed(dedupeKey)) return;

    // Lock immediately to prevent duplicate schedules
    pushed = true;

    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      // Re-verify acceptance after the DOM has settled
      if (!isAccepted()) {
        pushed = false;
        return;
      }

      markProcessed(dedupeKey);

      const meta = getProblemMeta();
      const code = await getCodeFromPageContext();
      if (code && code.trim().length > 0) {
        // Practice Mode gate
        try {
          const pmData = await chrome.storage.local.get(["practiceMode"]);
          if (pmData.practiceMode === true) {
            _showPracticeModeNotice();
            return;
          }
        } catch (_) {}

        showCommitDialog({ ...meta, platform: "gfg", code, language: getLanguage() });
      } else {
        pushed = false;
      }
    }, 2000);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  function _showPracticeModeNotice() {
    if (document.getElementById("dsa-practice-notify")) return;
    const el = document.createElement("div");
    el.id = "dsa-practice-notify";
    el.style.cssText = "position:fixed;bottom:24px;right:24px;background:rgba(28,28,30,0.92);color:#F5F5F7;border-radius:16px;padding:16px 20px;font-family:-apple-system,BlinkMacSystemFont,'Inter',system-ui,sans-serif;font-size:13px;z-index:2147483646;box-shadow:0 8px 32px rgba(0,0,0,0.4);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;gap:12px;max-width:340px;animation:dsaPNIn .4s cubic-bezier(.16,1,.3,1) forwards";
    el.innerHTML = '<style>@keyframes dsaPNIn{0%{opacity:0;transform:translateY(20px)}100%{opacity:1;transform:translateY(0)}}</style><div style="width:36px;height:36px;border-radius:10px;background:rgba(255,214,10,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;border:1px solid rgba(255,214,10,0.3)"><span style="font-size:18px">🎯</span></div><div><div style="font-weight:600;color:#FFD60A;margin-bottom:2px">Practice Mode</div><div style="color:#AEAEB2;font-size:12px;line-height:1.4">Solution detected. GitHub sync skipped.</div></div>';
    document.body.appendChild(el);
    setTimeout(() => { el.style.transition = "opacity .3s,transform .3s"; el.style.opacity = "0"; el.style.transform = "translateY(10px)"; setTimeout(() => el.remove(), 350); }, 4000);
  }
})();
