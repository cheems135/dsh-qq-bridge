param([switch]$PlanOnly)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local-service-startup.ps1')
$work = 'D:\CodexData\work\qq-local-background-services'
New-Item -ItemType Directory -Force -Path $work | Out-Null
$mutex = New-Object System.Threading.Mutex($false, 'Local\QQBridgeLocalServiceStartup')
$locked = $false
$results = @()
$failed = $false
try {
    try { $locked = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw 'Startup is already in progress. Wait for the first startup window.' }
    $settingsFile = Join-Path $env:USERPROFILE '.dsh\im-bridge\settings.json'
    $settings = Read-StartupJson $settingsFile
    $gatewayPort = if ($env:LOCAL_AI_PORT) { [int]$env:LOCAL_AI_PORT } else { 8777 }
    $gateway = 'http://127.0.0.1:' + $gatewayPort
    $comfy = if ($settings.comfyui.baseUrl) { $settings.comfyui.baseUrl } else { 'http://127.0.0.1:8188' }
    $configFile = if ($env:LOCAL_AI_CONFIG_FILE) { $env:LOCAL_AI_CONFIG_FILE } else { Join-Path $env:LOCALAPPDATA 'local-ai-config.json' }
    if (Test-Path -LiteralPath $configFile) {
        $savedConfig = Read-StartupJson $configFile
        if ($savedConfig.comfyUrl) { $comfy = $savedConfig.comfyUrl }
    }
    # Prefer the effective gateway URL if it is already available.
    try { $config = Invoke-RestMethod ($gateway + '/config') -TimeoutSec 2; if ($config.comfyUrl) { $comfy = $config.comfyUrl } } catch {}
    $voice = if ($env:VOICE_URL) { $env:VOICE_URL } else { 'http://127.0.0.1:7870' }
    $labels = @{ comfy='图片与本地模型服务'; voice='语音服务'; gateway='本地桥接' }
    $states = @{ reused='已运行，直接连接'; started='后台启动成功'; 'would-start'='尚未启动，启动路径已准备' }
    foreach ($kind in @('comfy','voice','gateway')) {
        try {
            $origin = switch ($kind) { 'comfy' { $comfy } 'voice' { $voice } 'gateway' { $gateway } }
            # Reuse is checked before installation discovery, including manual launches.
            if (Test-LocalServiceReady $kind $origin) {
                $result = [pscustomobject]@{service=$kind;state='reused';origin=$origin}
            } elseif ($kind -eq 'gateway') {
                if ($PlanOnly) { $result = [pscustomobject]@{service=$kind;state='would-start';origin=$origin} }
                else {
                    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start-local-ai.ps1') | Out-Host
                    if ($LASTEXITCODE -ne 0 -or -not (Test-LocalServiceReady $kind $origin)) { throw 'Gateway startup failed. Existing processes were left running.' }
                    $result = [pscustomobject]@{service=$kind;state='started';origin=$origin}
                }
            } else {
                $spec = if ($kind -eq 'comfy') { Get-ComfyStartupSpec $comfy } else { Get-VoiceStartupSpec $voice $settings.comfyui.localVoiceDir $work }
                $result = Start-LocalService $spec $work -PlanOnly:$PlanOnly
            }
            $results += $result
            Write-Host ($labels[$kind] + '：' + $states[$result.state] + ' ' + $origin)
        } catch {
            $failed = $true
            $results += [pscustomobject]@{service=$kind;state='error';message=$_.Exception.Message}
            Write-Host ($labels[$kind] + '启动未完成：' + $_.Exception.Message) -ForegroundColor Red
        }
    }
    if (-not $PlanOnly) { $results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $work 'startup-status.json') -Encoding UTF8 }
    Write-Host ('启动状态和日志：' + $work)
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
if ($failed) { exit 1 }
