# Wake the display from black-screen standby (no lock password on this machine).
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Wake {
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, int e);
}
"@
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
[Wake]::SetThreadExecutionState([uint32]"0x80000003") | Out-Null
[Wake]::mouse_event(0x0001, 0, 0, 0, 0)
Start-Sleep -Milliseconds 250
[Wake]::SetThreadExecutionState([uint32]"0x80000000") | Out-Null
Write-Output "display-woken"
