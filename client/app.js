const apiBase = (window.SAMPLE_SERVER_BASE_URL || "").replace(/\/$/, "");

const statusEl = document.getElementById("status");
const pathEl = document.getElementById("current-path");
const listEl = document.getElementById("entry-list");
const upButton = document.getElementById("up-button");
const searchInput = document.getElementById("search-input");
const searchClear = document.getElementById("search-clear");
const selectedCount = document.getElementById("selected-count");
const nowTitle = document.getElementById("now-title");
const nowMeta = document.getElementById("now-meta");
const audioPlayer = document.getElementById("audio-player");
const playButton = document.getElementById("play-button");
const bulkDownloadButton = document.getElementById("bulk-download-button");
const autoplayToggle = document.getElementById("autoplay-toggle");

let currentPath = "";
let currentEntries = [];
let entryLookup = new Map();
let metaLookup = new Map();
let entryRows = [];
let activeIndex = -1;
let lastSelectedIndex = -1;
let activeEntry = null;
let autoplayEnabled = true;
let searchActive = false;
let lastBrowsePath = "";
let searchTimer = null;
let searchRequestId = 0;
const searchDelay = 250;
const selectedPaths = new Set();
const durationCache = new Map();
const waveformCache = new Map();
const waveformQueue = [];
let waveformActive = 0;
let waveformObserver = null;
let audioContext = null;
const maxWaveformWorkers = 2;

const downloadIcon =
  "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\">" +
  "<path d=\"M12 3a1 1 0 0 1 1 1v9.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4.01 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 1.4-1.42L11 13.59V4a1 1 0 0 1 1-1z\"/>" +
  "<path d=\"M5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1z\"/>" +
  "</svg>";
const folderIcon =
  "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">" +
  "<path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\"/>" +
  "</svg>";
const fileIcon =
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" ` +
  `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
  `stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M9 18V5l12-2v13"/>` +
  `<circle cx="6" cy="18" r="3"/>` +
  `<circle cx="18" cy="16" r="3"/>` +
  `</svg>`;
function setStatus(text, ok) {
  statusEl.textContent = text;
  statusEl.style.background = ok ? "#f1f7f4" : "#fff0f0";
  statusEl.style.color = ok ? "#2d5b4f" : "#8d2b2b";
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(1)} ${units[index]}`;
}

function formatTimestamp(seconds) {
  if (!seconds) return "-";
  const date = new Date(seconds * 1000);
  return date.toLocaleString();
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--:--";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function getFileType(entry) {
  const parts = entry.name.split(".");
  if (parts.length < 2) return "AUDIO";
  return parts[parts.length - 1].toUpperCase();
}

function buildMetaText(entry) {
  if (entry.is_dir) {
    if (entry.size === null || entry.size === undefined) {
      return "Folder";
    }
    return `Folder - ${formatBytes(entry.size)}`;
  }
  const duration = durationCache.get(entry.path);
  const durationText = duration ? formatDuration(duration) : "--:--";
  return `${getFileType(entry)} - ${formatBytes(entry.size)} - ${durationText}`;
}

function renderBreadcrumbs(path) {
  pathEl.innerHTML = "";
  const rootButton = document.createElement("button");
  rootButton.type = "button";
  rootButton.textContent = "(root)";
  rootButton.addEventListener("click", () => loadDirectory(""));
  pathEl.appendChild(rootButton);

  const parts = path.split("/").filter(Boolean);
  let prefix = "";
  parts.forEach((part) => {
    prefix = prefix ? `${prefix}/${part}` : part;
    const separator = document.createElement("span");
    separator.className = "path-separator";
    separator.textContent = "/";
    pathEl.appendChild(separator);

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = part;
    button.addEventListener("click", () => loadDirectory(prefix));
    pathEl.appendChild(button);
  });
}

function renderSearchMeta(query, count) {
  pathEl.innerHTML = "";
  const label = document.createElement("span");
  label.className = "search-label";
  label.textContent = `Search: "${query}"`;
  pathEl.appendChild(label);
  const tally = document.createElement("span");
  tally.className = "search-count";
  tally.textContent = `${count} results`;
  pathEl.appendChild(tally);
}

function buildUrl(path, query) {
  const base = apiBase ? `${apiBase}${path}` : path;
  if (!query) return base;
  const params = new URLSearchParams(query);
  return `${base}?${params.toString()}`;
}

async function fetchJson(path, query) {
  const response = await fetch(buildUrl(path, query));
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.detail || "Request failed");
  }
  return response.json();
}

async function checkHealth() {
  try {
    await fetchJson("/api/health");
    setStatus("Connected", true);
  } catch (err) {
    setStatus("Disconnected", false);
  }
}

function updatePreview(entry, { autoplay = false } = {}) {
  activeEntry = entry;
  if (!entry) {
    nowTitle.textContent = "No file selected";
    nowMeta.textContent = "-";
    audioPlayer.pause();
    audioPlayer.src = "";
    playButton.disabled = true;
    return;
  }

  nowTitle.textContent = entry.name;
  nowMeta.textContent = `${formatBytes(entry.size)} - ${formatTimestamp(entry.modified)}`;
  const fileUrl = buildUrl("/api/file", { path: entry.path });
  audioPlayer.pause();
  audioPlayer.currentTime = 0;
  audioPlayer.src = fileUrl;
  audioPlayer.load();
  playButton.disabled = !entry.is_audio;

  if (entry.is_audio && autoplay) {
    audioPlayer.play().catch(() => {});
  }
}

function ensureAudioContext() {
  if (!audioContext) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    audioContext = new Context();
  }
  return audioContext;
}

function drawWaveform(canvas, peaks) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#2d5b4f";
  const bucketWidth = width / peaks.length;
  peaks.forEach((value, index) => {
    const barHeight = Math.max(1, Math.round(value * height));
    const x = Math.floor(index * bucketWidth);
    const nextX = Math.floor((index + 1) * bucketWidth);
    const barWidth = Math.max(1, nextX - x);
    const y = Math.floor((height - barHeight) / 2);
    ctx.fillRect(x, y, barWidth, barHeight);
  });
}

function drawWaveformPlaceholder(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#d2c3ab";
  const height = canvas.height;
  const width = canvas.width;
  ctx.fillRect(0, Math.floor(height / 2) - 1, width, 2);
}

function computePeaks(samples, buckets) {
  const peaks = new Array(buckets).fill(0);
  if (!samples.length) return peaks;
  const blockSize = Math.max(1, Math.floor(samples.length / buckets));
  for (let i = 0; i < buckets; i += 1) {
    const start = i * blockSize;
    const end = Math.min(samples.length, start + blockSize);
    let max = 0;
    for (let j = start; j < end; j += 1) {
      const value = Math.abs(samples[j]);
      if (value > max) {
        max = value;
      }
    }
    peaks[i] = max;
  }
  return peaks;
}

async function generateWaveform(entry) {
  const context = ensureAudioContext();
  if (!context) {
    throw new Error("AudioContext not supported");
  }
  const response = await fetch(buildUrl("/api/file", { path: entry.path }));
  if (!response.ok) {
    throw new Error("Waveform fetch failed");
  }
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await context.decodeAudioData(arrayBuffer);
  const channelData = audioBuffer.getChannelData(0);
  return { peaks: computePeaks(channelData, 48), duration: audioBuffer.duration };
}

function enqueueWaveform(entry, canvas) {
  if (!entry || !entry.is_audio) return;
  if (waveformCache.has(entry.path)) {
    const cached = waveformCache.get(entry.path);
    drawWaveform(canvas, cached.peaks);
    if (cached.duration) {
      durationCache.set(entry.path, cached.duration);
      const meta = metaLookup.get(entry.path);
      if (meta) {
        meta.textContent = buildMetaText(entry);
      }
    }
    return;
  }
  if (canvas.dataset.state === "queued") return;
  canvas.dataset.state = "queued";
  waveformQueue.push({ entry, canvas });
  runWaveformQueue();
}

function runWaveformQueue() {
  while (waveformActive < maxWaveformWorkers && waveformQueue.length > 0) {
    const { entry, canvas } = waveformQueue.shift();
    waveformActive += 1;
    generateWaveform(entry)
      .then((data) => {
        waveformCache.set(entry.path, data);
        drawWaveform(canvas, data.peaks);
        if (data.duration) {
          durationCache.set(entry.path, data.duration);
          const meta = metaLookup.get(entry.path);
          if (meta) {
            meta.textContent = buildMetaText(entry);
          }
        }
      })
      .catch(() => {
        drawWaveformPlaceholder(canvas);
      })
      .finally(() => {
        waveformActive -= 1;
        runWaveformQueue();
      });
  }
}

function updateSelectionInfo() {
  const count = selectedPaths.size;
  selectedCount.textContent = `${count} selected`;
  if (count === 0) {
    bulkDownloadButton.disabled = true;
    bulkDownloadButton.textContent = "Download selected";
    return;
  }
  bulkDownloadButton.disabled = false;
  bulkDownloadButton.textContent = `Download selected (${count})`;
}

function refreshSelectionUI() {
  entryRows.forEach((row, index) => {
    const entry = currentEntries[index];
    row.classList.toggle("active", index === activeIndex);
    row.classList.toggle("selected", entry && selectedPaths.has(entry.path));
  });
  updateSelectionInfo();
}

function clearSelection() {
  selectedPaths.clear();
}

function selectEntry(entry) {
  if (!entry || entry.is_dir) return;
  selectedPaths.add(entry.path);
}

function toggleSelection(entry) {
  if (!entry || entry.is_dir) return;
  if (selectedPaths.has(entry.path)) {
    selectedPaths.delete(entry.path);
  } else {
    selectedPaths.add(entry.path);
  }
}

function selectRange(startIndex, endIndex) {
  selectedPaths.clear();
  const start = Math.min(startIndex, endIndex);
  const end = Math.max(startIndex, endIndex);
  for (let i = start; i <= end; i += 1) {
    const entry = currentEntries[i];
    if (entry && !entry.is_dir) {
      selectedPaths.add(entry.path);
    }
  }
}

function setActiveIndex(index, { select = true, autoplay = false } = {}) {
  if (index < 0 || index >= currentEntries.length) return;
  activeIndex = index;
  const entry = currentEntries[index];

  if (select) {
    selectedPaths.clear();
    if (entry && !entry.is_dir) {
      selectedPaths.add(entry.path);
      lastSelectedIndex = index;
    } else {
      lastSelectedIndex = -1;
    }
  }

  updatePreview(entry && !entry.is_dir ? entry : null, {
    autoplay: autoplay && entry && entry.is_audio,
  });
  refreshSelectionUI();

  const row = entryRows[index];
  if (row) {
    row.scrollIntoView({ block: "nearest" });
  }
}

function handleEntryClick(entry, index, event) {
  if (entry.is_dir) {
    if (searchActive) {
      exitSearch({ targetPath: entry.path });
    } else {
      loadDirectory(entry.path);
    }
    return;
  }

  if (event.shiftKey && lastSelectedIndex >= 0) {
    selectRange(lastSelectedIndex, index);
  } else if (event.metaKey || event.ctrlKey) {
    toggleSelection(entry);
  } else {
    clearSelection();
    selectEntry(entry);
  }

  lastSelectedIndex = index;
  activeIndex = index;
  updatePreview(entry, { autoplay: autoplayEnabled && entry.is_audio });
  refreshSelectionUI();
}

function renderEntries(entries, { emptyMessage = "Empty folder" } = {}) {
  listEl.innerHTML = "";
  entryRows = [];
  metaLookup = new Map();
  if (waveformObserver) {
    waveformObserver.disconnect();
  }
  waveformObserver = new IntersectionObserver(
    (items) => {
      items.forEach((item) => {
        if (!item.isIntersecting) return;
        waveformObserver.unobserve(item.target);
        const path = item.target.dataset.path;
        const entry = entryLookup.get(path);
        if (entry) {
          enqueueWaveform(entry, item.target);
        }
      });
    },
    { root: listEl, rootMargin: "40px" }
  );

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "entry";
    empty.textContent = emptyMessage;
    listEl.appendChild(empty);
    return;
  }

  entries.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "entry";
    row.addEventListener("click", (event) => {
      if (event.target.closest(".icon-button")) {
        return;
      }
      handleEntryClick(entry, index, event);
    });

    const button = document.createElement("button");
    button.className = "entry-name";
    const icon = document.createElement("span");
    icon.className = "entry-icon";
    icon.innerHTML = entry.is_dir ? folderIcon : fileIcon;
    button.appendChild(icon);

    const label = document.createElement("span");
    label.textContent = entry.is_dir ? `${entry.name}/` : entry.name;
    button.appendChild(label);

    const actions = document.createElement("div");
    actions.className = "entry-actions";
    actions.classList.add(entry.is_dir ? "is-dir" : "is-audio");

    const meta = document.createElement("div");
    meta.className = "entry-meta";
    meta.textContent = buildMetaText(entry);
    if (!entry.is_dir) {
      metaLookup.set(entry.path, meta);
    }
    actions.appendChild(meta);

    if (!entry.is_dir) {
      const canvas = document.createElement("canvas");
      canvas.className = "waveform";
      canvas.width = 84;
      canvas.height = 24;
      canvas.dataset.path = entry.path;
      drawWaveformPlaceholder(canvas);
      actions.appendChild(canvas);
      if (waveformCache.has(entry.path)) {
        const cached = waveformCache.get(entry.path);
        drawWaveform(canvas, cached.peaks);
        if (cached.duration) {
          durationCache.set(entry.path, cached.duration);
          meta.textContent = buildMetaText(entry);
        }
      } else {
        waveformObserver.observe(canvas);
      }
      actions.appendChild(canvas);
    }

    const downloadLink = document.createElement("a");
    downloadLink.className = "icon-button";
    downloadLink.href = buildUrl("/api/download", { path: entry.path });
    if (!entry.is_dir) {
      downloadLink.download = entry.name;
    }
    downloadLink.title = entry.is_dir ? "Download folder" : "Download";
    downloadLink.setAttribute("aria-label", downloadLink.title);
    downloadLink.innerHTML = downloadIcon;
    downloadLink.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    actions.appendChild(downloadLink);

    row.appendChild(button);
    row.appendChild(actions);
    listEl.appendChild(row);
    entryRows.push(row);
  });

  refreshSelectionUI();
}

function setSearchControls(value) {
  searchClear.disabled = !value;
}

function showListMessage(message) {
  listEl.innerHTML = "";
  entryRows = [];
  const placeholder = document.createElement("div");
  placeholder.className = "entry";
  placeholder.textContent = message;
  listEl.appendChild(placeholder);
}

async function runSearch(query) {
  const trimmed = query.trim();
  if (!trimmed) return;
  searchTimer = null;
  const requestId = (searchRequestId += 1);
  if (!searchActive) {
    lastBrowsePath = currentPath;
    searchActive = true;
  }
  setSearchControls(trimmed);
  upButton.disabled = true;
  showListMessage("Searching...");
  try {
    const data = await fetchJson("/api/search", { query: trimmed, limit: 120 });
    if (requestId !== searchRequestId) {
      return;
    }
    currentEntries = (data.results || []).filter(
      (entry) => entry.is_dir || entry.is_audio
    );
    entryLookup = new Map(currentEntries.map((entry) => [entry.path, entry]));
    activeIndex = -1;
    lastSelectedIndex = -1;
    clearSelection();
    renderSearchMeta(trimmed, data.count ?? currentEntries.length);
    updatePreview(null);
    renderEntries(currentEntries, { emptyMessage: "No matches" });
  } catch (err) {
    setStatus(err.message, false);
  }
}

function exitSearch({ targetPath = null } = {}) {
  if (!searchActive && !searchInput.value) {
    return;
  }
  searchRequestId += 1;
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
  searchActive = false;
  searchInput.value = "";
  setSearchControls("");
  if (targetPath !== null) {
    loadDirectory(targetPath);
  }
}

async function loadDirectory(path) {
  try {
    if (!searchActive) {
      lastBrowsePath = path;
    }
    const data = await fetchJson("/api/list", { path });
    currentPath = data.path || "";
    currentEntries = (data.entries || []).filter(
      (entry) => entry.is_dir || entry.is_audio
    );
    entryLookup = new Map(currentEntries.map((entry) => [entry.path, entry]));
    activeIndex = -1;
    lastSelectedIndex = -1;
    clearSelection();
    renderBreadcrumbs(currentPath);
    upButton.disabled = !currentPath;
    updatePreview(null);
    renderEntries(currentEntries);
  } catch (err) {
    setStatus(err.message, false);
  }
}

function downloadSelected() {
  const entries = currentEntries.filter(
    (entry) => !entry.is_dir && selectedPaths.has(entry.path)
  );
  if (!entries.length) return;

  entries.forEach((entry, index) => {
    const url = buildUrl("/api/download", { path: entry.path });
    setTimeout(() => {
      const link = document.createElement("a");
      link.href = url;
      link.download = entry.name;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }, index * 150);
  });
}

function isFormTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName ? target.tagName.toLowerCase() : "";
  return tag === "input" || tag === "textarea" || tag === "select";
}

upButton.addEventListener("click", () => {
  if (!currentPath) return;
  const parts = currentPath.split("/").filter(Boolean);
  parts.pop();
  loadDirectory(parts.join("/"));
});

playButton.addEventListener("click", () => {
  if (!activeEntry || !activeEntry.is_audio) return;
  audioPlayer.play().catch(() => {});
});

bulkDownloadButton.addEventListener("click", () => {
  downloadSelected();
});

setSearchControls(searchInput.value);
searchInput.addEventListener("input", () => {
  const value = searchInput.value;
  setSearchControls(value);
  if (searchTimer) {
    clearTimeout(searchTimer);
  }
  if (!value.trim()) {
    if (searchActive) {
      exitSearch({ targetPath: lastBrowsePath || "" });
    }
    return;
  }
  searchTimer = setTimeout(() => runSearch(value), searchDelay);
});

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    if (searchTimer) {
      clearTimeout(searchTimer);
    }
    runSearch(searchInput.value);
  }
  if (event.key === "Escape") {
    event.preventDefault();
    exitSearch({ targetPath: lastBrowsePath || "" });
  }
});

searchClear.addEventListener("click", () => {
  exitSearch({ targetPath: lastBrowsePath || "" });
});

document.addEventListener("keydown", (event) => {
  if (isFormTarget(event.target)) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (!currentEntries.length) return;
    const nextIndex = activeIndex < 0 ? 0 : Math.min(activeIndex + 1, currentEntries.length - 1);
    setActiveIndex(nextIndex, { select: true, autoplay: autoplayEnabled });
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (!currentEntries.length) return;
    const nextIndex = activeIndex < 0 ? currentEntries.length - 1 : Math.max(activeIndex - 1, 0);
    setActiveIndex(nextIndex, { select: true, autoplay: autoplayEnabled });
  }
});

const storedAutoplay = window.localStorage.getItem("sampleServerAutoplay");
autoplayEnabled = storedAutoplay === null ? true : storedAutoplay === "true";
autoplayToggle.checked = autoplayEnabled;
autoplayToggle.addEventListener("change", () => {
  autoplayEnabled = autoplayToggle.checked;
  window.localStorage.setItem("sampleServerAutoplay", String(autoplayEnabled));
});

checkHealth();
loadDirectory("");
