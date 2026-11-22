"""likeness：通过一个命令管理工作室。

  serve          启动工作室（应用、接口与引擎），并输出手机访问方法
  probe codex    检查是否安装并登录 Codex 命令行工具，以及它是否支持工作室使用的参数；--smoke 会生成图像
  relay          运行一个中继任务包
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
from pathlib import Path

from . import __version__, paths


def _lan_address() -> str:
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("10.255.255.255", 1))
        return probe.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        probe.close()


def _write(report: dict, out: str | None) -> None:
    text = json.dumps(report, indent=2)
    if out:
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        Path(out).write_text(text, encoding="utf-8")
    print(text)


def serve(args) -> int:
    import uvicorn

    from . import engines, settings
    from .server import create_app, pairing_key

    home = paths.home()
    config = settings.load(home)
    engine = engines.create(args.engine or config["studio"].get("engine", "auto"), config, home)
    app = create_app(engine, home=home, open_door=args.open, config=config)
    scheme = "https" if args.cert and args.key else "http"
    local = f"{scheme}://127.0.0.1:{args.port}/"
    honest = "  （每张图像都是替代示例，且有明确标记）" if engine.kind == "simulator" else ""
    print(f"\n  HakiShow {__version__}  ·  {engine.describe()['label']}{honest}\n\n  本机访问地址     {local}\n")
    if os.environ.get("LIKENESS_OWNER_LINK") == "1":
        print("  所有者链接模式：仅允许曾打开你的私有链接的浏览器访问（likeness link 可输出该链接）。\n")
    elif args.host not in {"localhost", "127.0.0.1", "::1"}:
        phone = f"{scheme}://{_lan_address()}:{args.port}/?pair={pairing_key(home)}"
        print(f"  手机访问地址     {phone}\n")
        try:
            import segno

            segno.make(phone, error="m").terminal(compact=True, border=2)
        except Exception:
            pass
        print("  手机必须连接同一网络。扫描二维码一次后即可保持配对。")
    print("  按 Ctrl+C 停止工作室。\n", flush=True)
    tls = {"ssl_certfile": args.cert, "ssl_keyfile": args.key} if scheme == "https" else {}
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning", access_log=False, **tls)
    return 0


def link(args) -> int:
    """将工作室作为网站使用的所有者链接模式：仅允许曾打开此私有链接的浏览器访问。
    首次使用时生成密钥（存放于由 Git 忽略的私有文件夹下），并输出链接。"""
    import secrets

    from .server import owner_link_token, owner_secret_path

    path = owner_secret_path() or paths.home() / "owner.secret"
    made = args.new or not path.is_file()
    if made:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(secrets.token_urlsafe(48), encoding="utf-8")
        try:
            path.chmod(0o600)
        except OSError:
            pass
    token = owner_link_token(path.read_bytes().strip())
    base = (args.base or "https://<your-site>").rstrip("/")
    try:
        shown = path.relative_to(paths.ROOT).as_posix()
    except ValueError:
        shown = str(path)
    print(("\n  新密钥：" if made else "\n  密钥：") + shown + "  （请保密；绝不要提交到版本库）")
    if os.environ.get("LIKENESS_OWNER_LINK") != "1" or owner_secret_path() is None:
        print("\n  启用所有者链接模式：将下面两行写入 .env.local，然后重启 likeness serve\n"
              f"    LIKENESS_OWNER_LINK=1\n    LIKENESS_OWNER_SECRET_FILE={shown}")
    print(f"\n  你的私有链接（每部手机或电脑需打开一次；任何持有者都能使用你的密钥）：\n\n    {base}/open/{token}\n")
    return 0


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):   # Windows 控制台默认代码页无法输出 ·、× 或二维码方块
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    parser = argparse.ArgumentParser(prog="likeness", description="HakiShow：可以与你对话的个人图像工作室。")
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("serve", help="启动工作室")
    p.add_argument("--engine", default="", help="auto、simulator、codex 或 openai（默认先读取 studio.toml，再使用 auto）")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8787)
    p.add_argument("--open", action="store_true", help="允许网络上的任意设备无需配对即可访问")
    p.add_argument("--cert", default="", help="用于通过 HTTPS 提供服务的 TLS 证书（PEM）：手机仅允许安全来源使用相机")
    p.add_argument("--key", default="", help="证书的私钥（PEM）")

    p = sub.add_parser("probe", help="检查本机上的引擎")
    p.add_argument("engine", choices=["codex", "openai"])
    p.add_argument("--smoke", action="store_true", help="使用 codex 探测时，同时生成真实图像并记录耗时")
    p.add_argument("--out", help="同时将报告写到这里（图像保存在旁边）")

    p = sub.add_parser("link", help="将工作室作为网站访问的私有链接（所有者链接模式）")
    p.add_argument("--base", default="", help="网站地址，例如 https://studio.example.com")
    p.add_argument("--new", action="store_true", help="生成新密钥：每台设备都必须重新打开新链接")

    p = sub.add_parser("relay", help="运行一个中继任务包")
    p.add_argument("action", choices=["run", "pending"])
    p.add_argument("packet", nargs="?", default="")
    p.add_argument("--only", action="append")

    args = parser.parse_args(argv)
    from .settings import load_env_local

    load_env_local()
    if args.command == "serve":
        return serve(args)
    if args.command == "probe":
        from . import settings

        if args.engine == "openai":
            from .engines import openai_images

            report = openai_images.probe(settings.load().get("openai", {}))
            _write(report, args.out)
            return 0 if report["ok"] else 1
        from .engines import codex

        report = codex.probe(settings.load().get("codex", {}), smoke=args.smoke, out=Path(args.out).parent if args.out else None)
        _write(report, args.out)
        return 0 if report["ok"] else 1
    if args.command == "link":
        return link(args)
    from . import relay

    if args.action == "pending":
        print("\n".join(p.name for p in relay.pending()) or "没有待处理的任务包。")
        return 0
    waiting = relay.pending()
    if not args.packet and not waiting:
        print("没有待处理的任务包。")
        return 0
    status = relay.run(args.packet or waiting[0].name, args.only)
    return 0 if not status["stopped_at"] else 1
