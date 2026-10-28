const DAY_LIMIT = 365;
const DEFAULT_SETTINGS = {
  watchLimitMinutes: 60,
  theme: "light",
  alertMode: "text",
  alertText: "Your ScrollGuard limit has been reached.",
  alertImage: "",
};

function sanitizeSettings(settings = {}) {
  const next = { ...DEFAULT_SETTINGS, ...settings };
  next.watchLimitMinutes = Math.max(0, Number(next.watchLimitMinutes) || 0);
  next.alertText =
    typeof next.alertText === "string"
      ? next.alertText.trim()
      : DEFAULT_SETTINGS.alertText;
  next.theme = next.theme === "dark" ? "dark" : "light";
  const alertImage =
    typeof next.alertImage === "string" ? next.alertImage.trim() : "";
  const safeAlertImage =
    /^data:image\//i.test(alertImage) ||
    /^blob:/i.test(alertImage) ||
    /^https:\/\//i.test(alertImage)
      ? alertImage
      : "";
  next.alertImage = safeAlertImage;
  next.alertMode =
    next.alertImage && next.alertMode === "image" ? "image" : "text";
  return next;
}

const localDateParts = (date = new Date()) => ({
  year: date.getFullYear(),
  month: date.getMonth() + 1,
  day: date.getDate(),
});
const todayKey = (date = new Date()) => {
  const parts = localDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
};
const monthKey = (date = new Date()) => {
  const parts = localDateParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
};
let eventQueue = Promise.resolve();

function emptyDay() {
  return { watchSeconds: 0, categories: {}, platforms: {}, videos: 0 };
}

function freshLimitState() {
  return {
    date: todayKey(),
    blocked: {},
    ignored: {},
    baseline: { watch: 0 },
  };
}

function normalizeLimitState(limitState = {}) {
  const fresh = freshLimitState();
  return {
    date: typeof limitState.date === "string" ? limitState.date : fresh.date,
    blocked: { watch: Boolean(limitState.blocked?.watch) },
    ignored: { watch: Boolean(limitState.ignored?.watch) },
    baseline: { watch: Number(limitState.baseline?.watch) || 0 },
  };
}

async function getState() {
  const saved = await chrome.storage.local.get([
    "days",
    "months",
    "settings",
    "limitState",
  ]);
  const limitState = normalizeLimitState(saved.limitState);
  return {
    days: saved.days || {},
    months: saved.months || {},
    settings: sanitizeSettings(saved.settings || {}),
    limitState: limitState.date === todayKey() ? limitState : freshLimitState(),
  };
}

async function trimAndSave(state) {
  const keys = Object.keys(state.days).sort().slice(-DAY_LIMIT);
  const days = Object.fromEntries(
    keys.map((key) => {
      const day = state.days[key] || emptyDay();
      return [
        key,
        {
          watchSeconds: Number(day.watchSeconds) || 0,
          categories: day.categories || {},
          platforms: day.platforms || {},
          videos: Number(day.videos) || 0,
        },
      ];
    }),
  );
  await chrome.storage.local.set({
    days,
    months: Object.fromEntries(
      Object.entries(state.months).map(([key, month]) => [
        key,
        {
          ...month,
          categories: month.categories || {},
          platforms: month.platforms || {},
          videos: Number(month.videos) || 0,
          watchSeconds: Number(month.watchSeconds) || 0,
        },
      ]),
    ),
    settings: state.settings,
    limitState: state.limitState,
  });
}

async function sendToTabs(message) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id) return;
      try {
        await chrome.tabs.sendMessage(tab.id, message);
      } catch (_) {
        // Tabs without the content script are expected (for example chrome:// pages).
      }
    }),
  );
}

async function evaluateLimits(state) {
  const day = state.days[todayKey()] || emptyDay();
  const baseline = state.limitState.baseline || { watch: 0 };
  const exceeded = {
    watch:
      state.settings.watchLimitMinutes > 0 &&
      day.watchSeconds - baseline.watch >=
        state.settings.watchLimitMinutes * 60,
  };
  const newlyBlocked = [];
  for (const type of ["watch"]) {
    if (
      exceeded[type] &&
      !state.limitState.blocked[type] &&
      !state.limitState.ignored[type]
    ) {
      state.limitState.blocked[type] = true;
      newlyBlocked.push(type);
    }
  }
  if (newlyBlocked.length) await trimAndSave(state);
  return { exceeded, newlyBlocked };
}

function limitMessage(type, settings) {
  return {
    type: "LIMIT_REACHED",
    limitType: type,
    theme: settings.theme,
    alertMode: settings.alertMode,
    alertText: settings.alertText,
    alertImage: settings.alertImage,
  };
}

async function recordEvent(event) {
  const state = await getState();
  const day = todayKey();
  if (state.limitState.date !== day) {
    state.limitState = freshLimitState();
  }
  const month = monthKey();
  const current = state.days[day] || emptyDay();
  current.watchSeconds = Number(current.watchSeconds) || 0;
  current.videos = Number(current.videos) || 0;
  current.categories = current.categories || {};
  current.platforms = current.platforms || {};
  const monthly = state.months[month] || {
    watchSeconds: 0,
    videos: 0,
    categories: {},
    platforms: {},
    highestDay: day,
    highestWatchSeconds: 0,
  };
  monthly.watchSeconds = Number(monthly.watchSeconds) || 0;
  monthly.videos = Number(monthly.videos) || 0;
  monthly.categories = monthly.categories || {};
  monthly.platforms = monthly.platforms || {};

  if (event.kind === "watch") {
    const seconds = Math.max(0, Math.min(Number(event.seconds) || 0, 60));
    current.watchSeconds += seconds;
    monthly.watchSeconds += seconds;
    current.categories[event.category || "other"] =
      (current.categories[event.category || "other"] || 0) + seconds;
    monthly.categories[event.category || "other"] =
      (monthly.categories[event.category || "other"] || 0) + seconds;
    const platform = event.platform || "other";
    current.platforms = current.platforms || {};
    current.platforms[platform] = (current.platforms[platform] || 0) + seconds;
    monthly.platforms = monthly.platforms || {};
    monthly.platforms[platform] = (monthly.platforms[platform] || 0) + seconds;
    if (event.newVideo) {
      current.videos += 1;
      monthly.videos += 1;
    }
  }

  if (current.watchSeconds > monthly.highestWatchSeconds) {
    monthly.highestWatchSeconds = current.watchSeconds;
    monthly.highestDay = day;
  }
  state.days[day] = current;
  state.months[month] = monthly;
  await trimAndSave(state);

  const result = await evaluateLimits(state);
  await Promise.all(
    result.newlyBlocked.map((type) =>
      sendToTabs(limitMessage(type, state.settings)),
    ),
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TRACK_EVENT") {
    eventQueue = eventQueue
      .then(() => recordEvent(message))
      .catch((error) => console.error("ScrollGuard tracking error", error));
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === "GET_STATE") {
    getState()
      .then((state) => sendResponse(state))
      .catch((error) => {
        console.error("ScrollGuard state error", error);
        sendResponse({ ok: false });
      });
    return true;
  }
  if (message.type === "GET_ENFORCEMENT") {
    getState()
      .then(async (state) => {
        if (state.limitState.date !== todayKey())
          state.limitState = freshLimitState();
        const result = await evaluateLimits(state);
        sendResponse({
          active: ["watch"].filter(
            (type) =>
              state.limitState.blocked[type] && !state.limitState.ignored[type],
          ),
          settings: state.settings,
          messages: result.newlyBlocked.map((type) =>
            limitMessage(type, state.settings),
          ),
        });
      })
      .catch((error) => {
        console.error("ScrollGuard enforcement error", error);
        sendResponse({
          ok: false,
          error: "Unable to evaluate enforcement state.",
          active: [],
          settings: sanitizeSettings(),
          messages: [],
        });
      });
    return true;
  }
  if (message.type === "UPDATE_SETTINGS") {
    getState().then(async (state) => {
      if (state.limitState.date !== todayKey())
        state.limitState = freshLimitState();
      state.settings = sanitizeSettings(message.settings);
      const result = await evaluateLimits(state);
      await trimAndSave(state);
      await Promise.all(
        result.newlyBlocked.map((type) =>
          sendToTabs(limitMessage(type, state.settings)),
        ),
      );
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message.type === "LIMIT_ACTION") {
    getState()
      .then(async (state) => {
        const day = todayKey();
        state.limitState =
          state.limitState.date === day ? state.limitState : freshLimitState();
        const current = state.days[day] || emptyDay();
        state.limitState.baseline = state.limitState.baseline || { watch: 0 };
        if (
          message.limitType !== "watch" ||
          !["resume", "ignore"].includes(message.action)
        ) {
          sendResponse({ ok: false });
          return;
        }
        state.limitState.baseline.watch = current.watchSeconds;
        delete state.limitState.blocked[message.limitType];
        if (message.action === "ignore") {
          state.limitState.ignored[message.limitType] = true;
        } else {
          delete state.limitState.ignored[message.limitType];
        }
        await trimAndSave(state);
        await sendToTabs({
          type: "LIMIT_ACTION",
          action: message.action,
          limitType: message.limitType,
        });
        sendResponse({ ok: true });
      })
      .catch((error) => {
        console.error("ScrollGuard limit action error", error);
        sendResponse({ ok: false });
      });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => getState().then(trimAndSave));
