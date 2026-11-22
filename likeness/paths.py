"""各类内容的存放位置。所有个人内容均保存在同一个由 Git 忽略的文件夹下。"""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
RELAY = ROOT / "relay"
CONFIG = ROOT / "studio.toml"


def home() -> Path:
    """私有文件夹：存放你的图像、工作室生成结果、任务文件夹及配对密钥。绝不提交到版本库。"""
    path = Path(os.environ.get("LIKENESS_HOME") or ROOT / "private")
    path.mkdir(parents=True, exist_ok=True)
    return path
