param([Parameter(Mandatory=$true)][ValidatePattern('^\d{5,12}$')][string]$Account,[Parameter(Mandatory=$true)][string]$NapcatDir,[string]$LaunchRecord='')
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NapcatConsoleWindows {
 public delegate bool WindowCallback(IntPtr h, IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumWindows(WindowCallback callback, IntPtr p);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder name, int count);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int state);
}
'@
$napcatAll=@(Get-CimInstance Win32_Process)
$napcatPattern='(?:^|\s)(?:-q|--qq)\s+"?'+$Account+'"?(?=\s|$)'
$napcatRoots=@($napcatAll | Where-Object { $_.Name -in @('cmd.exe','powershell.exe','NapCatWinBootMain.exe') -and $_.CommandLine -match $napcatPattern -and $_.CommandLine.IndexOf($NapcatDir,[StringComparison]::OrdinalIgnoreCase) -ge 0 })
$napcatIds=[Collections.Generic.HashSet[uint32]]::new()
foreach($napcatProcess in $napcatRoots){[void]$napcatIds.Add($napcatProcess.ProcessId)}
if($LaunchRecord -and (Test-Path -LiteralPath $LaunchRecord)){
 $napcatRecord=Get-Content -LiteralPath $LaunchRecord -Raw | ConvertFrom-Json
 foreach($napcatProcess in $napcatAll){if($napcatRecord.qq -eq $Account -and $napcatProcess.Name -eq 'QQ.exe' -and $napcatProcess.ProcessId -eq $napcatRecord.pid -and $napcatProcess.ExecutablePath -eq $napcatRecord.exe -and $napcatProcess.CreationDate.ToUniversalTime().Ticks.ToString() -eq $napcatRecord.createdTicks){[void]$napcatIds.Add($napcatProcess.ProcessId)}}
}
do {$napcatChanged=$false;foreach($napcatProcess in $napcatAll){if($napcatIds.Contains($napcatProcess.ParentProcessId) -and $napcatIds.Add($napcatProcess.ProcessId)){$napcatChanged=$true}}} while($napcatChanged)
$script:napcatHidden=0
$script:napcatRemaining=0
$napcatCallback=[NapcatConsoleWindows+WindowCallback]{param($window,$unused)
 [uint32]$windowProcess=0;[void][NapcatConsoleWindows]::GetWindowThreadProcessId($window,[ref]$windowProcess)
 if($napcatIds.Contains($windowProcess) -and [NapcatConsoleWindows]::IsWindowVisible($window)){
  $windowClass=[Text.StringBuilder]::new(128);[void][NapcatConsoleWindows]::GetClassName($window,$windowClass,128)
  if($windowClass.ToString() -eq 'ConsoleWindowClass'){[void][NapcatConsoleWindows]::ShowWindow($window,0);$script:napcatHidden++;if([NapcatConsoleWindows]::IsWindowVisible($window)){$script:napcatRemaining++}}
 }
 return $true
}
[void][NapcatConsoleWindows]::EnumWindows($napcatCallback,[IntPtr]::Zero)
@{hidden=$script:napcatHidden;visibleAfterHide=$script:napcatRemaining;matchedProcesses=$napcatIds.Count}|ConvertTo-Json -Compress
