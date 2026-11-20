# 屏幕陪伴安卓组件 0.1.3

独立 APK，保留官方 DSH Go。需要 Android 8.0 及以上。仅连接 `127.0.0.1` 上的桥接插件，不保存或读取模型 API 密钥、QQ 密码与聊天数据库。

## 使用

在插件的手机识屏页点击「安装屏幕陪伴组件」，在浏览器下载 APK 后打开并确认安装。装好后回插件点「连接跨应用悬浮球」，再通过浏览器的连接页打开组件。授权悬浮窗并选择系统共享范围后开始。浏览器无法唤起组件时，可以复制连接信息，在组件里粘贴。连接信息有效两分钟。

球形窗口支持拖动、展开、收起、关闭；展开页显示真实会话状态、最近画面时间、分析次数和最近对话。输入按钮打开原生输入页，按住录音后使用插件的 API 识别连接转成草稿，确认才发送。输入页不会主动断开屏幕共享。

MediaProjection 持续提供画面，组件按省流、均衡、细看预算压缩最新帧并上传到本机插件。旧帧覆盖，不排队；模型理解按插件原有间隔执行，不是每帧调用模型。暂停切断显示输出，结束释放投影。系统受保护画面可能无法捕获。不提供系统音轨或自动游戏操作。

## 构建

安装 Java 17+、Android SDK Platform 35、Build Tools 35.0.0 后，在 PowerShell 运行：

```powershell
./build.ps1 -SdkRoot '你的Android SDK目录' -JavaHome '你的Java目录' -OutputDirectory 'D:/CodexData/outputs/dsh-companion-build' -Development
```

开发签名用于当前验证包；以后覆盖更新必须使用同一签名文件。正式分发可指定 `-SigningStore`、`-SigningAlias`，并将签名密码放在 `DSH_COMPANION_SIGNING_PASSWORD` 环境变量中，不加 `-Development`。签名文件和密码不可放入插件包或公共仓库。

## 协议

- `dshcompanion://connect#base=...&ticket=...`：一次性配对入口，片段中无 API 密钥。
- `POST /im-bridge/mobile-overlay`：claim 换取仅内存保存的 Bearer；其余请求需要 Bearer。
- start / status / frame / input / transcribe / pause / resume / stop / disconnect。
- frame、输入和转写需要当前会话 id；配对绑定账号与人设。每次请求刷新五分钟闲置期限，重新配对撤销旧连接。
- 帧为 JPEG，长边最大 640/768/1024，最多 768 KiB，附捕获时间及 16×9 灰度签名；服务端会再次检查。

已在真实手机验证跨应用显示、实际采集、文字输入与测试回复、暂停/恢复和关闭释放；真实麦克风与付费视觉/ASR尚未验证。
