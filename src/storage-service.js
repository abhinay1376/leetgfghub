/**
 * @fileoverview StorageService — Typed chrome.storage wrapper.
 * Single source of truth for all extension persistence.
 *
 * chrome.storage.sync  → token, config (small, synced across devices)
 * chrome.storage.local → history, pending, analytics cache (large)
 */

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

const SYNC_KEYS = {
  TOKEN:          "githubToken",
  USER:           "githubUser",       // { login, name, avatarUrl }
  LC_REPO_URL:    "lcRepoUrl",
  GFG_REPO_URL:   "gfgRepoUrl",
  LC_FOLDER:      "leetcodeFolder",
  GFG_FOLDER:     "gfgFolder",
  REPO_NAME:      "repoName",
  THEME:          "theme",
  ONBOARDED:      "onboarded",
  SELECTED_REPO:  "selectedRepo",     // { owner, repo, fullName, private, branch }
};

const LOCAL_KEYS = {
  HISTORY:        "pushHistory",
  PENDING:        "pendingPushes",
  ANALYTICS:      "cachedAnalytics",
};

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

export async function getToken() {
  const d = await chrome.storage.sync.get([SYNC_KEYS.TOKEN]);
  return d[SYNC_KEYS.TOKEN] || null;
}

export async function setToken(token) {
  await chrome.storage.sync.set({ [SYNC_KEYS.TOKEN]: token });
}

export async function clearToken() {
  await chrome.storage.sync.remove([SYNC_KEYS.TOKEN]);
}

// ---------------------------------------------------------------------------
// User Profile
// ---------------------------------------------------------------------------

/** @returns {Promise<{login:string, name:string, avatarUrl:string}|null>} */
export async function getUser() {
  const d = await chrome.storage.sync.get([SYNC_KEYS.USER]);
  return d[SYNC_KEYS.USER] || null;
}

/** @param {{login:string, name:string, avatarUrl:string}} user */
export async function setUser(user) {
  await chrome.storage.sync.set({ [SYNC_KEYS.USER]: user });
}

// ---------------------------------------------------------------------------
// Config (repo URLs, folders)
// ---------------------------------------------------------------------------

/**
 * @returns {Promise<{
 *   lcRepoUrl: string, gfgRepoUrl: string,
 *   leetcodeFolder: string, gfgFolder: string,
 *   repoName: string, onboarded: boolean,
 *   selectedRepo: object|null, theme: string
 * }>}
 */
export async function getConfig() {
  return chrome.storage.sync.get([
    SYNC_KEYS.LC_REPO_URL,
    SYNC_KEYS.GFG_REPO_URL,
    SYNC_KEYS.LC_FOLDER,
    SYNC_KEYS.GFG_FOLDER,
    SYNC_KEYS.REPO_NAME,
    SYNC_KEYS.ONBOARDED,
    SYNC_KEYS.SELECTED_REPO,
    SYNC_KEYS.THEME,
  ]);
}

export async function setConfig(partial) {
  const mapped = {};
  if ("lcRepoUrl"      in partial) mapped[SYNC_KEYS.LC_REPO_URL]   = partial.lcRepoUrl;
  if ("gfgRepoUrl"     in partial) mapped[SYNC_KEYS.GFG_REPO_URL]  = partial.gfgRepoUrl;
  if ("leetcodeFolder" in partial) mapped[SYNC_KEYS.LC_FOLDER]     = partial.leetcodeFolder;
  if ("gfgFolder"      in partial) mapped[SYNC_KEYS.GFG_FOLDER]    = partial.gfgFolder;
  if ("repoName"       in partial) mapped[SYNC_KEYS.REPO_NAME]     = partial.repoName;
  if ("onboarded"      in partial) mapped[SYNC_KEYS.ONBOARDED]     = partial.onboarded;
  if ("selectedRepo"   in partial) mapped[SYNC_KEYS.SELECTED_REPO] = partial.selectedRepo;
  if ("theme"          in partial) mapped[SYNC_KEYS.THEME]         = partial.theme;
  if (Object.keys(mapped).length > 0) await chrome.storage.sync.set(mapped);
}

// ---------------------------------------------------------------------------
// Push History
// ---------------------------------------------------------------------------

/** @returns {Promise<Array>} */
export async function getHistory() {
  const d = await chrome.storage.local.get([LOCAL_KEYS.HISTORY]);
  return d[LOCAL_KEYS.HISTORY] || [];
}

export async function appendHistory(entry) {
  const history = await getHistory();
  history.push(entry);
  if (history.length > 500) history.splice(0, history.length - 500);
  await chrome.storage.local.set({ [LOCAL_KEYS.HISTORY]: history });
}

export async function setHistory(entries) {
  await chrome.storage.local.set({ [LOCAL_KEYS.HISTORY]: entries });
}

// ---------------------------------------------------------------------------
// Pending Pushes
// ---------------------------------------------------------------------------

/** @returns {Promise<Array>} */
export async function getPending() {
  const d = await chrome.storage.local.get([LOCAL_KEYS.PENDING]);
  return d[LOCAL_KEYS.PENDING] || [];
}

export async function addPending(item) {
  const pending = await getPending();
  const exists = pending.some(p => p.platform === item.platform && p.slug === item.slug);
  if (!exists) {
    pending.push({ ...item, savedAt: Date.now() });
    if (pending.length > 100) pending.splice(0, pending.length - 100);
    await chrome.storage.local.set({ [LOCAL_KEYS.PENDING]: pending });
  }
}

export async function removePending(platform, slug) {
  const pending = await getPending();
  const filtered = pending.filter(p => !(p.platform === platform && p.slug === slug));
  await chrome.storage.local.set({ [LOCAL_KEYS.PENDING]: filtered });
}

// ---------------------------------------------------------------------------
// Cached Analytics
// ---------------------------------------------------------------------------

export async function getCachedAnalytics() {
  const d = await chrome.storage.local.get([LOCAL_KEYS.ANALYTICS]);
  return d[LOCAL_KEYS.ANALYTICS] || null;
}

export async function setCachedAnalytics(analytics) {
  await chrome.storage.local.set({ [LOCAL_KEYS.ANALYTICS]: analytics });
}

// ---------------------------------------------------------------------------
// Full clear (logout)
// ---------------------------------------------------------------------------

export async function clearAll() {
  await chrome.storage.sync.clear();
  await chrome.storage.local.clear();
}

export async function clearAuth() {
  await chrome.storage.sync.remove([
    SYNC_KEYS.TOKEN,
    SYNC_KEYS.USER,
    SYNC_KEYS.ONBOARDED,
    SYNC_KEYS.SELECTED_REPO,
    SYNC_KEYS.LC_REPO_URL,
    SYNC_KEYS.GFG_REPO_URL,
    SYNC_KEYS.LC_FOLDER,
    SYNC_KEYS.GFG_FOLDER,
  ]);
}
