/**
 * @fileoverview Revision Notes module
 *
 * Generates language-aware comment blocks prepended to solution code.
 * Validates revision note fields before allowing push.
 */

// ── Comment syntax per language ─────────────────────────────────────────────

const BLOCK_COMMENT_LANGS = new Set([
  "java", "cpp", "c++", "c", "javascript", "js", "typescript", "ts",
  "go", "rust", "kotlin", "swift", "scala", "php", "csharp", "c#",
]);

const HASH_COMMENT_LANGS = new Set(["python", "python3", "ruby"]);

/**
 * Wrap text in the correct comment syntax for a given language.
 * @param {string} language
 * @param {string} body - multiline text to wrap
 * @returns {string}
 */
function wrapComment(language, body) {
  const lang = (language || "java").toLowerCase();

  if (HASH_COMMENT_LANGS.has(lang)) {
    // Use triple-quote docstring for Python, hash lines for Ruby
    if (lang === "ruby") {
      return body.split("\n").map(l => `# ${l}`).join("\n") + "\n\n";
    }
    return `"""\n${body}\n"""\n\n`;
  }

  // Default: block comment /* ... */
  return `/*\n${body}\n*/\n\n`;
}

// ── Revision note fields ────────────────────────────────────────────────────

export const REVISION_FIELDS = [
  { key: "intuition",       label: "Intuition",                       placeholder: "How did you arrive at this approach? What pattern did you recognize?" },
  { key: "careful",         label: "Lines / Logic To Be Careful With", placeholder: "Tricky conditions, off-by-one, overflow, pointer movement, etc." },
  { key: "edgeCases",       label: "Edge Cases Handled",               placeholder: "Empty input, single element, duplicates, negative numbers, etc." },
  { key: "mistakes",        label: "Mistakes I Made",                  placeholder: "Wrong base case, forgot to sort, incorrect boundary, etc." },
  { key: "futureReminder",  label: "Future Reminder",                  placeholder: "What should your future self remember when revising this?" },
  { key: "timeComplexity",  label: "Time Complexity",                  placeholder: "e.g. O(n log n) — explain why" },
  { key: "spaceComplexity", label: "Space Complexity",                 placeholder: "e.g. O(n) — explain why" },
];

// ── Validation ──────────────────────────────────────────────────────────────

const REJECTED_VALUES = new Set([
  "*", "none", "na", "n/a", ".", "..", "...", "test", "abc", "xyz",
  "todo", "tbd", "asdf", "aaa", "bbb", "ccc", "123", "hi", "ok",
  "-", "--", "nil", "null", "undefined",
]);

// Complexity fields have a shorter minimum (e.g. "O(1)" is valid)
const COMPLEXITY_KEYS = new Set(["timeComplexity", "spaceComplexity"]);

/**
 * Validate a single revision field value.
 * @param {string} value
 * @param {string} [key]  – field key, used to relax complexity min-length
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateField(value, key) {
  const trimmed = (value || "").trim();
  if (trimmed.length === 0) {
    return { valid: false, error: "This field is required." };
  }
  const minLen = COMPLEXITY_KEYS.has(key) ? 3 : 20;
  if (trimmed.length < minLen) {
    return { valid: false, error: `Minimum ${minLen} characters (currently ${trimmed.length}).` };
  }
  if (REJECTED_VALUES.has(trimmed.toLowerCase())) {
    return { valid: false, error: "Please provide a meaningful response." };
  }
  return { valid: true };
}

/**
 * Validate all revision fields.
 * @param {Record<string, string>} notes - keyed by field key
 * @returns {{ valid: boolean, errors: Record<string, string> }}
 */
export function validateAllFields(notes) {
  const errors = {};
  let valid = true;
  for (const field of REVISION_FIELDS) {
    const result = validateField(notes[field.key], field.key);
    if (!result.valid) {
      errors[field.key] = result.error;
      valid = false;
    }
  }
  return { valid, errors };
}

// ── Comment block generation ────────────────────────────────────────────────

/**
 * Build the revision comment block.
 * @param {{
 *   title: string,
 *   platform: string,
 *   difficulty?: string,
 *   date: string,
 *   notes: Record<string, string>,
 * }} opts
 * @returns {string}
 */
export function buildRevisionBlock(opts) {
  const { title, platform, difficulty, date, notes } = opts;
  const platformLabel = platform === "leetcode" ? "LeetCode" : "GeeksForGeeks";

  const lines = [
    "Problem Revision Notes",
    "",
    `Problem:    ${title}`,
    `Platform:   ${platformLabel}`,
    difficulty ? `Difficulty: ${difficulty}` : null,
    `Date:       ${date}`,
    "",
    "─".repeat(50),
    "",
    "Intuition",
    notes.intuition?.trim() || "",
    "",
    "─".repeat(50),
    "",
    "Lines / Logic To Be Careful With",
    notes.careful?.trim() || "",
    "",
    "─".repeat(50),
    "",
    "Edge Cases Handled",
    notes.edgeCases?.trim() || "",
    "",
    "─".repeat(50),
    "",
    "Mistakes I Made",
    notes.mistakes?.trim() || "",
    "",
    "─".repeat(50),
    "",
    "Future Reminder",
    notes.futureReminder?.trim() || "",
    "",
    "─".repeat(50),
    "",
    "Time Complexity",
    notes.timeComplexity?.trim() || "",
    "",
    "Space Complexity",
    notes.spaceComplexity?.trim() || "",
    "",
    "═".repeat(50),
  ].filter(l => l !== null);

  return lines.join("\n");
}

/**
 * Prepend the revision comment block to source code.
 * @param {string} code - original source code
 * @param {string} language
 * @param {{
 *   title: string,
 *   platform: string,
 *   difficulty?: string,
 *   notes: Record<string, string>,
 * }} meta
 * @returns {string}
 */
export function prependRevisionNotes(code, language, meta) {
  const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const body = buildRevisionBlock({ ...meta, date });
  const comment = wrapComment(language, body);
  return comment + code;
}
