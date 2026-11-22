"""模拟器为每种修改类型都生成图像，并为所有结果加上标记。"""

import pytest
from PIL import Image, ImageDraw

from likeness.engines.simulator import Simulator, stamp
from likeness.turns import Inputs, Turn

OPS = ["create", "edit", "restyle", "reference", "blend", "region", "backdrop", "remove", "vary", "angles"]


@pytest.mark.parametrize("op", OPS)
def test_every_kind_of_change_paints_something(tmp_path, op):
    a, b, m = tmp_path / "a.png", tmp_path / "b.png", tmp_path / "m.png"
    Image.new("RGB", (80, 120), (200, 150, 120)).save(a)
    Image.new("RGB", (80, 120), (30, 60, 140)).save(b)
    mask = Image.new("L", (80, 120), 0)
    ImageDraw.Draw(mask).rectangle((10, 10, 40, 40), fill=255)
    mask.save(m)
    pins = op in ("region", "remove")
    turn = Turn(id="x", text="make it warmer and dreamy", handles={"A": "a", "B": "b"},  # 英文颜色效果匹配输入：让它更温暖、更梦幻
                intent={"op": op, "subject": "a", "refs": [{"asset": "b", "role": "style"}]},
                look={"name": "Film", "prompt": "vintage film"} if op == "restyle" else None,  # 英文风格匹配输入：复古胶片
                backdrop={"name": "Harbour", "words": "a harbour at dusk"} if op == "backdrop" else None,  # 英文场景匹配输入：黄昏时的港湾
                pins=[{"n": 1, "note": "gold", "print": "a", "mask": "m"}] if pins else [])
    inputs = Inputs(pictures={"A": a, "B": b}, subject="A", refs=[("B", "style")], pins=[(1, "gold", m)] if pins else [])
    made = Simulator().paint(turn, inputs, 0)
    assert made.mode == "RGB" and made.width > 0
    if op != "create":
        assert made.size == (80, 120)
    assert stamp(made).size == made.size


def test_a_look_borrowed_and_marks_drawn_are_painted_with(tmp_path):
    """镜像编辑器在修改请求旁一并发送参考图（角色 look）以及绘有用户标记的图像（角色 marks）：
    替代示例将参考图颜色应用到选定部分，并显示收到的标记。"""
    a, look, marks, m = tmp_path / "a.png", tmp_path / "look.png", tmp_path / "marks.png", tmp_path / "m.png"
    Image.new("RGB", (80, 120), (200, 150, 120)).save(a)
    Image.new("RGB", (80, 120), (20, 160, 60)).save(look)
    drawn = Image.new("RGB", (80, 120), (200, 150, 120))
    ImageDraw.Draw(drawn).line((5, 100, 75, 100), fill=(255, 40, 80), width=4)
    drawn.save(marks)
    mask = Image.new("L", (80, 120), 0)
    ImageDraw.Draw(mask).rectangle((10, 10, 40, 40), fill=255)
    mask.save(m)
    turn = Turn(id="y", text="对 @A 的修改", handles={"A": "a", "B": "look", "C": "marks"},
                intent={"op": "region", "subject": "a", "refs": [{"asset": "marks", "role": "marks"}, {"asset": "look", "role": "look"}]},
                pins=[{"n": 1, "note": "参考图中的刘海", "print": "a", "mask": "m"}])
    inputs = Inputs(pictures={"A": a, "B": look, "C": marks}, subject="A", refs=[("C", "marks"), ("B", "look")], pins=[(1, "参考图中的刘海", m)])
    made = Simulator().paint(turn, inputs, 0)
    inside, outside, mark = made.getpixel((25, 25)), made.getpixel((60, 70)), made.getpixel((40, 100))
    assert inside[1] > inside[0], "选定部分内借用了参考图的绿色"
    assert outside == (200, 150, 120), "选定部分外的所有内容保持不变"
    assert mark[0] > 230 and mark[1] < 90, "标记显示在原本绘制的位置"
