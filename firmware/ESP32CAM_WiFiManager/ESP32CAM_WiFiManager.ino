/*
 * ESP32-CAM CameraWebServer + WiFiManager
 *
 * 功能说明：
 * 1. 首次上电或已存 WiFi 连不上时，自动开启 AP 热点（名称：AI-Vision-Setup）
 * 2. 手机连上该热点，浏览器会自动弹出配置页面（或手动访问 192.168.4.1）
 * 3. 在页面中选择 WiFi 并输入密码，ESP32 自动重启并连接
 * 4. 连接成功后启动 CameraWebServer，Serial Monitor 打印 IP
 * 5. 下次开机自动连接已保存的 WiFi，无需重新配置
 * 6. 换 WiFi 时：关闭旧热点并重启相机，连接超时后自动进入配网模式
 *
 * 硬件：AI Thinker ESP32-CAM + OV2640
 *
 * 依赖库（需在 Arduino IDE Library Manager 中安装）：
 * - WiFiManager by tzapu（搜索 "WiFiManager" 选 tzapu 那个，版本 2.x）
 *
 * Board 设置：Tools → Board → AI Thinker ESP32-CAM
 */

#include "esp_camera.h"
#include <WiFi.h>
#include <WiFiManager.h>
#include <WebServer.h>
#include "esp_http_server.h"

// ==================== 摄像头引脚定义（AI Thinker ESP32-CAM） ====================
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// ==================== LED 定义 ====================
#define LED_BUILTIN_PIN    33   // 板载红色 LED（LOW = 亮）
#define FLASH_LED_PIN       4   // 闪光灯 LED

// ==================== AP 热点配置 ====================
const char* AP_NAME = "AI-Vision-Setup";    // 配网热点名称
const int   WIFI_TIMEOUT = 600;             // 配网页面等待 10 分钟，方便切换设备配网

// ==================== 全局对象 ====================
WebServer server(80);
httpd_handle_t streamServer = nullptr;
bool streamReady = false;

// ==================== 摄像头初始化 ====================
bool initCamera() {
  camera_config_t config = {};  // 必须初始化全部字段，避免未定义值导致帧缓冲分配失败
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size   = FRAMESIZE_VGA;      // 640x480
  config.jpeg_quality = 12;                 // 0-63，越小质量越高
  config.fb_count     = 1;
  config.grab_mode    = CAMERA_GRAB_WHEN_EMPTY;
  config.fb_location  = CAMERA_FB_IN_DRAM;

  // PSRAM 可用时提高配置
  if (psramFound()) {
    config.fb_location  = CAMERA_FB_IN_PSRAM;
    config.jpeg_quality = 10;
    config.fb_count     = 2;
    config.grab_mode    = CAMERA_GRAB_LATEST;
  } else {
    config.frame_size   = FRAMESIZE_QVGA;
  }
  Serial.printf("PSRAM：%s，空闲堆：%u 字节\n", psramFound() ? "可用" : "不可用", ESP.getFreeHeap());

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("摄像头初始化失败，错误码: 0x%x\n", err);
    return false;
  }

  // 翻转画面（根据你的摄像头安装方向，可能需要调整）
  sensor_t * s = esp_camera_sensor_get();
  s->set_vflip(s, 0);
  s->set_hmirror(s, 0);

  Serial.println("摄像头初始化成功");
  return true;
}

// ==================== HTTP 处理函数 ====================

// 首页 - 简单的状态页面
void handleRoot() {
  String html = "<!DOCTYPE html><html><head>";
  html += "<meta charset='UTF-8'>";
  html += "<meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<title>AI Vision Camera</title>";
  html += "<style>";
  html += "body{font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:20px;background:#f2f2f7;color:#1c1c1e}";
  html += ".card{background:#fff;border-radius:16px;padding:20px;margin:12px 0;box-shadow:0 1px 3px rgba(0,0,0,0.1)}";
  html += "h1{font-size:22px;text-align:center}";
  html += ".status{color:#34c759;font-weight:600}";
  html += "img{width:100%;border-radius:12px;margin:8px 0}";
  html += "a{color:#007aff;text-decoration:none}";
  html += ".btn{display:block;text-align:center;background:#007aff;color:#fff;padding:14px;border-radius:12px;font-size:16px;margin:8px 0}";
  html += "</style></head><body>";
  html += "<h1>📷 AI Vision Camera</h1>";
  html += "<div class='card'>";
  html += "<p>状态：<span class='status'>● 在线</span></p>";
  html += "<p>IP 地址：" + WiFi.localIP().toString() + "</p>";
  html += "<p>WiFi：" + WiFi.SSID() + "</p>";
  html += "<p>信号强度：" + String(WiFi.RSSI()) + " dBm</p>";
  html += "</div>";
  html += "<div class='card'>";
  html += "<h3>实时画面</h3>";
  html += "<img src='/stream' alt='camera stream'>";
  html += "</div>";
  html += "<div class='card'>";
  html += "<h3>接口说明</h3>";
  html += "<p><a href='/capture'>/capture</a> — 拍一张 JPEG</p>";
  html += "<p><a href='/stream'>/stream</a> — MJPEG 视频流</p>";
  html += "<p><a href='/status'>/status</a> — 设备状态 JSON</p>";
  html += "</div>";
  html += "<div class='card'>";
  html += "<h3>切换 WiFi</h3>";
  html += "<p>关闭旧热点并短按 RST；旧网络连接失败后，相机会开启 AI-Vision-Setup 配网热点。</p>";
  html += "</div>";
  html += "</body></html>";
  server.send(200, "text/html", html);
}

// 拍照 - 返回一张 JPEG
void handleCapture() {
  camera_fb_t * fb = esp_camera_fb_get();
  if (!fb) {
    server.send(500, "text/plain", "Camera capture failed");
    return;
  }
  server.sendHeader("Content-Disposition", "inline; filename=capture.jpg");
  server.send_P(200, "image/jpeg", (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

// 视频流独立运行在 81 端口，避免长连接阻塞 80 端口的拍照请求。
esp_err_t handleStreamRequest(httpd_req_t *req) {
  httpd_resp_set_type(req, "multipart/x-mixed-replace; boundary=frame");
  httpd_resp_set_hdr(req, "Cache-Control", "no-cache");
  esp_err_t result = ESP_OK;

  while (result == ESP_OK) {
    camera_fb_t * fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("抓帧失败");
      result = ESP_FAIL;
      break;
    }

    char header[96];
    int headerLength = snprintf(header, sizeof(header),
                                "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
                                (unsigned int)fb->len);
    if (headerLength < 0 || headerLength >= (int)sizeof(header)) {
      result = ESP_FAIL;
    } else {
      result = httpd_resp_send_chunk(req, header, headerLength);
      if (result == ESP_OK) result = httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);
      if (result == ESP_OK) result = httpd_resp_send_chunk(req, "\r\n", 2);
    }
    esp_camera_fb_return(fb);
    delay(100);   // 约 10fps，降低功耗和发热
  }
  return result;
}

bool startStreamServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 81;
  config.ctrl_port += 1;
  config.stack_size = 8192;
  if (httpd_start(&streamServer, &config) != ESP_OK) return false;

  httpd_uri_t streamUri = {};
  streamUri.uri = "/stream";
  streamUri.method = HTTP_GET;
  streamUri.handler = handleStreamRequest;
  if (httpd_register_uri_handler(streamServer, &streamUri) != ESP_OK) {
    httpd_stop(streamServer);
    streamServer = nullptr;
    return false;
  }
  return true;
}

// 保留原有 /stream 地址，浏览器会自动跳转到独立的视频流端口。
void handleStreamRedirect() {
  if (!streamReady) {
    server.send(503, "text/plain", "Camera stream unavailable");
    return;
  }
  server.sendHeader("Location", "http://" + WiFi.localIP().toString() + ":81/stream");
  server.send(302, "text/plain", "");
}

// 状态 JSON - 供 Web 网关的 /api/health 调用
void handleStatus() {
  String json = "{";
  json += "\"status\":\"online\",";
  json += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
  json += "\"ssid\":\"" + WiFi.SSID() + "\",";
  json += "\"rssi\":" + String(WiFi.RSSI()) + ",";
  json += "\"free_heap\":" + String(ESP.getFreeHeap()) + ",";
  json += "\"psram\":" + String(psramFound() ? "true" : "false");
  json += "}";
  server.send(200, "application/json", json);
}

// ==================== LED 提示函数 ====================
void blinkLED(int times, int interval) {
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_BUILTIN_PIN, LOW);   // 亮
    delay(interval);
    digitalWrite(LED_BUILTIN_PIN, HIGH);  // 灭
    delay(interval);
  }
}

// ==================== 配网回调 ====================
void configModeCallback(WiFiManager *myWiFiManager) {
  Serial.println("========================================");
  Serial.println("已进入配网模式（AP 热点）");
  Serial.println("热点名称：" + String(AP_NAME));
  Serial.println("配置地址：http://192.168.4.1");
  Serial.println("========================================");

  // LED 慢闪表示配网模式
  blinkLED(3, 300);
}

// ==================== setup ====================
void setup() {
  Serial.begin(115200);
  Serial.println("\n\n========================================");
  Serial.println("AI Vision Camera 启动中...");
  Serial.println("========================================");

  // 初始化 LED；IO0 是摄像头 XCLK，不能在运行时作为按钮输入
  pinMode(LED_BUILTIN_PIN, OUTPUT);
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(LED_BUILTIN_PIN, HIGH);  // 灭
  digitalWrite(FLASH_LED_PIN, LOW);     // 闪光灯关

  // ---- WiFiManager 配网 ----
  bool connected = false;
  {
    WiFiManager wm;
    wm.setConfigPortalTimeout(WIFI_TIMEOUT);
    wm.setConnectTimeout(15);  // 已保存网络不可用时尽快进入配网页面
    wm.setAPCallback(configModeCallback);
    wm.setTitle("AI Vision Camera");
    // autoConnect(热点名称, 热点密码) - 不设密码则开放热点
    connected = wm.autoConnect(AP_NAME);
  }  // 配网结束后释放 WiFiManager 占用的内存，再初始化摄像头

  if (!connected) {
    Serial.println("配网超时或失败，重启...");
    delay(1000);
    ESP.restart();
  }

  // WiFi 连接成功
  Serial.println("========================================");
  Serial.println("WiFi 连接成功！");
  Serial.println("SSID：" + WiFi.SSID());
  Serial.println("IP 地址：" + WiFi.localIP().toString());
  Serial.println("信号强度：" + String(WiFi.RSSI()) + " dBm");
  Serial.println("========================================");

  // LED 亮一下表示连接成功
  blinkLED(2, 200);

  // ---- 初始化摄像头 ----
  if (!initCamera()) {
    Serial.println("摄像头初始化失败！请检查硬件连接");
    blinkLED(20, 100);   // 疯狂闪烁表示错误
    ESP.restart();
  }

  // ---- 启动 Web 服务器 ----
  server.on("/", handleRoot);
  server.on("/capture", HTTP_GET, handleCapture);
  server.on("/stream", HTTP_GET, handleStreamRedirect);
  server.on("/status", HTTP_GET, handleStatus);
  streamReady = startStreamServer();
  if (!streamReady) Serial.println("视频流服务启动失败（81 端口）");
  server.begin();

  Serial.println("========================================");
  Serial.println("Web 服务器已启动！");
  Serial.println("首页：http://" + WiFi.localIP().toString());
  Serial.println("/capture — 拍照");
  Serial.println("/stream  — 视频流");
  Serial.println("/status  — 设备状态");
  Serial.println("========================================");
  Serial.println("切换 WiFi：关闭旧热点并短按 RST，连接失败后进入配网模式");
  Serial.println("========================================");
}

// ==================== loop ====================
void loop() {
  server.handleClient();

  delay(1);
}
