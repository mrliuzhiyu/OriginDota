# parse-replay.ps1
# 把 .dem 录像 POST 到 OpenDota Parser (Docker 在 5600)，得到 JSONL 事件流
#
# 用法：
#   .\tools\parse-replay.ps1 -DemPath "C:\path\to\replay.dem"
#   .\tools\parse-replay.ps1 -DemPath ".\replays\内战201.dem"
#
# 输出: .\parsed\<basename>.jsonl

param(
    [Parameter(Mandatory=$true)]
    [string]$DemPath,

    [string]$ParserUrl = "http://localhost:5600/"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $DemPath)) {
    Write-Host "ERROR: 文件不存在: $DemPath" -ForegroundColor Red
    exit 1
}

$DemPath = (Resolve-Path $DemPath).Path
$projectRoot = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $projectRoot "parsed"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$baseName = [System.IO.Path]::GetFileNameWithoutExtension($DemPath)
$outPath = Join-Path $outDir "$baseName.jsonl"

$inputSize = (Get-Item $DemPath).Length / 1MB
Write-Host ""
Write-Host "===== OpenDota Parser =====" -ForegroundColor Cyan
Write-Host "录像: $DemPath ($('{0:N2}' -f $inputSize) MB)"
Write-Host "输出: $outPath"
Write-Host "Parser: $ParserUrl"
Write-Host ""

# 检查 parser 在线
try {
    $health = Invoke-WebRequest -Uri $ParserUrl -Method GET -UseBasicParsing -TimeoutSec 5
    Write-Host "✓ Parser 在线 (HTTP $($health.StatusCode))" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Parser 没启动。先跑 docker ps 看 odota-parser 在不在。" -ForegroundColor Red
    Write-Host "重启命令: docker start odota-parser" -ForegroundColor Yellow
    exit 1
}

Write-Host "解析中（大文件可能要 1–5 分钟）..." -ForegroundColor Yellow
$startTime = Get-Date

# 用 curl.exe POST 二进制文件（Windows 10+ 自带）
& curl.exe -s --max-time 600 --data-binary "@$DemPath" -H "Content-Type: application/octet-stream" -o $outPath $ParserUrl

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: curl 失败 (exit $LASTEXITCODE)" -ForegroundColor Red
    exit 1
}

$elapsed = (Get-Date) - $startTime
$outSize = (Get-Item $outPath).Length / 1MB
$lineCount = (Get-Content $outPath -ReadCount 0 | Measure-Object -Line).Lines

Write-Host ""
Write-Host "✓ 解析完成" -ForegroundColor Green
Write-Host "  耗时: $('{0:N1}' -f $elapsed.TotalSeconds) 秒"
Write-Host "  输出: $('{0:N2}' -f $outSize) MB / $lineCount 行事件"
Write-Host ""
Write-Host "下一步: node tools\aggregate.mjs `"$outPath`"" -ForegroundColor Cyan
