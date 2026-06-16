/**
 * @fileoverview Popup UI Logic & DSA Analytics Dashboard
 * Apple Human Interface Design guidelines applied.
 * Renders high-performance interactive SVG charts, Git-style heatmap, and streak metrics.
 */

// ---------------------------------------------------------------------------
// Pure helper functions (regex, formatters)
// ---------------------------------------------------------------------------

function parseRepoUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const url = rawUrl.trim();
  const ssh = url.match(/git@github\.com[:/]([^/]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  const https = url.match(/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/.*)?$/i);
  if (https) return { owner: https[1], repo: https[2] };
  return null;
}

/** Escape HTML special characters to prevent injection. */
function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const secs = Math.floor(diff / 1000);
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (secs < 60) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  return new Date(timestamp).toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

/**
 * Animate text count up from start to end value.
 * @param {string} id Element ID
 * @param {number} start Start value
 * @param {number} end End value
 * @param {number} duration Duration in ms
 */
function animateValue(id, start, end, duration = 800) {
  const obj = document.getElementById(id);
  if (!obj) return;
  if (start === end) {
    obj.textContent = end;
    return;
  }
  
  const startTime = performance.now();
  
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Ease out cubic
    const ease = 1 - Math.pow(1 - progress, 3);
    const value = Math.floor(start + ease * (end - start));
    
    obj.textContent = value;
    
    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      obj.textContent = end;
    }
  }
  
  requestAnimationFrame(update);
}

// ---------------------------------------------------------------------------
// Theme System Manager
// ---------------------------------------------------------------------------

class ThemeManager {
  constructor() {
    this.html = document.documentElement;
    this.sysMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    this.activeTheme = "system";
    this.boundListener = this._handleSystemThemeChange.bind(this);
  }

  async init() {
    const data = await chrome.storage.sync.get(["theme"]);
    this.activeTheme = data.theme || "system";
    this.apply(this.activeTheme);
  }

  apply(mode) {
    this.activeTheme = mode;
    this.html.classList.add("theme-transitioning");
    this.sysMediaQuery.removeEventListener("change", this.boundListener);

    if (mode === "system") {
      this._applySystemTheme();
      this.sysMediaQuery.addEventListener("change", this.boundListener);
    } else {
      this.html.className = `theme-${mode}`;
    }

    chrome.storage.sync.set({ theme: mode });
    setTimeout(() => {
      this.html.classList.remove("theme-transitioning");
    }, 300);
  }

  _applySystemTheme() {
    const isDark = this.sysMediaQuery.matches;
    this.html.className = isDark ? "theme-dark" : "theme-light";
  }

  _handleSystemThemeChange() {
    if (this.activeTheme === "system") {
      this._applySystemTheme();
    }
  }
}

const themeManager = new ThemeManager();

// ---------------------------------------------------------------------------
// Smart Topic Classifier
// ---------------------------------------------------------------------------

function classifyTopic(slug, title) {
  const text = `${slug || ""} ${title || ""}`.toLowerCase();
  
  if (/\b(tree|bst|node|traversal|ancestor|binary-tree|trie)\b/.test(text)) return "Trees";
  if (/\b(graph|dfs|bfs|island|dijkstra|mst|path|bridge|cycle)\b/.test(text)) return "Graphs";
  if (/\b(search|binary-search|sort|mergesort|quicksort|find)\b/.test(text)) return "Binary Search / Sorting";
  if (/\b(dp|dynamic|memo|coin|subsequence|knapsack|lcs|lis|fibonacci|grid-path)\b/.test(text)) return "Dynamic Programming";
  if (/\b(string|anagram|palindrome|regex|char|reverse-string)\b/.test(text)) return "Strings";
  if (/\b(linked-list|list|reverse-list|cycle-list|pointer)\b/.test(text)) return "Linked Lists";
  if (/\b(matrix|grid|sudoku|spiral|diagonal)\b/.test(text)) return "Matrix / Grid";
  if (/\b(greedy|interval|jump|activity|fractional)\b/.test(text)) return "Greedy";
  if (/\b(hash|map|dictionary|frequency|two-sum)\b/.test(text)) return "Hashing / Maps";
  
  return "Arrays / Math";
}

// ---------------------------------------------------------------------------
// Main UI Controller
// ---------------------------------------------------------------------------

class PopupUIController {
  constructor() {
    this.activeTab = "dashboard";
    this.history = [];
    this.pending = [];
    this.config = {};
    
    // UI Local Filters
    this.difficultyFilter = "combined"; // combined, leetcode, gfg
    this.trendPeriod = "7"; // 7, 30, 90, all
  }

  async init() {
    this._setupTabs();
    await this._loadSettings();
    await this.refreshAllData();
    this._registerHandlers();

    // Show Welcome Screen on first run
    if (!this.config.githubToken) {
      const overlay = _id("welcome-overlay");
      if (overlay) overlay.style.display = "flex";
    }

    // Live update triggers
    chrome.storage.onChanged.addListener(() => {
      this.refreshAllData();
    });
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  _setupTabs() {
    const navItems = document.querySelectorAll(".nav-item");
    const pages = document.querySelectorAll(".page-pane");
    const titleLabel = _id("page-title-label");
    const subtitleLabel = _id("header-subtitle-label");

    const pageMeta = {
      dashboard: { title: "Insights", sub: "DSA Progress Analytics" },
      repositories: { title: "Repositories", sub: "Linked Solution Repos" },
      pending: { title: "Pending Pushes", sub: "Queued Offline Submissions" },
      activity: { title: "Activity", sub: "Global Push Log" },
      settings: { title: "Settings", sub: "System Configuration" },
      about: { title: "About", sub: "DSA Git Pusher Info" }
    };

    navItems.forEach(item => {
      item.addEventListener("click", () => {
        const tab = item.dataset.tab;
        this.activeTab = tab;

        navItems.forEach(i => i.classList.remove("active"));
        pages.forEach(p => p.classList.remove("active"));

        item.classList.add("active");
        const activePage = _id(`page-pane-${tab}`);
        if (activePage) activePage.classList.add("active");

        const meta = pageMeta[tab] || { title: "DSA Pusher", sub: "" };
        titleLabel.textContent = meta.title;
        subtitleLabel.textContent = meta.sub;

        const container = document.querySelector(".pages-container");
        if (container) container.scrollTop = 0;
      });
    });

    _id("view-pending-link").onclick = () => _id("nav-btn-pending").click();
    _id("dashboard-view-all-activity").onclick = () => _id("nav-btn-activity").click();
  }

  // ── Data Refreshing & Calculations ────────────────────────────────────────

  async refreshAllData() {
    this.config = await chrome.storage.sync.get([
      "githubToken", "githubUser", "lcRepoUrl", "gfgRepoUrl", 
      "leetcodeFolder", "gfgFolder", "notificationsEnabled"
    ]);

    const histData = await chrome.storage.local.get(["pushHistory"]);
    this.history = histData.pushHistory || [];

    // Auto-sync: if local history is empty but repos are configured, try recovering
    if (this.history.length === 0 && this.config.githubToken && (this.config.lcRepoUrl || this.config.gfgRepoUrl)) {
      try {
        const syncResult = await chrome.runtime.sendMessage({ type: "SYNC_FROM_REPO" });
        if (syncResult?.success && syncResult.entries?.length > 0) {
          this.history = syncResult.entries;
        }
      } catch (_) { /* silent — sync is best-effort */ }
    }

    const pendData = await chrome.storage.local.get(["pendingPushes"]);
    this.pending = pendData.pendingPushes || [];

    this._renderHeaderStatus();
    this._renderAnalytics();
    this._renderRepoList();
    this._renderPendingPushes();
    this._renderActivityTimeline();
  }

  _renderHeaderStatus() {
    const dot = _id("status-indicator-dot");
    const text = _id("connection-label");

    const connected = this.config.githubUser && (this.config.lcRepoUrl || this.config.gfgRepoUrl);
    if (connected) {
      dot.className = "status-indicator connected";
      text.textContent = `@${this.config.githubUser}`;
    } else {
      dot.className = "status-indicator";
      text.textContent = "Disconnected";
    }
  }

  _renderAnalytics() {
    // 1. Calculate Streak Metrics
    const streak = this._calculateStreaks(this.history);
    
    // 2. Count period metrics
    const thisWeek = this._countSolvesInPeriod(this.history, 7 * 24 * 60 * 60 * 1000);
    const thisMonth = this._countSolvesInPeriod(this.history, 30 * 24 * 60 * 60 * 1000);

    // 3. Stagger Animate KPI Counters
    const prevTotal = parseInt(_id("stat-total").textContent) || 0;
    animateValue("stat-total", prevTotal, this.history.length);
    animateValue("stat-current-streak", 0, streak.current);
    animateValue("stat-longest-streak", 0, streak.longest);
    animateValue("stat-this-week", 0, thisWeek);
    animateValue("stat-this-month", 0, thisMonth);
    
    const prevPending = parseInt(_id("stat-pending").textContent) || 0;
    animateValue("stat-pending", prevPending, this.pending.length);
    
    const banner = _id("pending-banner");
    const bannerText = _id("pending-banner-text");
    if (banner && bannerText) {
      if (this.pending.length > 0) {
        banner.style.display = "";
        bannerText.textContent = this.pending.length === 1 
          ? "1 solution queued locally" 
          : `${this.pending.length} solutions queued locally`;
      } else {
        banner.style.display = "none";
      }
    }

    _id("stat-active-days").textContent = streak.activeDays;

    // 4. Render Git Contribution Heatmap
    this._renderHeatmap(streak.datesMap);

    // 5. Render Gauges (Platform & Difficulty)
    this._renderDifficultyGauges();

    // 6. Render Trend Chart
    this._renderTrendChart();

    // 7. Render Language usage
    this._renderLanguages();

    // 8. Render Topic statistics
    this._renderTopics();

    // 9. Achievements Activation
    this._updateAchievements(streak.longest);

    // 10. Mini Recent Feed
    this._renderMiniRecentFeed();
  }

  // ── Analytics Calculators ──────────────────────────────────────────────────

  _calculateStreaks(history) {
    if (!history || history.length === 0) {
      return { current: 0, longest: 0, activeDays: 0, datesMap: new Map() };
    }

    // Map: DateString -> Solve count on that date
    const datesMap = new Map();
    history.forEach(item => {
      const dateStr = new Date(item.timestamp).toDateString();
      datesMap.set(dateStr, (datesMap.get(dateStr) || 0) + 1);
    });

    // Sort unique dates in ascending order
    const sortedDates = Array.from(datesMap.keys()).map(d => new Date(d));
    sortedDates.sort((a, b) => a - b);

    let longest = 0;
    let current = 0;
    let tempStreak = 0;
    let prev = null;

    sortedDates.forEach(curr => {
      curr.setHours(0, 0, 0, 0);
      if (!prev) {
        tempStreak = 1;
      } else {
        const diff = Math.ceil(Math.abs(curr - prev) / (1000 * 60 * 60 * 24));
        if (diff === 1) {
          tempStreak++;
        } else if (diff > 1) {
          if (tempStreak > longest) longest = tempStreak;
          tempStreak = 1;
        }
      }
      prev = curr;
    });
    if (tempStreak > longest) longest = tempStreak;

    // Calculate current streak starting from today or yesterday
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const hasToday = datesMap.has(today.toDateString());
    const hasYesterday = datesMap.has(yesterday.toDateString());

    if (hasToday || hasYesterday) {
      let checkDate = hasToday ? today : yesterday;
      let count = 0;
      while (datesMap.has(checkDate.toDateString())) {
        count++;
        checkDate.setDate(checkDate.getDate() - 1);
      }
      current = count;
    } else {
      current = 0;
    }

    return { current, longest, activeDays: datesMap.size, datesMap };
  }

  _countSolvesInPeriod(history, timeWindowMs) {
    const cutoff = Date.now() - timeWindowMs;
    return history.filter(h => h.timestamp >= cutoff).length;
  }

  // ── Visualization Renderers ───────────────────────────────────────────────

  _renderHeatmap(datesMap) {
    const grid = _id("heatmap-grid-inner");
    const monthsRow = _id("heatmap-month-row");
    const tooltip = _id("heatmap-cell-tooltip");
    
    grid.innerHTML = "";
    monthsRow.innerHTML = "";

    // Generate a 7x24 grid representing the last 24 weeks
    const weeksToRender = 24;
    const totalDays = weeksToRender * 7;

    const today = new Date();
    const startOffset = today.getDay(); // 0 (Sun) - 6 (Sat)
    
    // Start grid on Sunday of 23 weeks ago
    const startDate = new Date();
    startDate.setDate(today.getDate() - (weeksToRender - 1) * 7 - startOffset);
    startDate.setHours(0, 0, 0, 0);

    const cellsHtml = [];
    const monthPos = []; // Track where months shift to place labels

    for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
      const cellDate = new Date(startDate);
      cellDate.setDate(startDate.getDate() + dayOffset);

      const dateStr = cellDate.toDateString();
      const count = datesMap.get(dateStr) || 0;

      let level = 0;
      if (count === 1) level = 1;
      else if (count >= 2 && count <= 3) level = 2;
      else if (count >= 4 && count <= 6) level = 3;
      else if (count >= 7) level = 4;

      const fmtDate = cellDate.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" });
      const label = count === 1 ? "1 problem solved" : `${count} problems solved`;

      cellsHtml.push(`
        <div class="heatmap-cell level-${level}" 
             data-tooltip="${label} on ${fmtDate}" 
             aria-label="${label} on ${fmtDate}">
        </div>
      `);

      // Track month transitions in top row (row 0)
      if (dayOffset % 7 === 0) {
        const colIdx = dayOffset / 7;
        const monthAbbr = cellDate.toLocaleDateString("en-US", { month: "short" });
        if (monthPos.length === 0 || monthPos[monthPos.length - 1].month !== monthAbbr) {
          monthPos.push({ index: colIdx, month: monthAbbr });
        }
      }
    }

    grid.innerHTML = cellsHtml.join("");

    // Render month labels at computed column widths (5px cell + 2.2px gap = 7.2px per col)
    monthPos.forEach(m => {
      const leftPx = m.index * 7.2;
      const label = document.createElement("span");
      label.style.position = "absolute";
      label.style.left = `${leftPx}px`;
      label.textContent = m.month;
      monthsRow.appendChild(label);
    });

    // Tooltip listeners
    const cells = grid.querySelectorAll(".heatmap-cell");
    cells.forEach(cell => {
      cell.addEventListener("mouseenter", e => {
        const text = cell.getAttribute("data-tooltip");
        tooltip.textContent = text;
        tooltip.style.display = "block";
        
        // Position tooltip
        const rect = cell.getBoundingClientRect();
        const popupRect = document.body.getBoundingClientRect();
        
        const top = rect.top - popupRect.top - 24;
        const left = rect.left - popupRect.left - 40;
        
        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
      });

      cell.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });
    });
  }

  _renderDifficultyGauges() {
    const filter = this.difficultyFilter;
    const history = this.history;

    // Filter list
    const items = history.filter(h => {
      if (filter === "leetcode") return h.platform === "leetcode";
      if (filter === "gfg") return h.platform === "gfg";
      return true;
    });

    const total = items.length;
    const easy = items.filter(h => h.difficulty === "Easy").length;
    const med = items.filter(h => h.difficulty === "Medium").length;
    const hard = items.filter(h => h.difficulty === "Hard").length;

    // Center Donut text
    _id("donut-center-total").textContent = total;

    // Set donut segment lengths
    const lcCount = history.filter(h => h.platform === "leetcode").length;
    const gfgCount = history.filter(h => h.platform === "gfg").length;
    const globalTotal = lcCount + gfgCount;

    const segLc = _id("donut-seg-lc");
    const segGfg = _id("donut-seg-gfg");

    if (globalTotal === 0) {
      segLc.setAttribute("stroke-dasharray", "0 100");
      segGfg.setAttribute("stroke-dasharray", "0 100");
    } else {
      const lcPercent = (lcCount / globalTotal) * 100;
      const gfgPercent = (gfgCount / globalTotal) * 100;

      segLc.setAttribute("stroke-dasharray", `${lcPercent} ${100 - lcPercent}`);
      segGfg.setAttribute("stroke-dasharray", `${gfgPercent} ${100 - gfgPercent}`);
      segGfg.setAttribute("stroke-dashoffset", `-${lcPercent}`);
    }

    // Set Difficulty Labels
    _id("lbl-gauge-easy").textContent = `${easy} / ${total}`;
    _id("lbl-gauge-medium").textContent = `${med} / ${total}`;
    _id("lbl-gauge-hard").textContent = `${hard} / ${total}`;

    // Set Progress bars
    const easyPct = total > 0 ? (easy / total) * 100 : 0;
    const medPct = total > 0 ? (med / total) * 100 : 0;
    const hardPct = total > 0 ? (hard / total) * 100 : 0;

    _id("fill-gauge-easy").style.width = `${easyPct}%`;
    _id("fill-gauge-medium").style.width = `${medPct}%`;
    _id("fill-gauge-hard").style.width = `${hardPct}%`;
  }

  _renderTrendChart() {
    const period = this.trendPeriod;
    const history = this.history;
    const linePath = _id("trend-line-path");
    const areaPath = _id("trend-area-path");

    if (history.length === 0) {
      linePath.setAttribute("d", "M 0 80 L 300 80");
      areaPath.setAttribute("d", "M 0 80 L 300 80 L 300 90 L 0 90 Z");
      return;
    }

    // Determine day scope
    let dayCount = 7;
    if (period === "30") dayCount = 30;
    else if (period === "90") dayCount = 90;
    else if (period === "all") {
      // Find range between first solve and today
      const sortedHistory = [...history].sort((a,b) => a.timestamp - b.timestamp);
      const firstTs = sortedHistory[0]?.timestamp || Date.now();
      dayCount = Math.max(7, Math.ceil((Date.now() - firstTs) / (1000 * 60 * 60 * 24)));
    }

    // Generate list of dates
    const dates = [];
    for (let i = dayCount - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(todayDateOnly().getDate() - i);
      d.setHours(0,0,0,0);
      dates.push(d);
    }

    // Calculate cumulative solve count at each date
    const counts = [];
    dates.forEach(d => {
      const cutoff = d.getTime() + 24 * 60 * 60 * 1000; // End of the day
      const countAtDate = history.filter(h => h.timestamp < cutoff).length;
      counts.push(countAtDate);
    });

    // Map to coordinates (Width: 300, Height: 90)
    const minVal = Math.min(...counts);
    const maxVal = Math.max(...counts);
    const valRange = maxVal - minVal;

    const coords = [];
    const stepX = 300 / (dayCount - 1);

    for (let i = 0; i < dayCount; i++) {
      const x = i * stepX;
      let y = 45; // default if range is 0
      if (valRange > 0) {
        y = 80 - ((counts[i] - minVal) / valRange) * 65; // map between Y: 15 and Y: 80
      } else if (maxVal > 0) {
        y = 35; // flat line above
      } else {
        y = 80; // flat line at bottom
      }
      coords.push({ x, y });
    }

    // Create Path String
    let dLine = `M ${coords[0].x} ${coords[0].y}`;
    for (let i = 1; i < coords.length; i++) {
      // Draw smooth curves or clean points
      dLine += ` L ${coords[i].x} ${coords[i].y}`;
    }

    const dArea = `${dLine} L 300 90 L 0 90 Z`;

    linePath.setAttribute("d", dLine);
    areaPath.setAttribute("d", dArea);

    function todayDateOnly() {
      const d = new Date();
      d.setHours(0,0,0,0);
      return d;
    }
  }

  _renderLanguages() {
    const container = _id("language-list-container");
    container.innerHTML = "";

    if (this.history.length === 0) {
      container.innerHTML = `<span style="font-size: 11px; color: var(--text-muted);">No language logs.</span>`;
      return;
    }

    // Count platforms
    const langs = {};
    this.history.forEach(h => {
      const l = h.language || "java";
      let name = "Java";
      if (l.includes("py")) name = "Python";
      else if (l.includes("cpp") || l.includes("c++")) name = "C++";
      else if (l.includes("js") || l.includes("javascript")) name = "JavaScript";
      else if (l.includes("ts") || l.includes("typescript")) name = "TypeScript";
      else if (l.includes("rust")) name = "Rust";
      else name = l.charAt(0).toUpperCase() + l.slice(1);

      langs[name] = (langs[name] || 0) + 1;
    });

    const sorted = Object.entries(langs).sort((a,b) => b[1] - a[1]).slice(0, 4);
    const total = this.history.length;

    const colors = {
      "Java": "#E76F51",
      "Python": "#3776AB",
      "C++": "#00599C",
      "JavaScript": "#F7DF1E",
      "TypeScript": "#3178C6",
      "Rust": "#DEA584"
    };

    container.innerHTML = sorted.map(([name, count]) => {
      const pct = Math.round((count / total) * 100);
      const color = colors[name] || "var(--primary)";
      return `
        <div class="skill-row">
          <div class="skill-lbl-row">
            <span style="font-weight: 500; font-size: 11px; color: var(--text-secondary);">${name}</span>
            <span style="font-size: 10px; color: var(--text-muted);">${pct}% (${count})</span>
          </div>
          <div class="diff-progress-track" style="height: 3px;">
            <div class="diff-progress-fill" style="background-color: ${color}; width: ${pct}%; height: 100%;"></div>
          </div>
        </div>
      `;
    }).join("");
  }

  _renderTopics() {
    if (this.history.length === 0) {
      _id("topic-top").textContent = "None";
      _id("topic-freq").textContent = "None";
      _id("topic-weak").textContent = "None";
      return;
    }

    const topics = {};
    const topicDifficulties = {}; // track Hard ratio per topic to estimate "weakest"

    this.history.forEach(h => {
      const t = classifyTopic(h.slug, h.title);
      topics[t] = (topics[t] || 0) + 1;

      if (!topicDifficulties[t]) topicDifficulties[t] = { easy: 0, medium: 0, hard: 0 };
      const diff = h.difficulty || "Easy";
      if (diff === "Easy") topicDifficulties[t].easy++;
      else if (diff === "Medium") topicDifficulties[t].medium++;
      else if (diff === "Hard") topicDifficulties[t].hard++;
    });

    const sortedTopics = Object.entries(topics).sort((a,b) => b[1] - a[1]);
    const topTopic = sortedTopics[0]?.[0] || "None";
    const freqTopic = sortedTopics[0] ? `${sortedTopics[0][0]} (${sortedTopics[0][1]})` : "None";

    // Determine weakest: topic with highest hard ratio or lowest count among solved
    // Let's identify the one with the lowest solve count among solved, which is very visual!
    const leastSolvedTopic = sortedTopics.length > 1 
      ? sortedTopics[sortedTopics.length - 1][0] 
      : "None";

    _id("topic-top").textContent = topTopic;
    _id("topic-freq").textContent = freqTopic;
    _id("topic-weak").textContent = leastSolvedTopic;
  }

  _updateAchievements(longestStreak) {
    const total = this.history.length;
    const hardCount = this.history.filter(h => h.difficulty === "Hard").length;

    const achs = [
      { id: "ach-first", active: total >= 1 },
      { id: "ach-10", active: total >= 10 },
      { id: "ach-50", active: total >= 50 },
      { id: "ach-100", active: total >= 100 },
      { id: "ach-250", active: total >= 250 },
      { id: "ach-500", active: total >= 500 },
      { id: "ach-streak", active: longestStreak >= 7 },
      { id: "ach-hard", active: hardCount >= 5 }
    ];

    achs.forEach(a => {
      const el = _id(a.id);
      if (el) {
        if (a.active) {
          el.classList.add("unlocked");
          el.setAttribute("aria-label", `${el.querySelector(".achievement-title").textContent} (Unlocked)`);
        } else {
          el.classList.remove("unlocked");
          el.setAttribute("aria-label", `${el.querySelector(".achievement-title").textContent} (Locked)`);
        }
      }
    });
  }

  _renderMiniRecentFeed() {
    const container = _id("mini-feed-container");
    container.innerHTML = "";

    if (this.history.length === 0) {
      container.innerHTML = `<span style="font-size: 11px; color: var(--text-muted); text-align: center; display: block; padding: 10px 0;">No activities logged yet.</span>`;
      return;
    }

    // Get last 3 pushed items (chronological descending)
    const recent = [...this.history].reverse().slice(0, 3);

    container.innerHTML = recent.map(item => {
      const platformClass = item.platform === "leetcode" ? "lc" : "gfg";
      const platformBadge = item.platform === "leetcode" ? "LC" : "GFG";
      const diffColor = item.difficulty === "Easy" ? "var(--success)" : item.difficulty === "Medium" ? "var(--warning)" : "var(--error)";
      const elapsed = formatRelativeTime(item.timestamp);
      const shortTitle = escapeHtml(item.title.length > 24 ? item.title.slice(0, 24) + "…" : item.title);

      return `
        <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px;">
          <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; max-width: 70%;">
            <div class="push-platform-icon ${platformClass}" style="width: 22px; height: 22px; font-size: 8px; font-weight: 700; border-radius: 6px;">${platformBadge}</div>
            <span style="font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${shortTitle}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
            <span style="font-size: 8px; font-weight: 700; color: ${diffColor}; background: ${diffColor}18; border: 1px solid ${diffColor}25; padding: 1px 5px; border-radius: 4px;">${item.difficulty || 'Easy'}</span>
            <span style="color: var(--text-muted); font-size: 9px;">${elapsed}</span>
          </div>
        </div>
      `;
    }).join("");
  }

  // ── Repository verification & timeline mapping ─────────────────────────────

  _renderRepoList() {
    const lcInfo = parseRepoUrl(this.config.lcRepoUrl);
    const gfgInfo = parseRepoUrl(this.config.gfgRepoUrl);

    const lcPill = _id("lc-repo-status-pill");
    if (lcInfo) {
      _id("lc-repo-name-label").textContent = lcInfo.repo;
      _id("lc-repo-url-label").textContent = this.config.lcRepoUrl;
      _id("lc-repo-folder-label").textContent = `${this.config.leetcodeFolder || "LeetCode"}/`;
      lcPill.className = "repo-status-label ok";
      lcPill.textContent = "🟢 Linked";
    } else {
      _id("lc-repo-name-label").textContent = "Unlinked";
      _id("lc-repo-url-label").textContent = "None";
      _id("lc-repo-folder-label").textContent = "—";
      lcPill.className = "repo-status-label err";
      lcPill.textContent = "🔴 Unlinked";
    }

    const gfgPill = _id("gfg-repo-status-pill");
    if (gfgInfo) {
      _id("gfg-repo-name-label").textContent = gfgInfo.repo;
      _id("gfg-repo-url-label").textContent = this.config.gfgRepoUrl;
      _id("gfg-repo-folder-label").textContent = `${this.config.gfgFolder || "GFG"}/`;
      gfgPill.className = "repo-status-label ok";
      gfgPill.textContent = "🟢 Linked";
    } else {
      _id("gfg-repo-name-label").textContent = "Unlinked";
      _id("gfg-repo-url-label").textContent = "None";
      _id("gfg-repo-folder-label").textContent = "—";
      gfgPill.className = "repo-status-label err";
      gfgPill.textContent = "🔴 Unlinked";
    }
  }

  _renderPendingPushes() {
    const container = _id("pending-items-container");
    if (this.pending.length === 0) {
      container.innerHTML = `
        <div class="premium-empty" role="status">
          <div class="premium-empty-icon" aria-hidden="true">📥</div>
          <h3 class="premium-empty-title">Queue is empty</h3>
          <p class="premium-empty-desc">Skipped solutions will accumulate here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.pending.map((item, idx) => {
      const displayNum = item.number ? `${String(item.number).padStart(4, "0")}. ` : "";
      const platformClass = item.platform === "leetcode" ? "lc" : "gfg";
      const platformText = item.platform === "leetcode" ? "LeetCode" : "GFG";
      const dateText = new Date(item.timestamp).toLocaleDateString("en-IN", { month: "short", day: "numeric" });
      
      return `
        <div class="glass-card pending-card" id="pending-card-${idx}">
          <div class="pending-header">
            <div>
              <span class="platform-badge ${platformClass}">${platformText}</span>
              <h3 style="font-size: 13px; font-weight: 600; margin-top: 5px; color: var(--text-primary);">${displayNum}${escapeHtml(item.title)}</h3>
            </div>
            <span style="font-size: 10px; color: var(--text-muted); font-weight: 500;">${dateText}</span>
          </div>
          
          <div class="pending-actions">
            <button class="btn-premium btn-compact push-single-btn" data-index="${idx}" id="push-single-${idx}">
              Push Now
            </button>
            <button class="btn-premium btn-premium-sec btn-compact preview-single-btn" data-index="${idx}">
              Preview
            </button>
            <button class="btn-icon-only delete-single-btn" data-index="${idx}" aria-label="Delete pending solution" style="margin-left: auto; color: var(--error);">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join("");

    container.querySelectorAll(".push-single-btn").forEach(btn => {
      btn.onclick = () => this._pushPendingSingle(parseInt(btn.dataset.index));
    });
    container.querySelectorAll(".preview-single-btn").forEach(btn => {
      btn.onclick = () => this._previewPendingSingle(parseInt(btn.dataset.index));
    });
    container.querySelectorAll(".delete-single-btn").forEach(btn => {
      btn.onclick = () => this._deletePendingSingle(parseInt(btn.dataset.index));
    });
  }

  _renderActivityTimeline() {
    const container = _id("activity-timeline-container");
    if (this.history.length === 0) {
      container.innerHTML = `
        <div class="premium-empty" role="status" style="border-style: solid; border-width: 1px;">
          <div class="premium-empty-icon" aria-hidden="true">⚡</div>
          <h3 class="premium-empty-title">No activity logged</h3>
          <p class="premium-empty-desc">Your push timeline will be built automatically.</p>
        </div>
      `;
      return;
    }

    const groups = {};
    const todayStr = new Date().toDateString();
    const yesterdayStr = new Date(Date.now() - 86400000).toDateString();
    const reversedHistory = [...this.history].reverse();

    reversedHistory.forEach(item => {
      const dateStr = new Date(item.timestamp).toDateString();
      let header = dateStr;
      if (dateStr === todayStr) header = "Today";
      else if (dateStr === yesterdayStr) header = "Yesterday";
      else header = new Date(item.timestamp).toLocaleDateString("en-IN", { weekday: 'long', month: 'short', day: 'numeric' });

      if (!groups[header]) groups[header] = [];
      groups[header].push(item);
    });

    let html = "";
    for (const [day, items] of Object.entries(groups)) {
      html += `
        <div class="timeline-group">
          <div class="timeline-header">${day}</div>
          ${items.map(item => {
            const timeStr = new Date(item.timestamp).toLocaleTimeString("en-IN", { hour: '2-digit', minute: '2-digit', hour12: true });
            const dotClass = item.platform === "leetcode" ? "lc" : "gfg";
            const platformText = item.platform === "leetcode" ? "LeetCode" : "GFG";
            
            return `
              <div class="timeline-item">
                <div class="timeline-dot ${dotClass}" aria-hidden="true"></div>
                <div class="timeline-content">
                  <div class="timeline-title">${escapeHtml(item.title)}</div>
                  <div class="timeline-meta">
                    <span style="font-weight: 600; color: var(--text-primary);">${platformText}</span>
                    <span>•</span>
                    <span>${timeStr}</span>
                    <span>•</span>
                    <span style="color: var(--success);">✓ Pushed</span>
                  </div>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `;
    }

    container.innerHTML = html;
  }

  // ── Pending Queue Actions ─────────────────────────────────────────────────

  async _pushPendingSingle(index) {
    const item = this.pending[index];
    const btn = _id(`push-single-${index}`);
    if (!btn) return;

    btn.disabled = true;
    btn.textContent = "Syncing…";

    const defaultMsg = item.platform === "leetcode"
      ? `feat(leetcode): solve ${item.number ? "#" + item.number + " " : ""}${item.title}`
      : `feat(gfg): solve ${item.title}`;

    try {
      const response = await chrome.runtime.sendMessage({
        type: "PUSH_TO_GITHUB",
        data: {
          platform:      item.platform,
          problemNumber: item.number,
          problemSlug:   item.slug,
          problemTitle:  item.title,
          problemUrl:    item.problemUrl,
          difficulty:    item.difficulty,
          code:          item.code,
          commitMessage: defaultMsg,
          language:      item.language || "java"
        }
      });

      if (response?.success) {
        const currentData = await chrome.storage.local.get(["pendingPushes"]);
        const currentPending = currentData.pendingPushes || [];
        const filtered = currentPending.filter(p => !(p.platform === item.platform && p.slug === item.slug));
        await chrome.storage.local.set({ pendingPushes: filtered });
        this.refreshAllData();
      } else {
        btn.disabled = false;
        btn.textContent = "Failed - Retry";
        alert(`Failed to push: ${response?.error || "Unknown GitHub error"}`);
      }
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Error";
      alert(`Extension error: ${e.message}`);
    }
  }

  async _deletePendingSingle(index) {
    const item = this.pending[index];
    const currentData = await chrome.storage.local.get(["pendingPushes"]);
    const currentPending = currentData.pendingPushes || [];

    const filtered = currentPending.filter(p => !(p.platform === item.platform && p.slug === item.slug));
    await chrome.storage.local.set({ pendingPushes: filtered });
    this.refreshAllData();
  }

  _previewPendingSingle(index) {
    const item = this.pending[index];
    const modal = _id("code-preview-overlay");
    
    _id("modal-problem-title").textContent = item.title;
    _id("modal-code-block").textContent = item.code;
    
    const platformLabel = item.platform === "leetcode" ? "LeetCode" : "GFG";
    const languageLabel = (item.language || "java").toUpperCase();
    
    _id("modal-problem-meta-row").innerHTML = `
      <span>Platform: ${platformLabel}</span>
      <span>•</span>
      <span>Language: ${languageLabel}</span>
      <span>•</span>
      <span>Queued: ${new Date(item.timestamp).toLocaleDateString()}</span>
    `;

    const actionBtn = _id("modal-action-btn");
    actionBtn.onclick = async () => {
      actionBtn.disabled = true;
      actionBtn.textContent = "Syncing…";
      await this._pushPendingSingle(index);
      modal.classList.remove("active");
    };

    const copyBtn = _id("modal-copy-btn");
    copyBtn.textContent = "Copy Code";
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(item.code);
      copyBtn.textContent = "Copied! ✓";
      setTimeout(() => { copyBtn.textContent = "Copy Code"; }, 1500);
    };

    modal.classList.add("active");
  }

  // ── Settings Handlers ─────────────────────────────────────────────────────

  async _loadSettings() {
    const data = await chrome.storage.sync.get([
      "githubToken", "githubUser", "lcRepoUrl", "gfgRepoUrl", 
      "leetcodeFolder", "gfgFolder", "theme", "notificationsEnabled",
      "lcFolders", "gfgFolders"
    ]);

    _val("githubUser", data.githubUser || "");
    _val("githubToken", data.githubToken || "");
    _val("lcRepoUrl", data.lcRepoUrl || "");
    _val("gfgRepoUrl", data.gfgRepoUrl || "");
    
    // Populate folder dropdowns from cached folder lists
    this._populateFolderDropdown("leetcodeFolder", data.lcFolders || [], data.leetcodeFolder || "LeetCode", "LeetCode");
    this._populateFolderDropdown("gfgFolder", data.gfgFolders || [], data.gfgFolder || "GFG", "GFG");
    
    _id("notificationToggle").checked = data.notificationsEnabled !== false;

    const selectedTheme = data.theme || "system";
    const segmentOptions = document.querySelectorAll("#theme-selector .segmented-option");
    segmentOptions.forEach(opt => {
      if (opt.dataset.value === selectedTheme) {
        opt.classList.add("active");
        opt.setAttribute("aria-checked", "true");
        opt.setAttribute("tabindex", "0");
      } else {
        opt.classList.remove("active");
        opt.setAttribute("aria-checked", "false");
        opt.setAttribute("tabindex", "-1");
      }
    });
  }

  /**
   * Populate a <select> dropdown with folder options from the repository.
   * @param {string} selectId  – DOM id of the <select>
   * @param {string[]} folders – list of folder names from GitHub
   * @param {string} savedValue – user's previously saved selection
   * @param {string} defaultName – default option name (e.g. "LeetCode")
   */
  _populateFolderDropdown(selectId, folders, savedValue, defaultName) {
    const select = _id(selectId);
    if (!select) return;

    select.innerHTML = "";

    // Always include the default as first option
    const defaultOpt = document.createElement("option");
    defaultOpt.value = defaultName;
    defaultOpt.textContent = `${defaultName} (default)`;
    select.appendChild(defaultOpt);

    // Add repo folders (deduplicated, skip if same as default)
    const seen = new Set([defaultName]);
    folders.forEach(name => {
      if (seen.has(name)) return;
      seen.add(name);
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });

    // If the saved value isn't in the list, add it as a custom option
    if (savedValue && !seen.has(savedValue)) {
      const customOpt = document.createElement("option");
      customOpt.value = savedValue;
      customOpt.textContent = `${savedValue} (custom)`;
      select.appendChild(customOpt);
    }

    select.value = savedValue || defaultName;
  }

  async _saveSettings() {
    const user = _get("githubUser");
    const token = _get("githubToken");
    const lcRepoUrl = _get("lcRepoUrl");
    const gfgRepoUrl = _get("gfgRepoUrl");
    const leetcodeFolder = _id("leetcodeFolder")?.value || "LeetCode";
    const gfgFolder = _id("gfgFolder")?.value || "GFG";
    const notificationsEnabled = _id("notificationToggle").checked;

    const statusEl = _id("settings-save-status");
    statusEl.innerHTML = "";

    if (!user || !token) {
      this._showConfigStatus(statusEl, "❌ Username & Token are required.", "err");
      return;
    }

    const lcInfo = parseRepoUrl(lcRepoUrl);
    const gfgInfo = parseRepoUrl(gfgRepoUrl);

    if (lcRepoUrl && !lcInfo) {
      this._showConfigStatus(statusEl, "❌ LeetCode Repo URL is invalid.", "err");
      return;
    }
    if (gfgRepoUrl && !gfgInfo) {
      this._showConfigStatus(statusEl, "❌ GFG Repo URL is invalid.", "err");
      return;
    }

    await chrome.storage.sync.set({
      githubUser: user,
      githubToken: token,
      lcRepoUrl,
      gfgRepoUrl,
      leetcodeFolder,
      gfgFolder,
      notificationsEnabled,
      lcOwner: lcInfo?.owner || "",
      lcRepo: lcInfo?.repo || "",
      gfgOwner: gfgInfo?.owner || "",
      gfgRepo: gfgInfo?.repo || "",
    });

    this._showConfigStatus(statusEl, "✅ Settings saved successfully!", "ok");
    this.refreshAllData();
  }

  _showConfigStatus(el, msg, type) {
    el.textContent = msg;
    el.className = `status-msg ${type}`;
    setTimeout(() => {
      el.textContent = "";
      el.className = "status-msg";
    }, 3500);
  }

  // ── Verification Connection (enhanced with folder auto-detection) ──────────

  async _verifyAllConnections() {
    const token = _get("githubToken");
    const lcUrl = _get("lcRepoUrl");
    const gfgUrl = _get("gfgRepoUrl");
    const btn = _id("repos-verify-btn");
    const statusMsg = _id("repos-status-message");

    if (!token) {
      this._showVerifyStatus(statusMsg, "❌ Enter your GitHub Token in Settings tab.", "err");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Connecting…";
    this._showVerifyStatus(statusMsg, "🔍 Testing connections & scanning folders...", "info");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "VERIFY_CONNECTION",
        data: { githubToken: token, lcRepoUrl: lcUrl, gfgRepoUrl: gfgUrl }
      });

      if (response?.success) {
        const results = response.results || [];
        const allOk = results.every(r => r.ok);
        
        let reportHtml = `<div style="margin-top: 10px; display: flex; flex-direction: column; gap: 6px;">`;
        results.forEach(r => {
          reportHtml += `
            <div class="alert-box ${r.ok ? 'ok' : 'err'}">
              <span>${r.ok ? '✅' : '❌'}</span>
              <span><strong>${escapeHtml(r.label)}:</strong> ${r.ok ? (escapeHtml(r.repoName) + (r.private ? ' (Private)' : ' (Public)')) : escapeHtml(r.error)}</span>
            </div>
          `;
        });
        reportHtml += `</div>`;
        
        statusMsg.innerHTML = reportHtml;
        statusMsg.className = "status-msg";
        
        // ── Auto-populate folder dropdowns from detected folders ──────────
        const lcResult = results.find(r => r.label === "LeetCode" && r.ok);
        const gfgResult = results.find(r => r.label === "GFG" && r.ok);

        if (lcResult?.folders) {
          const savedLc = _id("leetcodeFolder")?.value || "LeetCode";
          this._populateFolderDropdown("leetcodeFolder", lcResult.folders, savedLc, "LeetCode");
          await chrome.storage.sync.set({ lcFolders: lcResult.folders });
        }
        if (gfgResult?.folders) {
          const savedGfg = _id("gfgFolder")?.value || "GFG";
          this._populateFolderDropdown("gfgFolder", gfgResult.folders, savedGfg, "GFG");
          await chrome.storage.sync.set({ gfgFolders: gfgResult.folders });
        }

        // ── Show repo metadata panel ──────────────────────────────────────
        const metaPanel = _id("repo-metadata-panel");
        const metaContent = _id("repo-metadata-content");
        if (metaPanel && metaContent) {
          let metaHtml = "";
          results.filter(r => r.ok).forEach(r => {
            metaHtml += `
              <div class="settings-row" style="flex-direction: column; align-items: flex-start; gap: 6px;">
                <div style="display: flex; align-items: center; gap: 8px; width: 100%;">
                  <span style="font-size: 14px; font-weight: 700; color: var(--text-primary);">${escapeHtml(r.repoName)}</span>
                  <span style="font-size: 9px; font-weight: 600; padding: 2px 6px; border-radius: 4px; background: ${r.private ? 'var(--warning-glow)' : 'var(--success-glow)'}; color: ${r.private ? 'var(--warning)' : 'var(--success)'};">${r.private ? 'Private' : 'Public'}</span>
                </div>
                <div style="display: flex; gap: 16px; font-size: 11px; color: var(--text-secondary);">
                  <span>🌿 Branch: <strong>${escapeHtml(r.branch || 'main')}</strong></span>
                  <span>📁 ${r.folderCount || 0} folders</span>
                  <span>📄 ${r.fileCount || 0} files</span>
                </div>
                ${r.folders && r.folders.length > 0 ? `
                  <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;">
                    ${r.folders.map(f => `<span style="font-size: 10px; padding: 2px 8px; border-radius: 6px; background: var(--input-bg); border: 1px solid var(--border-color); color: var(--text-secondary); font-weight: 500;">${escapeHtml(f)}</span>`).join("")}
                  </div>
                ` : ""}
              </div>
            `;
          });
          metaContent.innerHTML = metaHtml;
          metaPanel.style.display = "";
        }
        
        const dot = _id("status-indicator-dot");
        const label = _id("connection-label");
        if (allOk) {
          dot.className = "status-indicator connected";
          label.textContent = `@${response.user?.login}`;
        } else {
          dot.className = "status-indicator";
          label.textContent = "Auth Error";
        }
      } else {
        this._showVerifyStatus(statusMsg, response?.error || "Verification failed.", "err");
      }
    } catch (e) {
      this._showVerifyStatus(statusMsg, `❌ ${e.message}`, "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "Verify All Connections";
    }
  }

  // ── Scan folders on demand ────────────────────────────────────────────────

  async _scanFolders() {
    const token = _get("githubToken");
    const btn = _id("scan-folders-btn");
    if (!token) {
      alert("Please enter your GitHub Token first.");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Scanning…";

    const urls = [
      { id: "leetcodeFolder", url: _get("lcRepoUrl"), defaultName: "LeetCode", storageKey: "lcFolders" },
      { id: "gfgFolder", url: _get("gfgRepoUrl"), defaultName: "GFG", storageKey: "gfgFolders" },
    ];

    for (const { id, url, defaultName, storageKey } of urls) {
      if (!url) continue;
      try {
        const response = await chrome.runtime.sendMessage({
          type: "LIST_REPO_FOLDERS",
          data: { githubToken: token, repoUrl: url }
        });
        if (response?.success) {
          const savedVal = _id(id)?.value || defaultName;
          this._populateFolderDropdown(id, response.folders, savedVal, defaultName);
          await chrome.storage.sync.set({ [storageKey]: response.folders });
        }
      } catch (_) { /* non-fatal */ }
    }

    btn.disabled = false;
    btn.textContent = "Scan Repository Folders";
  }

  _showVerifyStatus(el, msg, type) {
    el.innerHTML = `<div class="alert-box ${type}">${msg}</div>`;
    el.className = "status-msg";
  }

  // ── Listeners Registration ────────────────────────────────────────────────

  _registerHandlers() {
    _id("save-settings-btn").onclick = () => this._saveSettings();
    _id("repos-verify-btn").onclick = () => this._verifyAllConnections();
    _id("scan-folders-btn").onclick = () => this._scanFolders();

    const welcomeBtn = _id("welcome-start-btn");
    if (welcomeBtn) {
      welcomeBtn.onclick = () => {
        _id("welcome-overlay").style.display = "none";
        document.querySelector('[data-tab="settings"]').click();
      };
    }

    // Repository Sync buttons
    _id("restore-from-repo-btn").onclick = async () => {
      const btn = _id("restore-from-repo-btn");
      const statusEl = _id("sync-status");
      btn.disabled = true;
      btn.textContent = "Scanning...";
      statusEl.style.display = "block";
      statusEl.textContent = "Scanning repository folders and README files...";
      statusEl.style.color = "var(--primary)";
      try {
        const response = await chrome.runtime.sendMessage({ type: "REBUILD_FROM_REPO" });
        if (response?.success) {
          statusEl.textContent = "Restored " + response.count + " problems from repository.";
          statusEl.style.color = "var(--success, #34C759)";
          // Refresh dashboard with rebuilt data
          this.refreshAllData();
        } else {
          statusEl.textContent = response?.error || "Restore failed.";
          statusEl.style.color = "var(--danger, #FF453A)";
        }
      } catch (e) {
        statusEl.textContent = e.message;
        statusEl.style.color = "var(--danger, #FF453A)";
      }
      btn.disabled = false;
      btn.textContent = "Restore";
    };

    _id("save-config-to-repo-btn").onclick = async () => {
      const btn = _id("save-config-to-repo-btn");
      const statusEl = _id("sync-status");
      btn.disabled = true;
      btn.textContent = "Saving...";
      statusEl.style.display = "block";
      statusEl.textContent = "Saving settings to .dsa-sync/config.json...";
      statusEl.style.color = "var(--primary)";
      try {
        const config = {
          lcRepoUrl: _get("lc-repo-url"),
          gfgRepoUrl: _get("gfg-repo-url"),
          leetcodeFolder: _get("leetcode-folder") || _id("leetcode-folder")?.value,
          gfgFolder: _get("gfg-folder") || _id("gfg-folder")?.value,
          theme: document.querySelector("#theme-selector .segmented-option.active")?.dataset.value || "system",
        };
        const response = await chrome.runtime.sendMessage({ type: "SAVE_CONFIG_TO_REPO", data: { config } });
        if (response?.success) {
          statusEl.textContent = "Settings saved to repository.";
          statusEl.style.color = "var(--success, #34C759)";
        } else {
          statusEl.textContent = response?.error || "Save failed.";
          statusEl.style.color = "var(--danger, #FF453A)";
        }
      } catch (e) {
        statusEl.textContent = e.message;
        statusEl.style.color = "var(--danger, #FF453A)";
      }
      btn.disabled = false;
      btn.textContent = "Save";
    };

    // Theme selector
    const segmentOptions = document.querySelectorAll("#theme-selector .segmented-option");
    segmentOptions.forEach(opt => {
      opt.addEventListener("click", () => {
        segmentOptions.forEach(o => {
          o.classList.remove("active");
          o.setAttribute("aria-checked", "false");
          o.setAttribute("tabindex", "-1");
        });
        opt.classList.add("active");
        opt.setAttribute("aria-checked", "true");
        opt.setAttribute("tabindex", "0");
        themeManager.apply(opt.dataset.value);
      });
      opt.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          opt.click();
        }
      });
    });

    // Eye toggle button for token
    const tokenInput = _id("githubToken");
    const toggleBtn = _id("token-toggle-btn");
    toggleBtn.onclick = () => {
      if (tokenInput.type === "password") {
        tokenInput.type = "text";
        toggleBtn.textContent = "🙈";
        toggleBtn.setAttribute("aria-label", "Hide token");
      } else {
        tokenInput.type = "password";
        toggleBtn.textContent = "👁";
        toggleBtn.setAttribute("aria-label", "Show token");
      }
    };

    // Close preview modal
    const modal = _id("code-preview-overlay");
    _id("modal-close-btn").onclick = () => modal.classList.remove("active");
    modal.addEventListener("click", e => {
      if (e.target === modal) modal.classList.remove("active");
    });

    // Live validation for repo inputs
    ["lcRepoUrl", "gfgRepoUrl"].forEach(id => {
      _id(id).addEventListener("input", () => {
        const url = _get(id);
        if (!url) return;
        const parsed = parseRepoUrl(url);
        _id(id).style.borderColor = parsed ? "var(--success)" : "var(--error)";
        _id(id).style.boxShadow = parsed 
          ? "0 0 0 2px var(--success-glow)" 
          : "0 0 0 2px var(--error-glow)";
      });
      _id(id).addEventListener("blur", () => {
        _id(id).style.borderColor = "";
        _id(id).style.boxShadow = "";
      });
    });

    // Gauge tabs filter selection
    const gaugeTabs = document.querySelectorAll("#gauge-filter-tabs .mini-tab");
    gaugeTabs.forEach(tab => {
      tab.onclick = () => {
        gaugeTabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        this.difficultyFilter = tab.dataset.filter;
        this._renderDifficultyGauges();
      };
    });

    // Trend Period selector clicks
    const trendBtns = document.querySelectorAll("#trend-period-selectors .trend-btn");
    trendBtns.forEach(btn => {
      btn.onclick = () => {
        trendBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this.trendPeriod = btn.dataset.period;
        this._renderTrendChart();
      };
    });

    // Danger zone actions
    _id("clear-history-btn").onclick = async () => {
      if (confirm("Are you sure you want to clear your local activity history? This won't affect files on GitHub.")) {
        await chrome.storage.local.set({ pushHistory: [] });
        this.refreshAllData();
      }
    };

    _id("reset-all-btn").onclick = async () => {
      if (confirm("Are you sure you want to reset all extension config? You will need to link your GitHub token again.")) {
        await chrome.storage.sync.clear();
        await chrome.storage.local.clear();
        window.location.reload();
      }
    };
  }
}

// ---------------------------------------------------------------------------
// DOM Access Shorthands
// ---------------------------------------------------------------------------

function _id(id) { return document.getElementById(id); }
function _get(id) { return (_id(id)?.value || "").trim(); }
function _val(id, val) { const el = _id(id); if (el) el.value = val; }

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
  await themeManager.init();
  const controller = new PopupUIController();
  await controller.init();
});
