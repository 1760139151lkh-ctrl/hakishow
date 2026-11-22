"""工作室配置：先读取版本库中的 studio.toml（已提交的默认值），再叠加 private/studio.toml
（本机专用配置，绝不提交）。"""

from __future__ import annotations

import tomllib
from pathlib import Path

from . import paths


def _merge(base: dict, over: dict) -> dict:
    out = dict(base)
    for k, v in over.items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def load(home: Path | None = None) -> dict:
    config: dict = {}
    for path in (paths.CONFIG, (home or paths.home()) / "studio.toml"):
        if path.exists():
            config = _merge(config, tomllib.loads(path.read_text(encoding="utf-8")))
    config.setdefault("studio", {}).setdefault("engine", "auto")
    config["studio"].setdefault("workers", 2)
    config.setdefault("codex", {})
    return config


def load_env_local(root: Path | None = None) -> None:
    """将 .env.local（由 Git 忽略）中的 KEY=value 行加载到环境中，不覆盖已有设置。
    本地 OPENAI_API_KEY 保存在这里；绝不记入日志，也不写入其他位置。"""
    import os

    path = (root or paths.ROOT) / ".env.local"
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
