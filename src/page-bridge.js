/**
 * @fileoverview Page Bridge — runs in the MAIN world (page JS context).
 *
 * This script has access to window.monaco, window.CodeMirror, window.__NEXT_DATA__, etc.
 * It listens for requests from the isolated-world content scripts and responds via postMessage.
 *
 * Declared in manifest.json with "world": "MAIN" so it is pre-injected by the browser,
 * avoiding any dynamic inline-script injection that would violate LeetCode's CSP.
 */

(function () {
  "use strict";

  window.addEventListener("message", function (event) {
    if (!event.data || event.data.source !== "DSA_BRIDGE_REQUEST") return;

    const { type, eventId } = event.data;

    // ── Request: read Monaco / CodeMirror editor code ──────────────────────
    if (type === "GET_EDITOR_CODE") {
      let code = "";
      try {
        if (window.monaco && window.monaco.editor) {
          const models = window.monaco.editor.getModels();
          for (let i = models.length - 1; i >= 0; i--) {
            const val = models[i].getValue();
            if (val && val.trim().length > 10) { code = val; break; }
          }
        }
        if (!code && window.CodeMirror) {
          const cm = document.querySelector(".CodeMirror");
          if (cm && cm.CodeMirror) code = cm.CodeMirror.getValue();
        }
        if (!code && window.ace) {
          const editorEls = document.querySelectorAll(".ace_editor");
          if (editorEls.length > 0) {
            const editor = window.ace.edit(editorEls[editorEls.length - 1]);
            code = editor.getValue();
          }
        }
      } catch (_) {}
      window.postMessage({ source: "DSA_BRIDGE_RESPONSE", type: "EDITOR_CODE", eventId, code }, "*");
      return;
    }

    // ── Request: read problem number from __NEXT_DATA__ ────────────────────
    if (type === "GET_PROBLEM_NUM") {
      let num = null;
      try {
        const nd = window.__NEXT_DATA__;
        if (nd) {
          const queries = nd.props && nd.props.pageProps &&
                          nd.props.pageProps.dehydratedState &&
                          nd.props.pageProps.dehydratedState.queries;
          if (queries) {
            for (let i = 0; i < queries.length; i++) {
              const q = queries[i];
              const fid =
                (q.state && q.state.data && q.state.data.question && q.state.data.question.questionFrontendId) ||
                (q.state && q.state.data && q.state.data.submissionDetails &&
                 q.state.data.submissionDetails.question && q.state.data.submissionDetails.question.questionFrontendId);
              if (fid) { num = parseInt(fid); break; }
            }
          }
        }
      } catch (_) {}
      window.postMessage({ source: "DSA_BRIDGE_RESPONSE", type: "PROBLEM_NUM", eventId, num }, "*");
      return;
    }
  });
})();
