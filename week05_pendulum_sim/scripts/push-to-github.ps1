<#
.SYNOPSIS
    把 F:\Week5 课程仓库同步到 GitHub，并自动把远端地址回填进 README。

.DESCRIPTION
    一条命令搞定"配置远端 → 回填 README 链接 → 提交 → 推送"。
    脚本是幂等的：重复执行只会确认状态，不会产生重复提交，也不会重复加远端。

.PARAMETER RepoUrl
    GitHub 仓库地址，支持两种写法：
      完整地址 : https://github.com/你的用户名/Week05_Lab.git
      简写     : 你的用户名/Week05_Lab

.PARAMETER RemoteName
    远端名，默认 origin。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File week05_pendulum_sim\scripts\push-to-github.ps1 -RepoUrl 你的用户名/Week05_Lab

.NOTES
    认证：GitHub 已停用账号密码。第一次 push 会弹出 Git Credential Manager
    的登录窗口（浏览器授权或粘贴 Personal Access Token），那是正常流程。
    本脚本不会读取、打印或保存你的任何凭据。
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RepoUrl,

    [string]$RemoteName = 'origin'
)

$ErrorActionPreference = 'Stop'

function Fail($msg) { Write-Host "`n[错误] $msg" -ForegroundColor Red; exit 1 }
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }

# ---------- 0. 定位仓库根 ----------
Step '定位仓库根'
$RepoRoot = (& git rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $RepoRoot) { Fail '当前目录不在 git 仓库里，请在 F:\Week5 下执行' }
$RepoRoot = $RepoRoot.Trim()
Ok "仓库根: $RepoRoot"

$ReadmePath = Join-Path $RepoRoot 'week05_pendulum_sim\README.md'
if (-not (Test-Path $ReadmePath)) { Fail "找不到 README: $ReadmePath" }

# ---------- 1. 归一化远端地址 ----------
Step '解析远端地址'
$raw = $RepoUrl.Trim()
$raw = $raw -replace '\.git$', ''

if ($raw -match '^https?://') {
    $CloneUrl = "$raw.git"
    $WebUrl   = $raw
} elseif ($raw -match '^[\w.\-]+/[\w.\-]+$') {
    $CloneUrl = "https://github.com/$raw.git"
    $WebUrl   = "https://github.com/$raw"
} else {
    Fail "地址看不懂：'$RepoUrl'`n        请给 https://github.com/用户名/仓库名.git 或 用户名/仓库名"
}

# 只允许 https，避免不小心把 SSH 地址塞进来后认证方式对不上
if ($CloneUrl -notmatch '^https://') { Fail "只支持 https 地址，收到：$CloneUrl" }
# 明确拒绝把 token 写进地址，防止凭据落进 .git/config 和提交历史
if ($CloneUrl -match '@') { Fail '地址里含有 @（疑似嵌了用户名/令牌）。请不要把令牌写进 URL，交给凭据管理器处理。' }

Ok "clone 地址: $CloneUrl"
Ok "网页地址  : $WebUrl"

# ---------- 2. 工作树必须干净，否则先让你处理 ----------
Step '检查工作树'
$dirty = & git -C $RepoRoot status --porcelain
if ($dirty) {
    Write-Host '    以下改动尚未提交：' -ForegroundColor Yellow
    $dirty | ForEach-Object { Write-Host "      $_" -ForegroundColor Yellow }
    Fail '请先提交或撤销这些改动，再运行本脚本（脚本只在干净工作树上回填 README，避免误提交半成品）'
}
Ok '工作树干净'

# ---------- 3. 配置远端（幂等）----------
Step "配置远端 $RemoteName"
$existing = (& git -C $RepoRoot remote get-url $RemoteName 2>$null)
if ($LASTEXITCODE -eq 0 -and $existing) {
    $existing = $existing.Trim()
    if ($existing -eq $CloneUrl) {
        Ok "已存在且一致: $existing"
    } else {
        & git -C $RepoRoot remote set-url $RemoteName $CloneUrl
        Ok "已更新: $existing  ->  $CloneUrl"
    }
} else {
    & git -C $RepoRoot remote add $RemoteName $CloneUrl
    Ok "已添加: $CloneUrl"
}

# ---------- 4. 回填 README 链接 ----------
Step '回填 README 的 GitHub 地址'
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
$text = [System.IO.File]::ReadAllText($ReadmePath)
$placeholder = 'https://github.com/<你的用户名>/<仓库名>'

if ($text -notmatch [regex]::Escape($placeholder)) {
    Ok 'README 里已无占位符，跳过回填'
} else {
    $text = $text.Replace($placeholder, $WebUrl)
    # 顺带把"push 后把实际的地址替换到这里"这句提示语改掉
    $text = $text.Replace('远端仓库地址（push 后把实际的 GitHub 地址替换到这里）：', '远端仓库地址（已推送）：')
    [System.IO.File]::WriteAllText($ReadmePath, $text, $utf8Bom)
    Ok "已回填: $WebUrl"
}

# ---------- 5. 若 README 有变化则提交 ----------
Step '提交 README 变更'
& git -C $RepoRoot add -- 'week05_pendulum_sim/README.md' | Out-Null
$staged = & git -C $RepoRoot diff --cached --name-only
if ($staged) {
    & git -C $RepoRoot commit -m 'docs(week05): fill in GitHub portfolio repository URL' | Out-Null
    Ok '已提交 docs(week05): fill in GitHub portfolio repository URL'
} else {
    Ok 'README 无变化，无需提交'
}

# ---------- 6. 推送前的最终体检 ----------
Step '推送前体检'
$branch = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD).Trim()
$count  = [int](& git -C $RepoRoot rev-list --count HEAD)
$authors = (& git -C $RepoRoot log --format='%an') | Sort-Object -Unique
Ok "分支    : $branch"
Ok "提交数  : $count"
Ok "作者    : $($authors -join ', ')"
if ($count -lt 3) { Fail "提交数只有 $count，不满足'至少 3 次清晰 Commit'" }
if ($authors.Count -ne 1) { Fail "提交作者不唯一：$($authors -join ' / ')" }

# 远端仓库存在性预检：git push 对"私有/不存在"统一回 403 并要账号密码，
# 报错信息极具误导性，所以先用一次匿名 HTTP 请求探一下，把话说清楚。
Step '预检远端仓库是否已创建'
$probe = "$WebUrl/info/refs?service=git-upload-pack"
$probeOk = $false
try {
    $resp = Invoke-WebRequest -Uri $probe -Method Head -TimeoutSec 12 -UseBasicParsing -ErrorAction Stop
    $probeOk = $true
    Ok "远端仓库可达（HTTP $($resp.StatusCode)）"
} catch {
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    if ($code -eq 404) {
        Fail @"
远端仓库不存在（HTTP 404）：$WebUrl
        请先在 GitHub 上新建这个仓库，再重新运行本脚本。
        建仓库时务必【不要】勾选 "Add a README file" —— 勾了远端会先有一个提交，
        本地历史与它无关，push 会被拒（non-fast-forward）。
"@
    } elseif ($code -eq 401 -or $code -eq 403) {
        # 私有仓库匿名访问也会是 401/403，这是正常的，不代表仓库不存在
        Ok "远端返回 HTTP $code（私有仓库或需认证，属正常，继续）"
    } else {
        Write-Host "    [提示] 预检未能完成（$($_.Exception.Message)）" -ForegroundColor Yellow
        Write-Host "           可能是网络/TLS 限制，不阻塞，继续尝试 push。" -ForegroundColor Yellow
    }
}
if (-not $probeOk) { Write-Host '    （预检未确认可达，push 结果以下一步为准）' -ForegroundColor DarkGray }

# ---------- 7. 推送 ----------
Step "推送到 $RemoteName/$branch"
Write-Host '    若弹出 Git Credential Manager 登录窗口，请在浏览器完成授权或粘贴 PAT。' -ForegroundColor Yellow
& git -C $RepoRoot push -u $RemoteName $branch 2>&1 | ForEach-Object { "    $_" }
if ($LASTEXITCODE -ne 0) {
    Fail @"
push 失败。常见原因与对策：
      - 远端仓库不存在或名字拼错  -> 核对 $WebUrl
      - 远端不是空仓库（有初始 README/许可证）
        -> 用 git pull --rebase origin $branch 合并后重推，或删掉远端仓库重建一个空的
      - 认证被取消 / 令牌缺 repo 权限 -> 重新运行，弹出窗口时完成授权
      - 仓库名或用户名大小写不符      -> GitHub 对用户名不区分大小写，但路径要对
"@
}

# ---------- 8. 推送后复验 ----------
Step '推送后复验'
& git -C $RepoRoot fetch $RemoteName 2>$null | Out-Null
$localHead  = (& git -C $RepoRoot rev-parse HEAD).Trim()
$remoteHead = (& git -C $RepoRoot rev-parse "$RemoteName/$branch" 2>$null)
$remoteHead = if ($remoteHead) { $remoteHead.Trim() } else { '' }

if ($remoteHead -eq $localHead) {
    Ok "本地与远端 HEAD 一致: $($localHead.Substring(0,7))"
    Write-Host "`n[完成] 已同步到 $WebUrl" -ForegroundColor Green
} else {
    Write-Host "`n[注意] 远端 HEAD ($remoteHead) 与本地 ($localHead) 不一致，请检查。" -ForegroundColor Yellow
    exit 1
}
