/**
 * @fileoverview Page Bridge — runs in the MAIN world (page JS context).
 *
 * Has access to window.monaco, window.CodeMirror, window.__NEXT_DATA__, etc.
 * Responds to DSA_BRIDGE_REQUEST postMessages from the isolated-world scripts.
 *
 * Injected by the browser (world: "MAIN") — no inline script / no CSP violation.
 */

(function () {
  "use strict";

  window.addEventListener("message", function (event) {
    if (!event.data || event.data.source !== "DSA_BRIDGE_REQUEST") return;

    const { type, eventId } = event.data;

    // ─────────────────────────────────────────────────────────────────────────
    // GET_SUBMISSION_DATA
    // Reads the submitted code AND language directly from LeetCode's
    // __NEXT_DATA__ / Apollo cache on submission result pages.
    // This is the most reliable source — it IS the accepted submission record.
    // ─────────────────────────────────────────────────────────────────────────
    if (type === "GET_SUBMISSION_DATA") {
      let code = null;
      let lang = null;
      try {
        const nd = window.__NEXT_DATA__;
        if (nd) {
          const queries =
            nd.props &&
            nd.props.pageProps &&
            nd.props.pageProps.dehydratedState &&
            nd.props.pageProps.dehydratedState.queries;
          if (Array.isArray(queries)) {
            for (const q of queries) {
              // submissionDetails query holds code + lang
              const sd = q.state && q.state.data && q.state.data.submissionDetails;
              if (sd && sd.code && sd.code.trim().length > 10) {
                code = sd.code;
                lang = sd.lang || sd.langName || null;
                break;
              }
            }
          }
        }
      } catch (_) {}
      window.postMessage(
        { source: "DSA_BRIDGE_RESPONSE", type: "SUBMISSION_DATA", eventId, code, lang },
        "*"
      );
      return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET_EDITOR_CODE
    // Reads code from Monaco / CodeMirror / ACE.
    //
    // Monaco strategy (LeetCode submission pages):
    //   1. Prefer read-only models — on submission result pages, the accepted
    //      code is loaded into a READ-ONLY Monaco model. The writable model
    //      holds the current editor content (possibly a different language).
    //   2. Fall back to any model with content if no read-only model found.
    //
    // ─────────────────────────────────────────────────────────────────────────
    if (type === "GET_EDITOR_CODE") {
      let code = "";
      try {
        if (window.monaco && window.monaco.editor) {
          const models = window.monaco.editor.getModels();

          // Pass 1: read-only models (submission display — the actual accepted code)
          for (let i = models.length - 1; i >= 0; i--) {
            try {
              if (models[i].isReadonly && models[i].isReadonly()) {
                const val = models[i].getValue();
                if (val && val.trim().length > 10) { code = val; break; }
              }
            } catch (_) {}
          }

          // Pass 2: models whose URI contains "submission" (LeetCode submission viewer)
          if (!code) {
            for (let i = models.length - 1; i >= 0; i--) {
              try {
                const uri = models[i].uri && models[i].uri.toString();
                if (uri && uri.toLowerCase().includes("submission")) {
                  const val = models[i].getValue();
                  if (val && val.trim().length > 10) { code = val; break; }
                }
              } catch (_) {}
            }
          }

          // Pass 3: fallback — any model with content (last-created first)
          if (!code) {
            for (let i = models.length - 1; i >= 0; i--) {
              try {
                const val = models[i].getValue();
                if (val && val.trim().length > 10) { code = val; break; }
              } catch (_) {}
            }
          }
        }

        if (!code && window.CodeMirror) {
          const cm = document.querySelector(".CodeMirror");
          if (cm && cm.CodeMirror) code = cm.CodeMirror.getValue();
        }

        if (!code && window.ace) {
          const editorEls = document.querySelectorAll(".ace_editor");
          if (editorEls.length > 0) {
            try {
              const editor = window.ace.edit(editorEls[editorEls.length - 1]);
              code = editor.getValue();
            } catch (_) {}
          }
        }
      } catch (_) {}

      window.postMessage(
        { source: "DSA_BRIDGE_RESPONSE", type: "EDITOR_CODE", eventId, code },
        "*"
      );
      return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET_PROBLEM_NUM — read problem number from __NEXT_DATA__
    // ─────────────────────────────────────────────────────────────────────────
    if (type === "GET_PROBLEM_NUM") {
      let num = null;
      try {
        const nd = window.__NEXT_DATA__;
        if (nd) {
          const queries =
            nd.props &&
            nd.props.pageProps &&
            nd.props.pageProps.dehydratedState &&
            nd.props.pageProps.dehydratedState.queries;
          if (Array.isArray(queries)) {
            for (const q of queries) {
              const fid =
                (q.state && q.state.data && q.state.data.question &&
                 q.state.data.question.questionFrontendId) ||
                (q.state && q.state.data && q.state.data.submissionDetails &&
                 q.state.data.submissionDetails.question &&
                 q.state.data.submissionDetails.question.questionFrontendId);
              if (fid) { num = parseInt(fid); break; }
            }
          }
        }
      } catch (_) {}
      window.postMessage(
        { source: "DSA_BRIDGE_RESPONSE", type: "PROBLEM_NUM", eventId, num },
        "*"
      );
      return;
    }
  });
})();
