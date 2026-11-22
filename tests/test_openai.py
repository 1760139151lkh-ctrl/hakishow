"""使用此处提供的 OpenAI 接口替代服务测试 openai 引擎：流式中间图像与完整图像、
人像所请求的格式、以蒙版发送的标记区域、直白表达的接口拒绝信息，以及仅文本
请求。这里不会连接外部网络，也没有真实密钥。"""

from __future__ import annotations

import base64
import io
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from likeness.engines import EngineError
from likeness.engines.openai_images import OpenAIImages
from likeness.server import create_app

from conftest import follow, picture, png, upload


def _jpeg(size, colour) -> str:
    buf = io.BytesIO()
    Image.new("RGB", size, colour).save(buf, "JPEG")
    return base64.b64encode(buf.getvalue()).decode()


class FakeAPI(BaseHTTPRequestHandler):
    seen: list[dict] = []
    refuse = ""

    def log_message(self, *args):  # 静默
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        FakeAPI.seen.append({"path": self.path, "auth": self.headers.get("Authorization"), "type": self.headers.get("Content-Type", ""), "body": body})
        if FakeAPI.refuse:
            self.send_response(400 if FakeAPI.refuse == "safety" else 401)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            code = "moderation_blocked" if FakeAPI.refuse == "safety" else "invalid_api_key"
            self.wfile.write(json.dumps({"error": {"message": "no", "code": code}}).encode())  # 故障响应原文：拒绝
            return
        if self.path.endswith("/chat/completions"):
            answer = {"name": "天鹅绒时刻", "line": "迟暮光线", "prompt": "warm", "ramp": ["#220000", "#ffddaa"], "keep": .5, "grain": .2, "bloom": .3, "vignette": .4}
            if b'"suggestions"' in body:   # 在请求图像的同时请求工作室回复
                answer = {"reply": "完成了！你的人像正焕发光彩。", "suggestions": ["添加星空背景", "添加一顶小王冠", "试试温柔的微笑"]}
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"choices": [{"message": {"content": json.dumps(answer)}}]}).encode())
            return
        size = (1024, 1024) if b"1024x1024" in body else (1024, 1536)
        kind = "image_edit" if self.path.endswith("/edits") else "image_generation"
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for i, colour in enumerate([(40, 40, 40), (120, 80, 80)]):
            self.wfile.write(f"event: {kind}.partial_image\ndata: {json.dumps({'type': kind + '.partial_image', 'partial_image_index': i, 'b64_json': _jpeg(size, colour)})}\n\n".encode())
        self.wfile.write(f"event: {kind}.completed\ndata: {json.dumps({'type': kind + '.completed', 'b64_json': _jpeg(size, (220, 120, 160))})}\n\n".encode())


def _image_calls(api) -> list[dict]:
    """按顺序排列的图像请求调用（回复文字与这些请求并行获取）。"""
    return [s for s in api.seen if "/images/" in s["path"]]


def _image_call(api) -> dict:
    """最近一次请求图像的调用。"""
    return _image_calls(api)[-1]


@pytest.fixture
def api(monkeypatch):
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeAPI)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    FakeAPI.seen, FakeAPI.refuse = [], ""
    monkeypatch.setenv("OPENAI_BASE_URL", f"http://127.0.0.1:{server.server_port}/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-real")
    yield FakeAPI
    server.shutdown()


@pytest.fixture
def live(api, tmp_path):
    with TestClient(create_app(OpenAIImages({}), home=tmp_path / "home", open_door=True, config={"studio": {"workers": 2}, "codex": {}})) as c:
        yield c


def test_a_portrait_streams_as_it_develops_and_arrives_in_the_format_asked(live, api):
    photo = upload(live, png((300, 400), (200, 170, 140)))
    turn = {"id": "p1", "text": "Repaint this person as a storybook royal portrait.", "pace": "fine", "aspect": "square",
            "handles": {"A": photo}, "intent": {"op": "restyle", "subject": photo}}
    events = follow(live, live.post("/api/turns", json=turn).json()["job"])
    kinds = [e["type"] for e in events]
    assert kinds.count("partial") == 2 and kinds.index("partial") < kinds.index("result") and kinds[-1] == "done"
    result = next(e for e in events if e["type"] == "result")
    assert result["provenance"]["kind"] == "render" and "gpt-image" in result["provenance"]["detail"]
    assert picture(live, result["url"]).size == (1024, 1024)
    sent = _image_call(api)
    assert sent["path"] == "/v1/images/edits" and sent["auth"] == "Bearer sk-test-not-real"
    assert b'name="size"\r\n\r\n1024x1024' in sent["body"] and b'name="stream"\r\n\r\ntrue' in sent["body"]
    assert b"storybook royal portrait" in sent["body"]  # 原始请求字节：童话书中的皇家肖像


def test_words_alone_are_painted_by_the_generations_endpoint(live, api):
    events = follow(live, live.post("/api/turns", json={"id": "p2", "text": "茶杯中的灯塔", "pace": "quick", "intent": {"op": "create"}}).json()["job"])
    assert any(e["type"] == "result" for e in events)
    sent = _image_call(api)
    assert sent["path"] == "/v1/images/generations"
    body = json.loads(sent["body"])
    assert body["stream"] is True and body["model"] == "gpt-image-2.6-flare" and body["quality"] == "low"


def test_marked_regions_go_as_a_mask_transparent_where_it_may_change(live, api):
    subject = upload(live, png((120, 180), (180, 180, 180)))
    mask = upload(live, png((120, 180), (0, 0, 0), box=(0, 0, 59, 59)), "mask")
    turn = {"id": "p3", "text": "", "handles": {"A": subject}, "intent": {"op": "region", "subject": subject}, "pins": [{"n": 1, "note": "a red bow", "mask": mask}]}
    follow(live, live.post("/api/turns", json=turn).json()["job"])
    body = _image_call(api)["body"]
    start = body.index(b'name="mask"')
    data = body[body.index(b"\r\n\r\n", start) + 4:]
    with Image.open(io.BytesIO(data)) as m:
        alpha = m.convert("RGBA").getchannel("A")
        assert alpha.getpixel((10, 10)) == 0 and alpha.getpixel((100, 160)) == 255
    assert b"a red bow" in body  # 原始请求字节：红色蝴蝶结


def test_the_reply_and_three_ideas_are_written_alongside_the_picture(live, api):
    photo = upload(live, png((300, 400), (200, 170, 140)))
    turn = {"id": "r1", "text": "把背景改成日落海滩。", "say": "使用日落海滩背景", "pace": "quick",
            "handles": {"A": photo}, "intent": {"op": "edit", "subject": photo}}
    events = follow(live, live.post("/api/turns", json=turn).json()["job"])
    reply = next(e for e in events if e["type"] == "reply")
    assert reply["text"] == "完成了！你的人像正焕发光彩。" and reply["suggestions"] == ["添加星空背景", "添加一顶小王冠", "试试温柔的微笑"]
    words = json.loads(next(s for s in api.seen if s["path"].endswith("/chat/completions"))["body"])
    assert "使用日落海滩背景" in words["messages"][0]["content"][0]["text"]


def test_without_an_answer_in_time_the_reply_falls_back_to_the_styles_voice(live, api, monkeypatch):
    monkeypatch.setattr(OpenAIImages, "_talk", lambda self, turn: None)
    photo = upload(live, png((300, 400), (200, 170, 140)))
    turn = {"id": "r2", "text": "重绘。", "pace": "quick", "handles": {"A": photo}, "intent": {"op": "restyle", "subject": photo},
            "room": {"voice": ["你的新人像作品已完成！"]}}
    reply = next(e for e in follow(live, live.post("/api/turns", json=turn).json()["job"]) if e["type"] == "reply")
    assert reply["text"] == "你的新人像作品已完成！" and len(reply["suggestions"]) == 3


def test_short_or_repeated_model_suggestions_are_completed(live, api, monkeypatch):
    from concurrent.futures import Future

    answer = Future()
    answer.set_result({"reply": "你的图像已完成！", "suggestions": ["添加一顶小王冠", "添加一顶小王冠"]})
    monkeypatch.setattr(OpenAIImages, "_talk", lambda self, turn: answer)
    photo = upload(live, png((96, 144)))
    turn = {"id": "r3", "text": "重绘。", "handles": {"A": photo}, "intent": {"op": "restyle", "subject": photo}}
    reply = next(e for e in follow(live, live.post("/api/turns", json=turn).json()["job"]) if e["type"] == "reply")
    assert reply["suggestions"][0] == "添加一顶小王冠"
    assert len(reply["suggestions"]) == len(set(reply["suggestions"])) == 3


def test_refusals_are_said_plainly(live, api):
    api.refuse = "safety"
    events = follow(live, live.post("/api/turns", json={"id": "p4", "text": "x", "intent": {"op": "create"}}).json()["job"])
    failed = next(e for e in events if e["type"] == "failed")
    assert "安全审核" in failed["message"] and failed["hint"]
    api.refuse = "key"
    with pytest.raises(EngineError, match="接口密钥不可用"):
        OpenAIImages({}).look(type("Ask", (), {"text": "x"})(), None)


def test_words_only_asks_use_a_strict_schema(api):
    look = OpenAIImages({}).look(type("Ask", (), {"text": "天鹅绒般的夜晚"})(), None)
    assert look["name"]
    sent = json.loads(api.seen[-1]["body"])
    assert sent["response_format"]["json_schema"]["strict"] is True


def test_a_photo_goes_up_to_the_api_as_jpeg_not_a_re_encoded_png(live, api):
    photo = upload(live, png((300, 400), (200, 170, 140)))
    turn = {"id": "p5", "text": "重绘。", "pace": "quick", "aspect": "portrait", "preset": "princess",
            "handles": {"A": photo}, "intent": {"op": "restyle", "subject": photo}}
    follow(live, live.post("/api/turns", json=turn).json()["job"])
    body = _image_call(api)["body"]
    assert b'filename="A.jpg"' in body and b"Content-Type: image/jpeg" in body and b"image/png" not in body


def test_the_engine_will_not_start_without_a_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(SystemExit, match="OPENAI_API_KEY"):
        OpenAIImages({})


def test_the_studio_keeps_a_history_of_what_it_made(client):
    for i in range(2):
        follow(client, client.post("/api/turns", json={"id": f"h{i}", "text": "红色屋顶", "pace": "quick", "intent": {"op": "create"}}).json()["job"])
    made = client.get("/api/history").json()["made"]
    assert len(made) == 2 and made[0]["created"] >= made[1]["created"]
    assert all(m["url"].startswith("api/assets/") and m["provenance"]["kind"] == "simulated" for m in made)


def test_the_styles_art_is_served_and_cached(client):
    res = client.get("/img/styles/princess/mei.webp")
    assert res.status_code == 200 and res.headers["content-type"] == "image/webp"
    shell = client.get("/").text
    assert 'id="asset-manifest"' in shell and 'lang="zh-CN"' in shell


def test_a_region_edit_keeps_every_pixel_outside_the_marked_region(live, api):
    """区域编辑时，模型可以重绘整幅画面，但只有标记区域会合成到原图中。"""
    subject = upload(live, png((240, 360), (30, 160, 60)))
    mask = upload(live, png((240, 360), (0, 0, 0), box=(80, 120, 160, 200)), "mask")
    turn = {"id": "r1", "text": "红唇", "aspect": "portrait", "handles": {"A": subject}, "intent": {"op": "region", "subject": subject},
            "pins": [{"n": 1, "note": "经典红唇", "mask": mask}]}
    events = follow(live, live.post("/api/turns", json=turn).json()["job"])
    out = picture(live, next(e for e in events if e["type"] == "result")["url"]).convert("RGB")
    w, h = out.size
    far = out.getpixel((int(w * .05), int(h * .05)))
    inside = out.getpixel((int(w * .5), int(h * .44)))
    assert abs(far[0] - 30) < 14 and abs(far[1] - 160) < 14, far          # 未修改：仍为原始绿色
    assert inside[0] > 150 and inside[1] < 150, inside                    # 已修改：模型生成的粉色


def test_every_angle_is_asked_for_on_its_own(live, api):
    photo = upload(live, png((300, 450), (200, 170, 140)))
    turn = {"id": "a1", "text": "", "n": 3, "aspect": "portrait", "handles": {"A": photo}, "intent": {"op": "angles", "subject": photo}}
    events = follow(live, live.post("/api/turns", json=turn).json()["job"])
    assert sum(e["type"] == "result" for e in events) == 3
    prompts = [s["body"] for s in _image_calls(api)[-3:]]
    assert any(b'\xe5\x9b\x9b\xe5\x88\x86\xe4\xb9\x8b\xe4\xb8\x89\xe4\xbe\xa7\xe9\x9d\xa2\xe8\xa7\x86\xe8\xa7\x92\xef\xbc\x8c\xe5\xa4\xb4\xe9\x83\xa8\xe8\xbd\xac\xe5\x8a\xa8\xe4\xbd\xbf\xe9\xbc\xbb\xe5\xad\x90\xe6\x9c\x9d\xe5\x90\x91\xe7\x94\xbb\xe9\x9d\xa2\xe5\x8f\xb3' in p for p in prompts)  # 期望文本：四分之三侧面视角，头部转动使鼻子朝向画面右
    assert any(b'\xe5\xae\x8c\xe6\x95\xb4\xe4\xbe\xa7\xe9\x9d\xa2\xe8\xa7\x86\xe8\xa7\x92' in p for p in prompts)  # 期望文本：完整侧面视角
    assert any(b'\xe6\x9c\x9d\xe5\x90\x91\xe7\x94\xbb\xe9\x9d\xa2\xe5\xb7\xa6\xe8\xbe\xb9\xe7\xbc\x98' in p for p in prompts)  # 期望文本：朝向画面左边缘


def test_a_landscape_photo_is_edited_in_its_own_shape(live, api):
    photo = upload(live, png((600, 400), (120, 130, 140)))
    turn = {"id": "l1", "text": "make it sunset", "handles": {"A": photo}, "intent": {"op": "edit", "subject": photo}}  # 英文场景匹配输入：改成日落
    follow(live, live.post("/api/turns", json=turn).json()["job"])
    assert b'name="size"\r\n\r\n1536x1024' in _image_call(api)["body"]


def test_a_style_invented_from_words_is_complete_and_safe(live, api):
    res = live.post("/api/styles", json={"text": "宇宙糖果风格"})
    assert res.status_code == 200
    st = res.json()["style"]
    assert st["custom"] and st["id"].startswith("my-") and st["cat"] == "mine"
    assert len(st["details"]) == 8 and {d["group"] for d in st["details"]} == {"acc", "light", "scene", "frame"}
    assert all(st["theme"][k].startswith("#") for k in ("bg", "bg2", "surface", "ink", "soft", "accent", "accent2"))
    assert st["prompt"] and st["defaults"]["details"]
    assert live.post("/api/styles", json={"text": ""}).status_code == 400
