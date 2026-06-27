/**
 * @fileoverview LeetCode content script (Manifest V3)
 *
 * Detects accepted submissions on leetcode.com and triggers the commit dialog.
 * Runs at document_idle on https://leetcode.com/problems/*
 *
 * Trigger contract:
 *   - ONLY fires when a NEW submission result transitions to "Accepted"
 *   - Never fires when viewing history, refreshing, or on WA/TLE
 *   - Deduplicates using submissionId stored in sessionStorage
 */
(() => {
  let lastUrl        = location.href;
  let pushed         = false;
  let debounce       = null;

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
    const titleEl =
      document.querySelector('[data-cy="question-title"]') ||
      document.querySelector('.mr-2.text-label-1') ||
      document.querySelector('h1');
    if (titleEl) {
      const m = titleEl.innerText?.trim().match(/^(\d+)\./);
      if (m) return parseInt(m[1]);
    }

    try {
      const ndScript = document.getElementById("__NEXT_DATA__");
      if (ndScript) {
        const nd = JSON.parse(ndScript.textContent);
        const question =
          nd?.props?.pageProps?.dehydratedState?.queries?.[0]?.state?.data?.question ||
          nd?.props?.pageProps?.question;
        if (question?.questionFrontendId) return parseInt(question.questionFrontendId);
      }
    } catch (_) {}

    const pageMatch = document.title.match(/^(\d+)\./);
    if (pageMatch) return parseInt(pageMatch[1]);

    const slug = location.pathname.split("/problems/")[1]?.replace(/\/$/, "").split("/")[0] || "";
    const slugMatch = slug.match(/^(\d+)/);
    if (slugMatch) return parseInt(slugMatch[1]);

    return null;
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
   */
  function isAccepted() {
    // Primary: submission result data attribute (stable across LC redesigns)
    const resultEl = document.querySelector('[data-e2e-locator="submission-result"]');
    if (resultEl) {
      return resultEl.innerText.trim().toLowerCase() === "accepted";
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

  // ── MutationObserver ──────────────────────────────────────────────────────

  const observer = new MutationObserver(() => {
    const currentUrl = location.href;

    // Reset state on every SPA navigation
    if (currentUrl !== lastUrl) {
      lastUrl  = currentUrl;
      pushed   = false;
      clearTimeout(debounce);
      debounce = null;
    }

    // Gate 1: must be on a specific submission result page (has numeric ID in URL)
    if (!isSubmissionResultPage()) return;

    // Gate 2: this submission must not have been processed already
    const submissionId = getSubmissionIdFromUrl();
    if (isAlreadyProcessed(submissionId)) return;

    // Gate 3: must not have already triggered for this URL visit
    if (pushed) return;

    // Gate 4: result must ALREADY show "Accepted" in the DOM
    // (avoids triggering during the "Running..." transient state)
    if (!isAccepted()) return;

    // Schedule a deferred verification — the result banner can briefly appear
    // before the final verdict is set. We wait, then re-check before committing.
    pushed = true; // Prevent duplicate schedules

    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      // Re-verify acceptance after the DOM has had time to fully settle.
      // This prevents false positives when LeetCode briefly flashes "Accepted"
      // during result evaluation before the true verdict is shown.
      if (!isAccepted()) {
        pushed = false; // Reset so we can trigger again when real result arrives
        return;
      }

      // Only mark as fully processed now that we've confirmed the verdict
      markProcessed(submissionId);

      const meta = getProblemMeta();
      const code = await getCodeFromPageContext();
      if (code && code.trim().length > 0) {
        showCommitDialog({ ...meta, platform: "leetcode", code, language: getLanguage() });
      } else {
        // Code extraction failed — reset so we can retry on next mutation
        pushed = false;
      }
    }, 2500); // 2.5s — enough time for submission result page to fully render
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
