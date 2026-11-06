function Read-StartupJson($File) {
    try { return (Get-Content -LiteralPath $File -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop) }
    catch { throw "Cannot read startup configuration: $File" }
}

function Test-LocalServiceReady($Kind, $Origin) {
    try {
        $endpoint = switch ($Kind) { 'comfy' { '/system_stats' } 'voice' { '/api/status' } 'gateway' { '/health' } }
        $data = Invoke-RestMethod ($Origin.TrimEnd('/') + $endpoint) -TimeoutSec 2
        switch ($Kind) {
            'comfy' { return ($null -ne $data.system -and $null -ne $data.devices) }
            'voice' { return ($null -ne $data.phase -and $null -ne $data.busy -and $null -ne $data.pid) }
            'gateway' { return ($data.ok -eq $true -and $null -ne $data.version) }
        }
    } catch { return $false }
    return $false
}

function Test-ConfiguredVoiceReady($Service, $Origin) {
    if (-not $Service) { return (Test-LocalServiceReady 'voice' $Origin) }
    $endpoint = if ($Service.statusPath) { $Service.statusPath } elseif ($Service.type -eq 'voicelab') { '/api/status' } elseif ($Service.type -eq 'openai') { 'models' } else { '' }
    if (-not $endpoint) { return $false }
    try {
        $base = [uri]($Origin.TrimEnd('/') + '/')
        $url = [uri]::new($base, [string]$endpoint)
        if ($url.Authority -ne $base.Authority -or $url.Scheme -ne $base.Scheme) { return $false }
        $headers = @{}
        if ($Service.apiKey) { $headers.Authorization = 'Bearer ' + $Service.apiKey }
        $null = Invoke-RestMethod $url.AbsoluteUri -Headers $headers -MaximumRedirection 0 -TimeoutSec 2
        return $true
    } catch { return $false }
}

function Test-StartupSpecReady($Spec) {
    if ($Spec.Kind -eq 'voice' -and $Spec.VoiceService) { return (Test-ConfiguredVoiceReady $Spec.VoiceService $Spec.Origin) }
    return (Test-LocalServiceReady $Spec.Kind $Spec.Origin)
}

function Get-LocalServicePort($Origin) {
    $uri = [uri]$Origin
    if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'http' -or $uri.Host -notin @('127.0.0.1','localhost','[::1]')) {
        throw 'Automatic startup only supports a local HTTP service address.'
    }
    return $uri.Port
}

function Start-LocalService($Spec, $LogDirectory, [int]$WaitSeconds = 180, [switch]$PlanOnly) {
    $port = Get-LocalServicePort $Spec.Origin
    if (Test-StartupSpecReady $Spec) {
        return [pscustomobject]@{ service=$Spec.Kind; state='reused'; origin=$Spec.Origin }
    }
    if ($PlanOnly) { return [pscustomobject]@{ service=$Spec.Kind; state='would-start'; origin=$Spec.Origin } }
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) { throw "Port $port is occupied or the service is still starting. No process was stopped. Try again shortly." }
    foreach ($required in @($Spec.Executable, $Spec.Directory) + @($Spec.Required)) {
        if (-not $required -or -not (Test-Path -LiteralPath $required)) { throw "Required startup path is missing: $required" }
    }
    $previous = @{}
    try {
        foreach ($key in $Spec.Environment.Keys) {
            $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
            [Environment]::SetEnvironmentVariable($key, $Spec.Environment[$key], 'Process')
        }
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
        $outLog = Join-Path $LogDirectory ($Spec.Kind + '-' + $stamp + '.out.log')
        $errLog = Join-Path $LogDirectory ($Spec.Kind + '-' + $stamp + '.err.log')
        $child = Start-Process -FilePath $Spec.Executable -ArgumentList $Spec.Arguments -WorkingDirectory $Spec.Directory -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
    } finally {
        foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
    }
    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    do {
        if (Test-StartupSpecReady $Spec) {
            return [pscustomobject]@{ service=$Spec.Kind; state='started'; origin=$Spec.Origin; pid=$child.Id; stdout=$outLog; stderr=$errLog }
        }
        $child.Refresh()
        if ($child.HasExited) { throw "Service exited. See $errLog" }
        Start-Sleep -Milliseconds 700
    } while ((Get-Date) -lt $deadline)
    throw "Service is still starting; it was left running. See $errLog"
}

function Get-ComfyStartupSpec($Origin) {
    $desktopRoot = Join-Path $env:APPDATA 'Comfy Desktop'
    $installed = Read-StartupJson (Join-Path $desktopRoot 'installations.json')
    # The Desktop document may be an array or contain an installations array.
    $entries = if ($installed -is [array]) { $installed } else { $installed.installations }
    $port = Get-LocalServicePort $Origin
    $matches = @($entries | Where-Object { $_.sourceId -ne 'cloud' -and $_.status -eq 'installed' -and $_.launchArgs -match "--port\s+$port(\s|$)" })
    if ($matches.Count -ne 1) { throw 'Cannot uniquely identify the local ComfyUI installation for this port. Start it manually once and check Desktop installation settings.' }
    $instance = $matches[0]
    $source = Join-Path $instance.installPath 'ComfyUI'
    $data = $instance.adoptedBaseDir
    $python = $instance.adoptedPythonPath
    $paths = Join-Path $desktopRoot ('instance-model-paths\' + $instance.id + '.yaml')
    $args = '-s "' + (Join-Path $source 'main.py') + '" --listen 127.0.0.1 --port ' + $port + ' --base-directory "' + $data + '" --user-directory "' + (Join-Path $data 'user') + '" --extra-model-paths-config "' + $paths + '" --input-directory "' + $instance.inputDir + '" --output-directory "' + $instance.outputDir + '" --database-url "sqlite:///' + (Join-Path $data 'user\comfyui.db') + '"'
    return @{ Kind='comfy'; Origin=$Origin; Executable=$python; Directory=$instance.installPath; Arguments=$args; Required=@((Join-Path $source 'main.py'),$data,$paths); Environment=@{} }
}

function Get-VoiceStartupSpec($Origin, $VoiceDirectory, $LogDirectory) {
    $app = Join-Path $VoiceDirectory 'app'
    return @{ Kind='voice'; Origin=$Origin; Executable=(Join-Path $VoiceDirectory 'python\python.exe'); Directory=$app
        Arguments=('"' + (Join-Path $app 'server\app.py') + '" --host 127.0.0.1 --port ' + (Get-LocalServicePort $Origin) + ' --no-watch-console')
        Required=@((Join-Path $app 'server\app.py'))
        Environment=@{ PYTHONPATH=(Join-Path $app 'repo'); HF_HUB_OFFLINE='1'; TRANSFORMERS_OFFLINE='1'; TOKENIZERS_PARALLELISM='false'; BREEZE_LOG_DIR=$LogDirectory; BREEZE_CONSOLE_LEVEL='WARNING'; BREEZE_PREIMPORT='0' }
    }
}
