param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "命令失败（退出码 $LASTEXITCODE）：$Program $($Arguments -join ' ')" }
}

try {
    $Root = Split-Path -Parent $PSScriptRoot
    if ($env:OS -ne 'Windows_NT') { throw '请在原生 Windows PowerShell 中运行本脚本。' }
    $LocalToolchain = Join-Path $Root '.tools\windows-toolchain'
    if (Test-Path (Join-Path $LocalToolchain 'cargo\bin\cargo.exe')) {
        $env:CARGO_HOME = Join-Path $LocalToolchain 'cargo'
        $env:RUSTUP_HOME = Join-Path $LocalToolchain 'rustup'
        $env:PATH = (Join-Path $LocalToolchain 'cargo\bin') + ';' + $env:PATH
    }
    $Node = Get-Command node.exe -ErrorAction Stop
    $Npm = Get-Command npm.cmd -ErrorAction Stop
    $Runtime = (& $Node.Source -p 'JSON.stringify({platform:process.platform,arch:process.arch,node:process.versions.node})') | ConvertFrom-Json
    if ($Runtime.platform -ne 'win32' -or $Runtime.arch -ne 'x64') { throw '本脚本只构建 Windows x64 安装包，需要原生 x64 Node.js。' }
    if ([version]$Runtime.node -lt [version]'22.12.0') { throw 'Node.js 版本至少为 22.12.0。' }
    $NpmVersion = (& $Npm.Source --version).Trim()
    if ([version]$NpmVersion -lt [version]'11.0.0') { throw 'npm 版本至少为 11。' }
    $VersionJson = Invoke-Checked -Program $Node.Source -Arguments @((Join-Path $Root 'scripts\check-release-version.mjs'))
    $ReleaseInfo = ($VersionJson -join "`n") | ConvertFrom-Json
    $ReleaseVersion = $ReleaseInfo.version
    $ProductName = $ReleaseInfo.productName
    Write-Host "发布版本校验通过：$ProductName $ReleaseVersion"
    if ($CheckOnly) {
        Write-Host '仅检查版本与 Node/npm 环境，不安装依赖、不构建安装包、不修改用户数据。'
        return
    }
    $Cargo = Get-Command cargo.exe -ErrorAction SilentlyContinue
    $Rust = Get-Command rustc.exe -ErrorAction SilentlyContinue
    if (-not $Cargo -or -not $Rust) { throw '缺少 Rust / Cargo。请按 Windows应用打包与发布指南安装 Windows x64 MSVC Rust 工具链，重开终端后再试。' }
    $RustInfo = (& $Rust.Source -vV) -join "`n"
    if ($LASTEXITCODE -ne 0 -or $RustInfo -notmatch 'host: x86_64-pc-windows-msvc') { throw '请选择 Windows x64 MSVC Rust 工具链。' }

    # Fresh, project-owned workspace: no browser profile, existing build output or installed app data.
    $BuildId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
    $Workspace = Join-Path $Root ".tools\windows-build\$BuildId"
    New-Item -ItemType Directory -Path $Workspace -Force | Out-Null
    function Copy-ProductPath {
        param([string]$Relative)
        $Source = Join-Path $Root $Relative
        $Item = Get-Item -LiteralPath $Source -Force
        if (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "禁止复制链接：$Relative" }
        if ($Item.PSIsContainer) {
            $Links = @(Get-ChildItem -LiteralPath $Source -Recurse -Force | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 })
            if ($Links.Count) { throw "源码目录中存在链接，停止构建：$Relative" }
        }
        $Destination = Join-Path $Workspace $Relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
        Copy-Item -LiteralPath $Source -Destination $Destination -Recurse
    }
    foreach ($Relative in @('package.json', 'package-lock.json', 'tsconfig.json', 'index.html', 'vite.config.ts', 'src', 'scripts', 'docs\使用指南', 'src-tauri\Cargo.toml', 'src-tauri\build.rs', 'src-tauri\tauri.conf.json', 'src-tauri\src', 'src-tauri\capabilities', 'src-tauri\icons', 'public\books\user-guide.epub', 'public\demo\minimal.epub')) {
        Copy-ProductPath $Relative
    }
    # Unit-test input only; desktop publicDir is disabled and the release allowlist excludes this file.
    Copy-ProductPath 'public\demo\epub2.epub'
    if (Test-Path (Join-Path $Root 'src-tauri\Cargo.lock')) { Copy-ProductPath 'src-tauri\Cargo.lock' }

    Write-Host "正在构建 $ProductName $ReleaseVersion（Windows x64）"
    Write-Host "隔离构建目录：$Workspace"
    Write-Host '只复制产品源码、操作指南、自有样书和必要测试夹具；不读取或清理你的书架、笔记与草稿。'
    Write-Host 'EPUB 2 夹具仅用于单元测试，不进入安装包资源白名单。'
    $PreviousTargetDirectory = $env:CARGO_TARGET_DIR
    $env:CARGO_TARGET_DIR = Join-Path $Workspace 'src-tauri\target'
    Push-Location $Workspace
    try {
        # Validate the copied snapshot as well; never publish using metadata edited mid-build.
        $SnapshotJson = Invoke-Checked -Program $Node.Source -Arguments @('scripts/check-release-version.mjs')
        $SnapshotInfo = ($SnapshotJson -join "`n") | ConvertFrom-Json
        if ($SnapshotInfo.version -ne $ReleaseVersion -or $SnapshotInfo.productName -ne $ProductName -or $SnapshotInfo.identifier -ne $ReleaseInfo.identifier) {
            throw '隔离源码的发布信息与构建开始时不一致，请停止修改版本后重新打包。'
        }
        Invoke-Checked -Program $Npm.Source -Arguments @('ci')
        # Regenerate the guide from the copied source before tests inspect its contents.
        Invoke-Checked -Program $Npm.Source -Arguments @('run', 'guide:build')
        Invoke-Checked -Program $Npm.Source -Arguments @('test')
        Invoke-Checked -Program $Npm.Source -Arguments @('run', 'desktop:build')
        # Native AI transport / window-layout regression gate. Ignored paid API tests stay disabled.
        Write-Host '运行 Rust 单元测试（不调用真实 AI API、不读取用户密钥）。'
        Invoke-Checked -Program $Cargo.Source -Arguments @('test', '--locked', '--lib', '--manifest-path', 'src-tauri/Cargo.toml')
        Invoke-Checked -Program $Npm.Source -Arguments @('run', 'desktop:audit')
    } finally { Pop-Location; $env:CARGO_TARGET_DIR = $PreviousTargetDirectory }

    $Installers = @(Get-ChildItem -LiteralPath (Join-Path $Workspace 'src-tauri\target\release\bundle\nsis') -Filter '*.exe' -File)
    if (-not $Installers.Count) { throw '没有生成 NSIS 安装包，请检查上面的构建日志。' }
    $ExpectedInstallerName = "${ProductName}_${ReleaseVersion}_x64-setup.exe"
    if ($Installers.Count -ne 1 -or $Installers[0].Name -ne $ExpectedInstallerName) {
        throw "安装包名称或版本不符，预期仅生成：$ExpectedInstallerName"
    }
    $Release = Join-Path $Root "release\$ReleaseVersion\$BuildId"
    New-Item -ItemType Directory -Path $Release -Force | Out-Null
    $Checksums = @()
    foreach ($Installer in $Installers) {
        $Destination = Join-Path $Release $Installer.Name
        Copy-Item -LiteralPath $Installer.FullName -Destination $Destination
        $Checksums += (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLower() + '  ' + $Installer.Name
    }
    $Checksums | Set-Content -LiteralPath (Join-Path $Release 'SHA256SUMS.txt') -Encoding ASCII
    Copy-Item -LiteralPath (Join-Path $Workspace '.tools\windows-package-audit.json') -Destination (Join-Path $Release '产品资源清单.json')
    [ordered]@{
        version = $ReleaseVersion
        productName = $ProductName
        identifier = $ReleaseInfo.identifier
        buildId = $BuildId
        installer = $ExpectedInstallerName
        versions = $ReleaseInfo.versions
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $Release '发布版本.json') -Encoding UTF8
    if (-not (Test-Path (Join-Path $Root 'src-tauri\Cargo.lock'))) {
        Copy-Item -LiteralPath (Join-Path $Workspace 'src-tauri\Cargo.lock') -Destination (Join-Path $Root 'src-tauri\Cargo.lock')
    }
    @"
静读 $ReleaseVersion
这是未签名的 Windows x64 测试安装包，尚需在 Windows / WebView2 中进行安装、导出、关闭草稿与升级验收。
安装包不包含开发者或当前用户的书架、笔记、草稿、备份和浏览器数据。
只包含应用资源、静读操作指南和自有样书；首次启动不会自动导入它们，书架初始为空。
同一电脑同一用户覆盖升级时，用户已有桌面数据应保留，不会为了空书架而清库。
离线阅读不需要联网；AI 阅读助手仅在用户主动操作时联网，请自行配置 API Key，可能产生服务费用。
桌面记住密钥使用当前用户的 Windows 凭据管理器；安装包不包含 API Key，也不会迁移浏览器保存的密钥。
缺少 WebView2 的机器安装时需要联网补装运行库。未签名应用可能触发系统安全提示。
"@ | Set-Content -LiteralPath (Join-Path $Release '安装与数据说明.txt') -Encoding UTF8
    Write-Host "安装包及校验值已输出到：$Release"
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
}
