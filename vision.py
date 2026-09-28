"""通过电脑调用 DeepSeek，ESP32 不执行模型推理。"""
import asyncio
from typing import Any
import httpx
from config import ServiceError

async def analyze_image(data_url: str, prompt: str, key: str) -> tuple[str, dict[str, int | None]]:
    """发送图片与提示词，并只返回文本和用量，不透传上游错误体。"""
    body = {"model": "deepseek-flash", "messages": [{"role": "user", "content": [
        {"type": "text", "text": prompt}, {"type": "image_url", "image_url": {"url": data_url}}
    ]}]}
    async def perform() -> httpx.Response:
        """执行网络操作，由调用方施加总时限。"""
        async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
            response = await client.post("https://api.deepseek.com/chat/completions", headers={"Authorization": f"Bearer {key}"}, json=body)
        return response
    try:
        response = await asyncio.wait_for(perform(), timeout=60)
    except (asyncio.TimeoutError, httpx.TimeoutException):
        raise ServiceError("DeepSeek API 调用超时（60 秒），可稍后重试；上游可能已计费。", 504) from None
    except httpx.HTTPError:
        raise ServiceError("无法连接 DeepSeek API，请检查电脑网络。") from None
    messages = {401: "DeepSeek 密钥无效（401），请重新配置 API Key。", 402: "DeepSeek 余额不足（402），请检查账户余额。", 429: "DeepSeek 请求限流（429），请稍后重试。"}
    if response.status_code in messages:
        raise ServiceError(messages[response.status_code])
    if response.status_code >= 500:
        raise ServiceError("DeepSeek 服务端错误（5xx），请稍后重试。")
    if response.status_code != 200:
        raise ServiceError(f"DeepSeek 拒绝请求（HTTP {response.status_code}），请检查模型及接口支持情况。")
    try:
        payload: dict[str, Any] = response.json()
        text = payload["choices"][0]["message"]["content"]
        if not isinstance(text, str) or not text.strip():
            raise ValueError
        raw_usage = payload.get("usage") or {}
        usage = {name: raw_usage.get(name) if type(raw_usage.get(name)) is int else None for name in ("prompt_tokens", "completion_tokens", "total_tokens")}
    except (ValueError, KeyError, IndexError, TypeError, AttributeError):
        raise ServiceError("DeepSeek 返回格式异常：未找到有效文本或用量结构。") from None
    # 即便上游意外回显密钥，也不允许它进入历史或网页。
    return text.replace(key, "[密钥已隐藏]"), usage
