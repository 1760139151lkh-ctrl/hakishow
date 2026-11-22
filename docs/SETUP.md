# 安装与运行

## 全新安装

安装 Node.js 22 或更新版本、Python 3.12 或更新版本，以及 uv。在 `HakiShow` 文件夹中打开终端：

```sh
npm ci
uv sync --locked
npm run build
uv run likeness serve --engine simulator
```

打开 `http://127.0.0.1:8787/`。选择一个示例，创建人像，编辑一个区域，发送一条对话指令，再打开作品库。模拟器不需要服务商凭据。模拟输出会在界面中标注。

源代码包包含完成上述安装所需的图像、字体、浏览器模型、源代码、锁定文件和配置示例。安装依赖时，需要能够访问相应的软件包仓库。

## 静态展示

```sh
npm run serve
```

打开 `http://127.0.0.1:4173/`。展示模式支持界面、本地浏览器效果和随附示例结果。服务端账户、同步记录和依赖服务端的图像任务，请使用 Python 工作室。通过 HTTP 提供文件夹内容；不要直接以文件方式打开 `index.html`。

## 配置

| 项目 | 含义 |
|---|---|
| `studio.toml` | 共用的引擎和画质默认值 |
| `private/studio.toml` | 使用相同表格结构的本地覆盖配置 |
| `.env.local` | 由命令行工具加载的本地 `KEY=value` 值 |
| `OPENAI_API_KEY` | 直接图像接口引擎所使用的凭据 |
| `OPENAI_BASE_URL` | 可选的兼容接口基础地址 |
| `LIKENESS_HOME` | 运行数据目录；默认为 `private/` |
| `LIKENESS_OWNER_LINK` | 设为 `1` 时，要求使用所有者私有访问链接 |
| `LIKENESS_OWNER_SECRET_FILE` | 链接命令所创建的所有者密钥文件路径 |

使用文件管理器将 `.env.example` 复制为 `.env.local`，或者在 POSIX 命令行中运行 `cp .env.example .env.local`。只填写所选模式需要的值。源代码交接包有意不包含本地配置值。

### 直接图像接口

检查 `studio.toml` 或本地覆盖配置中的 `[openai]` 及其速度／画质档位表。配置所选服务商账户能够使用的模型标识符，然后运行：

```sh
uv run likeness probe openai
uv run likeness serve --engine openai
```

探测命令会报告凭据／配置或接口端点问题。仅探测成功并不能证明每种生成模式都可用。在将其作为真实服务商结果展示之前，请使用已配置服务确认生成和局部编辑。

### 可选的命令式引擎

项目还保留了一个用于本地可用 Codex 命令行工具的适配器。其命令、参数、画质请求和超时值在 `[codex]` 下配置。

```sh
uv run likeness probe codex
uv run likeness serve --engine codex
```

常规模拟器安装不依赖此适配器。`--engine auto` 在存在密钥时选择直接图像引擎，否则选择可用的本地命令引擎，再否则选择模拟器；为了获得可预期的演示，请显式选择 `simulator`。可选的 `probe codex --smoke` 命令会生成真实图像，因此仅在确实打算进行这项检查时使用。

## 在局域网内的另一台设备上使用

```sh
uv run likeness serve --engine simulator --host 0.0.0.0 --port 8787
```

在另一台设备上打开服务器打印的配对地址。设备必须能够在同一网络中互相访问。网络演示可以使用上传和示例流程。手机相机拍摄需要可信的安全来源地址；对于强制执行这一要求的浏览器，普通局域网 HTTP 地址并不满足条件。

如果你的环境中已有可信证书：

```sh
uv run likeness serve --engine simulator --host 0.0.0.0 --port 8787 --cert private/cert.pem --key private/key.pem
```

使用证书覆盖的主机名／地址。虚拟机还需要相机直通和浏览器权限。如果其中任一条件不满足，先测试上传流程，并单独记录该设备的相机检查。

## 私有网站访问

当另行配置的 HTTPS 部署就绪后，创建其所有者链接：

```sh
uv run likeness link --base https://studio.example.com
```

按照命令输出的本地配置说明操作，重启工作室，并在每台预定设备上打开生成的链接。这条命令创建本地密钥和访问链接；不会发布网站，也不会开通 HTTPS 托管服务。将密钥和运行数据保留在源代码包之外。

## 检查

```sh
npm run check
npm run build
uv run pytest
npx playwright install chromium webkit
npm test
npm run accept
```

`npm test` 运行静态展示和模拟器流程。扩展套件检查滑块、每一种风格／细节选项、工具布局、键盘行为、安全区域、弹出面板和可见按钮反馈。安装 WebKit 运行环境后会包含 WebKit 检查。模拟相机样本会在 Chromium 中演练本地相机流程；它不是实体设备相机测试。

在 POSIX 命令行中单独运行一个扩展测试项目：

```sh
LIKENESS_ACCEPT=1 npx playwright test --project=accept
```

在 PowerShell 中，先设置 `$env:LIKENESS_ACCEPT='1'`，再运行对应的 Playwright 命令。交付包具体运行过哪些检查，请以[验证记录](VALIDATION.md)为准。

## 故障排查

| 现象 | 下一步操作 |
|---|---|
| 依赖安装失败 | 检查要求的运行环境版本和软件包仓库访问情况；使用已提交的锁定文件 |
| 打包后的页面看起来没有更新 | 运行 `npm run build`，然后重新加载；确认服务器使用的是当前项目文件夹 |
| 相机不可用 | 检查安全来源条件、权限、相机可用性和虚拟机直通；尝试示例或上传 |
| 输出被标记为示例或模拟结果 | 检查当前模式；选择并配置所需的工作室引擎 |
| 托管请求失败 | 阅读中文错误消息，检查本地凭据／模型配置，解决问题后再重试 |
| 手机无法访问服务器 | 检查主机绑定、地址、网络连通性和打印出的配对链接 |
| 另一会话看起来没有内容 | 检查账户身份和服务地址；浏览器本地数据与服务端同步数据是不同的 |
| 素材生成工具报告缺少原图 | 保留随附图像；重新构建派生素材前，先提供完整原始素材集 |

使用 `Ctrl+C` 停止本地服务器。被版本控制忽略的运行目录会保留个人会话和图像，直到所有者选择清除它们。

