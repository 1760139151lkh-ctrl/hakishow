# HakiShow 最终交付物

本目录存放 Team01 的五项最终交付物。

| 序号 | 交付物 | 文件 |
|---|---|---|
| 1 | 项目源代码 | 仓库根目录（打包时导出为 `HakiShow-源代码.zip`，不含本目录与任何本地密钥） |
| 2 | 项目答辩 PPT | [HakiShow-项目答辩.pptx](HakiShow-项目答辩.pptx)（16 页，含演讲者备注） |
| 3 | 介绍文档 | [HakiShow-项目介绍文档.pdf](HakiShow-项目介绍文档.pdf)（源文件：[Markdown](HakiShow-项目介绍文档.md)） |
| 4 | 项目演示讲解视频 | [HakiShow-演示讲解视频.mp4](HakiShow-演示讲解视频.mp4)（1:56，1920×1080，60 帧／秒，中文解说与字幕；字幕文件：[SRT](HakiShow-演示讲解视频.srt)，解说稿：[旁白稿](HakiShow-演示讲解旁白稿.md)） |
| 5 | 成员任务分工文档 | [HakiShow-成员任务分工文档.pdf](HakiShow-成员任务分工文档.pdf)（源文件：[Markdown](HakiShow-成员任务分工文档.md)） |

## 打包提交

每位成员提交同一套完整材料。在仓库根目录运行：

```sh
sh deliverables/package.sh
```

脚本会在被版本控制忽略的 `dist/` 下生成三个提交文件夹及对应压缩包：

- `Team01-Lead-组长-HakiShow`
- `Team01-Member-组员1-HakiShow`
- `Team01-Member-组员2-HakiShow`

每个文件夹都包含上述五项交付物。源代码压缩包由 `git archive` 从当前提交导出，因此只包含已提交的文件，不会带入 `.env.local`、`private/` 等本地数据。

## 视频说明

演示视频是一支按 120 BPM 节拍编排的动态展示片，包括动态文字排版、三维镜头调度、节拍卡点转场，以及配乐和逐个对齐画面的音效。其中手机里的应用画面都是真实运行的 HakiShow：录制时用虚拟时钟逐帧推进应用，再以每秒 60 帧合成，所以画面流畅，行为也和应用实际一致。“云端生成中”的等待过程在视频中做了加速处理，并在画面上注明。

视频、PPT 与介绍文档中的人物，都是素材库中的虚拟人物 mei（`web/img/people/mei.webp`），33 种风格肖像都由她变化而来。实时相机画面以她的原图作为模拟摄像头输入；微笑、张嘴和眨眼等表情帧，只在原图上局部修改嘴部或眼部。视频与截图中的 AI 艺术肖像由 GPT Image 真实生成。

解说使用微软 Edge 在线神经语音“晓晓”（zh-CN-XiaoxiaoNeural），配乐与音效为程序合成的原创音频。
