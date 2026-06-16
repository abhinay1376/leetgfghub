/**
 * @fileoverview LeetCode content script (Manifest V3)
 *
 * Detects accepted submissions on leetcode.com and triggers the commit dialog.
 * Runs at document_idle on https://leetcode.com/problems/*
 */
(() => {
  let lastUrl  = location.href;
  let pushed   = false;
  let debounce = null;

  // ── Problem metadata extraction ──────────────────────────────────────────

  /**
   * Extract the LeetCode problem number from multiple DOM sources.
   * Priority: element text > __NEXT_DATA__ > page title > slug
   * @returns {number|null}
   */
  function getProblemNumber() {
    // Source 1: Title element text — e.g. "1. Two Sum" or "196. Koko Eating Bananas"
    const titleEl =
      document.querySelector('[data-cy="question-title"]') ||
      document.querySelector('.mr-2.text-label-1') ||
      document.querySelector('h1');
    if (titleEl) {
      const m = titleEl.innerText?.trim().match(/^(\d+)\./);
      if (m) return parseInt(m[1]);
    }

    // Source 2: __NEXT_DATA__ — LeetCode embeds structured question data in the page
    try {
      const ndScript = document.getElementById("__NEXT_DATA__");
      if (ndScript) {
        const nd = JSON.parse(ndScript.textContent);
        // The question frontend ID can be at different paths depending on page version
        const question =
          nd?.props?.pageProps?.dehydratedState?.queries?.[0]?.state?.data?.question ||
          nd?.props?.pageProps?.question;
        if (question?.questionFrontendId) {
          return parseInt(question.questionFrontendId);
        }
      }
    } catch (_) { /* best effort */ }

    // Source 3: Page title — sometimes "1. Two Sum - LeetCode"
    const pageMatch = document.title.match(/^(\d+)\./);
    if (pageMatch) return parseInt(pageMatch[1]);

    // Source 4: URL slug — rarely has a number prefix, but check anyway
    const slug = location.pathname.split("/problems/")[1]?.replace(/\/$/, "").split("/")[0] || "";
    const slugMatch = slug.match(/^(\d+)/);
    if (slugMatch) return parseInt(slugMatch[1]);

    return null;
  }

  function getProblemMeta() {
    // Title — try the canonical selectors in priority order
    const titleEl =
      document.querySelector('[data-cy="question-title"]') ||
      document.querySelector('.mr-2.text-label-1') ||
      document.querySelector('h1');
    const titleRaw = titleEl?.innerText?.trim() || document.title.split(" - ")[0].trim();

    // Strip leading "N. " numbering that LeetCode sometimes includes in the element
    const titleMatch = titleRaw.match(/^\d+\.\s*(.+)$/);
    const title      = titleMatch ? titleMatch[1] : titleRaw;

    // Slug — authoritative source from the URL
    const slug = location.pathname.split("/problems/")[1]?.replace(/\/$/, "").split("/")[0] || "";

    // Problem number — robust multi-source extraction
    const number = getProblemNumber();

    // Difficulty
    const diffEl = document.querySelector('[diff]') ||
                   document.querySelector('.text-difficulty-easy, .text-difficulty-medium, .text-difficulty-hard') ||
                   document.querySelector('[class*="text-difficulty"]');
    const difficulty = diffEl?.innerText?.trim() || _extractDifficultyFromDOM();

    // Problem URL
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

  // ── Code extraction ──────────────────────────────────────────────────────

  function getCodeFromPageContext() {
    return new Promise((resolve) => {
      // 1. Try to find the submitted code block in the submission detail view
      const codeTags = document.querySelectorAll('pre code, [data-e2e-locator="submission-code"]');
      for (const tag of codeTags) {
        if (tag.innerText.trim().length > 0) {
          return resolve(tag.innerText);
        }
      }

      // 2. Try Monaco view-lines DOM scraping directly
      const monacoLines = document.querySelectorAll('.view-lines .view-line');
      if (monacoLines.length > 0) {
        const code = Array.from(monacoLines).map(l => l.innerText).join("\n");
        if (code.trim().length > 0) return resolve(code);
      }

      // 3. Try CodeMirror
      const cmCode = document.querySelector('.CodeMirror-code');
      if (cmCode && cmCode.innerText.trim().length > 0) {
        return resolve(cmCode.innerText);
      }

      // 4. Inject script to read from Monaco Editor API directly (bypasses virtual DOM)
      const script = document.createElement('script');
      const eventId = "lc-code-fetch-" + Date.now() + Math.random().toString(36).substring(2);

      script.textContent = [
        "(function() {",
        "  var code = '';",
        "  try {",
        "    if (window.monaco && window.monaco.editor) {",
        "      var models = window.monaco.editor.getModels();",
        "      if (models.length > 0) {",
        "        code = models[models.length - 1].getValue();",
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
          resolve(event.data.code);
        }
      };

      window.addEventListener('message', listener);
      (document.head || document.documentElement).appendChild(script);

      // Fallback timeout
      setTimeout(() => {
        window.removeEventListener('message', listener);
        if (script.parentNode) script.remove();
        resolve("");
      }, 2000);
    });
  }

  // ── Language detection ───────────────────────────────────────────────────

  function getLanguage() {
    // LeetCode shows active language in a button/tab
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

  // ── Acceptance detection ─────────────────────────────────────────────────

  function isAccepted() {
    // Primary: e2e locator attribute (most stable)
    const resultEl = document.querySelector('[data-e2e-locator="submission-result"]');
    if (resultEl) return resultEl.innerText.trim().toLowerCase() === "accepted";

    // Fallback: green "Accepted" span
    for (const el of document.querySelectorAll("span, p, div")) {
      const text = el.innerText?.trim().toLowerCase();
      if (text === "accepted" && (
        el.className.toLowerCase().includes("text-green") ||
        el.className.toLowerCase().includes("success") ||
        el.style.color?.includes("green") ||
        el.style.color?.includes("rgb(44, 181, 93)")
      )) {
        // Ensure element is visible
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return true;
      }
    }
    return false;
  }

  function onSubmissionPage() {
    return location.pathname.includes("/submissions/") || location.pathname.endsWith("/submissions");
  }

  // ── MutationObserver ─────────────────────────────────────────────────────

  const observer = new MutationObserver(() => {
    const currentUrl = location.href;

    // SPA navigation reset
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      pushed  = false;
      clearTimeout(debounce);
      debounce = null;
    }

    if (!pushed && onSubmissionPage() && isAccepted()) {
      pushed = true;

      // Debounce: wait for DOM to fully settle
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const meta = getProblemMeta();
        const code = await getCodeFromPageContext();
        if (code && code.trim().length > 0) {
          showCommitDialog({ ...meta, platform: "leetcode", code, language: getLanguage() });
        } else {
          // Code extraction failed — reset so user can try again
          pushed = false;
        }
      }, 1500);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
