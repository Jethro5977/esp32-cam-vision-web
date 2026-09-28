"""文件存储与真实性能统计；不依赖数据库。"""
import json
import math
import threading
import time
from datetime import datetime
from pathlib import Path
from statistics import mean, median
from typing import Any
from config import ROOT

LOCK = threading.Lock()
CAPTURES = ROOT / "captures"
HISTORY = ROOT / "history.jsonl"

def save_image(data: bytes) -> str:
    """独占创建图片；同秒冲突等待下一秒，保持要求的文件名格式。"""
    CAPTURES.mkdir(exist_ok=True)
    with LOCK:
        while True:
            name = datetime.now().strftime("capture-%Y%m%d-%H%M%S.jpg")
            try:
                with (CAPTURES / name).open("xb") as stream:
                    stream.write(data)
                return "/captures/" + name
            except FileExistsError:
                time.sleep(0.05)

def append_record(record: dict[str, Any]) -> None:
    """以一行 JSON 原子追加一条记录（单进程内加锁）。"""
    with LOCK:
        with HISTORY.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")
            stream.flush()

def read_records() -> tuple[list[dict[str, Any]], int]:
    """读取记录；返回损坏行数量，避免不完整行阻断全部历史。"""
    records: list[dict[str, Any]] = []
    invalid = 0
    with LOCK:
        if not HISTORY.exists():
            return records, invalid
        with HISTORY.open(encoding="utf-8") as stream:
            for line in stream:
                try:
                    record = json.loads(line)
                    if not isinstance(record, dict) or "created_at" not in record or "status" not in record:
                        raise ValueError
                    records.append(record)
                except (ValueError, TypeError):
                    invalid += 1
    return records, invalid

def summarize(values: list[float]) -> dict[str, float | None]:
    """计算均值、中位数及最近秩法 P95；空样本返回 null。"""
    if not values:
        return {"mean": None, "median": None, "p95": None}
    return {"mean": round(mean(values), 2), "median": round(median(values), 2), "p95": round(sorted(values)[math.ceil(len(values) * .95) - 1], 2)}

def statistics() -> dict[str, Any]:
    """只汇总成功识别；缺失用量不伪装为零。"""
    records, invalid = read_records()
    successful = [r for r in records if r.get("status") == "success"]
    def numbers(group: str, field: str) -> list[float]:
        """抽取实际存在的数值字段。"""
        return [float(r.get(group, {}).get(field)) for r in successful if isinstance(r.get(group, {}).get(field), (int, float))]
    sizes = [float(r["image_bytes"]) for r in successful]
    return {"sample_count": len(successful), "attempt_count": len(records), "failure_count": len(records) - len(successful), "invalid_lines": invalid,
        "timings_ms": {name: summarize(numbers("timings", name)) for name in ("capture_ms", "api_ms", "total_ms")},
        "average_image_bytes": round(mean(sizes), 2) if sizes else None,
        "average_usage": {name: summarize(numbers("usage", name))["mean"] for name in ("prompt_tokens", "completion_tokens", "total_tokens")},
        "usage_sample_count": {name: len(numbers("usage", name)) for name in ("prompt_tokens", "completion_tokens", "total_tokens")},
        "percentile_method": "nearest-rank", "scope": "全部本地历史中的成功记录"}
