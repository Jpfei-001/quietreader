# 内置操作指南的文件说明

面向日常使用者的正文是 [静读操作指南.md](./静读操作指南.md)，内容包括 16 个操作章节和欢迎页（共 17 章），配有 15 张当前界面截图。新增 AI 配置、选文问答／引用、模式／保存回答与隐私计费说明；AI 回答图明确标注为模拟操作示例，使用虚拟密钥，不发送真实付费请求。正文没有安装依赖、开发服务、调试或内部数据库说明。

## 文件

- `静读操作指南.md`：唯一正文来源，先编辑这里，再生成 EPUB。
- `images/`：自有示例书在正式构建界面中拍摄的操作截图，以及指南封面。
- `../../public/books/user-guide.epub`（项目根目录下的 `public/books/user-guide.epub`）：生成的内置 EPUB。文件内包含完整图片、目录、样式和封面，不依赖外部图片网址。
- `scripts/create-user-guide.mjs`：将 Markdown 与图片生成 EPUB，固定 ZIP 时间；相同内容重复生成的文件字节一致，避免重复书籍。
- `scripts/capture-user-guide.mjs`：使用新的浏览器环境，在独立的正式预览端口拍摄；不使用真实书架、不读取真实用户资料、不复用正常用户服务。

## 应用中的使用方式

书架标题区提供“使用指南”入口。打开后，内置 EPUB 按普通书籍的导入流程保存到书架：可继续阅读、保存进度、跳转目录、标注和写思考。重复打开同一份指南不增加副本；用户删除后，可以从“使用指南”入口主动重新添加。

旧版指南已进入书架后是独立的本地副本，不自动覆盖或删掉。更新应用后点击首页“使用指南”才能打开当前随附的新版；新版内容改变会得到新书籍标识，旧版的笔记、草稿及阅读位置保留。需要只更新阅读材料，也可导入项目的新版 `public/books/user-guide.epub`。

没有在启动时强制导入，也不会因为用户删除指南而自动恢复书架条目。

## 后续维护

正文修改后：

```bash
npm run guide:build
npm run guide:check
npm run build
```

界面更新、需要重拍截图时：

```bash
npm run build
npm run guide:screenshots
npm run guide:build
npm run guide:check
npm run build
```

截图脚本依赖已安装的 Playwright Chromium，并使用 `GUIDE_CAPTURE_PORT` 指定的独立端口（默认 1457）。截图完成后会自行关闭预览服务。截图中的书籍是自有示例，标注与思考通过界面操作创建，不含私人内容。AI 配置、提问和保存操作也通过当前界面完成，服务请求完全拦截返回标注过的模拟回答；不打开用户官网登录页、不读取个人密钥、不请求付费 API。截图配置输入框为空，已保存密钥不回显。

`npm run build` 会先生成指南，然后执行原来的类型检查与前端构建。Vite 会把 `public/books/user-guide.epub` 复制到 `dist/books/user-guide.epub`。桌面构建使用独立命令 `npm run desktop:frontend` 与 `dist-desktop`，禁用整个 `public` 目录复制，通过白名单将指南放入 `dist-desktop/books/user-guide.epub`。安装包不包含用户现有书籍、笔记或草稿；指南只在用户点击后加入书架。新版指南随完整 Windows 0.3.7 包发布，见 `docs/Windows打包执行记录.md`。

生成器缺少正文图片时会直接报错，不生成缺图 EPUB。`guide:check` 会逐项比对打包内容与 Markdown、图片，防止两者不同步。
