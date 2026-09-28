"""通过隐藏输入保存本机 DeepSeek API Key。"""
import getpass
import os
from config import ROOT

def main() -> None:
    """仅在终端读取密钥，以受限权限存储。"""
    key = getpass.getpass("请输入 DeepSeek API Key（输入时不会显示）：").strip()
    if not key:
        print("未输入密钥，原文件未修改。")
        return
    directory = ROOT / ".secrets"
    directory.mkdir(mode=0o700, exist_ok=True)
    directory.chmod(0o700)
    target = directory / "deepseek_api_key"
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(key + "\n")
    print("密钥已保存在本机。请勿将 .secrets 上传 GitHub。")

if __name__ == "__main__":
    main()
