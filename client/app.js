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
const serverBase = document.getElementById("server-base");

let currentPath = "";
let selectedEntry = null;

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

function updatePreview(entry) {
  selectedEntry = entry;
  if (!entry) {
    previewTitle.textContent = "Select a file";
    previewMeta.textContent = "No file selected.";
    audioPlayer.src = "";
    playButton.disabled = true;
    downloadButton.href = "#";
    return;
  }

  previewTitle.textContent = entry.name;
  previewMeta.textContent = `${formatBytes(entry.size)} • ${formatTimestamp(entry.modified)}`;
  const fileUrl = buildUrl("/api/file", { path: entry.path });
  const downloadUrl = buildUrl("/api/download", { path: entry.path });
  audioPlayer.src = fileUrl;
  playButton.disabled = !entry.is_audio;
  downloadButton.href = downloadUrl;
}

function renderEntries(entries) {
  listEl.innerHTML = "";
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "entry";
    empty.textContent = "Empty folder";
    listEl.appendChild(empty);
    return;
  }

  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "entry";

    const button = document.createElement("button");
    button.textContent = entry.is_dir ? `${entry.name}/` : entry.name;
    button.addEventListener("click", () => {
      if (entry.is_dir) {
        loadDirectory(entry.path);
      } else {
        updatePreview(entry);
      }
    });

    const meta = document.createElement("div");
    meta.className = "entry-meta";
    if (entry.is_dir) {
      meta.textContent = "Folder";
    } else {
      const label = entry.is_audio ? "Audio" : "File";
      meta.textContent = `${label} • ${formatBytes(entry.size)}`;
    }

    row.appendChild(button);
    row.appendChild(meta);
    listEl.appendChild(row);
  });
}

async function loadDirectory(path) {
  try {
    const data = await fetchJson("/api/list", { path });
    currentPath = data.path || "";
    pathEl.textContent = `/${currentPath}`.replace(/\/\//g, "/");
    upButton.disabled = !currentPath;
    updatePreview(null);
    renderEntries(data.entries);
  } catch (err) {
    setStatus(err.message, false);
  }
}

upButton.addEventListener("click", () => {
  if (!currentPath) return;
  const parts = currentPath.split("/").filter(Boolean);
  parts.pop();
  loadDirectory(parts.join("/"));
});

playButton.addEventListener("click", () => {
  if (!selectedEntry || !selectedEntry.is_audio) return;
  audioPlayer.play();
});

serverBase.textContent = apiBase ? `Server: ${apiBase}` : "Server: local";

checkHealth();
loadDirectory("");
