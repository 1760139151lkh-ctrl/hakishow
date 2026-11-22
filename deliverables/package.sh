#!/bin/sh
# 生成三个成员提交文件夹及压缩包（输出到被忽略的 dist/）。
set -eu
cd "$(dirname "$0")/.."
OUT=dist
rm -rf "$OUT" && mkdir -p "$OUT"
git archive --format=zip --prefix=HakiShow/ -o "$OUT/HakiShow-源代码.zip" HEAD -- . ':(exclude)deliverables'
for NAME in Team01-Lead-组长-HakiShow Team01-Member-组员1-HakiShow Team01-Member-组员2-HakiShow; do
  D="$OUT/$NAME"
  mkdir -p "$D"
  cp "$OUT/HakiShow-源代码.zip" "$D/1-HakiShow-源代码.zip"
  cp deliverables/HakiShow-项目答辩.pptx "$D/2-HakiShow-项目答辩.pptx"
  cp deliverables/HakiShow-项目介绍文档.pdf "$D/3-HakiShow-项目介绍文档.pdf"
  cp deliverables/HakiShow-演示讲解视频.mp4 "$D/4-HakiShow-演示讲解视频.mp4"
  cp deliverables/HakiShow-演示讲解视频.srt "$D/4-HakiShow-演示讲解视频.srt"
  cp deliverables/HakiShow-成员任务分工文档.pdf "$D/5-HakiShow-成员任务分工文档.pdf"
  python3 -c "import shutil, sys; shutil.make_archive(sys.argv[1], 'zip', sys.argv[2], sys.argv[3])" "$OUT/$NAME" "$OUT" "$NAME"
done
rm -f "$OUT/HakiShow-源代码.zip"
ls -la "$OUT"
