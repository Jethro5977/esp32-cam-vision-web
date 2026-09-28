"use strict";
const $ = (selector) => document.querySelector(selector);
const prompts = [...document.querySelectorAll("[data-prompt]")];
/** 请求 JSON；把服务端可读错误转成界面消息。 */
async function request(url, options = {}) {
  const response = await fetch(url, options);
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`服务返回了非 JSON 内容（HTTP ${response.status}）。`); }
  if (!response.ok) {
    const error = new Error(data.error || (response.status === 422 ? "提示词需要 1–2000 个字符。" : `请求失败（HTTP ${response.status}）。`));
    error.record = data.image_url ? data : data.result;
    throw error;
  }
  return data;
}
/** 更新相机状态，不调用识别 API。 */
async function refreshHealth() {
  $("#refresh").disabled = true;
  try {
    const data = await request("/api/health");
    $("#health").textContent = `${data.camera_online ? "● 在线" : "○ 离线"} · ${data.camera_url || "相机尚未配置"} — ${data.message}${data.api_key_configured ? "" : "；API Key 未配置"}`;
  } catch { $("#health").textContent = "电脑服务无法连接，请检查服务是否运行及 Wi-Fi。"; }
  finally { $("#refresh").disabled = false; }
}
/** 创建节点并只设置纯文本，防止模型输出成为 HTML。 */
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
/** 将缺失的数据明确标为未提供。 */
function number(value, suffix = "") {
  return typeof value === "number" ? `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}` : "未提供";
}
/** 构建照片、识别文本与真实性能指标。 */
function renderRecord(record) {
  const container = element("div");
  if (record.image_url && /^\/captures\/capture-[0-9]{8}-[0-9]{6}\.jpg$/.test(record.image_url)) {
    const button = element("button", undefined, "photo-button");
    button.setAttribute("aria-label", "放大拍摄照片");
    const image = element("img");
    image.src = record.image_url;
    image.alt = "ESP32-CAM 拍摄照片，点击放大";
    image.loading = "lazy";
    button.append(image);
    button.addEventListener("click", () => {
      $("#large-image").src = record.image_url;
      $("#lightbox").showModal();
      document.body.classList.add("modal-open");
    });
    container.append(button);
  }
  container.append(element("p", record.error || record.text || "未返回文本", "result-text"));
  const metrics = element("dl", undefined, "metrics");
  const t = record.timings || {}, u = record.usage || {};
  const fields = [["拍照耗时", number(t.capture_ms, " ms")], ["API 耗时", number(t.api_ms, " ms")], ["总耗时", number(t.total_ms, " ms")], ["图片大小", number(typeof record.image_bytes === "number" ? record.image_bytes / 1024 : null, " KB")], ["Base64 长度", number(record.base64_length)], ["输入 / 输出 / 总 tokens", `${number(u.prompt_tokens)} / ${number(u.completion_tokens)} / ${number(u.total_tokens)}`]];
  for (const [label, value] of fields) {
    const pair = element("div");
    pair.append(element("dt", label), element("dd", value));
    metrics.append(pair);
  }
  container.append(metrics);
  return container;
}
/** 从电脑 JSONL 恢复最近二十条，不依赖浏览器本地存储。 */
async function loadHistory() {
  try {
    const data = await request("/api/history?limit=20");
    $("#history").replaceChildren();
    $("#history-warning").textContent = data.invalid_lines ? `历史中有 ${data.invalid_lines} 条损坏记录未加载。` : "";
    if (!data.records.length) $("#history").textContent = "还没有记录，拍摄第一张照片吧。";
    for (const record of data.records) {
      const details = element("details");
      details.append(element("summary", `${new Date(record.created_at).toLocaleString()} · ${record.status === "success" ? "识别完成" : "未完成"}`), renderRecord(record));
      $("#history").append(details);
    }
  } catch { $("#history").textContent = "历史读取失败，请检查电脑服务后刷新页面。"; }
}
/** 发起一次识别，并提供明确的等待与错误状态。 */
async function analyze() {
  const prompt = $("#prompt").value.trim();
  if (!prompt) { $("#error").hidden = false; $("#error").textContent = "请输入提示词。"; return; }
  $("#analyze").disabled = true;
  $("#analyze").textContent = "正在拍照并识别…";
  $("#error").hidden = true;
  $("#progress").textContent = "正在取图并等待云端识别，API 最多等待 60 秒，请勿重复点击。";
  $("#latest-section").hidden = true;
  try {
    const data = await request("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
    $("#latest").replaceChildren(renderRecord(data));
    $("#latest-section").hidden = false;
    $("#progress").textContent = "识别完成，已保存到电脑历史记录。";
  } catch (error) {
    $("#error").textContent = error.message === "Failed to fetch" ? "与电脑服务的连接中断，请检查网络；请求可能仍在电脑执行，先查看历史再重试。" : error.message;
    $("#error").hidden = false;
    $("#progress").textContent = "";
    if (error.record) { $("#latest").replaceChildren(renderRecord(error.record)); $("#latest-section").hidden = false; }
  } finally {
    $("#analyze").disabled = false;
    $("#analyze").textContent = "拍照并识别";
    await loadHistory();
  }
}
prompts.forEach(button => button.addEventListener("click", () => {
  $("#prompt").value = button.dataset.prompt;
  prompts.forEach(item => item.setAttribute("aria-pressed", String(item === button)));
}));
$("#prompt").addEventListener("input", () => prompts.forEach(item => item.setAttribute("aria-pressed", String(item.dataset.prompt === $("#prompt").value))));
$("#analyze").addEventListener("click", analyze);
$("#refresh").addEventListener("click", refreshHealth);
$("#close-lightbox").addEventListener("click", () => $("#lightbox").close());
$("#lightbox").addEventListener("close", () => document.body.classList.remove("modal-open"));
refreshHealth();
loadHistory();
