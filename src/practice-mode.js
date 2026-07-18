/**
 * @fileoverview Practice Mode module
 *
 * Manages the global Practice Mode toggle. When enabled, no GitHub
 * synchronization occurs — submissions are detected but not pushed.
 *
 * State is persisted in chrome.storage.local for cross-session persistence.
 */

const STORAGE_KEY = "practiceMode";

/**
 * Check if Practice Mode is currently enabled.
 * @returns {Promise<boolean>}
 */
export async function isPracticeModeOn() {
  try {
    const data = await chrome.storage.local.get([STORAGE_KEY]);
    return data[STORAGE_KEY] === true;
  } catch (_) {
    return false;
  }
}

/**
 * Set Practice Mode state.
 * @param {boolean} enabled
 * @returns {Promise<void>}
 */
export async function setPracticeMode(enabled) {
  await chrome.storage.local.set({ [STORAGE_KEY]: !!enabled });
}

/**
 * Show a small, non-intrusive notification banner when a solution is
 * detected but Practice Mode is ON.
 *
 * This is injected into the page DOM by content scripts.
 */
export function showPracticeModeNotification() {
  // Prevent duplicates
  if (document.getElementById("dsa-practice-notify")) return;

  const el = document.createElement("div");
  el.id = "dsa-practice-notify";
  el.style.cssText = [
    "position:fixed",
    "bottom:24px",
    "right:24px",
    "background:rgba(28,28,30,0.92)",
    "color:#F5F5F7",
    "border-radius:16px",
    "padding:16px 20px",
    "font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Inter',system-ui,sans-serif",
    "font-size:13px",
    "z-index:2147483646",
    "box-shadow:0 8px 32px rgba(0,0,0,0.4),inset 0 1px 1px rgba(255,255,255,0.08)",
    "backdrop-filter:blur(24px)",
    "-webkit-backdrop-filter:blur(24px)",
    "border:1px solid rgba(255,255,255,0.08)",
    "animation:dsaPracticeSlideIn 0.4s cubic-bezier(0.16,1,0.3,1) forwards",
    "display:flex",
    "align-items:center",
    "gap:12px",
    "max-width:340px",
  ].join(";");

  el.innerHTML = `
    <style>
      @keyframes dsaPracticeSlideIn {
        0% { opacity:0; transform:translateY(20px) scale(0.95); }
        100% { opacity:1; transform:translateY(0) scale(1); }
      }
    </style>
    <div style="width:36px;height:36px;border-radius:10px;background:rgba(255,214,10,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;border:1px solid rgba(255,214,10,0.3)">
      <span style="font-size:18px">🎯</span>
    </div>
    <div>
      <div style="font-weight:600;color:#FFD60A;margin-bottom:2px">Practice Mode</div>
      <div style="color:#AEAEB2;font-size:12px;line-height:1.4">Solution detected. GitHub sync skipped.</div>
    </div>
  `;

  document.body.appendChild(el);

  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    el.style.transition = "opacity 0.3s ease, transform 0.3s ease";
    el.style.opacity = "0";
    el.style.transform = "translateY(10px) scale(0.95)";
    setTimeout(() => el.remove(), 320);
  }, 4000);
}
