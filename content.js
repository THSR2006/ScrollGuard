(function () {
  const host = location.hostname;
  const supported =
    host.includes("youtube.") ||
    host.includes("instagram.") ||
    host.includes("tiktok.");
  if (!supported) return;

  const platform = host.includes("youtube")
    ? "youtube"
    : host.includes("instagram")
      ? "instagram"
      : "tiktok";
  let nextVideoId = 1;
  const videoIds = new WeakMap();
  const countedVideoKeys = new Set();
  const shownLimits = new Set();
  const pausedVideos = new Set();
  const activeLimits = new Set();

  function sendMessage(message, callback) {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) return;
        if (callback) callback(response);
      });
    } catch (_) {
      // The page can outlive the extension during an extension reload.
    }
  }

  function categoryFor(video) {
    const text =
      `${document.title} ${video?.getAttribute("aria-label") || ""}`.toLowerCase();
    const groups = {
      education: ["learn", "tutorial", "how to", "course", "science", "study"],
      music: ["music", "song", "cover", "remix", "concert", "dj"],
      news: ["news", "politics", "breaking", "current affairs"],
      sports: [
        "football",
        "soccer",
        "cricket",
        "basketball",
        "sports",
        "fitness",
      ],
      comedy: ["comedy", "funny", "joke", "meme"],
      gaming: ["gaming", "gameplay", "gamer", "esports"],
    };
    return (
      Object.entries(groups).find(([, words]) =>
        words.some((word) => text.includes(word)),
      )?.[0] || "entertainment"
    );
  }

  function track(kind, data = {}) {
    sendMessage({ type: "TRACK_EVENT", kind, platform, ...data });
  }

  function videoKey(video) {
    const source = video.currentSrc || video.src || video.getAttribute("src");
    if (source) return source;
    if (!videoIds.has(video)) videoIds.set(video, `element-${nextVideoId++}`);
    return videoIds.get(video);
  }

  function inspectVideo() {
    const videos = [...document.querySelectorAll("video")];
    const video = videos.find(
      (item) => !item.paused && item.readyState >= 2 && item.offsetWidth > 0,
    );
    if (!video) {
      return;
    }
    const key = videoKey(video);
    if (!countedVideoKeys.has(key)) {
      countedVideoKeys.add(key);
      track("watch", {
        seconds: 0,
        category: categoryFor(video),
        newVideo: true,
      });
    }
    track("watch", { seconds: 5, category: categoryFor(video) });
  }

  function pauseAllVideos() {
    document.querySelectorAll("video").forEach((video) => {
      if (!video.paused) {
        video.pause();
        pausedVideos.add(video);
      }
    });
  }

  document.addEventListener(
    "play",
    (event) => {
      if (!activeLimits.size || !(event.target instanceof HTMLVideoElement))
        return;
      event.target.pause();
      pausedVideos.add(event.target);
    },
    true,
  );

  function resumeVideos() {
    pausedVideos.forEach((video) => video.play().catch(() => {}));
    pausedVideos.clear();
  }

  function isSafeImageSource(value) {
    return (
      typeof value === "string" &&
      (/^data:image\//i.test(value) ||
        /^blob:/i.test(value) ||
        /^https:\/\//i.test(value))
    );
  }

  function showLimit(message) {
    const existing = document.getElementById("scrollguard-limit");
    if (existing) return;
    const isDark = message.theme === "dark";
    const root = document.createElement("div");
    root.id = "scrollguard-limit";
    root.style.cssText =
      `position:fixed;inset:0;background:${isDark ? "rgba(10,14,24,.86)" : "rgba(245,246,248,.88)"};z-index:2147483647;display:grid;place-items:center;font:16px system-ui;color:${isDark ? "#edf0f3" : "#20252b"};`;
    const card = document.createElement("div");
    card.style.cssText =
      `max-width:420px;padding:32px;border:1px solid ${isDark ? "#353c45" : "#d9dde3"};border-radius:20px;background:${isDark ? "#20242a" : "#ffffff"};text-align:center;box-shadow:0 20px 60px ${isDark ? "#0008" : "rgba(31,37,43,.16)"};`;
    if (
      message.alertMode === "image" &&
      isSafeImageSource(message.alertImage)
    ) {
      const image = document.createElement("img");
      image.src = message.alertImage;
      image.style.cssText =
        "max-width:100%;max-height:240px;border-radius:12px;";
      card.appendChild(image);
    }
    const text = document.createElement("p");
    text.textContent = message.alertText || "Time for a mindful break.";
    text.style.cssText = `margin:18px 0 0;color:${isDark ? "#edf0f3" : "#20252b"};line-height:1.5;`;
    card.appendChild(text);
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;justify-content:center;gap:10px;margin-top:22px;";
    [
      ["resume", "Resume", "secondary"],
      ["ignore", "Ignore today", "primary"],
    ].forEach(([action, label, variant]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.style.cssText =
        `padding:9px 14px;border:1px solid ${isDark ? "#59636e" : "#b7bec8"};border-radius:8px;background:${variant === "primary" ? (isDark ? "#60a5fa" : "#2563eb") : "transparent"};color:${variant === "primary" ? "#fff" : isDark ? "#edf0f3" : "#20252b"};font:inherit;cursor:pointer;`;
      button.addEventListener("click", () => {
        sendMessage({
          type: "LIMIT_ACTION",
          action,
          limitType: message.limitType,
        });
      });
      actions.appendChild(button);
    });
    card.appendChild(actions);
    root.appendChild(card);
    document.documentElement.appendChild(root);
  }

  setInterval(inspectVideo, 5000);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== "LIMIT_REACHED") return;
    if (shownLimits.has(message.limitType)) return;
    shownLimits.add(message.limitType);
    activeLimits.add(message.limitType);
    pauseAllVideos();
    showLimit(message);
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== "LIMIT_ACTION") return;
    shownLimits.delete(message.limitType);
    activeLimits.delete(message.limitType);
    document.getElementById("scrollguard-limit")?.remove();
    resumeVideos();
  });

  sendMessage({ type: "GET_ENFORCEMENT" }, (response) => {
    if (chrome.runtime.lastError || !response) return;
    response.active.forEach((limitType) => {
      const alert = response.messages.find(
        (item) => item.limitType === limitType,
      ) || {
        type: "LIMIT_REACHED",
        limitType,
        ...response.settings,
      };
      if (shownLimits.has(limitType)) return;
      shownLimits.add(limitType);
      activeLimits.add(limitType);
      pauseAllVideos();
      showLimit(alert);
    });
  });
})();