param(
 [Parameter(Mandatory=$true)][uint32]$TargetPid,
 [Parameter(Mandatory=$true)][string]$CreatedTicks,
 [Parameter(Mandatory=$true)][string]$ExpectedExe
)
$ErrorActionPreference='Stop'
$proc=Get-CimInstance Win32_Process -Filter ("ProcessId="+$TargetPid) -ErrorAction Stop
if(!$proc -or $proc.Name -ine 'QQ.exe' -or $proc.ExecutablePath -ine $ExpectedExe -or $proc.CreationDate.ToUniversalTime().Ticks.ToString() -ne $CreatedTicks){Write-Output 'QQ_PROCESS_ENDED';return}
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$ae=[System.Windows.Automation.AutomationElement]
$scope=[System.Windows.Automation.TreeScope]
$conditions=[System.Windows.Automation.AndCondition]::new(
 [System.Windows.Automation.PropertyCondition]::new($ae::ProcessIdProperty,[int]$TargetPid),
 [System.Windows.Automation.PropertyCondition]::new($ae::ClassNameProperty,'#32770')
)
$static=[System.Windows.Automation.PropertyCondition]::new($ae::ClassNameProperty,'Static')
# Match only QQ's installation-error sentence in a dialog belonging to the recorded process.
foreach($window in $ae::RootElement.FindAll($scope::Children,$conditions)){
 foreach($label in $window.FindAll($scope::Descendants,$static)){
  $value=$label.Current.Name.Trim()
  if($value -match '^\u6587\u4ef6\u5df2\u635f\u574f\s*[,.\uFF0C\u3002]\s*\u8bf7\u91cd\u65b0\u5b89\u88c5\s*QQ[\u3002.!]?$'){
   Write-Output 'QQ_FILE_DAMAGED'
   return
  }
 }
}
