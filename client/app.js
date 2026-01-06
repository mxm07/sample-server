const apiBase = (window.SAMPLE_SERVER_BASE_URL || "").replace(/\/$/, "");

const statusEl = document.getElementById("status");
const pathEl = document.getElementById("current-path");
const listEl = document.getElementById("entry-list");
const upButton = document.getElementById("up-button");
const previewTitle = document.getElementById("preview-title");
const previewMeta = document.getElementById("preview-meta");
const audioPlayer = document.getElementById("audio-player");
const playButton = document.getElementById("play-button");
const downloadButton = document.getElementById("download-button");
const bulkDownloadButton = document.getElementById("bulk-download-button");
const autoplayToggle = document.getElementById("autoplay-toggle");
const selectionInfo = document.getElementById("selection-info");
const serverBase = document.getElementById("server-base");

let currentPath = "";
let currentEntries = [];
let entryRows = [];
let activeIndex = -1;
let lastSelectedIndex = -1;
let activeEntry = null;
let autoplayEnabled = true;
const selectedPaths = new Set();

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
    previewTitle.textContent = "Select a file";
    previewMeta.textContent = "No file selected.";
    audioPlayer.pause();
    audioPlayer.src = "";
    playButton.disabled = true;
    downloadButton.href = "#";
    downloadButton.setAttribute("aria-disabled", "true");
    return;
  }

  previewTitle.textContent = entry.name;
  previewMeta.textContent = `${formatBytes(entry.size)} - ${formatTimestamp(entry.modified)}`;
  const fileUrl = buildUrl("/api/file", { path: entry.path });
  const downloadUrl = buildUrl("/api/download", { path: entry.path });
  audioPlayer.pause();
  audioPlayer.currentTime = 0;
  audioPlayer.src = fileUrl;
  audioPlayer.load();
  playButton.disabled = !entry.is_audio;
  downloadButton.href = downloadUrl;
  downloadButton.setAttribute("aria-disabled", "false");

  if (entry.is_audio && autoplay) {
    audioPlayer.play().catch(() => {});
  }
}

function updateSelectionInfo() {
  const count = selectedPaths.size;
  if (count === 0) {
    selectionInfo.textContent = "No files selected.";
    bulkDownloadButton.disabled = true;
    bulkDownloadButton.textContent = "Download selected";
    return;
  }
  selectionInfo.textContent = `${count} file${count === 1 ? "" : "s"} selected.`;
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
    loadDirectory(entry.path);
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

function renderEntries(entries) {
  listEl.innerHTML = "";
  entryRows = [];

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "entry";
    empty.textContent = "Empty folder";
    listEl.appendChild(empty);
    return;
  }

  entries.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "entry";

    const button = document.createElement("button");
    button.textContent = entry.is_dir ? `${entry.name}/` : entry.name;
    button.addEventListener("click", (event) => {
      handleEntryClick(entry, index, event);
    });

    const meta = document.createElement("div");
    meta.className = "entry-meta";
    if (entry.is_dir) {
      meta.textContent = "Folder";
    } else {
      const label = entry.is_audio ? "Audio" : "File";
      meta.textContent = `${label} - ${formatBytes(entry.size)}`;
    }

    row.appendChild(button);
    row.appendChild(meta);
    listEl.appendChild(row);
    entryRows.push(row);
  });

  refreshSelectionUI();
}

async function loadDirectory(path) {
  try {
    const data = await fetchJson("/api/list", { path });
    currentPath = data.path || "";
    currentEntries = data.entries || [];
    activeIndex = -1;
    lastSelectedIndex = -1;
    clearSelection();
    pathEl.textContent = `/${currentPath}`.replace(/\/\//g, "/");
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

serverBase.textContent = apiBase ? `Server: ${apiBase}` : "Server: local";

checkHealth();
loadDirectory("");
