/**
 * @fileoverview Repository URL parser & README generators.
 * Pure utility functions — no side effects.
 */

// ---------------------------------------------------------------------------
// Repository URL Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a GitHub repository URL and extract owner + repo name.
 *
 * Supports:
 *   https://github.com/user/repo
 *   https://github.com/user/repo.git
 *   github.com/user/repo
 *   git@github.com:user/repo.git
 *
 * @param {string} rawUrl
 * @returns {{ owner: string, repo: string } | null}
 */
export function parseRepoUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;

  const url = rawUrl.trim();

  // SSH format: git@github.com:user/repo.git
  const sshMatch = url.match(/git@github\.com[:/]([^/]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  // HTTPS or bare format
  const httpsMatch = url.match(/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/.*)?$/i);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  return null;
}

// ---------------------------------------------------------------------------
// File-path helpers
// ---------------------------------------------------------------------------

/**
 * Build the folder name for a LeetCode problem.
 * e.g. "0196_Koko_Eating_Bananas"
 * @param {number|string} number
 * @param {string} slug  – e.g. "koko-eating-bananas"
 * @returns {string}
 */
export function leetcodeFolderName(number, slug) {
  // Convert kebab-case slug to Title_Case: "koko-eating-bananas" → "Koko_Eating_Bananas"
  const clean = (slug || "unknown")
    .split(/[-_]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .replace(/^_|_$/g, "");

  // Only pad if we have a real problem number (> 0)
  if (number && Number(number) > 0) {
    const padded = String(number).padStart(4, "0");
    return `${padded}_${clean}`;
  }
  // Fallback: slug-only (avoids creating 0000_ folders)
  return clean;
}

/**
 * Build the folder name for a GFG problem.
 * e.g. "Floor_In_A_Sorted_Array"
 * @param {string} title
 * @param {string} slug
 * @returns {string}
 */
export function gfgFolderName(title, slug) {
  const source = title || slug || "unknown";
  return source
    .trim()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join("_")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

// ---------------------------------------------------------------------------
// File extension mapping
// ---------------------------------------------------------------------------

const EXT_MAP = {
  java:       ".java",
  python:     ".py",
  python3:    ".py",
  cpp:        ".cpp",
  "c++":      ".cpp",
  c:          ".c",
  javascript: ".js",
  js:         ".js",
  typescript: ".ts",
  ts:         ".ts",
  go:         ".go",
  rust:       ".rs",
  kotlin:     ".kt",
  swift:      ".swift",
  scala:      ".scala",
  ruby:       ".rb",
  php:        ".php",
  csharp:     ".cs",
  "c#":       ".cs",
};

/**
 * Get the file extension for a given language string.
 * @param {string} language
 * @returns {string}
 */
export function getExtension(language) {
  return EXT_MAP[(language || "").toLowerCase()] ?? ".java";
}

// ---------------------------------------------------------------------------
// Centralized Path Generator — SINGLE SOURCE OF TRUTH
// ---------------------------------------------------------------------------

/**
 * Generate all file paths for a problem submission.
 * This is the ONLY function that should build paths for GitHub uploads.
 *
 * @param {{
 *   platform: "leetcode"|"gfg",
 *   folderBase: string,      – user's chosen top-level folder (e.g. "Leetcode_Problems")
 *   problemNumber?: number,
 *   problemSlug: string,
 *   problemTitle: string,
 *   language: string,
 * }} opts
 * @returns {{
 *   problemFolder: string,    – e.g. "0196_koko-eating-bananas"
 *   folderPath: string,       – e.g. "Leetcode_Problems/0196_koko-eating-bananas"
 *   codePath: string,         – e.g. "Leetcode_Problems/0196_koko-eating-bananas/solution.java"
 *   readmePath: string,       – e.g. "Leetcode_Problems/0196_koko-eating-bananas/README.md"
 *   ext: string,              – e.g. ".java"
 * }}
 */
export function generateProblemPath(opts) {
  const { platform, folderBase, problemNumber, problemSlug, problemTitle, language } = opts;

  const problemFolder = platform === "leetcode"
    ? leetcodeFolderName(problemNumber, problemSlug)
    : gfgFolderName(problemTitle, problemSlug);

  const ext = getExtension(language);
  const folderPath  = `${folderBase}/${problemFolder}`;
  const codePath    = `${folderPath}/solution${ext}`;
  const readmePath  = `${folderPath}/README.md`;

  return { problemFolder, folderPath, codePath, readmePath, ext };
}

// ---------------------------------------------------------------------------
// README generators
// ---------------------------------------------------------------------------

/**
 * Build the per-problem README content.
 *
 * @param {{
 *   title: string,
 *   platform: "leetcode"|"gfg",
 *   difficulty?: string,
 *   problemUrl: string,
 *   submissionDate: string,
 *   language: string,
 *   number?: number|string,
 * }} opts
 * @returns {string}
 */
export function buildProblemReadme(opts) {
  const { title, platform, difficulty, problemUrl, submissionDate, language, number } = opts;
  const platformLabel = platform === "leetcode" ? "LeetCode" : "GeeksForGeeks";
  const displayNum    = number ? `${String(number).padStart(4, "0")}. ` : "";
  const diffLine      = difficulty ? `**Difficulty:** ${difficulty}  \n` : "";

  return `# ${displayNum}${title}

**Platform:** ${platformLabel}  
${diffLine}**Problem Link:** [View Problem](${problemUrl})  
**Submission Date:** ${submissionDate}  
**Language:** ${language}  

## Approach

<!-- Describe your approach here -->

## Time & Space Complexity

**Time Complexity:** O(?)  
**Space Complexity:** O(?)  

## Solution

See \`solution${getExtension(language)}\` in this folder.
`;
}

/**
 * Build / update the root README that tracks solved problem stats.
 *
 * Uses autogenerated markers to isolate the managed section.
 * All content outside the markers is preserved unchanged.
 *
 * IMPORTANT: This function now takes a `stats` object (from computeAnalytics)
 * and a `lastSolvedDate` string, not raw problem lists.
 * The old `leetcodeProblems` / `gfgProblems` approach is retired.
 *
 * @param {{
 *   repoName?:       string,
 *   stats:           { totalSolved: number, leetcode: number, gfg: number,
 *                      easy: number, medium: number, hard: number,
 *                      currentStreak: number, longestStreak: number,
 *                      solvedDates: string[] },
 *   existingContent?: string,  // Current README text (may already have markers)
 * }} opts
 * @returns {string}
 */
export function buildRootReadme({ repoName = "DSA Solutions", stats, existingContent = "" }) {
  const now     = new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC";
  const s       = stats || { totalSolved: 0, leetcode: 0, gfg: 0, easy: 0, medium: 0, hard: 0, currentStreak: 0, longestStreak: 0, solvedDates: [] };

  // Last solved date — pick the last date in solvedDates array
  const lastDate = (s.solvedDates && s.solvedDates.length > 0)
    ? s.solvedDates[s.solvedDates.length - 1]
    : "—";

  const block = [
    "<!-- LEETGFGHUB_STATS_START -->",
    "",
    "## 📊 Statistics",
    "",
    `| Metric              | Count         |`,
    `| ------------------- | ------------- |`,
    `| Total Solved        | **${s.totalSolved}**  |`,
    `| LeetCode            | ${s.leetcode}            |`,
    `| GeeksForGeeks       | ${s.gfg}            |`,
    `| Easy                | ${s.easy}            |`,
    `| Medium              | ${s.medium}            |`,
    `| Hard                | ${s.hard}            |`,
    `| Last Solved         | ${lastDate}   |`,
    "",
    `> _Last updated: ${now}_`,
    `> _Automatically generated by [LeetGFGHub](https://github.com/abhinay1376/leetgfghub)._`,
    "",
    "<!-- LEETGFGHUB_STATS_END -->",
  ].join("\n");

  const START_MARKER = "<!-- LEETGFGHUB_STATS_START -->";
  const END_MARKER   = "<!-- LEETGFGHUB_STATS_END -->";

  if (existingContent.includes(START_MARKER) && existingContent.includes(END_MARKER)) {
    // Replace only the managed block — preserve all other content
    const startIdx = existingContent.indexOf(START_MARKER);
    const endIdx   = existingContent.indexOf(END_MARKER) + END_MARKER.length;
    return existingContent.substring(0, startIdx) + block + existingContent.substring(endIdx);
  }

  // No markers yet — prepend marker block right after the first H1 (if any) or at the top
  const h1Match = existingContent.match(/^#\s.+$/m);
  if (h1Match && h1Match.index !== undefined) {
    const insertAt = h1Match.index + h1Match[0].length;
    return existingContent.substring(0, insertAt) + "\n\n" + block + "\n" + existingContent.substring(insertAt).replace(/^\n+/, "\n");
  }

  // Fallback — no existing content at all: create a minimal README with the block
  return `# ${repoName}\n\n` + block + "\n";
}

/**
 * Parse existing README — kept for backward-compat but no longer used by the
 * primary push flow (analytics come from .dsa-sync/analytics.json now).
 *
 * @param {string} existingContent
 * @returns {{ leetcodeProblems: any[], gfgProblems: any[] }}
 */
export function parseRootReadme(existingContent) {
  const leetcodeProblems = [];
  const gfgProblems      = [];

  if (!existingContent) return { leetcodeProblems, gfgProblems };

  try {
    // Extract LeetCode rows (legacy format): | `0001` | [Title](path) | Difficulty |
    const lcRegex = /\|\s*`(\d+)`\s*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*([^|]*?)\s*\|/g;
    let m;
    while ((m = lcRegex.exec(existingContent)) !== null) {
      leetcodeProblems.push({ number: m[1], title: m[2], path: m[3], difficulty: m[4].trim() || undefined });
    }

    // Extract GFG rows (legacy format): | [Title](path) |
    const gfgRegex = /\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|/g;
    while ((m = gfgRegex.exec(existingContent)) !== null) {
      if (!/^\d{4}$/.test(m[1])) {
        gfgProblems.push({ title: m[1], path: m[2] });
      }
    }
  } catch (_) {}

  return { leetcodeProblems, gfgProblems };
}

/**
 * Produce a human-readable error message for a GitHubError.
 * @param {import('./github-service.js').GitHubError} err
 * @returns {string}
 */
export function friendlyError(err) {
  if (!err || !err.code) return err?.message ?? "Unknown error";
  const map = {
    INVALID_TOKEN:   "❌ Invalid token — go to Settings → Reconnect GitHub.",
    REPO_NOT_FOUND:  "❌ Repository not found. Check permissions in Settings.",
    NO_PERMISSION:   "❌ No write access to this repository.",
    SHA_MISMATCH:    "⚠️ File conflict — please retry.",
    RATE_LIMITED:    "⏳ GitHub rate limit hit. Wait a moment and retry.",
    NETWORK_FAILURE: "🌐 Network error. Check your connection.",
    BAD_CONFIG:      "⚙️ Not fully configured — open Settings to complete setup.",
    UNKNOWN:         `Unknown error: ${err.message}`,
  };
  return map[err.code] ?? err.message;
}
