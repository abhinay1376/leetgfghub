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
  const raw = title || slug || "unknown";
  // Strip GFG-appended status suffixes (e.g. "| Solved", "(Solved)")
  const source = raw
    .replace(/\s*[|\u2013\-]\s*(solved|accepted|correct|passed|submission|practice).*$/i, "")
    .replace(/\s*(solved|\(solved\)|\[solved\])\s*$/i, "")
    .trim() || "unknown";
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
// README Solution Parsing & Merging
// ---------------------------------------------------------------------------

/**
 * Parse existing README to count solutions.
 * Looks for "## Solution N" pattern.
 * @param {string} readmeContent
 * @returns {number} Count of existing solutions
 */
export function countExistingSolutions(readmeContent) {
  if (!readmeContent || typeof readmeContent !== "string") return 0;
  return getExistingSolutionNumbers(readmeContent).length;
}

/**
 * Return the solution numbers present in a README, sorted numerically.
 * @param {string} readmeContent
 * @returns {number[]}
 */
export function getExistingSolutionNumbers(readmeContent) {
  if (!readmeContent || typeof readmeContent !== "string") return [];
  const numbers = [...readmeContent.matchAll(/^##\s+Solution\s+(\d+)$/gm)]
    .map(match => Number(match[1]));
  return [...new Set(numbers)].sort((a, b) => a - b);
}

/**
 * Extract a specific solution from existing README.
 * Returns everything from "## Solution N" to the next "## Solution" or end of file.
 * @param {string} readmeContent
 * @param {number} solutionNumber
 * @returns {string} The solution section, including the header
 */
export function extractSolution(readmeContent, solutionNumber) {
  if (!readmeContent) return null;
  const pattern = new RegExp(`^## Solution ${solutionNumber}$[\\s\\S]*?(?=^## Solution \\d+$|$)`, "gm");
  const match = readmeContent.match(pattern);
  return match ? match[0].trim() : null;
}

/**
 * Generate a single solution block to add or replace.
 * @param {{
 *   solutionNumber: number,
 *   code: string,
 *   language: string,
 *   revisionNotes?: Record<string, string>,
 * }} opts
 * @returns {string}
 */
export function buildSolutionBlock(opts) {
  const { solutionNumber, code, language, revisionNotes } = opts;
  const timeComplexity = revisionNotes?.timeComplexity?.trim() || "O(?)";
  const spaceComplexity = revisionNotes?.spaceComplexity?.trim() || "O(?)";

  let sections = [];

  if (revisionNotes?.intuition?.trim()) {
    sections.push("### Intuition\n" + revisionNotes.intuition.trim());
  }

  if (revisionNotes?.careful?.trim()) {
    sections.push("### Logic to Be Careful With\n" + revisionNotes.careful.trim());
  }

  if (revisionNotes?.edgeCases?.trim()) {
    sections.push("### Edge Cases Handled\n" + revisionNotes.edgeCases.trim());
  }

  if (revisionNotes?.mistakes?.trim()) {
    sections.push("### Mistakes Made\n" + revisionNotes.mistakes.trim());
  }

  sections.push(`**Time Complexity:** ${timeComplexity}  \n**Space Complexity:** ${spaceComplexity}`);

  const fenceLang = (language || "").toLowerCase();
  const solutionCode = code || "";

  return `## Solution ${solutionNumber}

\`\`\`${fenceLang}
${solutionCode}
\`\`\`

${sections.join("\n\n")}`;
}

/**
 * Merge a new solution into existing README (append as new solution).
 * @param {string} existingContent
 * @param {string} newSolutionBlock
 * @returns {string}
 */
export function appendSolutionToReadme(existingContent, newSolutionBlock) {
  if (!existingContent || !existingContent.trim()) {
    return newSolutionBlock;
  }
  return existingContent.trimEnd() + "\n\n" + newSolutionBlock + "\n";
}

/**
 * Replace a specific solution in existing README.
 * @param {string} existingContent
 * @param {number} solutionNumber
 * @param {string} newSolutionBlock
 * @returns {string|null} Updated content, or null if solution not found
 */
export function replaceSolutionInReadme(existingContent, solutionNumber, newSolutionBlock) {
  if (!existingContent) return null;

  const pattern = new RegExp(`^## Solution ${solutionNumber}$[\\s\\S]*?(?=^## Solution \\d+$|$)`, "gm");
  const match = existingContent.match(pattern);

  if (!match) return null;

  // Replace the matched section with the new solution block
  const trailingWhitespace = match[0].match(/\s*$/)?.[0] || "";
  return existingContent.replace(pattern, newSolutionBlock.trimEnd() + trailingWhitespace);
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
 *   revisionNotes?: Record<string, string>,
 *   code: string,
 *   existingContent?: string,     // Existing README if updating
 *   solutionAction?: "new"|"add"|"overwrite",
 *   solutionNumber?: number,       // Which solution to add/overwrite
 * }} opts
 * @returns {string}
 */
export function buildProblemReadme(opts) {
  const {
    title, platform, difficulty, problemUrl, submissionDate, language, number,
    revisionNotes, code, existingContent, solutionAction, solutionNumber
  } = opts;

  const platformLabel = platform === "leetcode" ? "LeetCode" : "GeeksForGeeks";
  const displayNum    = number ? `${String(number).padStart(4, "0")}. ` : "";
  const diffLine      = difficulty ? `**Difficulty:** ${difficulty}  \n` : "";

  // Build the new solution block
  const newSolutionBlock = buildSolutionBlock({
    solutionNumber: solutionNumber || 1,
    code,
    language,
    revisionNotes,
  });

  // Handle solution merging/replacing
  let fullContent = "";

  if (solutionAction === "add" && existingContent) {
    // Append new solution to existing README (preserving header and other sections)
    fullContent = appendSolutionToReadme(existingContent, newSolutionBlock);
  } else if (solutionAction === "overwrite" && existingContent && solutionNumber) {
    // Replace specific solution in existing README
    const replaced = replaceSolutionInReadme(existingContent, solutionNumber, newSolutionBlock);
    if (!replaced) throw new Error(`Solution ${solutionNumber} does not exist`);
    fullContent = replaced;
  } else if (existingContent) {
    // README exists but solutionAction is neither "add" nor "overwrite".
    // background.js guards this before we reach here, but throw as a fail-safe
    // to prevent any silent append or overwrite.
    throw new Error(
      "An existing README was found but no explicit solution action (add/overwrite) was provided. " +
      "This is a bug — please report it."
    );
  } else {
    // No existing content: create new README with header and first solution
    fullContent = `# ${displayNum}${title}

**Platform:** ${platformLabel}
${diffLine}**Problem Link:** [View Problem](${problemUrl})
**Submission Date:** ${submissionDate}
**Language:** ${language}

## Approach

<!-- Describe your approach here -->

## Time & Space Complexity

<!-- Note: See individual solution sections below -->

${newSolutionBlock}
`;
  }

  return fullContent;
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
