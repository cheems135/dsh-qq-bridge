param([switch]$Restart)
$ErrorActionPreference = 'Stop'
$serviceRoot = Split-Path -Parent $PSScriptRoot
$serviceFile = Join-Path $serviceRoot 'local-model-server.mjs'
$servicePort = if ($env:LOCAL_AI_PORT) { [int]$env:LOCAL_AI_PORT } else { 8777 }
$serviceOrigin = 'http://127.0.0.1:' + $servicePort
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $servicePort -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($serviceProcessId in $listeners) {
    $serviceProcess = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $serviceProcessId)
    if (-not $serviceProcess.CommandLine -or $serviceProcess.CommandLine.IndexOf($serviceFile, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw "Port $servicePort belongs to another process. It was left running."
    }
    if (-not $Restart) {
        $existingHealth = Invoke-RestMethod ($serviceOrigin + '/health') -TimeoutSec 10
        if ($existingHealth.version -eq '1.58.3') { Write-Output ('local-ai ready: ' + $serviceOrigin); exit 0 }
        throw 'An older gateway is still running. When idle, use tools/start-local-ai.ps1 -Restart to update it.'
    }
    $restartStatus = Invoke-RestMethod ($serviceOrigin + '/v1/local/status') -TimeoutSec 5
    if (@($restartStatus.execution.active).Count -gt 0 -or $restartStatus.comfyQueue.running -gt 0 -or $restartStatus.comfyQueue.pending -gt 0) { throw 'Local tasks are running. Gateway restart deferred; existing tasks were left running.' }
    Stop-Process -Id $serviceProcessId -ErrorAction Stop
}
$serviceWork = 'D:\CodexData\workspaces\2026-11-04\qq\work\local-ai-runtime'
New-Item -ItemType Directory -Force -Path $serviceWork | Out-Null
$env:LOCAL_AI_WORK_DIR = $serviceWork
$env:LOCAL_AI_LOG_FILE = Join-Path $serviceWork 'local-ai.log'
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
# Enable task-scoped cancellation only when the installed ComfyUI server explicitly supports prompt_id.
$env:LOCAL_COMFY_TARGETED_INTERRUPT = '0'
$comfyServerSource = 'C:\Users\cheems\AppData\Local\Programs\ComfyUI\resources\ComfyUI\server.py'
if (Test-Path -LiteralPath $comfyServerSource) {
    $comfyServerText = Get-Content -LiteralPath $comfyServerSource -Raw
    if ($comfyServerText -match "prompt_id = json_data.get\('prompt_id'\)" -and $comfyServerText -match 'if item\[1\] == prompt_id:') { $env:LOCAL_COMFY_TARGETED_INTERRUPT = '1' }
}
$serviceChild = Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + $serviceFile + '"') -WorkingDirectory $serviceRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $serviceWork 'local-ai.out.log') -RedirectStandardError (Join-Path $serviceWork 'local-ai.err.log') -PassThru
for ($serviceAttempt = 0; $serviceAttempt -lt 40; $serviceAttempt++) {
    $serviceChild.Refresh()
    if ($serviceChild.HasExited) { throw ('Gateway exited. See ' + (Join-Path $serviceWork 'local-ai.err.log')) }
    try {
        $serviceConfig = Invoke-RestMethod ($serviceOrigin + '/config') -TimeoutSec 1
        if ($serviceConfig.ok) { Write-Output ('local-ai ready: ' + $serviceOrigin); exit 0 }
    } catch {}
    Start-Sleep -Milliseconds 250
}
throw 'Gateway did not become ready. Check the local-ai logs.'
