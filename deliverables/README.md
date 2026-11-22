# HakiShow 最终交付物

本目录存放 Team01 的五项最终交付物。

| 序号 | 交付物 | 文件 |
|---|---|---|
| 1 | 项目源代码 | 仓库根目录（打包时导出为 `HakiShow-源代码.zip`，不含本目录与任何本地密钥） |
| 2 | 项目答辩 PPT | [HakiShow-项目答辩.pptx](HakiShow-项目答辩.pptx)（16 页，含演讲者备注） |
| 3 | 介绍文档 | [HakiShow-项目介绍文档.pdf](HakiShow-项目介绍文档.pdf)（源文件：[Markdown](HakiShow-项目介绍文档.md)） |
| 4 | 项目演示讲解视频 | [HakiShow-演示讲解视频.mp4](HakiShow-演示讲解视频.mp4)（1920×1080，中文解说与字幕；字幕文件：[SRT](HakiShow-演示讲解视频.srt)，解说稿：[旁白稿](HakiShow-演示讲解旁白稿.md)） |
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

演示视频中的应用画面均为真实运行的 HakiShow：录制时用虚拟时钟逐帧推进应用，再以每秒 30 帧合成，因此画面流畅且与应用实际行为一致。“云端生成中”的等待过程在视频中做了加速处理，并在画面上注明。测试人物为虚构人物，其照片与表情素材由图像模型生成；视频中的 AI 艺术肖像由 GPT Image 真实生成。
