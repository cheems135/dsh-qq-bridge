$ErrorActionPreference='Stop'

[Console]::InputEncoding=New-Object System.Text.UTF8Encoding $false

[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding $false

$request=[Console]::In.ReadToEnd()|ConvertFrom-Json

Add-Type -AssemblyName System.Windows.Forms

Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @'

using System;using System.Runtime.InteropServices;using System.Text;

public static class BridgeDesktop {

 [DllImport("user32.dll")]public static extern bool SetProcessDPIAware();

 [DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);

 [DllImport("user32.dll")]public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);

 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();

 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder s,int count);

 [DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);

 [DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int cmd);

 [StructLayout(LayoutKind.Sequential)]public struct INPUT {public uint type;public InputUnion U;}

 [StructLayout(LayoutKind.Explicit)]public struct InputUnion {[FieldOffset(0)]public KEYBDINPUT ki;[FieldOffset(0)]public MOUSEINPUT mi;}

 [StructLayout(LayoutKind.Sequential)]public struct KEYBDINPUT {public ushort wVk,wScan;public uint dwFlags,time;public UIntPtr dwExtraInfo;}

 [StructLayout(LayoutKind.Sequential)]public struct MOUSEINPUT {public int dx,dy;public uint mouseData,dwFlags,time;public UIntPtr dwExtraInfo;}

 [DllImport("user32.dll",SetLastError=true)]public static extern uint SendInput(uint n,INPUT[] input,int size);

 public static void TypeUnicode(string text){foreach(char c in text){if(c=='\r')continue;ushort key=c=='\n'?(ushort)13:c=='\t'?(ushort)9:(ushort)0;var a=new INPUT[2];a[0].type=a[1].type=1;a[0].U.ki.wVk=a[1].U.ki.wVk=key;a[0].U.ki.wScan=a[1].U.ki.wScan=key==0?c:(ushort)0;a[0].U.ki.dwFlags=key==0?4u:0u;a[1].U.ki.dwFlags=a[0].U.ki.dwFlags|2u;if(SendInput(2,a,Marshal.SizeOf(typeof(INPUT)))!=2)throw new Exception("Unicode input was blocked by the foreground application");}}

 [DllImport("user32.dll")]public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);

}

'@

[void][BridgeDesktop]::SetProcessDPIAware()

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BridgeWake {
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, int e);
}
'@

function Invoke-BridgeWake {
  [BridgeWake]::SetThreadExecutionState([uint32]'0x80000003') | Out-Null
  [BridgeWake]::mouse_event(1, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 250
  [BridgeWake]::SetThreadExecutionState([uint32]'0x80000000') | Out-Null
  return [bool](Get-Process -Name LogonUI -ErrorAction SilentlyContinue)
}


$window=[BridgeDesktop]::GetForegroundWindow()

if($request.windowId -and $request.action -notin @('wake','observe','windows','focus') -and [string]$window.ToInt64() -ne [string]$request.windowId){throw '前台窗口已经改变，请重新观察后操作'}

if($request.action -in @('click','type','press') -and (Get-Process -Name LogonUI -ErrorAction SilentlyContinue)){throw 'Windows 安全锁屏，需要本人解锁；自动化不能绕过密码或 PIN'}

if($request.action -eq 'windows'){

 $windows=@(Get-Process|Where-Object {$_.MainWindowHandle -ne 0}|ForEach-Object {@{windowId=[string]$_.MainWindowHandle.ToInt64();title=$_.MainWindowTitle;application=$_.ProcessName}})

 @{ok=$true;windows=$windows}|ConvertTo-Json -Depth 6 -Compress

 exit

}

function Desktop-Shortcuts {

 $roots=@([Environment]::GetFolderPath('DesktopDirectory'),[Environment]::GetFolderPath('CommonDesktopDirectory'))|Where-Object {$_ -and (Test-Path -LiteralPath $_)}|Select-Object -Unique

 foreach($root in $roots){Get-ChildItem -LiteralPath $root -File -Force|Where-Object {$_.Extension -in @('.lnk','.url')}|ForEach-Object {$_}}

}

switch($request.action){

 'shortcuts' {

  $items=@(Desktop-Shortcuts|ForEach-Object {@{name=$_.Name;label=$_.BaseName;kind=$_.Extension;location=if($_.DirectoryName -eq [Environment]::GetFolderPath('CommonDesktopDirectory')){'public-desktop'}else{'user-desktop'}}})

  @{ok=$true;environment='user-desktop';shortcuts=$items;note='只列实际桌面快捷方式，不枚举安装程序或开始菜单'}|ConvertTo-Json -Depth 5 -Compress;exit

 }

 'launch-shortcut' {

  $name=[string]$request.shortcut

  if(!$name -or [IO.Path]::GetFileName($name) -ne $name -or $name -match '[\\/:*?"<>|]'){throw '快捷方式名称无效'}

  $items=@(Desktop-Shortcuts|Where-Object {$_.Name -eq $name})

  if($items.Count -ne 1){throw '桌面没有唯一匹配的快捷方式，请重新列出并确认名称'}

  $shortcut=$items[0]

  if($shortcut.Extension -eq '.lnk'){

   $shell=New-Object -ComObject WScript.Shell;$link=$shell.CreateShortcut($shortcut.FullName);$target=[Environment]::ExpandEnvironmentVariables([string]$link.TargetPath)

   if([IO.Path]::GetExtension($target) -ne '.exe' -or [IO.Path]::GetFileNameWithoutExtension($target) -match '^(?:cmd|powershell|pwsh|wscript|cscript|mshta|rundll32|regsvr32)$'){throw '该快捷方式执行脚本或系统命令，需本人另外确认'}

   if(!(Test-Path -LiteralPath $target -PathType Leaf)){throw '该桌面快捷方式的目标已不存在'}

  }else{

   $line=Get-Content -LiteralPath $shortcut.FullName|Where-Object {$_ -match '^URL='}|Select-Object -First 1

   $uri=[Uri]($line -replace '^URL=','');if($uri.Scheme -notin @('http','https') -or $uri.UserInfo){throw '该网页快捷方式的地址不适合自动打开'}

  }

  Start-Process -FilePath $shortcut.FullName -WindowStyle Hidden

 }

 'wake' {

  $locked=Invoke-BridgeWake

  $note=if($locked){'显示器已唤醒，但当前是 Windows 安全锁屏，需要本人解锁；自动化不能绕过密码或 PIN。'}else{'显示器已唤醒，可以继续观察和操作。'}

  @{ok=$true;environment='user-desktop';action='wake';display='woken';locked=$locked;note=$note}|ConvertTo-Json -Depth 4 -Compress;exit

 }

 'observe' {

  $locked=Invoke-BridgeWake

  if($locked){@{ok=$true;environment='user-desktop';locked=$true;display='woken';file=$null;note='显示器已唤醒，但仍是 Windows 安全锁屏；请本人解锁后再操作，自动化不能绕过密码或 PIN。'}|ConvertTo-Json -Depth 4 -Compress;exit}

 }

 'launch' {

  switch([string]$request.app){

   'browser' {if($request.url){Start-Process -FilePath ([string]$request.url) -WindowStyle Hidden}else{Start-Process -FilePath 'msedge.exe' -WindowStyle Hidden}}

   'notepad' {Start-Process -FilePath 'notepad.exe' -WindowStyle Hidden}

   'calculator' {Start-Process -FilePath 'calc.exe' -WindowStyle Hidden}

   'explorer' {Start-Process -FilePath 'explorer.exe' -WindowStyle Hidden}

   default {throw 'Unsupported application'}

  }

 }



 'click' {

  [void][BridgeDesktop]::SetCursorPos([int]$request.x,[int]$request.y)

  if($request.button -eq 'right'){$down=8;$up=16}else{$down=2;$up=4}

  [BridgeDesktop]::mouse_event($down,0,0,0,[UIntPtr]::Zero);[BridgeDesktop]::mouse_event($up,0,0,0,[UIntPtr]::Zero)

  if($request.double -eq $true){[BridgeDesktop]::mouse_event($down,0,0,0,[UIntPtr]::Zero);[BridgeDesktop]::mouse_event($up,0,0,0,[UIntPtr]::Zero)}

 }

 'scroll' {

  if($null -ne $request.x -and $null -ne $request.y){[void][BridgeDesktop]::SetCursorPos([int]$request.x,[int]$request.y)}

  $amount=[Math]::Max(-3600,[Math]::Min(3600,[int]$request.amount))

  [BridgeDesktop]::mouse_event(0x0800,0,0,[BitConverter]::ToUInt32([BitConverter]::GetBytes($amount),0),[UIntPtr]::Zero)

 }

 'type' {

  $text=[string]$request.text

  [BridgeDesktop]::TypeUnicode($text)

 }

 'press' {

  $keys=[string]$request.key

  if($keys -notmatch '^[a-zA-Z0-9 +_-]{1,60}$'){throw '按键组合无效'}

  $parts=$keys.Split('+');$prefix='';$last=$parts[-1]

  foreach($part in $parts[0..([Math]::Max(0,$parts.Length-2))]){if($parts.Length -eq 1){break};switch($part.ToLower()){'ctrl'{$prefix+='^'}'control'{$prefix+='^'}'alt'{$prefix+='%'}'shift'{$prefix+='+'}default{throw '不支持的组合键'}}}

  $mapping=@{enter='ENTER';escape='ESC';esc='ESC';tab='TAB';backspace='BACKSPACE';delete='DELETE';up='UP';down='DOWN';left='LEFT';right='RIGHT';home='HOME';end='END';pageup='PGUP';pagedown='PGDN';space=' '}

  if($mapping.ContainsKey($last.ToLower())){$name=$mapping[$last.ToLower()];if($name -ne ' '){$name='{'+$name+'}'}}elseif($last -match '^F(?:[1-9]|1[0-2])$'){$name='{'+$last+'}'}elseif($last -match '^[a-zA-Z0-9]$'){$name=$last}else{throw '不支持的按键'}

  [System.Windows.Forms.SendKeys]::SendWait($prefix+$name)

 }

 'focus' {

  $handle=[IntPtr]([long]$request.focusWindowId)

  [void][BridgeDesktop]::ShowWindow($handle,9);[void][BridgeDesktop]::SetForegroundWindow($handle)

 }

 default {throw '不支持的电脑操作'}

}

Start-Sleep -Milliseconds 180

$screen=[System.Windows.Forms.SystemInformation]::VirtualScreen

$bitmap=New-Object System.Drawing.Bitmap $screen.Width,$screen.Height

$graphics=[System.Drawing.Graphics]::FromImage($bitmap)

try{$graphics.CopyFromScreen($screen.Left,$screen.Top,0,0,$bitmap.Size);$bitmap.Save([string]$request.file)}finally{$graphics.Dispose();$bitmap.Dispose()}

$window=[BridgeDesktop]::GetForegroundWindow();$title=New-Object System.Text.StringBuilder 1024;[void][BridgeDesktop]::GetWindowText($window,$title,1024)

$controls=@();$focused=$null

try{Add-Type -AssemblyName UIAutomationClient; $root=[System.Windows.Automation.AutomationElement]::FromHandle($window);$all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)

 for($i=0;$i -lt $all.Count -and $controls.Count -lt 100;$i++){ $e=$all.Item($i);$v=$e.Current;if($v.IsOffscreen -or $v.IsPassword){continue};$rect=$v.BoundingRectangle;if($rect.Width -lt 3 -or $rect.Height -lt 3){continue};$kind=$v.ControlType.ProgrammaticName;if($kind -notmatch 'Edit|Button|ComboBox|Hyperlink|Document|TabItem'){continue};$controls+=@{label=$v.Name;type=$kind;automationId=$v.AutomationId;x=[int]$rect.X;y=[int]$rect.Y;width=[int]$rect.Width;height=[int]$rect.Height;focused=$v.HasKeyboardFocus} }

 $f=[System.Windows.Automation.AutomationElement]::FocusedElement;if($f){$v=$f.Current;$focused=@{label=$v.Name;type=$v.ControlType.ProgrammaticName;password=$v.IsPassword}}

}catch{}

@{ok=$true;environment='user-desktop';controls=$controls;focused=$focused;file=[string]$request.file;width=$screen.Width;height=$screen.Height;originX=$screen.Left;originY=$screen.Top;windowId=[string]$window.ToInt64();title=$title.ToString();note='已执行并重新截屏，按实际画面判断任务是否完成'}|ConvertTo-Json -Depth 5 -Compress

