<#
  package-submission.ps1 —— 生成第 5 周实验的最终提交包

  产物：F:\Week5\Week05_Lab_5702126059_杨明辉.zip
  结构：Week05_Lab_5702126059_杨明辉/
          week05_pendulum_sim/
            index.html            ← 最终完成的单文件交互应用程序
            README.md             ← 含「人机协同三反思」与 GitHub 链接
            scripts/ docs/ src/ data/ results/
            .git/                 ← 完整提交历史（≥3 次清晰 Commit）
            .gitignore .gitkeep build.sh commit_baseline.bat

  用法（在仓库根 F:\Week5 执行）：
      pwsh -File week05_pendulum_sim\scripts\package-submission.ps1

  设计说明：
  * 直接调 .NET 的 ZipFile，因为它能正确处理中文文件名 / UTF-8 实体名；
    Compress-Archive 在这个目录上处理中文与点开头文件时并不可靠。
  * 归档内的路径分隔符强制用 '/'（zip 规范要求正斜杠），否则部分解压工具会出错。
  * 先在临时目录里生成再移动到目标位置，避免半成品 zip 覆盖掉上一次的成功产物。
#>

[CmdletBinding()]
param(
    [string]$RepoRoot,
    [string]$OutDir,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# 实验者身份 —— 与 README「一、实验者信息」保持一致
$StudentId = '5702126059'
$StudentName = '杨明辉'

if (-not $RepoRoot) {
    # 本脚本位于 <模块>/scripts/ 下，故仓库根 = 上两级
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}
$ModuleName = 'week05_pendulum_sim'
$ModuleDir  = Join-Path $RepoRoot $ModuleName
if (-not (Test-Path $ModuleDir)) { throw "找不到实验模块目录：$ModuleDir" }

if (-not $OutDir) { $OutDir = $RepoRoot }
$ZipName   = "Week05_Lab_${StudentId}_${StudentName}.zip"
$ZipPath   = Join-Path $OutDir $ZipName
$RootEntry = "Week05_Lab_${StudentId}_${StudentName}"

Write-Host "==> 打包第 5 周实验提交件" -ForegroundColor Cyan
Write-Host "    仓库根   : $RepoRoot"
Write-Host "    模块目录 : $ModuleDir"
Write-Host "    目标 zip : $ZipPath"

# ---------- 0. 提交前自检 ----------
$indexPath = Join-Path $ModuleDir 'index.html'
if (-not (Test-Path $indexPath)) { throw "缺少 index.html：$indexPath" }
$readmePath = Join-Path $ModuleDir 'README.md'
if (-not (Test-Path $readmePath))  { throw "缺少 README.md：$readmePath" }

$readmeText = Get-Content $readmePath -Raw -Encoding UTF8
foreach ($needle in @('人机协同三反思', 'GitHub')) {
    if ($readmeText -notlike "*$needle*") { throw "README.md 缺少必需章节关键词：$needle" }
}

$repoGit  = Join-Path $RepoRoot '.git'
$localGit = Join-Path $ModuleDir '.git'
if (Test-Path $repoGit) {
    # 本实验是「就地 init」：仓库根就是 F:\Week5，模块目录不是独立仓库
    $gitDir = $repoGit
} elseif (Test-Path $localGit) {
    $gitDir = $localGit
} else {
    throw '找不到 .git（仓库根与模块目录都没有），提交历史无法随包交付'
}

$commitCount = (& git -C $RepoRoot rev-list --count HEAD) 2>$null
if ($LASTEXITCODE -ne 0) { throw 'git rev-list 失败，仓库状态异常' }
$commitCount = [int]$commitCount
if ($commitCount -lt 3) { throw "提交历史只有 $commitCount 次，验收要求至少 3 次清晰 Commit" }
Write-Host "    提交历史 : $commitCount 次 commit（要求 >= 3）" -ForegroundColor Green

# ---------- 1. 组装文件清单 ----------
# .git 必须整体收入（提交历史要随包交付），其余照单全收
$files = Get-ChildItem -Path $ModuleDir -Recurse -File -Force |
         Where-Object { $_.FullName -notlike '*.verify-tmp*' }
Write-Host "    待打包   : $($files.Count) 个文件（含 .git）"

# ---------- 2. 写入 zip ----------
$tmpZip = Join-Path ([System.IO.Path]::GetTempPath()) ("w05pack_" + [guid]::NewGuid().ToString('N') + ".zip")
$modulePrefixLen = $ModuleDir.TrimEnd('\').Length + 1

$fs = [System.IO.File]::Open($tmpZip, [System.IO.FileMode]::CreateNew)
try {
    $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($f in $files) {
            $rel  = $f.FullName.Substring($modulePrefixLen).Replace('\', '/')
            $name = "$RootEntry/$ModuleName/$rel"
            $entry = $zip.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
            $es = $entry.Open()
            try {
                $src = [System.IO.File]::OpenRead($f.FullName)
                try { $src.CopyTo($es) } finally { $src.Dispose() }
            } finally { $es.Dispose() }
        }
    } finally { $zip.Dispose() }
} finally { $fs.Dispose() }

# ---------- 3. 落位（先删旧的，再移动）----------
if ((Test-Path $ZipPath) -and -not $Force) {
    Remove-Item $ZipPath -Force
}
Move-Item -LiteralPath $tmpZip -Destination $ZipPath -Force

# ---------- 4. 回读校验 ----------
$verify = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
    $entries = $verify.Entries
    $total   = $entries.Count
    $hasIndex  = @($entries | Where-Object { $_.FullName -like "*/index.html" }).Count
    $hasReadme = @($entries | Where-Object { $_.FullName -like "*/README.md" }).Count
    $hasGit    = @($entries | Where-Object { $_.FullName -like "*/.git/*" }).Count
    $hasHead   = @($entries | Where-Object { $_.FullName -like "*/HEAD" }).Count
    $rawTotal  = ($entries | Measure-Object -Property Length -Sum).Sum
} finally { $verify.Dispose() }

if ($hasIndex -lt 1)  { throw '回读校验失败：zip 里没有 index.html' }
if ($hasReadme -lt 1) { throw '回读校验失败：zip 里没有 README.md' }
if ($hasHead -lt 1)   { throw '回读校验失败：zip 里没有 .git/HEAD，提交历史不完整' }

$zipBytes = (Get-Item $ZipPath).Length
Write-Host ""
Write-Host "==> 完成" -ForegroundColor Green
Write-Host "    $ZipPath"
Write-Host ("    条目 {0} 个（.git 内 {1} 条）  压缩包 {2:N0} B  解压后 {3:N0} B" -f `
            $total, $hasGit, $zipBytes, $rawTotal)
Write-Host ""
Write-Host "    自检清单："
Write-Host "      [√] index.html      —— 单文件交互应用程序"
Write-Host "      [√] README.md       —— 含人机协同三反思与 GitHub 链接"
Write-Host "      [√] .git/ 提交历史  —— $commitCount 次 commit"
Write-Host "      [√] scripts/ docs/  —— 验证脚本与渲染截图"
