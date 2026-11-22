"""工作室接收到的应用请求。在此进行验证，使引擎能够信任收到的输入。"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

Op = Literal["create", "edit", "restyle", "reference", "blend", "region", "backdrop", "remove", "vary", "angles"]
Pace = Literal["quick", "fine", "deep"]
Aspect = Literal["portrait", "square", "tall", "landscape"]
# 按格式规定对图像模型的要求（长壁纸先按竖幅绘制，再为手机构图）
SIZES = {"portrait": "1024x1536", "square": "1024x1024", "tall": "1024x1536", "landscape": "1536x1024"}
Handle = Annotated[str, StringConstraints(pattern=r"^[A-Z]{1,8}$")]


class Ref(BaseModel):
    asset: str = Field(max_length=40)
    # look：将其外观（发型、颜色、妆容、服饰）借用到主体上的图像；marks：绘有用户
    # 自己标记的主体图像，用来说明修改位置与方式
    role: Literal["style", "backdrop", "with", "look", "marks"] = "with"


class Intent(BaseModel):
    """应用对请求的初步理解。引擎会再次阅读文字，可能得出不同理解。"""
    op: Op = "create"
    subject: str | None = Field(None, max_length=40)
    refs: list[Ref] = Field(default_factory=list, max_length=8)


class Pin(BaseModel):
    n: int = Field(ge=1, le=9)
    note: str = Field("", max_length=1200)   # 由多个部分组合而成、带标记与参考图的外观包含较多信息
    print: str | None = Field(None, max_length=40)
    mask: str | None = Field(None, max_length=40)


class LookIn(BaseModel):
    id: str | None = Field(None, max_length=80)
    name: str = Field(max_length=80)
    prompt: str = Field("", max_length=800)


class BackdropIn(BaseModel):
    name: str = Field(max_length=120)
    words: str = Field(max_length=400)


class RoomIn(BaseModel):
    id: str = Field("", max_length=80)
    name: str = Field("", max_length=80)
    line: str = Field("", max_length=200)
    colors: dict[str, str] = Field(default_factory=dict)
    voice: list[str] = Field(default_factory=list, max_length=8)


class Turn(BaseModel):
    id: str = Field(max_length=64)
    text: str = Field("", max_length=4000)
    pace: Pace = "fine"
    n: int = Field(1, ge=1, le=4)
    handles: dict[Handle, str] = Field(default_factory=dict, max_length=12)   # "A" -> 素材标识符
    intent: Intent = Field(default_factory=Intent)
    look: LookIn | None = None
    backdrop: BackdropIn | None = None
    subject_mask: str | None = Field(None, max_length=40)
    pins: list[Pin] = Field(default_factory=list, max_length=9)
    room: RoomIn | None = None
    mood: str | None = Field(None, max_length=40)
    taste: str = Field("", max_length=600)   # 用用户自己的话描述其一贯偏好
    aspect: Aspect | None = None   # 人像工作室的格式：2:3竖幅、方形头像或长壁纸
    preset: str | None = Field(None, max_length=40, pattern=r"^[a-z0-9-]+$")   # 用户请求的 HakiShow 风格，随结果一同记录
    say: str = Field("", max_length=400)   # 用户以自己语言表达的内容（回复回应此内容，而非图像提示词）

    def asset_ids(self) -> list[str]:
        ids = list(self.handles.values()) + [r.asset for r in self.intent.refs] + [p.mask for p in self.pins if p.mask]
        ids += [x for x in (self.intent.subject, self.subject_mask) if x]
        return list(dict.fromkeys(ids))

    def handle_of(self, asset_id: str | None) -> str | None:
        return next((h for h, a in self.handles.items() if a == asset_id), None)


class RoomAsk(BaseModel):
    text: str = Field(max_length=300)
    palette: list[str] | None = Field(None, max_length=8)


class LookAsk(BaseModel):
    text: str = Field("", max_length=300)
    asset: str | None = Field(None, max_length=40)


class StyleAsk(BaseModel):
    """根据文字、参考图像或两者共同创造的自定义风格。"""
    text: str = Field("", max_length=300)
    asset: str | None = Field(None, max_length=40)


class BackdropAsk(BaseModel):
    text: str = Field("", max_length=300)
    near: float = Field(0.5, ge=0, le=1)
    dream: float = Field(0.4, ge=0, le=1)
    room: str = Field("", max_length=80)
    asset: str | None = Field(None, max_length=40)


@dataclass
class Inputs:
    """本轮的图像，已解析为磁盘文件，并按各自句柄命名。"""
    pictures: dict[str, Path] = field(default_factory=dict)       # "A" -> 文件
    subject: str | None = None                                     # 待修改图像的句柄
    refs: list[tuple[str, str]] = field(default_factory=list)      # （句柄、角色）
    pins: list[tuple[int, str, Path | None]] = field(default_factory=list)   # （编号、说明、蒙版文件）
    subject_mask: Path | None = None
