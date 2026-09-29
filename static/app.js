"use strict";

const ui = {
  status: document.querySelector("#camera-status"),
  statusText: document.querySelector("#status-text"),
  previewExpand: document.querySelector("#preview-expand"),
  previewContent: document.querySelector("#preview-content"),
  cameraAddress: document.querySelector("#camera-address"),
  stream: document.querySelector("#live-stream"),
  streamPlaceholder: document.querySelector("#stream-placeholder"),
  pills: Array.from(document.querySelectorAll(".prompt-pill")),
  customPill: document.querySelector("#custom-pill"),
  customField: document.querySelector("#custom-field"),
  customPrompt: document.querySelector("#custom-prompt"),
  clearPrompt: document.querySelector("#clear-prompt"),
  shutter: document.querySelector("#shutter-button"),
  resultRoot: document.querySelector("#result-root"),
  historyList: document.querySelector("#history-list"),
  historyCount: document.querySelector("#history-count"),
  historyMore: document.querySelector("#history-more"),
  historyWarning: document.querySelector("#history-warning"),
  dialog: document.querySelector("#photo-dialog"),
  dialogImage: document.querySelector("#photo-full"),
  dialogClose: document.querySelector("#photo-close")
};

const state = {
  selectedPrompt: "描述这张图",
  cameraUrl: "",
  streamFallbackTried: false,
  historyCount: 0,
  promptByTime: new Map()
};

function make(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

async function requestJSON(path, options) {
  const response = await fetch(path, Object.assign({ cache: "no-store" }, options || {}));
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("服务返回的数据无法读取，请稍后重试。");
  }
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error :
      response.status === 422 ? "请输入 1 到 2000 个字符的提示词。" :
      "请求失败（HTTP " + response.status + "）。";
    const error = new Error(message);
    error.record = data.status === "error" ? data : data.result;
    throw error;
  }
  return data;
}

function setCameraStatus(kind, label) {
  ui.status.dataset.state = kind;
  ui.statusText.textContent = label;
}

async function refreshHealth() {
  setCameraStatus("checking", "检测中");
  try {
    const data = await requestJSON("/api/health");
    state.cameraUrl = typeof data.camera_url === "string" ? data.camera_url : "";
    ui.cameraAddress.textContent = state.cameraUrl || "相机地址未配置";
    setCameraStatus(data.camera_online ? "online" : "offline", data.camera_online ? "在线" : "离线");
    if (!data.camera_online && !ui.previewContent.hidden) stopStream("摄像头已离线，请检查供电与网络。");
  } catch {
    setCameraStatus("offline", "离线");
    ui.cameraAddress.textContent = "电脑服务暂时不可达";
    if (!ui.previewContent.hidden) stopStream("无法连接电脑服务，请检查局域网。");
  }
}

function stopStream(message) {
  ui.stream.onerror = null;
  ui.stream.onload = null;
  ui.stream.removeAttribute("src");
  ui.stream.hidden = true;
  ui.streamPlaceholder.hidden = false;
  ui.streamPlaceholder.textContent = message || "展开后自动连接相机画面";
  state.streamFallbackTried = false;
}

function startStream() {
  if (!state.cameraUrl) {
    stopStream("请先配置相机地址。");
    return;
  }
  try {
    const url = new URL(state.cameraUrl);
    url.pathname = "/stream";
    url.search = "";
    url.hash = "";
    state.streamFallbackTried = false;
    ui.stream.referrerPolicy = "no-referrer";
    ui.streamPlaceholder.textContent = "正在连接实时画面…";
    ui.streamPlaceholder.hidden = true;
    ui.stream.hidden = false;
    ui.stream.onload = function () {
      ui.streamPlaceholder.hidden = true;
    };
    ui.stream.onerror = function () {
      if (!state.streamFallbackTried && url.protocol === "http:") {
        state.streamFallbackTried = true;
        const fallback = new URL(url.href);
        fallback.port = String(Number(url.port || "80") + 1);
        ui.stream.src = fallback.href;
      } else {
        stopStream("实时画面无法加载，请检查相机 /stream 服务。");
      }
    };
    ui.stream.src = url.href;
  } catch {
    stopStream("相机地址无效，无法连接实时画面。");
  }
}

function togglePreview() {
  const opening = ui.previewContent.hidden;
  ui.previewContent.hidden = !opening;
  ui.previewExpand.setAttribute("aria-expanded", String(opening));
  if (opening) startStream();
  else stopStream();
}

function selectPill(pill) {
  const custom = pill === ui.customPill;
  ui.pills.forEach(function (item) {
    item.setAttribute("aria-pressed", String(item === pill));
  });
  ui.customField.hidden = !custom;
  state.selectedPrompt = custom ? "" : pill.dataset.prompt;
  if (custom) ui.customPrompt.focus();
}

function selectedPrompt() {
  return ui.customPill.getAttribute("aria-pressed") === "true" ?
    ui.customPrompt.value.trim() : state.selectedPrompt;
}

function safeImageUrl(value) {
  return typeof value === "string" &&
    /^\/captures\/capture-[0-9]{8}-[0-9]{6}\.jpg$/.test(value) ? value : "";
}

function showFullPhoto(url) {
  ui.dialogImage.src = url;
  ui.dialog.showModal();
  document.body.classList.add("dialog-open");
}

function closeFullPhoto() {
  if (ui.dialog.open) ui.dialog.close();
}

function displayNumber(value, decimals) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", { maximumFractionDigits: decimals || 0 });
}

function displayTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未提供";
  return date.toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  });
}

function relativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  const now = new Date();
  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return Math.floor(seconds / 60) + "分钟前";
  if (date.toDateString() === now.toDateString()) return Math.floor(seconds / 3600) + "小时前";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "昨天";
  if (seconds < 7 * 86400) return Math.floor(seconds / 86400) + "天前";
  return (date.getMonth() + 1) + "/" + date.getDate();
}

function performanceItem(label, value) {
  const item = make("div", "performance-item");
  item.append(make("span", "performance-label", label));
  const number = make("span", "performance-value");
  number.append(document.createTextNode(displayNumber(value, 0)));
  number.append(make("span", "performance-unit", "ms"));
  item.append(number);
  return item;
}

function resultCard(record, animate) {
  const card = make("article", "result-card" + (animate ? " is-new" : ""));
  const imageUrl = safeImageUrl(record.image_url);
  if (imageUrl) {
    const photo = make("button", "result-photo");
    photo.type = "button";
    photo.setAttribute("aria-label", "全屏查看照片");
    const image = make("img");
    image.src = imageUrl;
    image.alt = "ESP32-CAM 拍摄的照片";
    image.loading = animate ? "eager" : "lazy";
    photo.append(image);
    photo.addEventListener("click", function () { showFullPhoto(imageUrl); });
    card.append(photo);
  }

  card.append(make("p", "result-text", record.error || record.text || "模型未返回文字。"));

  const strip = make("div", "performance-strip");
  const grid = make("div", "performance-grid");
  const timings = record.timings || {};
  grid.append(
    performanceItem("拍照", timings.capture_ms),
    performanceItem("API", timings.api_ms),
    performanceItem("总计", timings.total_ms)
  );
  strip.append(grid);
  const bytes = typeof record.image_bytes === "number" ?
    displayNumber(record.image_bytes / 1024, 2) + " KB" : "—";
  const extra = "图片 " + bytes +
    " · Base64 " + displayNumber(record.base64_length, 0) + " 字符 · Token " +
    displayNumber((record.usage || {}).total_tokens, 0);
  strip.append(make("p", "performance-extra", extra));
  card.append(strip);

  const timestamp = make("time", "result-time", displayTime(record.created_at));
  timestamp.dateTime = record.created_at || "";
  card.append(timestamp);
  return card;
}

function errorAdvice(message) {
  if (/提示词/.test(message)) return "在输入框填写问题后，再点击拍照按钮。";
  if (/摄像头|相机|capture|JPEG/i.test(message)) return "请检查摄像头供电、地址与 Wi-Fi 连接。";
  if (/密钥|API Key|401/i.test(message)) return "请在电脑重新配置 DeepSeek API Key。";
  if (/402|余额/.test(message)) return "请检查 DeepSeek 账户余额。";
  if (/429|限流/.test(message)) return "请稍等片刻，再重新尝试。";
  if (/超时|5xx|服务端/.test(message)) return "请稍后重试，并确认电脑可以访问互联网。";
  if (/正在识别|409/.test(message)) return "等待当前请求完成后再拍照。";
  return "请确认电脑服务仍在运行，然后重试。";
}

function showError(message, record) {
  const card = make("div", "error-card");
  card.setAttribute("role", "alert");
  card.append(make("span", "error-icon", "!"));
  const content = make("div", "error-content");
  content.append(make("strong", "", "识别未完成"));
  content.append(make("p", "", message));
  content.append(make("small", "", errorAdvice(message)));
  card.append(content);
  if (record && safeImageUrl(record.image_url)) {
    ui.resultRoot.replaceChildren(card, resultCard(record, false));
  } else {
    ui.resultRoot.replaceChildren(card);
  }
}

function showSkeleton() {
  const skeleton = make("div", "skeleton-card");
  skeleton.setAttribute("aria-label", "正在拍照并识别");
  skeleton.append(
    make("div", "skeleton-photo"),
    make("div", "skeleton-line"),
    make("div", "skeleton-line medium"),
    make("div", "skeleton-line short")
  );
  ui.resultRoot.replaceChildren(skeleton);
}

function historyEntry(record) {
  const details = make("details", "history-entry");
  const row = make("summary");
  const imageUrl = safeImageUrl(record.image_url);
  if (imageUrl) {
    const thumb = make("img", "history-thumb");
    thumb.src = imageUrl;
    thumb.alt = "";
    thumb.loading = "lazy";
    row.append(thumb);
  } else {
    const fallback = make("span", "history-thumb history-thumb-fallback", "▢");
    fallback.setAttribute("aria-hidden", "true");
    row.append(fallback);
  }
  const copy = make("span", "history-copy");
  copy.append(make("span", "history-snippet", record.text || record.error || "未返回识别结果"));
  const knownPrompt = state.promptByTime.get(record.created_at);
  copy.append(make("span", "history-prompt", knownPrompt ? "提示词：" + knownPrompt : "提示词未记录"));
  row.append(copy);
  const relative = make("time", "history-relative", relativeTime(record.created_at));
  relative.dateTime = record.created_at || "";
  row.append(relative);
  details.append(row);
  const expanded = make("div", "history-expanded");
  expanded.append(resultCard(record, false));
  details.append(expanded);
  return details;
}

async function loadHistory() {
  try {
    const data = await requestJSON("/api/history?limit=20");
    const records = Array.isArray(data.records) ? data.records : [];
    ui.historyList.replaceChildren();
    if (!records.length) {
      ui.historyList.append(make("p", "history-empty", "暂无历史记录"));
    } else {
      records.forEach(function (record) { ui.historyList.append(historyEntry(record)); });
    }
    state.historyCount = records.length;
    ui.historyCount.textContent = "共 " + records.length + " 条";
    const invalid = Number(data.invalid_lines) || 0;
    ui.historyWarning.hidden = !invalid;
    ui.historyWarning.textContent = invalid ? "有 " + invalid + " 条历史数据无法读取。" : "";
  } catch {
    ui.historyList.replaceChildren(make("p", "history-empty", "历史加载失败，请检查电脑服务。"));
    ui.historyWarning.hidden = true;
  }
}

async function loadStats() {
  try {
    const data = await requestJSON("/api/stats");
    const total = Number(data.attempt_count);
    if (Number.isFinite(total) && total >= 0) {
      ui.historyCount.textContent = "共 " + total + " 条";
      ui.historyMore.hidden = total <= 20;
    }
  } catch {
    ui.historyMore.hidden = true;
  }
}

function setBusy(busy) {
  ui.shutter.disabled = busy;
  ui.shutter.classList.toggle("is-loading", busy);
  ui.shutter.setAttribute("aria-busy", String(busy));
  ui.shutter.setAttribute("aria-label", busy ? "识别中" : "拍照并识别");
}

async function analyze() {
  const prompt = selectedPrompt();
  if (!prompt) {
    showError("请先输入自定义提示词。");
    ui.customPrompt.focus();
    return;
  }
  setBusy(true);
  showSkeleton();
  try {
    const record = await requestJSON("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt })
    });
    state.promptByTime.set(record.created_at, prompt);
    ui.resultRoot.replaceChildren(resultCard(record, true));
  } catch (error) {
    const message = error instanceof TypeError ?
      "与电脑服务的连接中断，请先查看历史记录，再决定是否重试。" :
      error.message || "识别失败，请稍后重试。";
    if (error.record && error.record.created_at) {
      state.promptByTime.set(error.record.created_at, prompt);
    }
    showError(message, error.record);
  } finally {
    setBusy(false);
    await Promise.all([loadHistory(), loadStats()]);
  }
}

ui.previewExpand.addEventListener("click", togglePreview);
ui.pills.forEach(function (pill) {
  pill.addEventListener("click", function () { selectPill(pill); });
});
ui.clearPrompt.addEventListener("click", function () {
  ui.customPrompt.value = "";
  ui.customPrompt.focus();
});
ui.shutter.addEventListener("click", analyze);
ui.dialogClose.addEventListener("click", closeFullPhoto);
ui.dialog.addEventListener("click", function (event) {
  if (event.target === ui.dialog) closeFullPhoto();
});
ui.dialog.addEventListener("close", function () {
  document.body.classList.remove("dialog-open");
  ui.dialogImage.removeAttribute("src");
});
document.addEventListener("visibilitychange", function () {
  if (document.hidden && !ui.previewContent.hidden) stopStream("视频流已暂停，收起后重新展开可继续预览。");
  if (!document.hidden) refreshHealth();
});
window.setInterval(refreshHealth, 10000);
window.setInterval(function () {
  document.querySelectorAll(".history-relative").forEach(function (time) {
    time.textContent = relativeTime(time.dateTime);
  });
}, 60000);

refreshHealth();
loadHistory();
loadStats();
