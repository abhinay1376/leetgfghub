/**
 * @fileoverview LeetCode content script (Manifest V3)
 *
 * Detects accepted submissions on leetcode.com and triggers the commit dialog.
 * Runs at document_idle on https://leetcode.com/problems/*
 *
 * Trigger contract:
 *   - ONLY fires when a NEW submission transitions to "Accepted"
 *   - Never fires when viewing history, refreshing, old submissions, or on WA/TLE
 *   - Requires proof of active submission (pending state / submit click / SPA nav)
 *   - Deduplicates using submissionId stored in sessionStorage
 */
(() => {
  let lastUrl            = location.href;
  let pushed             = false;
  let debounce           = null;
  let seenPendingState   = false;  // Proves this is a live submission, not historical

  // ── Submission ID extraction ──────────────────────────────────────────────
  // LeetCode URLs for a submission result look like:
  //   /problems/two-sum/submissions/1234567890/
  // We use the numeric submission ID as our dedup key.

  function getSubmissionIdFromUrl() {
    const m = location.pathname.match(/\/submissions\/(\d+)\/?$/);
    return m ? m[1] : null;
  }

  /**
   * Returns true if this exact submissionId has already been processed
   * in this browsing session.
   */
  function isAlreadyProcessed(submissionId) {
    if (!submissionId) return false;
    try {
      const seen = JSON.parse(sessionStorage.getItem("_lgfg_lc_seen") || "[]");
      return seen.includes(submissionId);
    } catch (_) { return false; }
  }

  function markProcessed(submissionId) {
    if (!submissionId) return;
    try {
      const seen = JSON.parse(sessionStorage.getItem("_lgfg_lc_seen") || "[]");
      if (!seen.includes(submissionId)) {
        seen.push(submissionId);
        // Keep only the last 200 to avoid unbounded growth
        if (seen.length > 200) seen.splice(0, seen.length - 200);
        sessionStorage.setItem("_lgfg_lc_seen", JSON.stringify(seen));
      }
    } catch (_) {}
  }

  // ── URL / page type guards ────────────────────────────────────────────────

  /**
   * We only care about the specific submission detail page:
   *   /problems/<slug>/submissions/<id>/
   *
   * We explicitly reject:
   *   /submissions           (history list)
   *   /submissions/          (history list)
   *   /submissions?...       (history list with filters)
   */
  function isSubmissionResultPage() {
    return /\/problems\/[^/]+\/submissions\/\d+\/?$/.test(location.pathname);
  }

  // ── Problem metadata extraction ───────────────────────────────────────────

  function getProblemNumber() {
    // Strategy 1: Title element with "123. Title" format (works on problem pages)
    const titleEl =
      document.querySelector('[data-cy="question-title"]') ||
      document.querySelector('.mr-2.text-label-1');
    if (titleEl) {
      const m = titleEl.innerText?.trim().match(/^(\d+)\./);
      if (m) return parseInt(m[1]);
    }

    // Strategy 2: __NEXT_DATA__ JSON — try multiple known paths
    // LeetCode embeds problem data in different locations depending on the page type
    try {
      const ndScript = document.getElementById("__NEXT_DATA__");
      if (ndScript) {
        const nd = JSON.parse(ndScript.textContent);
        // Path A: Direct question data (problem page)
        const q1 = nd?.props?.pageProps?.dehydratedState?.queries?.[0]?.state?.data?.question;
        if (q1?.questionFrontendId) return parseInt(q1.questionFrontendId);
        // Path B: Alternative question structure
        const q2 = nd?.props?.pageProps?.question;
        if (q2?.questionFrontendId) return parseInt(q2.questionFrontendId);
        // Path C: Search all dehydrated queries (submission pages store data in different indices)
        const queries = nd?.props?.pageProps?.dehydratedState?.queries;
        if (Array.isArray(queries)) {
          for (const q of queries) {
            const fid = q?.state?.data?.question?.questionFrontendId ||
                        q?.state?.data?.submissionDetails?.question?.questionFrontendId;
            if (fid) return parseInt(fid);
          }
        }
      }
    } catch (_) {}

    // Strategy 3: document.title — "123. Two Sum - LeetCode" or "Two Sum - LeetCode"
    const titleMatch = document.title.match(/^(\d+)\.\s/);
    if (titleMatch) return parseInt(titleMatch[1]);

    // Strategy 4: Meta tags — og:title or description may include the number
    try {
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content || "";
      const ogMatch = ogTitle.match(/^(\d+)\.\s/);
      if (ogMatch) return parseInt(ogMatch[1]);
    } catch (_) {}

    // Strategy 5: Breadcrumb / nav links that reference the problem
    for (const a of document.querySelectorAll('a[href*="/problems/"]')) {
      const text = a.innerText?.trim();
      const m = text?.match(/^(\d+)\.\s/);
      if (m) return parseInt(m[1]);
    }

    // Strategy 6: Any visible element on the page with "N. Title" pattern
    // (catches custom LeetCode layouts)
    for (const el of document.querySelectorAll('h1, h2, h3, [class*="title"]')) {
      const m = el.innerText?.trim().match(/^(\d+)\.\s/);
      if (m) return parseInt(m[1]);
    }

    return null;
  }

  /**
   * Async fallback: extract problem number via injected script that can read
   * LeetCode's client-side JS context (React cache, GraphQL store, etc.)
   * @returns {Promise<number|null>}
   */
  function getProblemNumberAsync() {
    return new Promise((resolve) => {
      const eventId = "lc-num-" + Date.now() + Math.random().toString(36).substring(2);
      const script = document.createElement("script");
      script.textContent = `(function() {
        var num = null;
        try {
          // Read from React's internal cache or __NEXT_DATA__
          var nd = window.__NEXT_DATA__;
          if (nd) {
            var queries = nd.props && nd.props.pageProps && nd.props.pageProps.dehydratedState && nd.props.pageProps.dehydratedState.queries;
            if (queries) {
              for (var i = 0; i < queries.length; i++) {
                var q = queries[i];
                var fid = (q.state && q.state.data && q.state.data.question && q.state.data.question.questionFrontendId) ||
                          (q.state && q.state.data && q.state.data.submissionDetails && q.state.data.submissionDetails.question && q.state.data.submissionDetails.question.questionFrontendId);
                if (fid) { num = parseInt(fid); break; }
              }
            }
          }
        } catch(e) {}
        window.postMessage({ type: 'DSA_PROBLEM_NUM', eventId: '${eventId}', num: num }, '*');
      })();`;

      const listener = (event) => {
        if (event.data?.type === "DSA_PROBLEM_NUM" && event.data.eventId === eventId) {
          window.removeEventListener("message", listener);
          if (script.parentNode) script.remove();
          resolve(event.data.num || null);
        }
      };
      window.addEventListener("message", listener);
      (document.head || document.documentElement).appendChild(script);

      // Safety timeout
      setTimeout(() => {
        window.removeEventListener("message", listener);
        if (script.parentNode) script.remove();
        resolve(null);
      }, 1500);
    });
  }

  function getProblemMeta() {
    const titleEl =
      document.querySelector('[data-cy="question-title"]') ||
      document.querySelector('.mr-2.text-label-1') ||
      document.querySelector('h1');
    const titleRaw = titleEl?.innerText?.trim() || document.title.split(" - ")[0].trim();

    const titleMatch = titleRaw.match(/^\d+\.\s*(.+)$/);
    const title      = titleMatch ? titleMatch[1] : titleRaw;

    // Slug — from the first path segment after /problems/
    const slug = location.pathname.split("/problems/")[1]?.replace(/\/$/, "").split("/")[0] || "";

    const number = getProblemNumber();

    const diffEl = document.querySelector('[diff]') ||
                   document.querySelector('.text-difficulty-easy, .text-difficulty-medium, .text-difficulty-hard') ||
                   document.querySelector('[class*="text-difficulty"]');
    const difficulty = diffEl?.innerText?.trim() || _extractDifficultyFromDOM();

    const problemUrl = "https://leetcode.com/problems/" + slug + "/";

    return { title, slug, number, difficulty, problemUrl };
  }

  function _extractDifficultyFromDOM() {
    const texts = ["Easy", "Medium", "Hard"];
    for (const span of document.querySelectorAll("span, div")) {
      if (texts.includes(span.innerText?.trim())) return span.innerText.trim();
    }
    return undefined;
  }

  // ── Acceptance detection ──────────────────────────────────────────────────

  /**
   * Returns true ONLY if the current submission result element shows "Accepted".
   * Uses the most stable selector first (data-e2e-locator).
   * Does NOT rely on body text scan to avoid catching old accepted banners.
   *
   * Also rejects transient states: Running, Pending, Compiling, Judging —
   * LeetCode briefly flashes result elements during evaluation.
   */
  function isAccepted() {
    // Guard: reject transient/pending states BEFORE checking for "Accepted"
    const resultEl = document.querySelector('[data-e2e-locator="submission-result"]');
    if (resultEl) {
      const text = resultEl.innerText.trim().toLowerCase();
      // Reject all non-final states
      if (text === "running" || text === "pending" || text === "compiling" ||
          text === "judging" || text === "" || text === "submitting") {
        return false;
      }
      return text === "accepted";
    }

    // Guard: reject if any pending/running indicator is visible on the page
    const pendingIndicators = document.querySelectorAll(
      '[class*="pending"], [class*="running"], [data-e2e-locator="submission-result-loading"]'
    );
    for (const el of pendingIndicators) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return false;
    }

    // Fallback: green badge with exact text "Accepted" that is visibly rendered
    for (const el of document.querySelectorAll("span, p, div")) {
      const text = el.innerText?.trim().toLowerCase();
      if (text === "accepted" && (
        el.className.toLowerCase().includes("text-green") ||
        el.className.toLowerCase().includes("success") ||
        el.style.color?.includes("green") ||
        el.style.color?.includes("rgb(44, 181, 93)")
      )) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return true;
      }
    }
    return false;
  }

  // ── Code extraction ───────────────────────────────────────────────────────

  /**
   * Tries to extract the submitted code from the submission detail page.
   * Attempts multiple strategies and retries up to maxAttempts times,
   * waiting between each, to handle the page still rendering.
   */
  function getCodeFromPageContext() {
    return new Promise((resolve) => {
      const MAX_ATTEMPTS = 6;
      const ATTEMPT_DELAY_MS = 800;
      let attempt = 0;

      function tryExtract() {
        attempt++;

        // Strategy 1: Dedicated submission code element (most reliable on result page)
        const submissionCode = document.querySelector('[data-e2e-locator="submission-code"]');
        if (submissionCode && submissionCode.innerText.trim().length > 10) {
          return resolve(submissionCode.innerText.trim());
        }

        // Strategy 2: <pre><code> block (rendered after page settles)
        const preCodes = document.querySelectorAll('pre code');
        for (const tag of preCodes) {
          if (tag.innerText.trim().length > 10) return resolve(tag.innerText.trim());
        }

        // Strategy 3: CodeMirror
        const cmCode = document.querySelector('.CodeMirror-code');
        if (cmCode && cmCode.innerText.trim().length > 10) return resolve(cmCode.innerText.trim());

        // Strategy 4: Inject script to read Monaco Editor API (gets full model content,
        // not just visible view-lines — avoids incomplete-code bug with virtual scrolling)
        const script  = document.createElement('script');
        const eventId = "lc-code-fetch-" + Date.now() + Math.random().toString(36).substring(2);

        script.textContent = [
          "(function() {",
          "  var code = '';",
          "  try {",
          "    if (window.monaco && window.monaco.editor) {",
          // Prefer the read-only submission model (last created) but validate it has content
          "      var models = window.monaco.editor.getModels();",
          "      for (var i = models.length - 1; i >= 0; i--) {",
          "        var val = models[i].getValue();",
          "        if (val && val.trim().length > 10) { code = val; break; }",
          "      }",
          "    } else if (window.CodeMirror) {",
          "      var cm = document.querySelector('.CodeMirror');",
          "      if (cm && cm.CodeMirror) code = cm.CodeMirror.getValue();",
          "    }",
          "  } catch(e) {}",
          "  window.postMessage({ type: 'DSA_CODE_RESULT', eventId: '" + eventId + "', code: code }, '*');",
          "})();"
        ].join("\n");

        const listener = (event) => {
          if (event.data && event.data.type === 'DSA_CODE_RESULT' && event.data.eventId === eventId) {
            window.removeEventListener('message', listener);
            if (script.parentNode) script.remove();

            const extractedCode = (event.data.code || "").trim();
            if (extractedCode.length > 10) {
              return resolve(extractedCode);
            }
            // Code not ready yet — retry if attempts remain
            if (attempt < MAX_ATTEMPTS) {
              setTimeout(tryExtract, ATTEMPT_DELAY_MS);
            } else {
              resolve(""); // Give up
            }
          }
        };

        window.addEventListener('message', listener);
        (document.head || document.documentElement).appendChild(script);

        // Safety timeout for this attempt's postMessage
        setTimeout(() => {
          window.removeEventListener('message', listener);
          if (script.parentNode) script.remove();
          // If we haven't resolved yet, try again
          if (attempt < MAX_ATTEMPTS) {
            setTimeout(tryExtract, ATTEMPT_DELAY_MS);
          } else {
            resolve("");
          }
        }, 1500);
      }

      tryExtract();
    });
  }

  // ── Language detection ────────────────────────────────────────────────────

  function getLanguage() {
    const langEl =
      document.querySelector('[data-cy="lang-select"] .ant-select-selection-item') ||
      document.querySelector('.select-mode button[class*="text-label"]') ||
      document.querySelector('[data-e2e-locator="code-lang-button"]');
    const raw = langEl?.innerText?.trim().toLowerCase() || "java";
    const langMap = {
      "c++":        "cpp",
      "javascript": "javascript",
      "typescript": "typescript",
      "python3":    "python3",
      "python":     "python",
      "java":       "java",
      "c":          "c",
      "c#":         "csharp",
      "go":         "go",
      "ruby":       "ruby",
      "swift":      "swift",
      "kotlin":     "kotlin",
      "scala":      "scala",
      "rust":       "rust",
      "php":        "php",
    };
    return langMap[raw] || "java";
  }

  // ── Pending state detection ───────────────────────────────────────────────
  // Differentiates a LIVE submission (Running → Accepted) from a HISTORICAL
  // page (loads with Accepted already rendered).

  function isPendingState() {
    const resultEl = document.querySelector('[data-e2e-locator="submission-result"]');
    if (resultEl) {
      const text = resultEl.innerText.trim().toLowerCase();
      if (["running", "pending", "compiling", "judging", "submitting"].includes(text)) {
        return true;
      }
    }
    const loadingEls = document.querySelectorAll(
      '[data-e2e-locator="submission-result-loading"], [class*="animate-spin"]'
    );
    for (const el of loadingEls) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return true;
    }
    return false;
  }

  // ── Submit action detection ───────────────────────────────────────────────
  // Detect when the user actively submits code (click or keyboard shortcut).

  document.addEventListener('click', (e) => {
    const stableBtn = e.target.closest('[data-e2e-locator="console-submit-button"]');
    if (stableBtn) { seenPendingState = true; return; }
    const btn = e.target.closest('button');
    if (btn && !btn.closest('#dsa-pusher-overlay')) {
      const text = btn.textContent.trim().toLowerCase();
      if (text === 'submit' || text === 'submit code') seenPendingState = true;
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && location.pathname.includes('/problems/')) {
      seenPendingState = true;
    }
  }, true);

  // ── MutationObserver ──────────────────────────────────────────────────────

  const observer = new MutationObserver(() => {
    const currentUrl = location.href;

    // Reset state on every SPA navigation
    if (currentUrl !== lastUrl) {
      // Detect SPA navigation from problem editor → submission result.
      // This pattern only happens during a live submission.
      const wasOnEditor = !/\/submissions\/\d+\/?$/.test(new URL(lastUrl, location.origin).pathname);
      const isNowOnResult = /\/problems\/[^/]+\/submissions\/\d+\/?$/.test(location.pathname);

      lastUrl  = currentUrl;
      pushed   = false;
      clearTimeout(debounce);
      debounce = null;

      if (wasOnEditor && isNowOnResult) {
        seenPendingState = true;   // Editor → result = live submission
      } else {
        seenPendingState = false;  // Any other navigation = reset
      }
    }

    // Gate 1: must be on a specific submission result page
    if (!isSubmissionResultPage()) return;

    // Track pending states — if we see Running/Pending/Compiling, this is live
    if (isPendingState()) seenPendingState = true;

    // Gate 2: must have proof this is a live submission (not historical)
    if (!seenPendingState) return;

    // Gate 3: this submission must not have been processed already
    const submissionId = getSubmissionIdFromUrl();
    if (isAlreadyProcessed(submissionId)) return;

    // Gate 4: must not have already triggered for this URL visit
    if (pushed) return;

    // Gate 5: result must show "Accepted"
    if (!isAccepted()) return;

    pushed = true;

    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      if (!isAccepted()) {
        pushed = false;
        return;
      }

      const meta = getProblemMeta();

      // If synchronous extraction missed the number, try the async injected-script fallback
      if (!meta.number) {
        meta.number = await getProblemNumberAsync();
      }

      const code = await getCodeFromPageContext();
      if (code && code.trim().length > 0) {
        markProcessed(submissionId);

        // Practice Mode gate — skip GitHub sync, show notification instead
        try {
          const pmData = await chrome.storage.local.get(["practiceMode"]);
          if (pmData.practiceMode === true) {
            _showPracticeModeNotice();
            return;
          }
        } catch (_) {}

        showCommitDialog({ ...meta, platform: "leetcode", code, language: getLanguage() });
      } else {
        pushed = false;
      }
    }, 2500);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // ── Practice Mode notification ────────────────────────────────────────────
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
