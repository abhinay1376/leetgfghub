/**
 * @fileoverview Background Service Worker (Manifest V3)
 *
 * Responsibilities:
 *  - Listen for PUSH_TO_GITHUB messages from content scripts
 *  - Orchestrate GitHub API calls via GitHubService
 *  - Update push history in chrome.storage.local
 *  - Update the root README after each successful push
 *  - List repository folders for auto-detection in settings
 *  - Sync analytics to GitHub (.dsa-sync/) for recovery
 */

import { GitHubService, GitHubError } from "./src/github-service.js";
import {
  parseRepoUrl,
  generateProblemPath,
  buildProblemReadme,
  buildRootReadme,
  friendlyError,
} from "./src/utils.js";
import {
  rebuildFromRepository,
  readSyncFile,
  writeSyncFile,
  syncAfterPush,
  computeAnalytics,
} from "./src/sync-service.js";
import {
  getToken, clearAuth,
} from "./src/storage-service.js";

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "PUSH_TO_GITHUB") {
    handlePush(message.data)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: friendlyError(err) }));
    return true;
  }

  if (message.type === "VERIFY_CONNECTION") {
    handleVerify(message.data)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: friendlyError(err) }));
    return true;
  }

  if (message.type === "LIST_REPO_FOLDERS") {
    handleListFolders(message.data)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: friendlyError(err) }));
    return true;
  }

  if (message.type === "REBUILD_FROM_REPO") {
    handleRebuild(message.data)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: friendlyError(err) }));
    return true;
  }

  if (message.type === "SYNC_FROM_REPO") {
    handleSync(message.data)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: friendlyError(err) }));
    return true;
  }

  if (message.type === "SAVE_CONFIG_TO_REPO") {
    handleSaveConfig(message.data)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: friendlyError(err) }));
    return true;
  }

  // ── PAT-based auth helpers ──────────────────────────────────────────

  // Validate a PAT by calling /user — returns full profile on success
  if (message.type === "VERIFY_PAT") {
    const { token } = message.data;
    if (!token) { sendResponse({ success: false, error: "No token provided" }); return true; }
    const gh = new GitHubService(token);
    gh.verifyToken()
      .then(user => sendResponse({ success: true, user }))
      .catch(err => sendResponse({ success: false, error: friendlyError(err) }));
    return true;
  }

  if (message.type === "AUTH_LOGOUT") {
    clearAuth()
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // ── Repository listing ─────────────────────────────────────────────────

  if (message.type === "LIST_USER_REPOS") {
    getToken().then(async (token) => {
      if (!token) return sendResponse({ success: false, error: "Not authenticated" });
      const gh = new GitHubService(token);
      const repos = await gh.listUserRepositories();
      sendResponse({ success: true, repos });
    }).catch(err => sendResponse({ success: false, error: friendlyError(err) }));
    return true;
  }

  if (message.type === "LIST_REPO_FOLDERS_V2") {
    const { owner, repo } = message.data;
    getToken().then(async (token) => {
      if (!token) return sendResponse({ success: false, error: "Not authenticated" });
      const gh = new GitHubService(token);
      const folders = await gh.listFoldersRecursive(owner, repo);
      sendResponse({ success: true, folders });
    }).catch(err => sendResponse({ success: false, error: friendlyError(err) }));
    return true;
  }
});

// ---------------------------------------------------------------------------
// Core: Push handler
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   platform: "leetcode"|"gfg",
 *   problemNumber?: number,
 *   problemSlug: string,
 *   problemTitle: string,
 *   problemUrl?: string,
 *   difficulty?: string,
 *   code: string,
 *   commitMessage: string,
 *   language: string,
 * }} PushPayload
 */

/**
 * @param {PushPayload} payload
 * @returns {Promise<{success: boolean, path?: string, error?: string}>}
 */
async function handlePush(payload) {
  const config = await loadConfig();
  validateConfig(config, payload.platform);

  const gh = new GitHubService(config.githubToken);

  const { owner, repo, folderBase } = resolveTarget(config, payload.platform);

  // ── Centralized path generation ──────────────────────────────────────────
  const paths = generateProblemPath({
    platform:     payload.platform,
    folderBase,
    problemNumber: payload.problemNumber,
    problemSlug:   payload.problemSlug,
    problemTitle:  payload.problemTitle,
    language:      payload.language,
  });

  const today      = new Date().toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
  const problemUrl = payload.problemUrl || buildDefaultUrl(payload);

  const readmeContent = buildProblemReadme({
    title:          payload.problemTitle,
    platform:       payload.platform,
    difficulty:     payload.difficulty,
    problemUrl,
    submissionDate: today,
    language:       payload.language,
    number:         payload.problemNumber,
    revisionNotes:  payload.revisionNotes || {},  // Pass revision notes to README builder
    code:           payload.code,                  // Embed exact submitted code in README
  });

  // Push only the per-problem README — it now contains the solution as a fenced code block.
  // No standalone solution file (solution.java / .py / .cpp etc.) is created.
  await gh.createOrUpdateFile(owner, repo, paths.readmePath, readmeContent, `docs: add README for ${payload.problemTitle}`);

  // Update root README (best-effort — don't fail the whole push if this fails)
  try {
    await updateRootReadme(gh, owner, repo, payload, paths.folderPath);
  } catch (e) {
    // Silent fail for root readme
  }

  // Persist history (includes fields needed by popup analytics dashboard)
  const historyEntry = {
    platform:   payload.platform,
    title:      payload.problemTitle,
    slug:       payload.problemSlug,
    difficulty: payload.difficulty,
    language:   payload.language,
    path:       paths.folderPath,
    timestamp:  Date.now(),
  };
  await appendHistory(historyEntry);

  // Sync analytics to GitHub repo (best-effort)
  try {
    await syncAfterPush(gh, owner, repo, historyEntry);
  } catch (e) {
    // Silent fail for sync
  }

  return { success: true, path: paths.folderPath };
}

// ---------------------------------------------------------------------------
// Root README updater
// ---------------------------------------------------------------------------

/**
 * @param {GitHubService} gh
 * @param {string} owner
 * @param {string} repo
 * @param {PushPayload} payload
 * @param {string} folderPath
 */
async function updateRootReadme(gh, owner, repo, payload, folderPath) {
  // ── Step 1: Read the analytics file (single source of truth for counts) ──
  let analytics = await readSyncFile(gh, owner, repo, "analytics.json");
  const allEntries = (analytics && Array.isArray(analytics.entries))
    ? analytics.entries
    : [];

  // Compute stats from the full analytics entry list — never count from README
  const stats = computeAnalytics(allEntries);

  // ── Step 2: Read the existing README content (to preserve custom sections) ─
  const existing = await gh.getFile(owner, repo, "README.md");
  let existingText = "";
  if (existing?.content) {
    existingText = _fromBase64(existing.content.replace(/\n/g, ""));
  }

  // ── Step 3: Build new README (marker-based, only replaces stat block) ─────
  const config   = await loadConfig();
  const repoName = config.repoName || "DSA Solutions";

  const content = buildRootReadme({ repoName, stats, existingContent: existingText });

  await gh.createOrUpdateFile(owner, repo, "README.md", content, "chore: update README stats [LeetGFGHub]");
}

// ---------------------------------------------------------------------------
// Verify handler (enhanced with repo metadata)
// ---------------------------------------------------------------------------

/**
 * @param {{ githubToken: string, lcRepoUrl?: string, gfgRepoUrl?: string }} data
 */
async function handleVerify({ githubToken, lcRepoUrl, gfgRepoUrl }) {
  if (!githubToken) throw new GitHubError("Token is required.", "BAD_CONFIG");

  const gh   = new GitHubService(githubToken);
  const user = await gh.verifyToken();

  const results = [];

  for (const [label, url] of [["LeetCode", lcRepoUrl], ["GFG", gfgRepoUrl]]) {
    if (!url) continue;
    const info = parseRepoUrl(url);
    if (!info) { results.push({ label, ok: false, error: "Invalid URL" }); continue; }
    try {
      const repoData = await gh.verifyRepository(info.owner, info.repo);
      // Fetch root folder contents for folder detection
      const contents = await gh.listDirectory(info.owner, info.repo);
      const folders = contents.filter(c => c.type === "dir").map(c => c.name);
      const fileCount = contents.filter(c => c.type === "file").length;

      results.push({
        label,
        ok: true,
        repoName: repoData.full_name,
        private: repoData.private,
        branch: repoData.default_branch,
        folders,
        folderCount: folders.length,
        fileCount,
      });
    } catch (e) {
      results.push({ label, ok: false, error: friendlyError(e) });
    }
  }

  return { success: true, user, results };
}

// ---------------------------------------------------------------------------
// Folder listing handler (for popup auto-detection)
// ---------------------------------------------------------------------------

/**
 * @param {{ githubToken: string, repoUrl: string }} data
 * @returns {Promise<{success: boolean, folders: string[]}>}
 */
async function handleListFolders({ githubToken, repoUrl }) {
  if (!githubToken) throw new GitHubError("Token is required.", "BAD_CONFIG");
  if (!repoUrl) throw new GitHubError("Repository URL is required.", "BAD_CONFIG");

  const info = parseRepoUrl(repoUrl);
  if (!info) throw new GitHubError("Invalid repository URL.", "BAD_CONFIG");

  const gh = new GitHubService(githubToken);
  const contents = await gh.listDirectory(info.owner, info.repo);
  const folders = contents.filter(c => c.type === "dir").map(c => c.name);

  return { success: true, folders };
}

// ---------------------------------------------------------------------------
// Repository rebuild handler (full scan of all README files)
// ---------------------------------------------------------------------------

async function handleRebuild() {
  const config = await loadConfig();
  if (!config.githubToken) throw new GitHubError("Token required.", "BAD_CONFIG");

  const gh = new GitHubService(config.githubToken);

  // Determine which repos to scan
  const repos = new Set();
  const lcInfo = config.lcRepoUrl ? parseRepoUrl(config.lcRepoUrl) : null;
  const gfgInfo = config.gfgRepoUrl ? parseRepoUrl(config.gfgRepoUrl) : null;

  let entries = [];

  if (lcInfo) {
    const lcEntries = await rebuildFromRepository(
      gh, lcInfo.owner, lcInfo.repo,
      config.leetcodeFolder || "LeetCode",
      // Only scan GFG folder in this repo if it's the same repo as GFG
      (gfgInfo && lcInfo.owner === gfgInfo.owner && lcInfo.repo === gfgInfo.repo)
        ? (config.gfgFolder || "GFG") : null
    );
    entries = entries.concat(lcEntries);
    repos.add(lcInfo.owner + "/" + lcInfo.repo);
  }

  if (gfgInfo) {
    const key = gfgInfo.owner + "/" + gfgInfo.repo;
    if (!repos.has(key)) {
      // Different repo for GFG — scan it separately
      const gfgEntries = await rebuildFromRepository(
        gh, gfgInfo.owner, gfgInfo.repo,
        null, config.gfgFolder || "GFG"
      );
      entries = entries.concat(gfgEntries);
    }
  }

  // Sort by timestamp
  entries.sort((a, b) => a.timestamp - b.timestamp);

  // Cache locally as pushHistory
  await chrome.storage.local.set({ pushHistory: entries });

  // Write sync files to primary repo (best-effort)
  const primaryInfo = lcInfo || gfgInfo;
  if (primaryInfo) {
    try {
      const analyticsData = {
        version: "1.0",
        lastSync: new Date().toISOString(),
        entries: entries,
      };
      await writeSyncFile(gh, primaryInfo.owner, primaryInfo.repo, "analytics.json", analyticsData, "sync: full rebuild");

      const stats = computeAnalytics(entries);
      const profile = {
        version: "1.0",
        lastSync: analyticsData.lastSync,
        totalSolved: stats.totalSolved,
        currentStreak: stats.currentStreak,
        longestStreak: stats.longestStreak,
        activeDays: stats.activeDays,
      };
      await writeSyncFile(gh, primaryInfo.owner, primaryInfo.repo, "profile.json", profile, "sync: rebuild profile");
    } catch (e) {
      // Best effort sync files
    }
  }

  const stats = computeAnalytics(entries);
  return { success: true, entries, stats, count: entries.length };
}

// ---------------------------------------------------------------------------
// Quick sync handler (reads analytics.json, falls back to full rebuild)
// ---------------------------------------------------------------------------

async function handleSync() {
  const config = await loadConfig();
  if (!config.githubToken) throw new GitHubError("Token required.", "BAD_CONFIG");

  const gh = new GitHubService(config.githubToken);
  const primaryInfo = config.lcRepoUrl ? parseRepoUrl(config.lcRepoUrl)
                    : config.gfgRepoUrl ? parseRepoUrl(config.gfgRepoUrl)
                    : null;

  if (!primaryInfo) throw new GitHubError("No repository configured.", "BAD_CONFIG");

  // Try reading cached analytics.json first (fast path — 1 API call)
  const analytics = await readSyncFile(gh, primaryInfo.owner, primaryInfo.repo, "analytics.json");
  if (analytics && Array.isArray(analytics.entries) && analytics.entries.length > 0) {
    await chrome.storage.local.set({ pushHistory: analytics.entries });
    const stats = computeAnalytics(analytics.entries);
    return { success: true, entries: analytics.entries, stats, count: analytics.entries.length, source: "cache" };
  }

  // No cached file — fall back to full rebuild
  return handleRebuild();
}

// ---------------------------------------------------------------------------
// Save config to repository
// ---------------------------------------------------------------------------

async function handleSaveConfig({ config: userConfig }) {
  const config = await loadConfig();
  if (!config.githubToken) throw new GitHubError("Token required.", "BAD_CONFIG");

  const gh = new GitHubService(config.githubToken);
  const primaryInfo = config.lcRepoUrl ? parseRepoUrl(config.lcRepoUrl)
                    : config.gfgRepoUrl ? parseRepoUrl(config.gfgRepoUrl)
                    : null;

  if (!primaryInfo) throw new GitHubError("No repository configured.", "BAD_CONFIG");

  const syncConfig = {
    version: "1.0",
    lastUpdated: new Date().toISOString(),
    lcRepoUrl: userConfig.lcRepoUrl || config.lcRepoUrl || "",
    gfgRepoUrl: userConfig.gfgRepoUrl || config.gfgRepoUrl || "",
    leetcodeFolder: userConfig.leetcodeFolder || config.leetcodeFolder || "LeetCode",
    gfgFolder: userConfig.gfgFolder || config.gfgFolder || "GFG",
    theme: userConfig.theme || "dark",
  };

  await writeSyncFile(gh, primaryInfo.owner, primaryInfo.repo, "config.json", syncConfig, "sync: update config");
  return { success: true };
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

async function loadConfig() {
  return chrome.storage.sync.get([
    "githubToken",
    "githubUser",
    "lcRepoUrl",
    "gfgRepoUrl",
    "leetcodeFolder",
    "gfgFolder",
    "repoName",
  ]);
}

/**
 * @param {object} config
 * @param {"leetcode"|"gfg"} platform
 */
function validateConfig(config, platform) {
  if (!config.githubToken) {
    throw new GitHubError("GitHub token not configured.", "BAD_CONFIG");
  }
  const url = platform === "leetcode" ? config.lcRepoUrl : config.gfgRepoUrl;
  if (!url) {
    throw new GitHubError(`${platform === "leetcode" ? "LeetCode" : "GFG"} repo URL not configured.`, "BAD_CONFIG");
  }
  if (!parseRepoUrl(url)) {
    throw new GitHubError("Repository URL is invalid.", "BAD_CONFIG");
  }
}

/**
 * @param {object} config
 * @param {"leetcode"|"gfg"} platform
 * @returns {{ owner: string, repo: string, folderBase: string }}
 */
function resolveTarget(config, platform) {
  const url        = platform === "leetcode" ? config.lcRepoUrl : config.gfgRepoUrl;
  const info       = parseRepoUrl(url);
  const folderBase = platform === "leetcode"
    ? (config.leetcodeFolder?.trim() || "LeetCode")
    : (config.gfgFolder?.trim()      || "GFG");
  return { owner: info.owner, repo: info.repo, folderBase };
}

/**
 * @param {PushPayload} payload
 * @returns {string}
 */
function buildDefaultUrl({ platform, problemSlug, problemTitle }) {
  if (platform === "leetcode") {
    const slug = (problemSlug || problemTitle).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    return `https://leetcode.com/problems/${slug}/`;
  }
  const slug = (problemSlug || problemTitle).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return `https://www.geeksforgeeks.org/problems/${slug}/1`;
}

// ---------------------------------------------------------------------------
// History helpers
// ---------------------------------------------------------------------------

/**
 * @param {{ platform: string, title: string, path: string, timestamp: number }} entry
 */
async function appendHistory(entry) {
  // Use local storage — sync quota is only 100KB total, too small for growing history
  const data    = await chrome.storage.local.get(["pushHistory"]);
  const history = data.pushHistory || [];
  history.push(entry);
  if (history.length > 200) history.splice(0, history.length - 200);
  await chrome.storage.local.set({ pushHistory: history });
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function _fromBase64(b64) {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
