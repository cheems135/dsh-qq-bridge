param(
  [string]$SdkRoot = $env:ANDROID_SDK_ROOT,
  [string]$JavaHome = $env:JAVA_HOME,
  [string]$OutputDirectory = (Join-Path $PSScriptRoot 'build'),
  [string]$SigningStore = '',
  [string]$SigningAlias = 'androiddebugkey',
  [string]$SigningPasswordEnvironment = 'DSH_COMPANION_SIGNING_PASSWORD',
  [switch]$Development
)
$ErrorActionPreference = 'Stop'
if (!$SdkRoot) { $SdkRoot = $env:ANDROID_HOME }
if (!$SdkRoot -or !$JavaHome) { throw '请指定 Android SDK 和 Java 17 以上路径：-SdkRoot 和 -JavaHome' }
$androidJar = Join-Path $SdkRoot 'platforms/android-35/android.jar'
$buildTools = Join-Path $SdkRoot 'build-tools/35.0.0'
# Also accept the isolated layout used during this task.
if (!(Test-Path $androidJar)) { $androidJar = Join-Path $SdkRoot 'platform/android-35/android.jar' }
if (!(Test-Path $buildTools)) { $buildTools = Join-Path $SdkRoot 'build/android-15' }
if (!(Test-Path $androidJar) -or !(Test-Path (Join-Path $buildTools 'aapt2.exe'))) { throw '缺少 Android 35 平台或 Build Tools 35.0.0' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
# Use a unique compilation directory: stale class files cannot enter a later build.
$scratch = Join-Path $OutputDirectory ('compile-' + [guid]::NewGuid().ToString('N'))
$classes = Join-Path $scratch 'classes'; $generated = Join-Path $scratch 'generated'; $dex = Join-Path $scratch 'dex'
New-Item -ItemType Directory -Force $classes,$generated,$dex | Out-Null
$oldJava = $env:JAVA_HOME
try {
  $env:JAVA_HOME = $JavaHome
  & (Join-Path $buildTools 'aapt2.exe') compile --dir (Join-Path $PSScriptRoot 'res') -o (Join-Path $scratch 'resources.zip')
  if ($LASTEXITCODE -ne 0) { throw '资源编译失败' }
  & (Join-Path $buildTools 'aapt2.exe') link -I $androidJar --manifest (Join-Path $PSScriptRoot 'AndroidManifest.xml') --java $generated -o (Join-Path $scratch 'resources.apk') (Join-Path $scratch 'resources.zip')
  if ($LASTEXITCODE -ne 0) { throw '资源链接失败' }
  $sources = @(Get-ChildItem (Join-Path $PSScriptRoot 'src'),$generated -Recurse -Filter '*.java' | ForEach-Object {$_.FullName})
  & (Join-Path $JavaHome 'bin/javac.exe') -encoding UTF-8 -source 8 -target 8 -Xlint:-options -classpath $androidJar -d $classes $sources
  if ($LASTEXITCODE -ne 0) { throw 'Java 编译失败' }
  $bytecode = @(Get-ChildItem $classes -Recurse -Filter '*.class' | ForEach-Object {$_.FullName})
  & (Join-Path $buildTools 'd8.bat') --lib $androidJar --min-api 26 --output $dex $bytecode
  if ($LASTEXITCODE -ne 0) { throw 'DEX 编译失败' }
  Copy-Item (Join-Path $scratch 'resources.apk') (Join-Path $scratch 'unsigned.apk')
  & (Join-Path $JavaHome 'bin/jar.exe') uf (Join-Path $scratch 'unsigned.apk') -C $dex classes.dex
  if ($LASTEXITCODE -ne 0) { throw 'DEX 写入失败' }
  & (Join-Path $buildTools 'zipalign.exe') -f 4 (Join-Path $scratch 'unsigned.apk') (Join-Path $scratch 'aligned.apk')
  if ($LASTEXITCODE -ne 0) { throw 'APK 对齐失败' }
  if ($Development) {
    if (!$SigningStore) { $SigningStore = Join-Path $OutputDirectory 'development.jks' }
    if (!(Test-Path $SigningStore)) {
      & (Join-Path $JavaHome 'bin/keytool.exe') -genkeypair -keystore $SigningStore -storepass android -keypass android -alias $SigningAlias -keyalg RSA -keysize 2048 -validity 3650 -dname 'CN=DSH Companion Development'
      if ($LASTEXITCODE -ne 0) { throw '开发签名生成失败' }
    }
    $signPass = 'pass:android'
  } else {
    if (!$SigningStore -or !(Test-Path $SigningStore) -or ![Environment]::GetEnvironmentVariable($SigningPasswordEnvironment)) { throw '正式构建需要现有签名文件及密码环境变量；临时开发构建可加 -Development' }
    $signPass = 'env:' + $SigningPasswordEnvironment
  }
  $apk = Join-Path $OutputDirectory 'DSH-Companion-0.1.3.apk'
  & (Join-Path $buildTools 'apksigner.bat') sign --ks $SigningStore --ks-key-alias $SigningAlias --ks-pass $signPass --out $apk (Join-Path $scratch 'aligned.apk')
  if ($LASTEXITCODE -ne 0) { throw 'APK 签名失败' }
  & (Join-Path $buildTools 'apksigner.bat') verify $apk
  if ($LASTEXITCODE -ne 0) { throw 'APK 签名校验失败' }
  $receipt = @{file=[IO.Path]::GetFileName($apk);sha256=(Get-FileHash $apk -Algorithm SHA256).Hash.ToLower();size=(Get-Item $apk).Length;developmentSigning=[bool]$Development;nativeDeviceVerified=$false}
  $receipt | ConvertTo-Json | Set-Content (Join-Path $OutputDirectory 'apk-build-receipt.json') -Encoding UTF8
  $receipt | ConvertTo-Json -Compress | Write-Output
} finally { $env:JAVA_HOME = $oldJava }
# Signing keys and compilation scratch are deliberately never copied into plugin packages.
