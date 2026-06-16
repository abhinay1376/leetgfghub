/**
 * @fileoverview Repository Sync Service
 *
 * Makes GitHub Repository the source of truth for all extension data.
 * Stores analytics/profile/config in .dsa-sync/ folder in the repo.
 * Can rebuild all dashboard data by scanning problem folders and READMEs.
 */

// ---------------------------------------------------------------------------
// Base64 helpers
// ---------------------------------------------------------------------------

function _fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------------------
// README metadata parser
// ---------------------------------------------------------------------------

/**
 * Parse a problem README.md and extract structured metadata.
 *
 * Expected format:
 *   # 0196. Koko Eating Bananas
 *   **Platform:** LeetCode
 *   **Difficulty:** Medium
 *   **Submission Date:** 16 Jun, 2026
 *   **Language:** java
 *
 * @param {string} content - decoded README text
 * @returns {{ title?: string, number?: number, platform?: string,
 *             difficulty?: string, language?: string, submissionDate?: string } | null}
 */
export function parseReadmeMetadata(content) {
  if (!content) return null;

  const result = {};

  // Title line: "# 0196. Koko Eating Bananas"
  const titleMatch = content.match(/^#\s+(?:(\d+)\.\s+)?(.+)$/m);
  if (titleMatch) {
    if (titleMatch[1]) result.number = parseInt(titleMatch[1]);
    result.title = titleMatch[2].trim();
  }

  // Platform
  const platMatch = content.match(/\*\*Platform:\*\*\s*(.+)/);
  if (platMatch) {
    const p = platMatch[1].trim().toLowerCase();
    result.platform = p.includes("leetcode") ? "leetcode" : "gfg";
  }

  // Difficulty
  const diffMatch = content.match(/\*\*Difficulty:\*\*\s*(.+)/);
  if (diffMatch) result.difficulty = diffMatch[1].trim().replace(/\s+$/, "");

  // Submission Date
  const dateMatch = content.match(/\*\*Submission Date:\*\*\s*(.+)/);
  if (dateMatch) result.submissionDate = dateMatch[1].trim().replace(/\s+$/, "");

  // Language
  const langMatch = content.match(/\*\*Language:\*\*\s*(.+)/);
  if (langMatch) result.language = langMatch[1].trim().replace(/\s+$/, "");

  return result;
}

// ---------------------------------------------------------------------------
// Date parser for README date strings
// ---------------------------------------------------------------------------

const MONTH_MAP = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse a date string like "16 Jun, 2026" into a Unix timestamp.
 * @param {string} dateStr
 * @returns {number}
 */
export function parseDateFromReadme(dateStr) {
  if (!dateStr) return Date.now();

  // Try native parse first
  const native = new Date(dateStr);
  if (!isNaN(native.getTime()) && native.getFullYear() > 2000) return native.getTime();

  // Manual: "16 Jun, 2026" or "16 June, 2026"
  const m = dateStr.match(/(\d{1,2})\s+(\w+),?\s+(\d{4})/);
  if (m) {
    const month = MONTH_MAP[m[2].toLowerCase().substring(0, 3)];
    if (month !== undefined) {
      return new Date(parseInt(m[3]), month, parseInt(m[1])).getTime();
    }
  }

  return Date.now();
}

// ---------------------------------------------------------------------------
// Analytics computation
// ---------------------------------------------------------------------------

/**
 * Compute full analytics from an array of history entries.
 *
 * @param {Array<{platform: string, difficulty?: string, language?: string, timestamp: number}>} entries
 * @returns {{ totalSolved: number, leetcode: number, gfg: number,
 *             easy: number, medium: number, hard: number,
 *             languages: Record<string, number>,
 *             currentStreak: number, longestStreak: number, activeDays: number,
 *             solvedDates: string[] }}
 */
export function computeAnalytics(entries) {
  const stats = {
    totalSolved: entries.length,
    leetcode: 0, gfg: 0,
    easy: 0, medium: 0, hard: 0,
    languages: {},
    currentStreak: 0, longestStreak: 0, activeDays: 0,
    solvedDates: [],
  };

  const dateSet = new Set();

  for (const e of entries) {
    // Platform counts
    if (e.platform === "leetcode") stats.leetcode++;
    else stats.gfg++;

    // Difficulty counts
    const diff = (e.difficulty || "").toLowerCase();
    if (diff === "easy" || diff === "basic" || diff === "school") stats.easy++;
    else if (diff === "medium") stats.medium++;
    else if (diff === "hard") stats.hard++;

    // Language counts
    const lang = (e.language || "unknown").toLowerCase();
    stats.languages[lang] = (stats.languages[lang] || 0) + 1;

    // Collect dates for streak/heatmap
    if (e.timestamp) {
      const d = new Date(e.timestamp).toISOString().split("T")[0];
      dateSet.add(d);
    }
  }

  const sortedDates = [...dateSet].sort();
  stats.solvedDates = sortedDates;
  stats.activeDays = sortedDates.length;

  // Streak calculation
  if (sortedDates.length > 0) {
    const streaks = calculateStreaks(sortedDates);
    stats.currentStreak = streaks.current;
    stats.longestStreak = streaks.longest;
  }

  return stats;
}

/**
 * @param {string[]} sortedDates - ISO date strings, already sorted ascending
 * @returns {{ current: number, longest: number }}
 */
function calculateStreaks(sortedDates) {
  if (sortedDates.length === 0) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;

  for (let i = 1; i < sortedDates.length; i++) {
    const prev = new Date(sortedDates[i - 1]);
    const curr = new Date(sortedDates[i]);
    const gap = Math.round((curr - prev) / 86400000);
    if (gap === 1) { run++; longest = Math.max(longest, run); }
    else if (gap > 1) { run = 1; }
    // gap === 0 means same day, skip
  }

  // Current streak: walk backwards from today
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];
  const yesterdayStr = new Date(today - 86400000).toISOString().split("T")[0];

  const last = sortedDates[sortedDates.length - 1];
  if (last !== todayStr && last !== yesterdayStr) {
    return { current: 0, longest };
  }

  let current = 1;
  for (let i = sortedDates.length - 2; i >= 0; i--) {
    const c = new Date(sortedDates[i + 1]);
    const p = new Date(sortedDates[i]);
    const gap = Math.round((c - p) / 86400000);
    if (gap === 1) current++;
    else break;
  }

  return { current, longest: Math.max(longest, current) };
}

// ---------------------------------------------------------------------------
// Sync file I/O
// ---------------------------------------------------------------------------

const SYNC_DIR = ".dsa-sync";

/**
 * Read a JSON file from .dsa-sync/ in the repository.
 * @param {import('./github-service.js').GitHubService} gh
 * @param {string} owner
 * @param {string} repo
 * @param {string} filename - e.g. "analytics.json"
 * @returns {Promise<object|null>}
 */
export async function readSyncFile(gh, owner, repo, filename) {
  const path = SYNC_DIR + "/" + filename;
  const file = await gh.getFile(owner, repo, path);
  if (!file || !file.content) return null;
  try {
    const text = _fromBase64(file.content.replace(/\n/g, ""));
    return JSON.parse(text);
  } catch (_) { return null; }
}

/**
 * Write a JSON file to .dsa-sync/ in the repository.
 * @param {import('./github-service.js').GitHubService} gh
 * @param {string} owner
 * @param {string} repo
 * @param {string} filename
 * @param {object} data
 * @param {string} [message]
 */
export async function writeSyncFile(gh, owner, repo, filename, data, message) {
  const path = SYNC_DIR + "/" + filename;
  const content = JSON.stringify(data, null, 2);
  const msg = message || ("sync: update " + filename);
  await gh.createOrUpdateFile(owner, repo, path, content, msg);
}

// ---------------------------------------------------------------------------
// Full repository rebuild
// ---------------------------------------------------------------------------

/**
 * Scan the entire repository and rebuild pushHistory entries from README files.
 *
 * @param {import('./github-service.js').GitHubService} gh
 * @param {string} owner
 * @param {string} repo
 * @param {string} lcFolder  - e.g. "Leetcode_Problems"
 * @param {string} gfgFolder - e.g. "GFG"
 * @returns {Promise<Array<{platform: string, title: string, slug: string,
 *           difficulty?: string, language?: string, path: string, timestamp: number}>>}
 */
export async function rebuildFromRepository(gh, owner, repo, lcFolder, gfgFolder) {
  const entries = [];

  // Helper: scan one folder for problem subfolders
  async function scanFolder(folderName, platform) {
    if (!folderName) return;
    let contents;
    try {
      contents = await gh.listDirectory(owner, repo, folderName);
    } catch (_) { return; }

    const dirs = contents.filter(c => c.type === "dir");

    for (const dir of dirs) {
      try {
        const readmePath = dir.path + "/README.md";
        const readmeFile = await gh.getFile(owner, repo, readmePath);
        if (!readmeFile || !readmeFile.content) continue;

        const text = _fromBase64(readmeFile.content.replace(/\n/g, ""));
        const meta = parseReadmeMetadata(text);
        if (!meta) continue;

        // Build slug from folder name
        let slug;
        if (platform === "leetcode") {
          // "0001_Two_Sum" → "two-sum"
          slug = dir.name.replace(/^\d+_/, "").replace(/_/g, "-").toLowerCase();
        } else {
          // "Floor_In_A_Sorted_Array" → "floor-in-a-sorted-array"
          slug = dir.name.replace(/_/g, "-").toLowerCase();
        }

        entries.push({
          platform: meta.platform || platform,
          title: meta.title || dir.name.replace(/_/g, " "),
          slug: slug,
          difficulty: meta.difficulty,
          language: meta.language,
          path: dir.path,
          timestamp: parseDateFromReadme(meta.submissionDate),
        });
      } catch (_) { /* skip unreadable folders */ }
    }
  }

  await scanFolder(lcFolder, "leetcode");
  await scanFolder(gfgFolder, "gfg");

  // Sort by timestamp ascending
  entries.sort((a, b) => a.timestamp - b.timestamp);

  return entries;
}

// ---------------------------------------------------------------------------
// Incremental sync (called after each push)
// ---------------------------------------------------------------------------

/**
 * Update .dsa-sync/analytics.json with a new entry after a successful push.
 * Best-effort — failures are logged but don't break the push.
 *
 * @param {import('./github-service.js').GitHubService} gh
 * @param {string} owner
 * @param {string} repo
 * @param {{ platform: string, title: string, slug: string,
 *           difficulty?: string, language?: string, path: string, timestamp: number }} newEntry
 */
export async function syncAfterPush(gh, owner, repo, newEntry) {
  // Read existing analytics
  let analytics = await readSyncFile(gh, owner, repo, "analytics.json");
  if (!analytics || !Array.isArray(analytics.entries)) {
    analytics = { version: "1.0", entries: [] };
  }

  // Add new entry (avoid duplicates by path)
  const exists = analytics.entries.some(e => e.path === newEntry.path);
  if (!exists) {
    analytics.entries.push(newEntry);
  } else {
    // Update existing entry
    const idx = analytics.entries.findIndex(e => e.path === newEntry.path);
    analytics.entries[idx] = newEntry;
  }

  analytics.lastSync = new Date().toISOString();

  // Write analytics
  await writeSyncFile(gh, owner, repo, "analytics.json", analytics, "sync: update analytics");

  // Write profile summary
  const stats = computeAnalytics(analytics.entries);
  const profile = {
    version: "1.0",
    lastSync: analytics.lastSync,
    totalSolved: stats.totalSolved,
    currentStreak: stats.currentStreak,
    longestStreak: stats.longestStreak,
    activeDays: stats.activeDays,
  };
  await writeSyncFile(gh, owner, repo, "profile.json", profile, "sync: update profile");
}
