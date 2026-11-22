"""Codex 命令行工具的替代实现：实现足够的 codex exec --json 行为，以便在任何机器上测试工作室引擎。

FAKE_CODEX 决定其行为：ok（默认）、fail（返回 FAILED）、signin（未登录）、crash（崩溃）、
slow（规划后挂起）、legacy（旧版 {"msg": ...} 事件行）。"""

import json
import os
import re
import sys
import time
from pathlib import Path


def emit(event: dict) -> None:
    print(json.dumps(event), flush=True)


ROOM = {"name": "街机厅", "line": "硬币与霓虹。", "dark": True,
        "colors": {"ground": "#0a0a12", "ground2": "#1a1030", "surface": "#101018", "ink": "#121220", "soft": "#8080a0", "accent": "#ff3fa4", "accent2": "#3ff0ff"},
        "type": "nonsense", "frame": "glow", "ornament": "bolt", "motifs": ["bolt", "star"], "set": "grid", "texture": "scanlines", "weather": "sparkles",
        "light": "night", "wipe": "scan", "sound": "synth", "motion": "crisp", "radius": "round",
        "voice": {"hello": {"morning": "请投币。", "afternoon": "第二位玩家？", "evening": "冲击高分的时刻。", "night": "再来一次。"},
                  "placeholder": "按下开始", "send": "开始", "stages": {"read": "正在加载", "plan": "正在选择关卡", "draw": "正在绘制精灵图", "finish": "正在保存"}, "done": ["关卡完成。"]}}


def main(argv: list[str]) -> int:
    if argv == ["--version"]:
        print("codex-cli 0.0.0 (fake)")  # 模拟版本协议：Codex 命令行工具0.0.0版
        return 0
    if argv[:2] == ["login", "status"]:
        print("已登录（模拟）")
        return 0
    if argv[:2] == ["exec", "--help"]:
        print("选项：--json --skip-git-repo-check --cd -C --sandbox --model --config --image --output-schema --output-last-message")
        return 0
    if argv[:1] != ["exec"] or argv[-2:] != ["--", "-"]:
        print(f"模拟 Codex：意外的参数{argv}", file=sys.stderr)
        return 64
    opt = lambda name: argv[argv.index(name) + 1] if name in argv else None
    workdir = Path(opt("-C"))
    (workdir / "fake-argv.json").write_text(json.dumps(argv), encoding="utf-8")
    brief = sys.stdin.read()
    mode = os.environ.get("FAKE_CODEX", "ok")
    if mode == "crash":
        print("thread 'main' panicked", file=sys.stderr)  # 故障模拟原文：主线程发生异常崩溃
        return 101
    if mode == "signin":
        print("Error: not logged in. Run codex login", file=sys.stderr)  # 故障模拟原文：尚未登录，请运行 codex login
        return 1
    legacy = mode == "legacy"

    def say(text: str) -> None:
        emit({"id": "1", "msg": {"type": "agent_message", "message": text}} if legacy else {"type": "item.completed", "item": {"id": "m", "type": "agent_message", "text": text}})

    def think(text: str) -> None:
        emit({"id": "0", "msg": {"type": "agent_reasoning", "text": text}} if legacy else {"type": "item.completed", "item": {"id": "r", "type": "reasoning", "text": text}})

    if not legacy:
        emit({"type": "thread.started", "thread_id": "fake-thread"})
        emit({"type": "turn.started"})
    think("**正在阅读请求**\n\n用户提出了具体要求。")
    if opt("--output-schema"):
        props = json.loads(Path(opt("--output-schema")).read_text(encoding="utf-8"))["properties"]
        if "backdrops" in props:
            answer = {"backdrops": [{"name": f"Place {i}", "words": f"somewhere, number {i}"} for i in range(6)]}
        elif "ramp" in props:
            answer = {"name": "玫瑰金", "line": "温暖的金属质感。", "prompt": "玫瑰金调色", "ramp": ["#ffffff", "#000000", "#c08080"], "keep": 2, "grain": .1, "bloom": .2, "vignette": .3}
        else:
            answer = ROOM
        if opt("-o"):
            Path(opt("-o")).write_text(json.dumps(answer), encoding="utf-8")
        say(json.dumps(answer))
        emit({"type": "turn.completed", "usage": {"input_tokens": 10, "output_tokens": 10}})
        return 0
    if mode == "fail":
        say('FAILED {"message": "那需要真实人物的面孔。", "hint": "试试绘画人物。"}')
        emit({"type": "turn.completed", "usage": {}})
        return 0
    n = int(re.search(r"制作 (\d+) 张图像", brief).group(1))
    say('PLAN {"summary": "正在绘制三个梨", "prompt": "三个梨，蓝色桌布"}')
    emit({"type": "item.started", "item": {"id": "c", "type": "command_execution", "command": "制作图像", "status": "in_progress"}})
    if mode == "slow":
        time.sleep(60)
    from PIL import Image

    for i in range(n):
        Image.new("RGB", (64, 96), (40 * i, 120, 200)).save(workdir / "out" / f"{i + 1}.png")
        time.sleep(.05)
    emit({"type": "item.completed", "item": {"id": "c", "type": "command_execution", "command": "制作图像", "exit_code": 0, "status": "completed"}})
    say('DONE {"reply": "按要求绘制了三个梨。", "suggestions": ["更温暖的光线", "改成夜景", "三个变体"]}')
    emit({"type": "turn.completed", "usage": {"input_tokens": 10, "output_tokens": 10}})
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
