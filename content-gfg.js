/**
 * @fileoverview GeeksForGeeks content script (Manifest V3)
 *
 * Detects accepted submissions on geeksforgeeks.org and triggers the commit dialog.
 * Runs at document_idle on https://www.geeksforgeeks.org/*
 */
(() => {
  let lastUrl  = location.href;
  let pushed   = false;
  let debounce = null;

  // ── Problem metadata extraction ──────────────────────────────────────────

  function getProblemMeta() {
    // Title — GFG uses various class names across redesigns
    const titleEl =
      document.querySelector('.problems_header_content__title__L2cB2') ||
      document.querySelector('h3.problem-tab__title') ||
      document.querySelector('.problemPageTitle') ||
      document.querySelector('[class*="problem-statement"] h1') ||
      document.querySelector('h1');
    const title = titleEl?.innerText?.trim() || document.title.split("|")[0].trim();

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

      // 5. Inject script to read from editor APIs directly (last resort)
      const script = document.createElement('script');
      const eventId = "gfg-code-fetch-" + Date.now() + Math.random().toString(36).substring(2);

      script.textContent = [
        "(function() {",
        "  var code = '';",
        "  try {",
        "    if (window.ace) {",
        "      var editorEls = document.querySelectorAll('.ace_editor');",
        "      if (editorEls.length > 0) {",
        "        var editor = window.ace.edit(editorEls[editorEls.length - 1]);",
        "        code = editor.getValue();",
        "      }",
        "    } else if (window.monaco && window.monaco.editor) {",
        "      var models = window.monaco.editor.getModels();",
        "      if (models.length > 0) code = models[models.length - 1].getValue();",
        "    } else if (document.querySelector('.CodeMirror')) {",
        "      var cmElements = document.querySelectorAll('.CodeMirror');",
        "      var lastCm = cmElements[cmElements.length - 1];",
        "      if (lastCm && lastCm.CodeMirror) code = lastCm.CodeMirror.getValue();",
        "    }",
        "  } catch(e) {}",
        "  if (!code) {",
        "    var textarea = document.querySelector('[class*=\"editor\"] textarea, .ace_text-input');",
        "    if (textarea) code = textarea.value;",
        "  }",
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

  function isAccepted() {
    // Method 1: Look for the known GFG success container classes
    if (document.querySelector('.problems_correct_tab__ZSygD, [class*="successMessage"], [class*="problems_success"], [class*="OutputContainer_success"]')) {
      return true;
    }

    // Method 2: Text-based scan of the page body (reliable fallback)
    const bodyText = document.body.innerText;
    if (
      bodyText.includes("Problem Solved Successfully") ||
      bodyText.includes("Congratulations, you have passed") ||
      bodyText.includes("Your solution is correct") ||
      bodyText.includes("Correct Answer")
    ) {
      // Additional check: make sure we're seeing a result, not just an old cached page
      // Look for visible result elements to confirm
      const resultArea = document.querySelector('[class*="correct"], [class*="success"], [class*="output"]');
      if (resultArea) {
        const rect = resultArea.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return true;
      }
      // Even without visible result area, trust the text if present
      return true;
    }

    return false;
  }

  function onProblemPage() {
    return location.pathname.includes("/problems/");
  }

  // ── MutationObserver ─────────────────────────────────────────────────────

  const observer = new MutationObserver(() => {
    const currentUrl = location.href;

    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      pushed  = false;
      clearTimeout(debounce);
      debounce = null;
    }

    if (!pushed && onProblemPage() && isAccepted()) {
      pushed = true;

      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const meta = getProblemMeta();
        const code = await getCodeFromPageContext();
        if (code && code.trim().length > 0) {
          showCommitDialog({ ...meta, platform: "gfg", code, language: getLanguage() });
        } else {
          // Code extraction failed — reset so user can try again
          pushed = false;
        }
      }, 1500);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
