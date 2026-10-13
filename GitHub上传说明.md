# GitHub 上传说明

## 应该上传哪里

**将本文件所在的目录作为 GitHub 仓库根目录。** 不要上传外层原项目目录，也不要把本目录再嵌套一层作为仓库的唯一子目录。

此目录由明确的文件白名单整理：复制的业务源码、脚本、测试、依赖锁文件及必要资源保持原字节；根目录 README、忽略规则、本说明和文件清单为本次新建的发布材料。没有修改外层原项目文件。

没有复制 `.tools/`、`.pi/`、依赖、历史日志、个人数据、构建结果、安装包、历史设计稿或未逐张检查的历史截图。生成的 EPUB 也不提交；生成方法见 README。

## 方法一：GitHub Desktop

1. 在 GitHub Desktop 中创建本地仓库，把仓库路径设置为本文件所在目录；不要新建额外的嵌套目录。
2. 如果界面只允许添加现有仓库，可先按下面的命令执行 `git init`，再添加此目录。
3. 检查文件列表和差异，提交，然后点击 Publish repository。
4. 根据需要选择公开或私有。不要在客户端中添加真实密钥或个人资料文件。

## 方法二：Git 命令行

在本文件所在目录打开终端：

```bash
git init
git branch -M main
git add .
git status --short
git diff --cached --stat
git diff --cached
```

确认暂存内容只有清单内文件后：

```bash
git commit -m "Initial source release"
```

在 GitHub 创建一个空仓库；为了避免初次推送冲突，不自动添加 README、.gitignore 或 LICENSE。将下面地址替换为你自己的仓库地址：

```bash
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

仓库地址不是凭据。不要把密码或 Token 拼进地址，也不要将登录凭据写入仓库文件。

## 发布前确认

- `.gitignore` 是隐藏文件，上传时不要漏掉。Git 命令和 GitHub Desktop 会正常识别它。
- 第一次使用前运行 `npm ci`、`npm run demo` 和 `npm run guide:build`；不要把生成的 EPUB 或依赖反向加入提交。
- 业务源码中的默认设置、权限配置和数据库 schema 必须保留，它们不是个人设置。
- 测试中的虚构文本和假密钥可以保留；如果要求完全不出现任何示例文本，需要另行调整测试，不能直接删掉必需输入。
- 已检查的指南图片会显示示例书架、演示笔记和设置界面，但没有真实密钥或私人资料。
- 本次没有安装依赖或执行构建、浏览器测试、Rust 编译；文件复制和静态检查通过不等同于构建测试通过。
- 本目录没有替作者选择开源许可证。如希望授权他人使用、修改或分发，请先自行确定许可证并添加 `LICENSE`；公开仓库本身不等于授予开源许可。

## 今后更新

只同步真正修改的源码与必要资源，不要将原项目整个目录覆盖到这里。提交前始终查看 `git status` 和 `git diff --cached`。忽略规则不会消除已经提交的秘密，也不能识别源码中的硬编码密钥。
