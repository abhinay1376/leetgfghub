/**
 * @fileoverview ThemeService — Premium theme system for LeetGFGHub v3.0
 *
 * Themes: dark | light | system
 * Persists preference in chrome.storage.sync.
 * Applies CSS custom properties to :root.
 */

const THEMES = {
  dark: {
    "--bg-app":           "#0d0d0f",
    "--bg-secondary":     "#141416",
    "--bg-tertiary":      "#1c1c1e",
    "--bg-card":          "rgba(255,255,255,0.04)",
    "--bg-card-hover":    "rgba(255,255,255,0.07)",
    "--bg-card-active":   "rgba(255,255,255,0.10)",
    "--bg-input":         "rgba(0,0,0,0.30)",
    "--bg-nav":           "rgba(13,13,15,0.88)",
    "--bg-overlay":       "rgba(0,0,0,0.60)",

    "--border":           "rgba(255,255,255,0.07)",
    "--border-strong":    "rgba(255,255,255,0.14)",
    "--border-active":    "rgba(255,255,255,0.22)",

    "--text-primary":     "#f5f5f7",
    "--text-secondary":   "#98989f",
    "--text-tertiary":    "#636366",
    "--text-inverse":     "#1c1c1e",

    "--accent":           "#34c759",     // Apple Green
    "--accent-muted":     "rgba(52,199,89,0.15)",
    "--accent-orange":    "#ff9f0a",     // Apple Orange
    "--accent-orange-m":  "rgba(255,159,10,0.15)",
    "--accent-red":       "#ff453a",     // Apple Red
    "--accent-red-m":     "rgba(255,69,58,0.15)",
    "--accent-blue":      "#0a84ff",     // Apple Blue
    "--accent-blue-m":    "rgba(10,132,255,0.15)",
    "--accent-purple":    "#bf5af2",     // Apple Purple
    "--accent-lc":        "#ffa116",     // LeetCode
    "--accent-lc-m":      "rgba(255,161,22,0.15)",
    "--accent-gfg":       "#2db55d",     // GFG
    "--accent-gfg-m":     "rgba(45,181,93,0.15)",

    "--shadow-sm":        "0 1px 3px rgba(0,0,0,0.4)",
    "--shadow-md":        "0 4px 16px rgba(0,0,0,0.4)",
    "--shadow-lg":        "0 8px 32px rgba(0,0,0,0.5)",
    "--shadow-xl":        "0 24px 64px rgba(0,0,0,0.6)",

    "--blur-sm":          "12px",
    "--blur-md":          "24px",
    "--blur-lg":          "48px",

    "--radius-sm":        "8px",
    "--radius-md":        "12px",
    "--radius-lg":        "16px",
    "--radius-xl":        "20px",
    "--radius-full":      "999px",
  },

  light: {
    "--bg-app":           "#f2f2f7",
    "--bg-secondary":     "#ffffff",
    "--bg-tertiary":      "#f2f2f7",
    "--bg-card":          "rgba(255,255,255,0.80)",
    "--bg-card-hover":    "rgba(255,255,255,0.95)",
    "--bg-card-active":   "rgba(240,240,245,0.95)",
    "--bg-input":         "rgba(0,0,0,0.05)",
    "--bg-nav":           "rgba(242,242,247,0.90)",
    "--bg-overlay":       "rgba(0,0,0,0.30)",

    "--border":           "rgba(0,0,0,0.08)",
    "--border-strong":    "rgba(0,0,0,0.14)",
    "--border-active":    "rgba(0,0,0,0.22)",

    "--text-primary":     "#1c1c1e",
    "--text-secondary":   "#636366",
    "--text-tertiary":    "#aeaeb2",
    "--text-inverse":     "#f5f5f7",

    "--accent":           "#30b04d",
    "--accent-muted":     "rgba(48,176,77,0.12)",
    "--accent-orange":    "#f09200",
    "--accent-orange-m":  "rgba(240,146,0,0.12)",
    "--accent-red":       "#e03530",
    "--accent-red-m":     "rgba(224,53,48,0.12)",
    "--accent-blue":      "#007aff",
    "--accent-blue-m":    "rgba(0,122,255,0.12)",
    "--accent-purple":    "#9c4bdd",
    "--accent-lc":        "#f5a623",
    "--accent-lc-m":      "rgba(245,166,35,0.12)",
    "--accent-gfg":       "#298a4f",
    "--accent-gfg-m":     "rgba(41,138,79,0.12)",

    "--shadow-sm":        "0 1px 3px rgba(0,0,0,0.08)",
    "--shadow-md":        "0 4px 16px rgba(0,0,0,0.10)",
    "--shadow-lg":        "0 8px 32px rgba(0,0,0,0.14)",
    "--shadow-xl":        "0 24px 64px rgba(0,0,0,0.18)",

    "--blur-sm":          "12px",
    "--blur-md":          "24px",
    "--blur-lg":          "48px",

    "--radius-sm":        "8px",
    "--radius-md":        "12px",
    "--radius-lg":        "16px",
    "--radius-xl":        "20px",
    "--radius-full":      "999px",
  },
};

// Copy all other tokens from dark to light where same
Object.assign(THEMES.light, {
  "--blur-sm":    THEMES.dark["--blur-sm"],
  "--blur-md":    THEMES.dark["--blur-md"],
  "--blur-lg":    THEMES.dark["--blur-lg"],
  "--radius-sm":  THEMES.dark["--radius-sm"],
  "--radius-md":  THEMES.dark["--radius-md"],
  "--radius-lg":  THEMES.dark["--radius-lg"],
  "--radius-xl":  THEMES.dark["--radius-xl"],
  "--radius-full":THEMES.dark["--radius-full"],
});

// ---------------------------------------------------------------------------
// Theme application
// ---------------------------------------------------------------------------

let _currentTheme = "dark";
let _mediaQuery   = null;

/**
 * Apply a theme by name. Writes CSS variables to :root.
 * @param {"dark"|"light"|"system"} name
 */
export function applyTheme(name) {
  _currentTheme = name;
  const resolved = name === "system" ? detectSystemTheme() : name;
  const tokens   = THEMES[resolved] || THEMES.dark;

  const root = document.documentElement;
  for (const [prop, value] of Object.entries(tokens)) {
    root.style.setProperty(prop, value);
  }

  root.setAttribute("data-theme", resolved);
}

/**
 * Initialize theme. Call once when popup loads.
 * @param {"dark"|"light"|"system"} savedTheme
 */
export function initTheme(savedTheme = "dark") {
  applyTheme(savedTheme);

  // Watch system theme changes if "system" is selected
  if (!_mediaQuery) {
    _mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    _mediaQuery.addEventListener("change", () => {
      if (_currentTheme === "system") applyTheme("system");
    });
  }
}

export function detectSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function getCurrentTheme() { return _currentTheme; }
