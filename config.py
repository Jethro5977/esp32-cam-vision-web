"""读取本机配置，不向客户端暴露密钥。"""
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent

class ServiceError(Exception):
    """可安全展示给用户的业务异常。"""
    def __init__(self, message: str, status: int = 502) -> None:
        """保存经过控制的中文消息及 HTTP 状态。"""
        super().__init__(message)
        self.message = message
        self.status = status

def camera_url() -> str:
    """环境变量优先，其次读取根目录配置文件。"""
    value = os.environ.get("CAMERA_URL", "").strip()
    if not value:
        try:
            value = str(json.loads((ROOT / "config.json").read_text()).get("camera_url", "")).strip()
        except FileNotFoundError:
            pass
        except (ValueError, OSError, AttributeError):
            raise ServiceError("config.json 无法读取或格式错误，请检查 camera_url。", 503) from None
    try:
        parsed = urlsplit(value)
        valid = parsed.scheme in ("http", "https") and parsed.hostname and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment and parsed.path in ("", "/")
        _ = parsed.port
    except ValueError:
        valid = False
    if not valid:
        raise ServiceError("请配置 CAMERA_URL 或 config.json 的 camera_url，填写相机首页地址（含 http://）。", 503)
    return value.rstrip("/")

def api_key() -> str:
    """读取密钥；不在异常中附带原始内容。"""
    key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not key:
        try:
            key = (ROOT / ".secrets" / "deepseek_api_key").read_text().strip()
        except FileNotFoundError:
            pass
        except OSError:
            raise ServiceError("无法读取密钥文件，请检查文件权限。", 503) from None
    if not key:
        raise ServiceError("API Key 未配置，请在电脑运行 python setup_key.py。", 503)
    return key
