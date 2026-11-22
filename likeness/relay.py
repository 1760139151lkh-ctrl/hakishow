"""中继：为工作站准备带编号的任务包，分阶段运行并记录每项结果。

任务包是 relay/ 下的一个文件夹，内含 task.toml；运行后还包含
out/（日志、数值、表格）和 REPORT.md（代理的执行说明）。各阶段按顺序运行；某个检查关卡
失败便停止运行，避免后续阶段白白浪费一个小时。
"""

from __future__ import annotations

import datetime
import json
import re
import shutil
import subprocess
import time
import tomllib
from pathlib import Path

from . import paths

REPORT = """# 报告：{title}

任务包 {id}。运行 uv run likeness relay run {id} 后填写此报告，并将它与本地运行输出一同保存。

## 概述

（用两三句话说明：运行了什么、数值结果说明什么、下一步受什么阻碍。）

## 已做修改

（列出在工作站上编辑的每个文件及原因。若没有则填写“无”。）

## 需要团队决定的问题

（列出需要决定的事项。若没有则填写“无”。）

## 运行记录

阶段表与日志末尾内容见 out/RUN.md；该文件会在每次运行时重写。
"""


def find(packet: str, root: Path | None = None) -> Path:
    matches = sorted(p for p in (root or paths.RELAY).glob(f"{packet}*") if (p / "task.toml").exists())
    if len(matches) != 1:
        raise SystemExit(f"预期只有一个匹配以下标识的任务包：'{packet}'，位于 relay/ 中；实际找到{len(matches)}.")
    return matches[0]


def pending(root: Path | None = None) -> list[Path]:
    """尚未完整运行的任务包，最早的在前。标记为 optional = true 的任务包等待明确请求后再运行。"""
    folder = root or paths.RELAY
    if not folder.is_dir():
        return []
    packets = sorted(p for p in folder.iterdir() if (p / "task.toml").exists())
    return [p for p in packets if not _status(p).get("finished") and not tomllib.loads((p / "task.toml").read_text(encoding="utf-8")).get("optional")]


def _status(folder: Path) -> dict:
    path = folder / "out" / "status.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _scrub(text: str, cwd: Path) -> str:
    """本地日志中，版本库自身路径写作“.”，用户主目录写作“~”，两种斜杠形式均支持。"""
    for found, shown in ((str(cwd), "."), (cwd.as_posix(), "."), (str(Path.home()), "~"), (Path.home().as_posix(), "~")):
        if len(found) > 3:
            text = text.replace(found, shown)
    text = text.replace("\r\n", "\n")
    return re.sub(r"[^\n]*\r(?!\n)", "", text)   # 进度条会重绘同一行数千次；仅保留每行的最终状态


def run(packet: str, only: list[str] | None = None, root: Path | None = None, cwd: Path | None = None) -> dict:
    """按顺序运行任务包的各阶段。每个阶段是参数列表（不使用 shell）；参数中的“{root}”代表
    版本库，可选的 cwd 让该阶段在版本库的某个子文件夹中运行。"""
    folder = find(packet, root)
    task, out, cwd = tomllib.loads((folder / "task.toml").read_text(encoding="utf-8")), folder / "out", cwd or paths.ROOT
    out.mkdir(exist_ok=True)
    rows, stopped = [], ""
    for stage in task["stage"]:
        if only and stage["id"] not in only:
            continue
        row = {"id": stage["id"], "command": " ".join(stage["run"]), "gate": stage.get("gate", True)}
        if stopped:
            rows.append({**row, "state": "not run", "seconds": 0, "why": f"停止于{stopped}"})  # 状态协议原值 not run：未运行
            continue
        started, log = time.perf_counter(), out / f"{stage['id']}.log"
        command, where = [part.replace("{root}", cwd.as_posix()) for part in stage["run"]], cwd / stage["cwd"] if stage.get("cwd") else cwd
        command[0] = shutil.which(command[0]) or command[0]   # 在 Windows 上，npm、uv 与 codex 是 .cmd 或 .exe 文件
        print(f"[relay] {stage['id']}: {row['command']}", flush=True)
        try:
            with log.open("w", encoding="utf-8", errors="replace") as sink:
                code = subprocess.run(command, cwd=where, stdout=sink, stderr=subprocess.STDOUT, timeout=stage.get("timeout", 3600)).returncode
            why = "" if code == 0 else f"退出代码{code}"
        except subprocess.TimeoutExpired:
            code, why = -1, f"超时，已等待{stage.get('timeout', 3600)} 秒"
        except OSError as error:
            code, why = -1, str(error)
        if log.exists():
            log.write_text(_scrub(log.read_bytes().decode("utf-8", errors="replace"), cwd), encoding="utf-8", newline="\n")
        missing = [e for e in stage.get("expect", []) if not (cwd / e).exists()]
        if code == 0 and missing:
            code, why = 1, "缺少：" + ", ".join(missing)
        row.update(state="passed" if code == 0 else "failed", seconds=round(time.perf_counter() - started, 1), why=why)
        rows.append(row)
        print(f"[relay] {stage['id']}: {row['state']}，耗时 {row['seconds']} 秒 {why}", flush=True)
        if code != 0 and row["gate"]:
            stopped = stage["id"]
    status = {"id": task["id"], "when": datetime.datetime.now().astimezone().isoformat(timespec="seconds"), "finished": not stopped and not only, "stopped_at": stopped, "stages": rows}
    (out / "status.json").write_text(json.dumps(status, indent=2), encoding="utf-8")
    lines = [f"# 运行：{task['id']}", "", f"{status['when']}. " + ("所有检查关卡均已通过。" if not stopped else f"停止于 **{stopped}**."), "", "| 阶段 | 状态 | 秒数 | 说明 |", "|---|---|---|---|"]
    lines += [f"| {r['id']} | {r['state']} | {r['seconds']} | {r['why']} |" for r in rows]
    for r in rows:
        log = out / f"{r['id']}.log"
        if log.exists():
            tail = log.read_text(encoding="utf-8", errors="replace").splitlines()[-25:]
            lines += ["", f"## {r['id']}", "", "~~~", *tail, "~~~"]
    (out / "RUN.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    if not (folder / "REPORT.md").exists():
        (folder / "REPORT.md").write_text(REPORT.format(id=task["id"], title=task.get("title", task["id"])), encoding="utf-8")
    return status
