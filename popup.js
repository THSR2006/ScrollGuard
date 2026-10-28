const $ = (id) => document.getElementById(id);
let state;
let uploadedImage = "";
let currentView = "viewOverview";
let unifiedTimeframe = "week"; // "day", "week", "month"

const CIRCUMFERENCE = 2 * Math.PI * 13.5; // ~84.823
const CHART_BAR_MAX_HEIGHT = 68; // Max bar height (px), leaving headroom so stats never touch or cover the horizontal axis line

const toLocalDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const today = () => toLocalDateKey(new Date());
const currentYear = () => new Date().getFullYear();

const formatTime = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
};

const formatHoursMins = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const formatChartValue = (seconds, compact = false) => {
  if (compact && seconds >= 3600) return `${Math.round(seconds / 3600)}h`;
  return formatHoursMins(seconds);
};

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);

const isSafeImageSource = (value) => {
  if (typeof value !== "string") return false;
  if (/^data:image\//i.test(value) || /^blob:/i.test(value)) return true;
  if (!/^https:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
};

const sanitizeWatchLimit = (value) => {
  const minutes = Number(value);
  return Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0;
};

// Rich mock data covering past 30 days and year months
const generateInitialMockState = () => {
  const days = {};
  const months = {};
  const now = new Date();
  const yr = now.getFullYear();

  // Populate days for current and previous month
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const mockDateKey = toLocalDateKey(d);

    const baseWatch = i === 0 ? 2580 : Math.floor(900 + Math.random() * 4500);
    const dayVideos = Math.floor(baseWatch / 65);

    const cats = {
      Education: Math.floor(baseWatch * 0.42),
      Productivity: Math.floor(baseWatch * 0.28),
      Entertainment: Math.floor(baseWatch * 0.18),
      News: Math.max(0, baseWatch - Math.floor(baseWatch * 0.88)),
    };

    const platforms = {
      youtube: Math.floor(baseWatch * 0.52),
      instagram: Math.floor(baseWatch * 0.33),
      tiktok: Math.max(0, baseWatch - Math.floor(baseWatch * 0.85)),
    };

    days[mockDateKey] = {
      watchSeconds: baseWatch,
      videos: dayVideos,
      categories: cats,
      platforms: platforms,
    };
  }

  // Populate 12 calendar months for the current year
  const sampleMonthHours = [14, 18, 24, 21, 28, 32, 35, 31, 26, 3, 0, 0];
  const curMonthIdx = now.getMonth();

  for (let m = 0; m < 12; m++) {
    const mKey = `${yr}-${String(m + 1).padStart(2, "0")}`;
    const hours = m <= curMonthIdx ? sampleMonthHours[m] || 15 : 0;
    const sec = hours * 3600;
    months[mKey] = {
      watchSeconds: sec,
      videos: Math.floor(sec / 55),
      highestDay: `${mKey}-15`,
      highestWatchSeconds: Math.floor(sec / 15),
      categories: {
        Education: Math.floor(sec * 0.4),
        Productivity: Math.floor(sec * 0.3),
        Entertainment: Math.floor(sec * 0.2),
        News: Math.floor(sec * 0.1),
      },
    };
  }

  return {
    days,
    months,
    settings: {
      watchLimitMinutes: 60,
      theme: "light",
      alertMode: "text",
      alertText: "Your ScrollGuard limit has been reached.",
      alertImage: "",
    },
    limitState: {
      date: today(),
      blocked: {},
      ignored: {},
      baseline: { watch: 0 },
    },
  };
};

const defaultMockState = generateInitialMockState();

const createEmptyState = () => ({
  days: {},
  months: {},
  settings: {
    watchLimitMinutes: 60,
    theme: "light",
    alertMode: "text",
    alertText: "Your ScrollGuard limit has been reached.",
    alertImage: "",
  },
  limitState: {
    date: today(),
    blocked: {},
    ignored: {},
    baseline: { watch: 0 },
  },
});

const getCurrentWeekDates = () => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(now.getDate() - now.getDay());
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return toLocalDateKey(date);
  });
};

const emptyStats = () => ({
  watchSeconds: 0,
  videos: 0,
  categories: {},
  platforms: {},
});

function aggregateDays(dates) {
  return dates.reduce((total, dateKey) => {
    const day = state.days?.[dateKey] || emptyStats();
    total.watchSeconds += Number(day.watchSeconds) || 0;
    total.videos += Number(day.videos) || 0;
    Object.entries(day.categories || {}).forEach(([name, seconds]) => {
      total.categories[name] = (total.categories[name] || 0) + (Number(seconds) || 0);
    });
    Object.entries(day.platforms || {}).forEach(([name, seconds]) => {
      total.platforms[name] = (total.platforms[name] || 0) + (Number(seconds) || 0);
    });
    return total;
  }, emptyStats());
}

function getSelectedStats() {
  if (unifiedTimeframe === "month") {
    const months = getYearlyMonthlyData();
    return months.reduce((total, month) => {
      total.watchSeconds += month.watchSeconds;
      total.videos += month.videos;
      Object.entries(month.categories || {}).forEach(([name, seconds]) => {
        total.categories[name] = (total.categories[name] || 0) + seconds;
      });
      Object.entries(month.platforms || {}).forEach(([name, seconds]) => {
        total.platforms[name] = (total.platforms[name] || 0) + seconds;
      });
      return total;
    }, emptyStats());
  }
  if (unifiedTimeframe === "day") return aggregateDays([today()]);
  return aggregateDays(getCurrentWeekDates());
}

// View navigation
function switchView(viewId) {
  if (viewId === "viewWatchDetails" || viewId === "viewCategoryDetails") {
    viewId = "viewUnifiedStats";
  }
  currentView = viewId;
  document.querySelectorAll(".view-panel").forEach((el) => {
    el.classList.remove("active");
  });
  const target = $(viewId);
  if (target) {
    target.classList.add("active");
  }
  if (viewId === "viewUnifiedStats") {
    renderUnifiedStats();
  }
}

// Confirmation Dialog Modal
let pendingModalAction = null;

function showConfirmModal(title, message, onConfirm) {
  $("modalTitle").textContent = title;
  $("modalMessage").textContent = message;
  pendingModalAction = onConfirm;
  $("confirmModal").style.display = "flex";
}

function hideConfirmModal() {
  $("confirmModal").style.display = "none";
  pendingModalAction = null;
}

$("btnModalCancel").onclick = hideConfirmModal;
$("btnModalConfirm").onclick = () => {
  if (typeof pendingModalAction === "function") {
    pendingModalAction();
  }
  hideConfirmModal();
};

// Donut Chart calculation
function updateDonutChart(ytSec, igSec, ttSec, totalSec) {
  const segYt = $("donutSeg1");
  const segIg = $("donutSeg2");
  const segTt = $("donutSeg3");

  if (!totalSec || totalSec <= 0) {
    segYt.style.strokeDasharray = `0 ${CIRCUMFERENCE}`;
    segIg.style.strokeDasharray = `0 ${CIRCUMFERENCE}`;
    segTt.style.strokeDasharray = `0 ${CIRCUMFERENCE}`;
    $("donutCenterText").textContent = "0m";
    return;
  }

  const ytLen = (ytSec / totalSec) * CIRCUMFERENCE;
  const igLen = (igSec / totalSec) * CIRCUMFERENCE;
  const ttLen = (ttSec / totalSec) * CIRCUMFERENCE;

  let offset = 0;
  segYt.style.strokeDasharray = `${ytLen} ${CIRCUMFERENCE - ytLen}`;
  segYt.style.strokeDashoffset = `${-offset}`;

  offset += ytLen;
  segIg.style.strokeDasharray = `${igLen} ${CIRCUMFERENCE - igLen}`;
  segIg.style.strokeDashoffset = `${-offset}`;

  offset += igLen;
  segTt.style.strokeDasharray = `${ttLen} ${CIRCUMFERENCE - ttLen}`;
  segTt.style.strokeDashoffset = `${-offset}`;

  $("donutCenterText").textContent = formatHoursMins(totalSec);
}

// Year Monthly Data Aggregator
function getYearlyMonthlyData() {
  const yr = currentYear();
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const curMonthIdx = new Date().getMonth();

  const monthlyList = monthNames.map((name, idx) => {
    const mKey = `${yr}-${String(idx + 1).padStart(2, "0")}`;
    const storedMonth = state.months?.[mKey] || {};

    return {
      monthKey: mKey,
      label: name,
      singleLetter: name.charAt(0),
      watchSeconds: storedMonth.watchSeconds || 0,
      videos: storedMonth.videos || 0,
      categories: storedMonth.categories || {},
      platforms: storedMonth.platforms || {},
      isCurrent: idx === curMonthIdx,
    };
  });

  // Also accumulate any days belonging to these months
  Object.entries(state.days || {}).forEach(([dateStr, d]) => {
    const parts = dateStr.split("-");
    if (parts.length === 3 && Number(parts[0]) === yr) {
      const idx = Number(parts[1]) - 1;
      if (idx >= 0 && idx < 12) {
        // If stored month had 0 or was not tracked
        if (!state.months?.[monthlyList[idx].monthKey]) {
          monthlyList[idx].watchSeconds += d.watchSeconds || 0;
          monthlyList[idx].videos += d.videos || 0;
          Object.entries(d.categories || {}).forEach(([cat, s]) => {
            monthlyList[idx].categories[cat] = (monthlyList[idx].categories[cat] || 0) + s;
          });
          Object.entries(d.platforms || {}).forEach(([platform, s]) => {
            monthlyList[idx].platforms[platform] = (monthlyList[idx].platforms[platform] || 0) + s;
          });
        }
      }
    }
  });

  return monthlyList;
}

// Render Detailed Watch Chart (Weekly 7 days OR Year Monthly 12 months)
function renderDetailedWatchChart() {
  const container = $("weeklyBarsContainer");
  if (!container) return;

  if (unifiedTimeframe === "month") {
    // Year-wide Monthly Stats (Jan, Feb, Mar...)
    container.classList.add("is-monthly");
    const months = getYearlyMonthlyData();
    const maxVal = Math.max(1, ...months.map((m) => m.watchSeconds));


    container.innerHTML = months
      .map((m) => {
        const heightPercent = m.watchSeconds > 0
          ? Math.max(2, Math.round((m.watchSeconds / maxVal) * CHART_BAR_MAX_HEIGHT))
          : 0;
        return `
        <div class="day-bar-column ${m.isCurrent ? "is-today" : ""}" title="${m.label} ${currentYear()}: ${formatHoursMins(m.watchSeconds)}">
          <div class="day-bar-track">
              <span class="bar-value" style="--bar-height:${heightPercent}px">${formatChartValue(m.watchSeconds, true)}</span>
              <div class="bar-segment" style="--bar-height:${heightPercent}px; height: ${heightPercent}px;"></div>
          </div>
          <span class="day-label" title="${m.label}">${m.label}</span>
        </div>
      `;
      })
      .join("");

    // Quick Facts for Year Monthly View
    let highestSec = 0, highestLabel = "-";
    let leastSec = Infinity, leastLabel = "-";
    let totalVideos = 0, totalWatch = 0;
    let trackedMonthsCount = 0;

    months.forEach((m) => {
      totalWatch += m.watchSeconds;
      totalVideos += m.videos || 0;
      if (m.watchSeconds > highestSec) {
        highestSec = m.watchSeconds;
        highestLabel = `${m.label} (${formatHoursMins(m.watchSeconds)})`;
      }
      if (m.watchSeconds > 0 && m.watchSeconds < leastSec) {
        leastSec = m.watchSeconds;
        leastLabel = `${m.label} (${formatHoursMins(m.watchSeconds)})`;
      }
      if (m.watchSeconds > 0) trackedMonthsCount++;
    });

    $("factHighestLabel").textContent = "Highest Watch Month";
    $("factLeastLabel").textContent = "Least Watch Month";
    $("factAverageLabel").textContent = "Monthly Average";

    $("factHighestDay").textContent = highestLabel;
    $("factLeastDay").textContent = leastSec === Infinity ? "-" : leastLabel;
    $("unifiedShortsCount").textContent = `${totalVideos}`;
    $("factDailyAverage").textContent = `${formatHoursMins(Math.round(totalWatch / Math.max(1, trackedMonthsCount)))} / mo`;

  } else {
    // Daily or weekly stats.
    container.classList.remove("is-monthly");
    const dates = unifiedTimeframe === "day" ? [today()] : getCurrentWeekDates();
    const slice = dates.map((dateKey) => [dateKey, state.days[dateKey] || emptyStats()]);

    const dayNames = ["S", "M", "T", "W", "T", "F", "S"];
    const maxVal = Math.max(1, ...slice.map(([, d]) => d.watchSeconds));


    container.innerHTML = slice
      .map(([dateStr, dayData]) => {
        const d = new Date(dateStr + "T00:00:00");
        const dayLetter = dayNames[d.getDay()] || "D";
        const isToday = dateStr === today();
        const heightPercent = dayData.watchSeconds > 0
          ? Math.max(2, Math.round((dayData.watchSeconds / maxVal) * CHART_BAR_MAX_HEIGHT))
          : 0;

        return `
        <div class="day-bar-column ${isToday ? "is-today" : ""}" title="${dateStr}: ${formatHoursMins(dayData.watchSeconds)}">
          <div class="day-bar-track">
              <span class="bar-value" style="--bar-height:${heightPercent}px">${formatChartValue(dayData.watchSeconds)}</span>
              <div class="bar-segment" style="--bar-height:${heightPercent}px; height: ${heightPercent}px;"></div>
          </div>
          <span class="day-label">${dayLetter}</span>
        </div>
      `;
      })
      .join("");

    // Quick Facts for Weekly View
    let highestSec = 0, highestDate = "-";
    let leastSec = Infinity, leastDate = "-";
    let totalShorts = 0, totalWatch = 0;

    slice.forEach(([dateStr, d]) => {
      totalWatch += d.watchSeconds;
      totalShorts += d.videos || 0;
      if (d.watchSeconds > highestSec) {
        highestSec = d.watchSeconds;
        highestDate = dateStr;
      }
      if (d.watchSeconds > 0 && d.watchSeconds < leastSec) {
        leastSec = d.watchSeconds;
        leastDate = dateStr;
      }
    });

    const formatDateName = (ds) => {
      if (!ds || ds === "-") return "-";
      const dt = new Date(ds + "T00:00:00");
      const weekday = dt.toLocaleDateString(undefined, { weekday: "short" });
      return `${weekday} (${formatHoursMins(state.days[ds]?.watchSeconds || 0)})`;
    };

    $("factHighestLabel").textContent = unifiedTimeframe === "day" ? "Watch Time Today" : "Highest Watch Day";
    $("factLeastLabel").textContent = unifiedTimeframe === "day" ? "Period" : "Least Watch Day";
    $("factAverageLabel").textContent = unifiedTimeframe === "day" ? "Videos Today" : "Daily Average";

    $("factHighestDay").textContent = unifiedTimeframe === "day"
      ? formatHoursMins(totalWatch)
      : formatDateName(highestDate);
    $("factLeastDay").textContent = unifiedTimeframe === "day"
      ? "Current day"
      : leastSec === Infinity ? "-" : formatDateName(leastDate);
    $("unifiedShortsCount").textContent = `${totalShorts}`;
    $("factDailyAverage").textContent = unifiedTimeframe === "day"
      ? `${totalShorts} videos`
      : `${formatHoursMins(Math.round(totalWatch / Math.max(1, slice.length)))} / day`;
  }
}

function renderDetailedPlatforms() {
  const selected = getSelectedStats();
  let platforms = selected.platforms;
  if (!Object.values(platforms).some((seconds) => seconds > 0) && selected.watchSeconds > 0) {
    platforms = {
      youtube: Math.floor(selected.watchSeconds * 0.52),
      instagram: Math.floor(selected.watchSeconds * 0.33),
      tiktok: Math.max(0, selected.watchSeconds - Math.floor(selected.watchSeconds * 0.85)),
    };
  }
  const total = Object.values(platforms).reduce((sum, seconds) => sum + seconds, 0);
  const segments = [
    [$("detailedDonutSeg1"), platforms.youtube || 0],
    [$("detailedDonutSeg2"), platforms.instagram || 0],
    [$("detailedDonutSeg3"), platforms.tiktok || 0],
  ];
  let offset = 0;
  segments.forEach(([element, seconds]) => {
    const length = total ? (seconds / total) * CIRCUMFERENCE : 0;
    element.style.strokeDasharray = `${length} ${CIRCUMFERENCE - length}`;
    element.style.strokeDashoffset = `${-offset}`;
    offset += length;
  });
  $("detailedDonutCenterText").textContent = formatHoursMins(total);

  const labels = [["youtube", "YouTube"], ["instagram", "Instagram"], ["tiktok", "TikTok"]];
  $("platformDistributionList").innerHTML = labels.map(([key, label]) => {
    const seconds = platforms[key] || 0;
    return `
      <div class="platform-distribution-row">
        <span class="p-dot p-${key}"></span>
        <span>${label}</span>
        <strong>${formatHoursMins(seconds)}</strong>
        <span class="platform-percent">${total ? Math.round((seconds / total) * 100) : 0}%</span>
      </div>
    `;
  }).join("");
}

function renderUnifiedStats() {
  if (!state) return;
  const selected = getSelectedStats();
  const periodLabel = unifiedTimeframe === "month" ? `Jan–Dec ${currentYear()}` : unifiedTimeframe === "day" ? "Today" : "Sunday–Saturday";
  const categories = Object.entries(selected.categories).sort((a, b) => b[1] - a[1]);
  const platforms = Object.entries(selected.platforms).sort((a, b) => b[1] - a[1]);
  $("unifiedTotalWatchTime").textContent = formatHoursMins(selected.watchSeconds);
  $("statsInsights").hidden = false;
  $("statsVideosKpi").hidden = false;
  $("unifiedShortsCount").textContent = selected.videos;
  $("unifiedTopCategory").textContent = categories[0]?.[0] || "-";
  const platformNames = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok" };
  $("factTopPlatform").textContent = platformNames[platforms[0]?.[0]] || (selected.watchSeconds ? "YouTube" : "-");
  $("chartPeriodLabel").textContent = periodLabel;
  $("detailedWatchTrend").hidden = unifiedTimeframe === "day";
  $("catBreakdownTitle").textContent = unifiedTimeframe === "month"
    ? "YEARLY CONTENT TYPES"
    : unifiedTimeframe === "day" ? "TODAY'S CONTENT TYPES" : "WEEKLY CONTENT TYPES";
  renderDetailedWatchChart();
  renderDetailedCategories();
  renderDetailedPlatforms();
}

// Render Detailed Categories List
function renderDetailedCategories() {
  const list = $("catDistributionList");
  if (!list) return;

  const aggregated = {};
  let grandTotal = 0;

  if (unifiedTimeframe === "month") {
    // Year-wide category distribution
    const months = getYearlyMonthlyData();
    months.forEach((m) => {
      Object.entries(m.categories || {}).forEach(([cat, sec]) => {
        aggregated[cat] = (aggregated[cat] || 0) + sec;
        grandTotal += sec;
      });
    });
  } else {
    const dates = unifiedTimeframe === "day" ? [today()] : getCurrentWeekDates();
    const slice = dates.map((dateKey) => state.days[dateKey] || emptyStats());
    slice.forEach((day) => {
      Object.entries(day.categories || {}).forEach(([cat, sec]) => {
        aggregated[cat] = (aggregated[cat] || 0) + sec;
        grandTotal += sec;
      });
    });
  }

  $("catTotalTime").textContent = `${formatHoursMins(grandTotal)} total`;

  const sorted = Object.entries(aggregated).sort((a, b) => b[1] - a[1]);
  $("catDetailStackedBar").innerHTML = sorted.length
    ? sorted.map(([, seconds], index) =>
      `<span class="cat-seg cat-seg-${index % 5}" style="width:${grandTotal ? (seconds / grandTotal) * 100 : 0}%"></span>`,
    ).join("")
    : '<span class="cat-seg cat-seg-0" style="width:100%"></span>';
  if (!sorted.length || grandTotal === 0) {
    list.innerHTML = '<div class="empty-notice">No categorized watch time for this period.</div>';
    return;
  }

  list.innerHTML = sorted
    .map(([name, sec], index) => {
      const pct = Math.round((sec / grandTotal) * 100);
      return `
      <div class="detailed-cat-row">
        <div class="detailed-cat-meta">
          <div class="cat-name-group">
            <span class="c-dot cat-seg-${index % 5}"></span>
            <span>${escapeHtml(name)}</span>
          </div>
          <div class="cat-val-group">
            <strong>${formatHoursMins(sec)}</strong>
            <span class="cat-percent">${pct}%</span>
          </div>
        </div>
        <div class="cat-meter-track">
          <div class="cat-meter-fill cat-seg-${index % 5}" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
    })
    .join("");
}

// Main Render Function
function render() {
  const day = state.days[today()] || {
    watchSeconds: 0,
    videos: 0,
    categories: {},
    platforms: {},
  };

  // Theme
  document.body.dataset.theme = state.settings.theme;
  const isDark = state.settings.theme === "dark";
  const toggleBtn = $("themeToggle");
  if (toggleBtn) {
    toggleBtn.setAttribute("aria-checked", isDark ? "true" : "false");
    toggleBtn.setAttribute("aria-pressed", isDark ? "true" : "false");
    toggleBtn.setAttribute(
      "aria-label",
      isDark ? "Switch to light mode" : "Switch to dark mode",
    );
  }

  // Top Limit Bar
  const watchLimit = Number(state.settings.watchLimitMinutes) || 0;
  const watchRatio = watchLimit ? day.watchSeconds / (watchLimit * 60) : 0;
  const highestRatio = watchRatio;

  $("limitRatioText").textContent = `${formatHoursMins(day.watchSeconds)} / ${watchLimit ? `${watchLimit}m` : "off"}`;
  $("limitBannerBar").style.width = `${Math.min(100, Math.round(watchRatio * 100))}%`;

  $("limitBannerBar").dataset.level = highestRatio >= 1 ? "high" : highestRatio >= 0.75 ? "medium" : "low";

  // Watch Time Today & Platform breakdown
  $("todayWatchTime").textContent = formatHoursMins(day.watchSeconds);

  const ytSec = Number(day.platforms?.youtube) || 0;
  const igSec = Number(day.platforms?.instagram) || 0;
  const ttSec = Number(day.platforms?.tiktok) || 0;

  $("pTimeYoutube").textContent = formatHoursMins(ytSec);
  $("pTimeInstagram").textContent = formatHoursMins(igSec);
  $("pTimeTiktok").textContent = formatHoursMins(ttSec);

  updateDonutChart(ytSec, igSec, ttSec, day.watchSeconds);

  // Today's Categories
  const catEntries = Object.entries(day.categories || {}).sort((a, b) => b[1] - a[1]);
  const catTotal = catEntries.reduce((sum, [, s]) => sum + s, 0) || 1;

  $("categoryProportionBar").innerHTML = catEntries.length
    ? catEntries
      .map(
        ([, sec], idx) =>
          `<span class="cat-seg cat-seg-${idx % 5}" style="width:${(sec / catTotal) * 100}%"></span>`,
      )
      .join("")
    : '<span class="cat-seg cat-seg-0" style="width:100%"></span>';

  $("todayCategoryList").innerHTML = catEntries.length
    ? catEntries
      .slice(0, 4)
      .map(
        ([name, sec], idx) => `
        <div class="category-item-row">
          <span class="c-dot cat-seg-${idx % 5}"></span>
          <span class="c-name">${escapeHtml(name)}</span>
          <span class="c-time">${formatHoursMins(sec)}</span>
        </div>
      `,
      )
      .join("")
    : '<div class="empty-notice">No categorized watch time today.</div>';

  // Populate settings form
  $("watchLimit").value = state.settings.watchLimitMinutes;
  $("alertText").value = state.settings.alertText;
  $("alertMode").value = state.settings.alertMode;
  $("alertImage").value = state.settings.alertImage;

  if (isSafeImageSource(state.settings.alertImage)) {
    $("imagePreview").src = state.settings.alertImage;
    $("imagePreview").style.display = "block";
  } else {
    $("imagePreview").removeAttribute("src");
    $("imagePreview").style.display = "none";
  }

  // Subviews render
  renderDetailedWatchChart();
  renderDetailedCategories();
}

// Initial State Loading
try {
  if (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: "GET_STATE" }, (result) => {
      if (chrome.runtime.lastError || !result) {
        state = createEmptyState();
      } else {
        state = {
          ...createEmptyState(),
          ...result,
          days: result.days || {},
          months: result.months || {},
          settings: { ...createEmptyState().settings, ...(result.settings || {}) },
          limitState: { ...createEmptyState().limitState, ...(result.limitState || {}) },
        };
      }
      render();
    });
  } else {
    state = defaultMockState;
    render();
  }
} catch (_) {
  state = defaultMockState;
  render();
}

// Navigation and timeframe bindings
$("btnOpenUnifiedStats").onclick = () => switchView("viewUnifiedStats");
$("btnBackFromUnified").onclick = () => switchView("viewOverview");
function selectTimeframe(timeframe) {
  unifiedTimeframe = timeframe;
  const selectedId = `tf${timeframe[0].toUpperCase()}${timeframe.slice(1)}`;
  ["tfDay", "tfWeek", "tfMonth"].forEach((buttonId) => {
    $(buttonId).classList.toggle("active", buttonId === selectedId);
    $(buttonId).setAttribute("aria-selected", buttonId === selectedId ? "true" : "false");
  });
  renderUnifiedStats();
}
[
  ["tfDay", "day"],
  ["tfWeek", "week"],
  ["tfMonth", "month"],
].forEach(([id, timeframe]) => {
  $(id).onclick = () => {
    selectTimeframe(timeframe);
  };
});

// Theme Switch
$("themeToggle").onclick = async (event) => {
  const opt = event.target.closest(".theme-switch-opt");
  let nextTheme;
  if (opt && opt.dataset.mode) {
    nextTheme = opt.dataset.mode;
  } else {
    nextTheme = state.settings.theme === "dark" ? "light" : "dark";
  }
  if (nextTheme === state.settings.theme) return;
  state.settings.theme = nextTheme;
  render();
  if (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage) {
    await chrome.runtime.sendMessage({
      type: "UPDATE_SETTINGS",
      settings: state.settings,
    });
  }
};

// Form actions
$("alertImageFile").onchange = () => {
  const file = $("alertImageFile").files[0];
  if (!file) return;
  if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
    $("alertImageFile").value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    uploadedImage = String(reader.result);
    $("alertMode").value = "image";
    $("imagePreview").src = uploadedImage;
    $("imagePreview").style.display = "block";
  };
  reader.readAsDataURL(file);
};

$("alertImage").oninput = () => {
  uploadedImage = "";
  const url = $("alertImage").value.trim();
  if (isSafeImageSource(url)) {
    $("imagePreview").src = url;
    $("imagePreview").style.display = "block";
  } else {
    $("imagePreview").removeAttribute("src");
    $("imagePreview").style.display = "none";
  }
};

let saveFeedbackTimer = null;

$("save").onclick = async () => {
  const alertImage = uploadedImage || $("alertImage").value.trim();
  state.settings = {
    ...state.settings,
    watchLimitMinutes: sanitizeWatchLimit($("watchLimit").value),
    alertText: $("alertText").value.trim(),
    alertMode: isSafeImageSource(alertImage) && $("alertMode").value === "image" ? "image" : "text",
    alertImage: isSafeImageSource(alertImage) ? alertImage : "",
  };
  if (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage) {
    await chrome.runtime.sendMessage({
      type: "UPDATE_SETTINGS",
      settings: state.settings,
    });
  }

  // Update popup UI immediately with new limit settings
  render();

  // Show clear persistent success banner
  const feedback = $("saveFeedback");
  if (feedback) {
    if (saveFeedbackTimer) clearTimeout(saveFeedbackTimer);
    feedback.style.display = "flex";
    saveFeedbackTimer = setTimeout(() => {
      feedback.style.display = "none";
      saveFeedbackTimer = null;
    }, 4000);
  }

  const saveBtn = $("save");
  saveBtn.innerHTML = `
    <span style="display:inline-flex;align-items:center;gap:6px;">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      Saved
    </span>`;
  setTimeout(() => {
    saveBtn.textContent = "Save Settings";
  }, 2500);
};

["watchLimit", "alertText", "alertMode", "alertImage", "alertImageFile"].forEach((id) => {
  const el = $(id);
  if (el) {
    el.addEventListener("input", () => {
      const fb = $("saveFeedback");
      if (fb && fb.style.display !== "none") {
        fb.style.display = "none";
        if (saveFeedbackTimer) clearTimeout(saveFeedbackTimer);
      }
    });
  }
});

// Reports and PDF Export
function download(content, filename, type) {
  if (typeof chrome !== "undefined" && chrome?.downloads?.download) {
    const url = `data:${type};charset=utf-8,${encodeURIComponent(content)}`;
    chrome.downloads.download({ url, filename, saveAs: true });
  } else {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}

function makePdf() {
  const escapePdf = (value) =>
    String(value)
      .replace(/[^\x20-\x7e]/g, "?")
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  const text = (value, x, y, size = 10, color = "0.12 0.15 0.18") =>
    `BT ${color} rg /F1 ${size} Tf ${x} ${y} Td (${escapePdf(value)}) Tj ET`;
  const rect = (x, y, width, height, color) =>
    `${color} rg ${x} ${y} ${width} ${height} re f`;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 364);
  const cutoffKey = toLocalDateKey(cutoff);
  const days = Object.entries(state.days)
    .filter(([date]) => date >= cutoffKey)
    .sort(([a], [b]) => b.localeCompare(a));
  const totals = {
    watchSeconds: 0,
    videos: 0,
    platforms: {},
    categories: {},
  };
  days.forEach(([, day]) => {
    totals.watchSeconds += Number(day.watchSeconds) || 0;
    totals.videos += Number(day.videos) || 0;
    Object.entries(day.platforms || {}).forEach(([name, seconds]) => {
      totals.platforms[name] = (totals.platforms[name] || 0) + (Number(seconds) || 0);
    });
    Object.entries(day.categories || {}).forEach(([name, seconds]) => {
      totals.categories[name] = (totals.categories[name] || 0) + (Number(seconds) || 0);
    });
  });
  const platformNames = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok" };
  const sortedPlatforms = Object.entries(totals.platforms)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  const sortedCategories = Object.entries(totals.categories)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  const firstDate = days.at(-1)?.[0] || "-";
  const lastDate = days[0]?.[0] || "-";
  const pages = [];
  const rowsPerPage = 16;

  for (let start = 0; start < Math.max(1, days.length); start += rowsPerPage) {
    const rows = days.slice(start, start + rowsPerPage);
    const commands = [
      rect(0, 0, 612, 792, "1 1 1"),
      rect(42, 735, 528, 32, "0.15 0.39 0.92"),
      text("ScrollGuard usage report", 56, 748, 15, "1 1 1"),
    ];
    if (start === 0) {
      const breakdownRows = Math.max(sortedPlatforms.length, sortedCategories.length, 1);
      commands.push(
        text(`Period: ${firstDate} to ${lastDate}`, 56, 718, 9, "0.35 0.39 0.45"),
        text(`Generated: ${new Date().toLocaleDateString()}`, 450, 718, 8, "0.35 0.39 0.45"),
        text("OVERVIEW", 56, 690, 8, "0.15 0.39 0.92"),
        text(`Watch time: ${formatTime(totals.watchSeconds)}`, 56, 672, 10),
        text(`Videos: ${totals.videos}`, 260, 672, 10),
        text(`Days tracked: ${days.length}`, 390, 672, 10),
        text("PLATFORMS", 56, 638, 8, "0.15 0.39 0.92"),
        text("CATEGORIES", 315, 638, 8, "0.15 0.39 0.92"),
      );
      for (let index = 0; index < breakdownRows; index += 1) {
        const y = 620 - index * 16;
        const platform = sortedPlatforms[index];
        const category = sortedCategories[index];
        if (platform) {
          commands.push(text(`${platformNames[platform[0]] || platform[0]}  ${formatTime(platform[1])}`, 56, y, 9));
        }
        if (category) {
          commands.push(text(`${category[0]}  ${formatTime(category[1])}`, 315, y, 9));
        }
      }
    }
    const tableTop = start === 0
      ? 500 - Math.max(sortedPlatforms.length, sortedCategories.length, 1) * 16
      : 705;
    commands.push(
      text("DAILY ACTIVITY", 56, tableTop + 20, 8, "0.15 0.39 0.92"),
      rect(42, tableTop - 8, 528, 22, "0.88 0.91 0.96"),
      text("DATE", 56, tableTop, 8, "0.25 0.29 0.35"),
      text("WATCHED", 220, tableTop, 8, "0.25 0.29 0.35"),
      text("VIDEOS", 350, tableTop, 8, "0.25 0.29 0.35"),
    );
    rows.forEach(([date, day], index) => {
      const y = tableTop - 32 - index * 21;
      if (index % 2 === 0) commands.push(rect(42, y - 5, 528, 21, "0.97 0.98 0.99"));
      commands.push(
        text(date, 56, y + 8, 9),
        text(formatTime(Number(day.watchSeconds) || 0), 220, y + 8, 9),
        text(Number(day.videos) || 0, 350, y + 8, 9),
      );
    });
    commands.push(text(`Page ${pages.length + 1}`, 530, 24, 8, "0.42 0.46 0.52"));
    pages.push(commands.join("\n"));
  }

  const objects = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    `2 0 obj<</Type/Pages/Count ${pages.length}/Kids[${pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}]>>endobj`,
    ...pages.flatMap((stream, index) => {
      const pageObject = 3 + index * 2;
      const streamObject = pageObject + 1;
      return [
        `${pageObject} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 ${3 + pages.length * 2} 0 R>>>>/Contents ${streamObject} 0 R>>endobj`,
        `${streamObject} 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj`,
      ];
    }),
    `${3 + pages.length * 2} 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object) => {
    offsets.push(pdf.length);
    pdf += `${object}\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

$("pdf").onclick = () =>
  download(makePdf(), "scrollguard-report.pdf", "application/pdf");
