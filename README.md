# 静读 · Quiet Reader

离线优先的 EPUB 阅读器，支持本地书架、阅读进度、划线与高亮、思考笔记、笔记备份，以及可选的 DeepSeek AI 阅读助手。包含 React / TypeScript 浏览器版和 Tauri / Rust Windows 桌面版。

当前源码版本：**0.3.7**。

## 环境

- Node.js ≥ 22.12.0，npm ≥ 11。
- 浏览器版不需要 Rust。
- Windows 桌面开发和打包需要原生 Windows x64 Node.js、Rust MSVC 工具链、C++ Build Tools 和 WebView2。

## 首次运行

此仓库只保留源码与必要资源，不提交生成的 EPUB。克隆后，在仓库根目录依次执行：

```bash
npm ci
npm run demo
npm run guide:build
npm run dev
```

打开终端显示的本机地址。首次生成资源后，也可使用 `启动静读.cmd` 启动浏览器版。

`npm run demo` 从项目自有文本生成 EPUB 2 / EPUB 3 / 安全测试样书；`npm run guide:build` 从 `docs/使用指南/` 的 Markdown 和示例图片生成内置指南。二者不会导入你的书架或读取个人笔记。

## 构建与测试

完成上述首次资源生成后：

```bash
npm test
npm run build
```

浏览器端到端测试需要先安装 Playwright 浏览器：

```bash
npx playwright install chromium
npm run test:e2e
```

Windows 桌面开发：

```bash
npm run desktop:dev
```

在原生 Windows 环境中打包：

```bash
npm run desktop:package
```

也可双击 `打包Windows.cmd`。桌面打包前必须完成首次资源生成。安装包生成在 `release/`，该目录不提交源码仓库。

## 源码结构

- `src/`：前端界面、EPUB 阅读、数据仓库与平台适配。
- `src-tauri/`：Rust 原生功能、桌面权限配置及应用图标。
- `scripts/`：资源生成、构建、诊断和发布校验脚本。
- `tests/`：Playwright 回归测试；单元测试也位于 `src/` 和 `scripts/`。
- `docs/使用指南/`：内置指南正文和使用自有样书制作的示例图片。
- `public/demo/README.md`：自有测试样书说明；EPUB 文件由脚本生成。

## 数据与密钥

仓库不包含个人书籍、书架、阅读进度、正式笔记、草稿、浏览器配置目录或真实 API Key。测试代码中的假密钥、虚构笔记和默认设置是测试与应用逻辑的一部分，不是个人使用数据。

个人书架及阅读设置保存在浏览器或桌面 WebView 的本地存储中。AI 功能需要用户自行配置密钥；主动提问会将选文和相关上下文发送至 DeepSeek，并可能计费。离线阅读不需要配置 AI。

指南图片中的笔记和 AI 回答是演示内容，不是私人数据。应用图标与这些指南来源图片是必要资源，因此保留在仓库中。

`.gitignore` 排除了生成资源、依赖、构建产物、日志、本机代理记录、环境文件和常见凭据文件。但它不能检测写在源码里的秘密，提交前仍应检查暂存内容。

关于上传方式和完整文件清单，请参阅 `GitHub上传说明.md` 与 `上传文件清单.md`。
