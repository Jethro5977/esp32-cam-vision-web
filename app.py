"""ESP32-CAM 局域网视觉网关。"""
import asyncio
import base64
from datetime import datetime, timezone
from time import perf_counter
from typing import Any
from fastapi import FastAPI, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import camera
import storage
import vision
from config import ROOT, ServiceError, api_key, camera_url

app = FastAPI(title="ESP32-CAM Vision Web")
analysis_lock = asyncio.Lock()
storage.CAPTURES.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
app.mount("/captures", StaticFiles(directory=storage.CAPTURES), name="captures")

class AnalyzeRequest(BaseModel):
    """限制提示词大小。"""
    prompt: str = Field(min_length=1, max_length=2000)

@app.get("/")
async def index() -> FileResponse:
    """返回移动端页面。"""
    return FileResponse(ROOT / "static" / "index.html")

@app.get("/api/health")
async def health() -> dict[str, Any]:
    """返回服务状态及三秒相机探测结果。"""
    url = ""
    try:
        url = camera_url()
        online, message = await camera.probe(url)
    except ServiceError as exc:
        online, message = False, exc.message
    try:
        api_key()
        configured = True
    except ServiceError:
        configured = False
    return {"service": "ok", "camera_url": url, "camera_online": online, "message": message, "api_key_configured": configured}

@app.post("/api/analyze")
async def analyze(request: AnalyzeRequest) -> JSONResponse:
    """取图、存盘、调用云模型，将成功或失败写入历史。"""
    prompt = request.prompt.strip()
    if not prompt:
        return JSONResponse({"error": "请输入提示词。"}, status_code=400)
    if analysis_lock.locked():
        return JSONResponse({"error": "有设备正在识别，请等待当前请求结束后重试。"}, status_code=409)
    async with analysis_lock:
        start = perf_counter()
        record: dict[str, Any] = {"created_at": datetime.now(timezone.utc).isoformat(), "status": "error", "image_url": None, "text": "", "timings": {"capture_ms": None, "api_ms": None, "total_ms": None}, "image_bytes": None, "base64_length": None, "usage": {"prompt_tokens": None, "completion_tokens": None, "total_tokens": None}}
        status = 200
        try:
            key = api_key()
            url = camera_url()
            tick = perf_counter()
            try:
                jpeg = await camera.capture(url)
            finally:
                record["timings"]["capture_ms"] = round((perf_counter() - tick) * 1000, 2)
            record["image_bytes"] = len(jpeg)
            record["image_url"] = await asyncio.to_thread(storage.save_image, jpeg)
            encoded = base64.b64encode(jpeg).decode("ascii")
            record["base64_length"] = len(encoded)
            tick = perf_counter()
            try:
                record["text"], record["usage"] = await vision.analyze_image("data:image/jpeg;base64," + encoded, prompt, key)
            finally:
                record["timings"]["api_ms"] = round((perf_counter() - tick) * 1000, 2)
            record["status"] = "success"
        except ServiceError as exc:
            record["error"], status = exc.message, exc.status
        except OSError:
            record["error"], status = "本地图片或历史文件无法写入，请检查磁盘空间与权限。", 500
        except Exception:
            # 不记录异常原文，避免 HTTP 请求信息或密钥泄漏。
            record["error"], status = "处理请求时发生内部错误，请检查本地配置并重启服务。", 500
        record["timings"]["total_ms"] = round((perf_counter() - start) * 1000, 2)
        try:
            await asyncio.to_thread(storage.append_record, record)
        except OSError:
            return JSONResponse({"error": "本次处理已结束，但历史记录保存失败，请检查磁盘空间与权限。", "result": record}, status_code=500)
        return JSONResponse(record, status_code=status)

@app.get("/api/history")
async def history(limit: int = Query(default=20, ge=1, le=20)) -> dict[str, Any]:
    """按新到旧返回最近二十条以内的会话记录。"""
    records, invalid = await asyncio.to_thread(storage.read_records)
    return {"records": list(reversed(records[-limit:])), "invalid_lines": invalid}

@app.get("/api/stats")
async def stats() -> dict[str, Any]:
    """返回全部历史的实测统计。"""
    return await asyncio.to_thread(storage.statistics)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
