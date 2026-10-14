<#
  package-submission.ps1 —— 生成第 5 周实验的最终提交包

  产物：F:\Week5\Week05_Lab_5702126059_杨明辉.zip
  结构：week05_pendulum_sim/
            index.html            ← 最终完成的单文件交互应用程序
            README.md             ← 含「人机协同三反思」与 GitHub 链接
            scripts/ docs/ src/ data/ results/
            .gitignore build.sh commit_baseline.bat
            .git/                 ← 完整提交历史（6 次清晰 Commit）
          第5周-单摆实验-工作区说明.md

  用法（在仓库根 F:\Week5 执行）：
      powershell -NoProfile -ExecutionPolicy Bypass -File week05_pendulum_sim\scripts\package-submission.ps1

  设计说明：
  * **本仓库是"就地 init"**：仓库根就是 F:\Week5，`.git` 在仓库根而不是模块目录里。
    所以打包必须遍历**仓库根**，只遍历模块目录会把 .git 漏掉（提交历史就不完整了）。
  * 直接调 .NET 的 ZipFile：它能正确处理中文文件名 / UTF-8 实体名，
    Compress-Archive 在这个目录上处理中文与点开头文件时并不可靠。
  * 归档内路径分隔符强制用 '/'（zip 规范要求正斜杠），否则部分解压工具会出错。
  * 先在临时目录里生成再移动到目标位置，避免半成品 zip 覆盖掉上一次的成功产物。
  * 排除项只有两个：`.verify-tmp`（验证脚本的可再生产物，已在 .gitignore 里）
    与 `.git/ORIG_HEAD`（filter-branch 遗留的旧哈希引用，会让新鲜解压的仓库报错）。
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
$RepoRoot   = $RepoRoot.TrimEnd('\')
$ModuleName = 'week05_pendulum_sim'
$ModuleDir  = Join-Path $RepoRoot $ModuleName
if (-not (Test-Path $ModuleDir)) { throw "找不到实验模块目录：$ModuleDir" }

if (-not $OutDir) { $OutDir = $RepoRoot }
$ZipName = "Week05_Lab_${StudentId}_${StudentName}.zip"
$ZipPath = Join-Path $OutDir $ZipName

Write-Host "==> 打包第 5 周实验提交件" -ForegroundColor Cyan
Write-Host "    仓库根   : $RepoRoot"
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
Write-Host "    必需文件 : index.html / README.md（含三反思与 GitHub 章节）OK" -ForegroundColor Green

# .git 在**仓库根**（就地 init），不在模块目录里
$gitDir = Join-Path $RepoRoot '.git'
if (-not (Test-Path $gitDir)) { throw "找不到 .git：$gitDir（提交历史无法随包交付）" }

$commitCount = (& git -C $RepoRoot rev-list --count HEAD) 2>$null
if ($LASTEXITCODE -ne 0) { throw 'git rev-list 失败，仓库状态异常' }
$commitCount = [int]$commitCount
if ($commitCount -lt 3) { throw "提交历史只有 $commitCount 次，验收要求至少 3 次清晰 Commit" }
Write-Host "    提交历史 : $commitCount 次 commit（要求 >= 3）OK" -ForegroundColor Green

# ---------- 1. 组装文件清单 ----------
# 注意：过滤条件只能匹配**相对路径**，绝不能拿绝对路径去比 ——
# 路径里的 "week05_pendulum_sim" 会意外命中 *.verify-tmp* 这类通配符。
$allFiles  = @(Get-ChildItem -Path $RepoRoot -Recurse -File -Force)
$prefixLen = $RepoRoot.Length + 1
# 必须排除**产物自身**：包放在仓库内，若不排除，上一次的 zip 会被打进这一次，
# 体积每跑一次翻一倍（1.5MB → 3.0MB → 6.1MB…）。
$files = @($allFiles | Where-Object {
    $rel = $_.FullName.Substring($prefixLen).Replace('\', '/')
    $rel -notlike '.verify-tmp/*' -and
    $rel -notlike '*/ORIG_HEAD'   -and
    $_.Name -notlike 'Week05_Lab_*.zip'
})
Write-Host "    待打包   : $($files.Count) 个文件（共扫描 $($allFiles.Count) 个）"
if ($files.Count -lt 20) { throw "文件清单只扫到 $($files.Count) 个，过滤条件可能又出错了" }
if (-not ($files | Where-Object { $_.Name -eq 'HEAD' -and $_.Directory.Name -eq '.git' })) {
    throw '文件清单里没有 .git/HEAD，.git 没被扫进来'
}
if ($files | Where-Object { $_.Name -like '*.zip' }) {
    throw '文件清单里混入了 zip，产物自身排除失败'
}

# ---------- 2. 写入 zip ----------
$tmpZip = Join-Path ([System.IO.Path]::GetTempPath()) ("w05pack_" + [guid]::NewGuid().ToString('N') + ".zip")
$fs = [System.IO.File]::Open($tmpZip, [System.IO.FileMode]::CreateNew)
try {
    $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($f in $files) {
            $rel   = $f.FullName.Substring($prefixLen).Replace('\', '/')
            $entry = $zip.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
            $es = $entry.Open()
            try {
                $src = [System.IO.File]::OpenRead($f.FullName)
                try { $src.CopyTo($es) } finally { $src.Dispose() }
            } finally { $es.Dispose() }
        }
    } finally { $zip.Dispose() }
} finally { $fs.Dispose() }

# ---------- 3. 落位 ----------
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Move-Item -LiteralPath $tmpZip -Destination $ZipPath -Force

# ---------- 4. 回读校验 ----------
$verify = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
    $entries = $verify.Entries
    $total     = $entries.Count
    $hasIndex  = @($entries | Where-Object { $_.FullName -eq "$ModuleName/index.html" }).Count
    $hasReadme = @($entries | Where-Object { $_.FullName -eq "$ModuleName/README.md" }).Count
    $hasHead   = @($entries | Where-Object { $_.FullName -eq '.git/HEAD' }).Count
    $hasRef    = @($entries | Where-Object { $_.FullName -eq '.git/refs/heads/main' }).Count
    $gitCount  = @($entries | Where-Object { $_.FullName -like '.git/*' }).Count
    $objCount  = @($entries | Where-Object { $_.FullName -like '.git/objects/*' }).Count
    $rawTotal  = ($entries | Measure-Object -Property Length -Sum).Sum
} finally { $verify.Dispose() }

if ($hasIndex  -lt 1)  { throw '回读校验失败：zip 里没有 index.html' }
if ($hasReadme -lt 1)  { throw '回读校验失败：zip 里没有 README.md' }
if ($hasHead   -lt 1)  { throw '回读校验失败：zip 里没有 .git/HEAD，提交历史不完整' }
if ($hasRef    -lt 1)  { throw '回读校验失败：zip 里没有 .git/refs/heads/main，分支引用丢失' }
if ($objCount  -lt 10) { throw "回读校验失败：.git/objects 只有 $objCount 项，对象库不完整" }

$zipBytes = (Get-Item $ZipPath).Length
Write-Host ""
Write-Host "==> 完成" -ForegroundColor Green
Write-Host "    $ZipPath"
Write-Host ("    条目 {0} 个（.git 内 {1} 条、objects {2} 条）  压缩包 {3:N0} B  解压后 {4:N0} B" -f `
            $total, $gitCount, $objCount, $zipBytes, $rawTotal)
Write-Host ""
Write-Host "    自检清单："
Write-Host "      [OK] index.html        —— 单文件交互应用程序"
Write-Host "      [OK] README.md         —— 含人机协同三反思与 GitHub 链接"
Write-Host "      [OK] .git/ 提交历史    —— $commitCount 次 commit（objects $objCount 项）"
Write-Host "      [OK] scripts/ docs/    —— 验证脚本、打包脚本与渲染截图"
