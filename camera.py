"""ESP32-CAM 取图、连通性探测与 JPEG 边界校验。"""
import asyncio
import httpx
from config import ServiceError

async def capture(url: str) -> bytes:
    """在十五秒内获取 JPEG，并限制图片大小为十 MB。"""
    async def perform() -> bytes:
        """执行网络操作，由调用方施加总时限。"""
        async with httpx.AsyncClient(timeout=15, trust_env=False) as client:
            async with client.stream("GET", url + "/capture") as response:
                if response.status_code != 200:
                    raise ServiceError(f"摄像头取图返回 HTTP {response.status_code}，请检查 CameraWebServer。")
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > 10 * 1024 * 1024:
                        raise ServiceError("摄像头图片超过 10 MB 限制。")
        return bytes(data)
    try:
        data = await asyncio.wait_for(perform(), timeout=15)
    except (asyncio.TimeoutError, httpx.TimeoutException):
        raise ServiceError("摄像头取图超时（15 秒），请检查供电和 Wi-Fi。", 504) from None
    except httpx.HTTPError:
        raise ServiceError("无法连接摄像头，请检查相机 IP、供电和同一 Wi-Fi 连接。") from None
    if len(data) < 4 or not data.startswith(b"\xff\xd8") or not data.endswith(b"\xff\xd9"):
        raise ServiceError("/capture 返回的不是有效 JPEG：缺少 FFD8 文件头或 FFD9 文件尾。")
    return bytes(data)

async def probe(url: str) -> tuple[bool, str]:
    """最多三秒探测相机首页，不触发拍照。"""
    async def perform() -> tuple[bool, str]:
        """执行网络操作，由调用方施加总时限。"""
        async with httpx.AsyncClient(timeout=3, trust_env=False) as client:
            async with client.stream("GET", url + "/") as response:
                if response.status_code == 200:
                    return True, "摄像头在线"
                return False, f"摄像头返回 HTTP {response.status_code}"
    try:
        return await asyncio.wait_for(perform(), timeout=3)
    except (asyncio.TimeoutError, httpx.TimeoutException):
        return False, "摄像头探测超时（3 秒）"
    except httpx.HTTPError:
        return False, "无法连接摄像头，请检查 IP、供电及 Wi-Fi"
