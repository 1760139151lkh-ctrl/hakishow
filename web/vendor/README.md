# 随附运行时依赖

这些文件使浏览器能够从项目自身加载字体和本地视觉模型。

| 路径 | 内容 | 来源系列 | 许可证 |
|---|---|---|---|
| `mediapipe/vision_bundle.mjs`、`mediapipe/wasm/*` | MediaPipe Tasks Vision 的 JavaScript 和 WebAssembly 运行时 | `@mediapipe/tasks-vision` | Apache 2.0 许可证 |
| `mediapipe/face_landmarker.task` | 人像区域和跟踪所使用的面部关键点模型 | MediaPipe 面部关键点检测器，float16（16 位浮点） | Apache 2.0 许可证 |
| `mediapipe/hair_segmenter.tflite` | 用于受支持本地预览的头发分割模型 | MediaPipe 头发分割器，float32（32 位浮点） | Apache 2.0 许可证 |
| `../fonts/fraunces.woff2` | Fraunces 字体 | Fontsource／Google Fonts | SIL 开放字体许可证 1.1 |
| `../fonts/courier-prime.woff2`、`vt323.woff2`、`instrument-serif.woff2`、`space-grotesk.woff2`、`cinzel.woff2` | 各风格专用字体 | Google Fonts | SIL 开放字体许可证 1.1 |

随附运行时中已移除视觉构建包里指向缺失源映射文件的引用。浏览器通过 `web/js/core/face.js` 和 `web/js/live/tracker.js` 使用这些模型。这些本地视觉操作，与用户明确向工作室图像引擎发出的请求相互独立。

