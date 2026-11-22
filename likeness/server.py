"""HakiShow 的入口：应用文件、所有引擎共同遵循的单轮请求接口、每个任务的事件流，以及
每位访问者的账户（各自拥有私有空间）。

  GET  /studio.json                 当前工作室及请求者信息（其账户）
  POST /api/assets                  一次上传一张图像或蒙版（multipart: file、kind），保存到该账户空间
  GET  /api/assets/{id}             返回图像，仅供其所属账户访问
  POST /api/turns                   提交一轮请求：返回 {job, eta}
  GET  /api/jobs/{id}/events        实时事件（服务器推送事件）；也可用 GET /api/jobs/{id} 轮询
  POST /api/jobs/{id}/cancel        停止任务
  GET  /api/history                 工作室为该账户制作的全部图像，最新在前（不会丢失）
  GET  /api/me                      账户及其内容数量
  POST /api/auth/signup | login | logout | profile     访客直接转为会员；登录会带入访客作品
  GET  /api/sync?cursor=N, POST /api/sync              应用记录（作品、源图、收藏、草稿、偏好）
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, engines, paths, settings
from .accounts import AccountError, Accounts
from .engines import EngineError, Work
from .estimates import Estimates
from .jobs import Job, Jobs, QueueFull, SubmissionConflict
from .store import MAX_UPLOAD, Store
from .turns import Inputs, StyleAsk, Turn
from .rooms import normalise_style

LOOPBACK = {"127.0.0.1", "::1", "localhost"}
NOT_PAIRED = """<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HakiShow</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#121110;color:#ede6da;font:17px/1.5 Georgia,serif">
<p style="max-width:20em;padding:2em">此工作室仅向已配对的设备开放。<br><br>请扫描 <code>likeness serve</code> 输出的二维码，为此设备配对。</p>"""
OWNER_OPEN = """<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HakiShow 工作室</title>
<p id="status" role="status">正在打开 HakiShow 工作室……</p>
<script>
const statusLine = document.getElementById("status");
const key = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
if (/^[0-9a-f]{64}$/.test(key)) {
  fetch(location.pathname, { method: "POST", headers: { "Content-Type": "text/plain" }, body: key })
    .then(response => { if (!response.ok) throw Error(); location.replace("/"); })
    .catch(() => { statusLine.textContent = "无法打开工作室。请重新打开你的访问链接。"; });
} else {
  fetch("/api/health", { cache: "no-store" }).then(response => {
    if (response.ok) location.replace("/");
    else statusLine.textContent = "请打开你的 HakiShow 私有链接，为此浏览器配对。";
  }).catch(() => { statusLine.textContent = "无法连接工作室。请重试。"; });
}
</script>"""
OWNER_HEADERS = {"Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
                 "X-Frame-Options": "DENY", "Permissions-Policy": "geolocation=()",
                 "X-Content-Type-Options": "nosniff"}
OWNER_COOKIE = "__Host-likeness"
SESSION_COOKIE = "hakishow_session"
STATIC_GROUPS = ("css/", "js/", "fonts/", "vendor/", "img/", "bundle/")
ROOT_FILES = {"icon.svg", "manifest.webmanifest", "sw.js", "icon-192.png", "icon-512.png", "apple-touch-icon.png"}
PUBLIC_ASSET_TYPES = {".js", ".mjs", ".css", ".woff2", ".webp", ".png", ".task", ".tflite", ".wasm", ".json"}


class SignUp(BaseModel):
    handle: str = Field(max_length=40)
    password: str = Field(max_length=128)
    nickname: str = Field("", max_length=40)


class LogIn(BaseModel):
    handle: str = Field(max_length=40)
    password: str = Field(max_length=128)


class Profile(BaseModel):
    nickname: str = Field(max_length=40)


class SyncIn(BaseModel):
    records: list[dict] = Field(default_factory=list, max_length=200)


class StudioFiles(StaticFiles):
    """浏览器复用未变化的公共资源时，确保应用外壳保持最新。"""

    def __init__(self, builds: dict[str, str], bundle: Path | None) -> None:
        super().__init__(directory=paths.WEB)
        self.builds = builds
        self.bundle = bundle

    def lookup_path(self, path):
        if path == os.path.join("bundle", "studio.js") and self.bundle and self.bundle.is_file():
            return str(self.bundle), self.bundle.stat()
        return super().lookup_path(path)

    def get_path(self, scope):
        path = super().get_path(scope)
        head, sep, tail = path.partition(os.sep)
        if sep and len(head) == 17 and head.startswith("v") and all(c in "0123456789abcdef" for c in head[1:]):
            return tail
        return path

    async def get_response(self, path, scope):
        if not path.replace(os.sep, "/").startswith(STATIC_GROUPS) and path not in ROOT_FILES:
            raise HTTPException(404)
        response = await super().get_response(path, scope)
        # Windows 不一定会为 WebP 注册媒体类型。
        if path.endswith(".webp") and response.status_code in (200, 206):
            response.headers["Content-Type"] = "image/webp"
        if path == "sw.js":   # 每次都重新检查服务工作线程，并允许它管理整个站点
            response.headers["Cache-Control"] = "no-cache"
            response.headers["Service-Worker-Allowed"] = "/"
            return response
        supplied = scope["path"].lstrip("/").partition("/")[0]
        if supplied == self.builds.get(path.partition(os.sep)[0]) and response.status_code in (200, 304):
            visibility = "public" if scope.get("state", {}).get("public_asset") else "private"
            response.headers["Cache-Control"] = f"{visibility}, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "private, no-cache"
        return response


def public_build(directory: Path) -> str:
    digest = hashlib.sha256()
    for file in sorted(directory.rglob("*")):
        if file.is_file():
            digest.update(file.relative_to(directory).as_posix().encode())
            digest.update(hashlib.sha256(file.read_bytes()).digest())
    return "v" + digest.hexdigest()[:16]


def app_shell(builds: dict[str, str], bundled: bool) -> str:
    template = (paths.WEB / "index.html").read_text(encoding="utf-8")
    support = ""
    catalog = paths.WEB / "img" / "manifest.json"
    if catalog.is_file():
        data = json.dumps(json.loads(catalog.read_text(encoding="utf-8")), separators=(",", ":"), ensure_ascii=False).replace("<", "\\u003c")
        support += f'<script id="asset-manifest" type="application/json">{data}</script>'
    versions = json.dumps(builds, separators=(",", ":"))
    support += f'<script id="studio-versions" type="application/json">{versions}</script>'
    for directory in ("css", "fonts", "js", "img"):
        template = template.replace(f'"{directory}/', f'"/{builds[directory]}/{directory}/')
    if bundled:
        template = template.replace(f'"/{builds["js"]}/js/main.js"', f'"/{builds["bundle"]}/bundle/studio.js"')
    return template.replace("<!-- studio-state -->", support + "<!-- studio-state -->", 1)


def owner_secret_path() -> Path | None:
    """LIKENESS_OWNER_SECRET_FILE 是相对于版本库根目录读取的路径（因此无论从哪个文件夹
    启动工作室都能正常工作）。"""
    raw = os.environ.get("LIKENESS_OWNER_SECRET_FILE", "").strip()
    if not raw:
        return None
    path = Path(raw).expanduser()
    return path if path.is_absolute() else paths.ROOT / path


def owner_link_token(secret: bytes) -> str:
    return hmac.new(secret, b"likeness-owner-open-v1", hashlib.sha256).hexdigest()


def owner_authenticated(header: str, secret: bytes) -> bool:
    scheme, _, encoded = header.partition(" ")
    if scheme.lower() != "basic" or len(encoded) > 256:
        return False
    try:
        credentials = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        return False
    return secrets.compare_digest(credentials, b"likeness:" + secret)


def pairing_key(home: Path) -> str:
    path = home / "pairing.key"
    if not path.exists():
        home.mkdir(parents=True, exist_ok=True)
        path.write_text(secrets.token_urlsafe(9), encoding="utf-8")
    return path.read_text(encoding="utf-8").strip()


def create_app(engine: engines.Engine | None = None, home: Path | None = None, open_door: bool | None = None, config: dict | None = None) -> FastAPI:
    home = home or paths.home()
    home.mkdir(parents=True, exist_ok=True)
    config = settings.load(home) if config is None else config
    engine = engine or engines.create(os.environ.get("LIKENESS_ENGINE") or config["studio"].get("engine", "auto"), config, home)
    owner_file = owner_secret_path()
    link_only = os.environ.get("LIKENESS_OWNER_LINK") == "1"
    if link_only and not owner_file:
        raise ValueError("所有者免密码访问需要本地所有者密钥文件。")
    owner_secret = Path(owner_file).read_bytes().strip() if owner_file else b""
    if owner_file and (not owner_secret.isascii() or not 32 <= len(owner_secret) <= 90):
        raise ValueError("所有者密钥必须包含32至90个 ASCII 字节。")
    link_key = owner_link_token(owner_secret) if link_only else ""
    session_key = hmac.new(owner_secret, b"likeness-owner-session-v2", hashlib.sha256).digest() if link_only else b""
    accounts = Accounts(home)
    jobs, key = Jobs(int(config["studio"].get("workers", 4))), pairing_key(home)
    estimates = Estimates(home / f"estimates-{engine.kind}.json", engine.kind)
    open_door = bool(os.environ.get("LIKENESS_OPEN")) if open_door is None else open_door
    app = FastAPI(title="HakiShow", version=__version__, docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    app.state.engine, app.state.accounts, app.state.jobs, app.state.key = engine, accounts, jobs, key
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=3)
    css = public_build(paths.WEB / "css")
    fonts = public_build(paths.WEB / "fonts")
    style_build = "v" + hashlib.sha256((css + fonts).encode()).hexdigest()[:16]
    builds = {name: public_build(paths.WEB / name) for name in ("js", "vendor", "img")}
    builds.update(css=style_build, fonts=style_build)
    bundled = paths.ROOT / "workstation" / "bundle" / "studio.js"
    manifest = bundled.with_name("source.txt")
    bundle = bundled if bundled.is_file() and manifest.is_file() and manifest.read_text(encoding="ascii").strip() == builds["js"] else None
    if bundle:
        builds["bundle"] = "v" + hashlib.sha256(bundle.read_bytes()).hexdigest()[:16]
    shell = app_shell(builds, bundle is not None)
    catalog_path = paths.WEB / "img" / "manifest.json"
    catalog_manifest = json.loads(catalog_path.read_text(encoding="utf-8")) if catalog_path.is_file() else {}
    # 共享缓存仅提供已随包发布且明确分组标记版本的资源。
    public_assets = {
        f"/{version}/{file.relative_to(paths.WEB).as_posix()}"
        for group, version in builds.items()
        if group != "bundle"
        for file in (paths.WEB / group).rglob("*")
        if file.is_file() and file.suffix in PUBLIC_ASSET_TYPES and file.resolve().is_relative_to(paths.WEB.resolve())
        and not (group == "img" and file.relative_to(paths.WEB / "img").parts[0] in {"people", "styles"})
    }
    if bundle:
        public_assets.add(f'/{builds["bundle"]}/bundle/studio.js')
    # 应用名称、图标与服务工作线程：“添加到主屏幕”会在没有所有者 Cookie 时获取它们。它们
    # 对所有人都相同，不透露任何人的信息；页面、接口与每张图像仍受私有链接保护。
    public_assets |= {"/" + name for name in ROOT_FILES}

    def owner_device(cookie: str) -> str | None:
        device, sep, mac = cookie.partition(".")
        if sep and len(device) == 32 and len(mac) == 64 and device.isascii() and all(c in "0123456789abcdef" for c in device):
            signed = hmac.new(session_key, device.encode("ascii"), hashlib.sha256).hexdigest()
            if secrets.compare_digest(mac.encode("utf-8"), signed.encode("ascii")):
                return device
        return None

    def owner_session(request: Request, response, device: str | None = None):
        device = device or owner_device(request.cookies.get(OWNER_COOKIE, "")) or secrets.token_hex(16)
        signed = hmac.new(session_key, device.encode("ascii"), hashlib.sha256).hexdigest()
        response.set_cookie(OWNER_COOKIE, f"{device}.{signed}", max_age=31536000,
                            secure=True, httponly=True, samesite="strict", path="/")
        return response

    def studio_store(request: Request) -> Store:
        """请求账户自己的图像：通过此入口永远无法查到其他账户的图像。"""
        return Store(accounts.space(request.state.account["id"]), isolated=True)

    def wants_account(request: Request) -> bool:
        path = request.url.path
        return path.startswith("/api/") or path in ("/", "/index.html", "/studio.json") or path.startswith("/open/")

    @app.middleware("http")
    async def account(request: Request, call_next):
        """每位访客从打开第一页起便拥有账户：在直接注册转为会员或登录之前，均为访客账户。"""
        if not wants_account(request):
            return await call_next(request)
        token = request.cookies.get(SESSION_COOKIE, "")
        who = await run_in_threadpool(accounts.session, token) if token else None
        fresh = None
        if who is None:
            who, fresh = await run_in_threadpool(accounts.guest)
            token = fresh
        request.state.account, request.state.token = who, token
        response = await call_next(request)
        if fresh:
            response.set_cookie(SESSION_COOKIE, fresh, max_age=2 * 31536000, httponly=True, samesite="lax",
                                secure=request.url.scheme == "https", path="/")
        return response

    @app.middleware("http")
    async def paired(request: Request, call_next):
        """仅允许本机或已扫描配对码的设备访问。"""
        if owner_secret:
            if request.method in {"GET", "HEAD"} and request.url.path in public_assets:
                request.state.public_asset = True
                response = await call_next(request)
                response.headers["X-Content-Type-Options"] = "nosniff"
                return response
            if link_only and request.method == "GET" and request.url.path.startswith("/open/"):
                supplied = request.url.path[len("/open/"):]
                if len(supplied) == 64 and secrets.compare_digest(supplied.encode("utf-8"), link_key.encode("ascii")):
                    # 在已认证的响应中启动应用；其资源路径相对于站点根目录。
                    device = owner_device(request.cookies.get(OWNER_COOKIE, "")) or secrets.token_hex(16)
                    request.state.device = device
                    response = page_response(request, entered=True)
                    response.headers.update(OWNER_HEADERS)
                    return owner_session(request, response, device)
                return HTMLResponse("请重新打开你的访问链接。", status_code=403, headers=OWNER_HEADERS)
            if link_only and request.url.path == "/open":
                if request.method == "GET":
                    return HTMLResponse(OWNER_OPEN, headers=OWNER_HEADERS)
                if request.method == "POST":
                    expected_origin = f"{request.url.scheme}://{request.url.netloc}"
                    if request.headers.get("origin") == expected_origin:
                        async for chunk in request.stream():
                            if len(chunk) == 64 and secrets.compare_digest(chunk, link_key.encode("ascii")):
                                return owner_session(request, HTMLResponse("", status_code=204, headers=OWNER_HEADERS))
                            break
                    return HTMLResponse("请重新打开你的访问链接。", status_code=403, headers=OWNER_HEADERS)
            if link_only:
                device = owner_device(request.cookies.get(OWNER_COOKIE, ""))
                if not device:
                    return HTMLResponse("请通过你的访问链接打开 HakiShow 工作室。", status_code=401, headers=OWNER_HEADERS)
                request.state.device = device
            elif not owner_authenticated(request.headers.get("authorization", ""), owner_secret):
                return HTMLResponse("请登录 HakiShow 工作室。", status_code=401, headers={
                    "WWW-Authenticate": 'Basic realm="HakiShow Studio", charset="UTF-8"', "Cache-Control": "no-store",
                })
            origin = request.headers.get("origin")
            if request.method not in {"GET", "HEAD"} and origin and origin != f"{request.url.scheme}://{request.url.netloc}":
                return HTMLResponse("请打开 HakiShow 工作室进行修改。", status_code=403)
            response = await call_next(request)
            cache = response.headers.get("Cache-Control", "")
            response.headers.update(OWNER_HEADERS)
            if cache.startswith("private, max-age=") and not request.url.path.startswith("/api/"):
                response.headers["Cache-Control"] = cache
            return response
        offered = request.query_params.get("pair")
        if offered and secrets.compare_digest(offered.encode("utf-8"), key.encode("utf-8")):
            response = RedirectResponse(str(request.url.remove_query_params("pair")))
            response.set_cookie("likeness_key", key, max_age=31536000, secure=request.url.scheme == "https", httponly=True, samesite="lax")
            return response
        host = request.client.host if request.client else ""
        cookie = request.cookies.get("likeness_key", "").encode("utf-8")
        if not (open_door or host in LOOPBACK or secrets.compare_digest(cookie, key.encode("utf-8"))):
            return HTMLResponse(NOT_PAIRED, status_code=401)
        response = await call_next(request)
        response.headers["Permissions-Policy"] = "geolocation=()"
        if "Cache-Control" not in response.headers:
            response.headers["cache-control"] = "no-cache"
        return response

    @app.exception_handler(EngineError)
    async def engine_failed(request: Request, error: EngineError):
        return JSONResponse({"detail": str(error), "hint": error.hint}, status_code=502)

    def describe(request: Request) -> dict:
        who = getattr(request.state, "account", None)
        return {"ok": True, "edition": "live", "version": __version__, "engine": engine.describe(),
                **({"account": Accounts.public(who)} if who else {}),
                "builds": {"img": builds["img"]},
                "events": "poll" if owner_secret else "stream",
                "eta": {pace: estimates.expect("edit", pace) for pace in ("quick", "fine", "deep")},
                "portraitEta": {pace: estimates.expect("restyle", pace) for pace in ("quick", "fine", "deep")}}

    app.get("/studio.json")(describe)
    app.get("/api/health")(describe)

    @app.get("/api/catalog")
    def catalog():
        return {"builds": builds, "manifest": catalog_manifest}

    def page_response(request: Request, *, entered: bool = False):
        info = json.dumps(describe(request), ensure_ascii=True).replace("<", "\\u003c")
        embedded = f'<script id="studio-state" type="application/json">{info}</script>'
        page = shell.replace("<!-- studio-state -->", embedded, 1)
        if entered:
            page = page.replace("<head>", """<head>
<base href="/">
<script>history.replaceState(null, "", "/");</script>""", 1)
        return HTMLResponse(page,
                            headers={"cache-control": "private, no-store"})

    @app.get("/", response_class=HTMLResponse, include_in_schema=False)
    @app.get("/index.html", response_class=HTMLResponse, include_in_schema=False)
    @app.head("/", response_class=HTMLResponse, include_in_schema=False)
    def home_page(request: Request):
        return page_response(request)

    @app.post("/api/assets")
    async def upload(request: Request, file: UploadFile = File(...), kind: Literal["image", "mask"] = Form("image")):
        data = await file.read(MAX_UPLOAD + 1)
        try:
            note = await run_in_threadpool(studio_store(request).add_bytes, data, kind)
        except ValueError as error:
            raise HTTPException(413 if len(data) > MAX_UPLOAD else 415, str(error)) from None
        return {"id": note["id"], "kind": note["kind"], "w": note["w"], "h": note["h"], "url": Store.url(note["id"])}

    @app.get("/api/assets/{asset_id}")
    def asset(request: Request, asset_id: str):
        path = studio_store(request).path(asset_id)
        if path is None or not path.exists():
            raise HTTPException(404, "找不到这张图像。")
        return FileResponse(path, media_type="image/jpeg" if path.suffix == ".jpg" else "image/png", headers={"cache-control": "private, max-age=31536000, immutable"})

    def inputs_for(turn: Turn, assets: Store) -> Inputs:
        pictures = {a: assets.path(a) for a in turn.asset_ids()}
        if any(path is None or not path.is_file() for path in pictures.values()):
            raise HTTPException(409, "请重新上传照片。")
        return Inputs(
            pictures={h: pictures[a] for h, a in turn.handles.items()},
            subject=turn.handle_of(turn.intent.subject) if turn.intent.subject else None,
            refs=[(h, r.role) for r in turn.intent.refs if (h := turn.handle_of(r.asset))],
            pins=[(p.n, p.note, pictures.get(p.mask)) for p in turn.pins],
            subject_mask=pictures.get(turn.subject_mask),
        )

    @app.post("/api/turns")
    def turn(body: Turn, request: Request):
        assets = studio_store(request)
        device = request.state.account["id"]
        inputs = inputs_for(body, assets)
        eta = estimates.expect(body.intent.op, body.pace, body.n)

        def work(job: Job) -> None:
            started = time.monotonic()
            progress = Work(job, assets, engine.provenance(body))
            engine.turn(body, inputs, progress)
            if not progress.results:
                raise EngineError("未返回图像", "请重试，或换一种方式描述修改。")
            ms = int((time.monotonic() - started) * 1000)
            estimates.record(body.intent.op, body.pace, body.n, ms)
            job.emit("done", ms=ms)

        submission = None
        if body.id:   # 同一轮次发送两次（断线后重试）仍然对应同一个任务，绝不创建第二个任务
            wire = json.dumps(body.model_dump(mode="json"), sort_keys=True, separators=(",", ":")).encode()
            submission = (f"{device}:{body.id}", hashlib.sha256(wire).hexdigest())
        try:
            job = jobs.submit(work, submission, owner=device)
            return {"job": job.id, "eta": eta}
        except SubmissionConflict:
            raise HTTPException(422, "此请求标识符已被另一个请求使用。请刷新后重试。") from None
        except QueueFull:
            raise HTTPException(429, "工作室队列已满。请等待一张图像完成后重试。", headers={"Retry-After": "10"}) from None

    def find(request: Request, job_id: str) -> Job:
        job = jobs.jobs.get(job_id)
        if job is None or job.owner != request.state.account["id"]:
            raise HTTPException(404, "找不到此任务。工作室可能已经重启。")
        return job

    @app.get("/api/jobs/{job_id}")
    def job_state(request: Request, job_id: str):
        job = find(request, job_id)
        return {"state": job.state, "events": job.events}

    @app.get("/api/jobs/{job_id}/events")
    async def job_events(request: Request, job_id: str):
        job = find(request, job_id)

        async def stream():
            sent = 0
            while True:
                while sent < len(job.events):
                    event = dict(job.events[sent])
                    sent += 1
                    yield f"event: {event.pop('type')}\ndata: {json.dumps(event)}\n\n"
                if job.finished and sent >= len(job.events):
                    return
                await asyncio.sleep(0.05)

        return StreamingResponse(stream(), media_type="text/event-stream", headers={"cache-control": "no-store", "x-accel-buffering": "no"})

    @app.post("/api/jobs/{job_id}/cancel")
    def cancel(request: Request, job_id: str):
        find(request, job_id)
        return {"ok": jobs.cancel(job_id)}

    @app.post("/api/styles")
    def invent_style(ask: StyleAsk, request: Request):
        """根据文字或参考图像创造一个完整的自定义风格。"""
        if not ask.text.strip() and not ask.asset:
            raise HTTPException(400, "请描述你想要的风格，或上传一张参考图像。")
        picture = studio_store(request).path(ask.asset) if ask.asset else None
        if ask.asset and picture is None:
            raise HTTPException(409, "请重新上传参考图像。")
        maker = getattr(engine, "style", None)
        if maker is None:
            raise HTTPException(501, "此工作室引擎暂不支持自定义风格。")
        return {"style": normalise_style(maker(ask, picture), ask.text.strip())}

    @app.get("/api/history")
    def history(request: Request, limit: int = 120):
        return {"made": studio_store(request).made(max(1, min(limit, 500)))}

    # ---- 账户及其私有空间 ----
    @app.exception_handler(AccountError)
    async def account_failed(request: Request, error: AccountError):
        return JSONResponse({"detail": str(error)}, status_code=error.status)

    def me(request: Request) -> dict:
        who = request.state.account
        return {"account": Accounts.public(who), "counts": accounts.counts(who["id"])}

    app.get("/api/me")(me)

    @app.post("/api/auth/signup")
    def signup(body: SignUp, request: Request):
        request.state.account = accounts.signup(request.state.account["id"], body.handle, body.password, body.nickname)
        return me(request)

    @app.post("/api/auth/login")
    def login(body: LogIn, request: Request):
        who = request.client.host if request.client else ""
        request.state.account, moved = accounts.login(request.state.token, request.state.account, body.handle, body.password, who)
        return {**me(request), "moved": moved}

    @app.post("/api/auth/logout")
    def logout(request: Request):
        accounts.logout(request.state.token)
        response = JSONResponse({"ok": True})
        response.delete_cookie(SESSION_COOKIE, path="/")
        return response

    @app.post("/api/auth/profile")
    def profile(body: Profile, request: Request):
        request.state.account = accounts.rename(request.state.account["id"], body.nickname)
        return me(request)

    @app.get("/api/sync")
    def pull(request: Request, cursor: int = 0):
        records, at = accounts.since(request.state.account["id"], max(0, cursor))
        return {"records": records, "cursor": at, "account": request.state.account["id"]}

    @app.post("/api/sync")
    def push(body: SyncIn, request: Request):
        return {"applied": accounts.put(request.state.account["id"], body.records)}

    app.mount("/", StudioFiles(builds, bundle), name="web")
    return app
