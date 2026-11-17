param([ValidateSet('capture','window')][string]$Mode='capture',[string]$BaseUrl,[string]$Key,[string]$Token,[string]$StateFile)
$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Windows.Forms,System.Drawing,System.Net.Http,System.Web.Extensions
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'companion-native.cs'),[Text.Encoding]::UTF8)
Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Net.Http,System.Web.Extensions
if($Mode -eq 'capture'){[DSHCompanion.NativeScreen]::Serve()}else{[DSHCompanion.CompanionWindow]::Run($BaseUrl,$Key,$Token,$StateFile)}
