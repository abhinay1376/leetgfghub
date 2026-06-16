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
  const padded = String(number || 0).padStart(4, "0");
  // Convert kebab-case slug to Title_Case: "koko-eating-bananas" → "Koko_Eating_Bananas"
  const clean = (slug || "unknown")
    .split(/[-_]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .replace(/^_|_$/g, "");
  return `${padded}_${clean}`;
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
 * Build / update the root README that tracks all solved problems.
 *
 * @param {{
 *   leetcodeProblems: Array<{number: string, title: string, difficulty?: string, path: string}>,
 *   gfgProblems:      Array<{title: string, path: string}>,
 *   repoName?:        string,
 * }} opts
 * @returns {string}
 */
export function buildRootReadme({ leetcodeProblems = [], gfgProblems = [], repoName = "DSA Solutions" }) {
  const now = new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });

  const lcRows = leetcodeProblems.map(p => {
    const num   = p.number ? `\`${String(p.number).padStart(4, "0")}\`` : "";
    const diff  = p.difficulty || "—";
    return `| ${num} | [${p.title}](${p.path}) | ${diff} |`;
  }).join("\n");

  const gfgRows = gfgProblems.map(p =>
    `| [${p.title}](${p.path}) |`
  ).join("\n");

  return `# ${repoName}

> Auto-synced by **DSA Git Pusher** Chrome Extension  
> Last updated: ${now}

## Statistics

| Platform | Solved |
| -------- | ------ |
| LeetCode | ${leetcodeProblems.length} |
| GFG | ${gfgProblems.length} |
| **Total** | **${leetcodeProblems.length + gfgProblems.length}** |

---

## LeetCode

| # | Problem | Difficulty |
| - | ------- | ---------- |
${lcRows || "| — | No solutions yet | — |"}

---

## GeeksForGeeks

| Problem |
| ------- |
${gfgRows || "| No solutions yet |"}
`;
}

/**
 * Parse the existing root README and extract problem lists.
 * Returns empty arrays if parsing fails (safe fallback).
 *
 * @param {string} existingContent  – decoded README text
 * @returns {{ leetcodeProblems: any[], gfgProblems: any[] }}
 */
export function parseRootReadme(existingContent) {
  const leetcodeProblems = [];
  const gfgProblems      = [];

  if (!existingContent) return { leetcodeProblems, gfgProblems };

  try {
    // Extract LeetCode rows: | `0001` | [Title](path) | Difficulty |
    const lcRegex = /\|\s*`(\d+)`\s*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*([^|]*?)\s*\|/g;
    let m;
    while ((m = lcRegex.exec(existingContent)) !== null) {
      leetcodeProblems.push({ number: m[1], title: m[2], path: m[3], difficulty: m[4].trim() || undefined });
    }

    // Extract GFG rows: | [Title](path) |
    const gfgRegex = /\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|/g;
    while ((m = gfgRegex.exec(existingContent)) !== null) {
      // Avoid re-capturing LeetCode rows (they have numbers in front)
      if (!/^\d{4}$/.test(m[1])) {
        gfgProblems.push({ title: m[1], path: m[2] });
      }
    }
  } catch (_) { /* best-effort parse */ }

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
    INVALID_TOKEN:   "❌ Invalid GitHub token. Check your PAT in Settings.",
    REPO_NOT_FOUND:  "❌ Repository not found. Verify the URL and your permissions.",
    NO_PERMISSION:   "❌ You don't have write access to this repository.",
    SHA_MISMATCH:    "⚠️ File conflict — please retry, it should work on second attempt.",
    RATE_LIMITED:    "⏳ GitHub API rate limit hit. Wait a minute and retry.",
    NETWORK_FAILURE: "🌐 Network error. Check your internet connection.",
    BAD_CONFIG:      "⚙️ Extension not fully configured. Open Settings.",
    UNKNOWN:         `Unknown error: ${err.message}`,
  };
  return map[err.code] ?? err.message;
}
