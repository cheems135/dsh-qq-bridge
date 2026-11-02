# dsh-im-bridge · QQ ⇄ DeepSeek Harness

把 DeepSeek Harness 接到 QQ 上：用 NapCat（OneBot 11）当网关，你的 DSH 会话就是她的脑子，QQ 是她的嘴。附带一个 28 页的管理面板，人设、记忆、声音、生图、设备权限全部可视化配置。

> 她在 QQ 里跟你聊天时，背后是一个真正的 DSH Session —— 同一套人设、同一套记忆、同一套工具能力，只是把出口从浏览器换成了 QQ。

---

## 它是什么

- **双向桥接**：NapCat 的 WebSocket → 桥接 → `sessionController` 创建/续聊 DSH 会话 → 回复拆成多条发回 QQ
- **像人一样说话**：回复按 `|||` 或空行拆成多个气泡，间隔 0.6–2.8 秒，模拟打字节奏
- **一个面板管全部**：28 个页面、5 个分组（她的小世界 / 消息中心 / 认识她 / 声音与照片 / 系统设置）

## 这版能做什么

### 聊天与人格
- 内置 `whale` 人设预设（大米鲸鱼娘），可在面板直接改文本
- 多套人设 + 「角色档案」：给单个联系人或群单独指定人设、模型、声音
- 底层性格、情绪状态（会衰减）、人设成长与称呼
- 试聊预览：不经过 QQ，直接问一次模型看语气

### 记忆与日常
- 按轮数压缩对话，本地全文检索（MiniSearch）按需召回，不上传
- 记忆星图、私人手账、每天的小日程
- 她自己写计划、自己开始/结束活动；「计划睡眠」不等于已睡着
- 学习记录：从对话里攒语言与知识观察，只作证据、不训练权重

### 表达：表情 / 语音 / 唱歌 / 生图
- 本地表情库、分组、联网搜图、按关键词采集素材、表情含义学习
- 语音：`[语音]` → 甜妹（edge-tts）/ MiniMax / Breeze TTS 2（官方或自建 vLLM-Omni）/ 自定义 HTTP / SAPI
- 听语音：语音消息转文字（硅基流动 SenseVoice，需填同一个 Key）
- 唱歌：按已确认的歌谱与逐字示范合成，不拿歌名当旋律
- 生图：硅基流动（Kolors）或 RunningHub 工作流 / AI App，支持参考图

### 看视频 / 听音乐 / 读网页
- QQ 视频抽帧看画面，只依据真正读到的帧作答
- 音频分析：波形、频谱、能量、拍速与调性候选，附平台公开歌词
- 网页正文抓取与字幕读取，失败会明确标注「未读取」

### 设备与操作
- 内部无窗口浏览器（自带 Playwright 内核），可打开网页、读正文、播放
- 桌面：窗口观察与点击输入，先列真实快捷方式再启动，不猜安装路径
- 手机（DSHBox）：Pilot 观察屏幕、点击、滑动、中文输入；USB 设备同步
- Live2D 桌面伴侣：呼吸、情绪体态，可按需精细动作
- 登录 / 支付 / 评论 / 发布 / 删除各自单独确认，不把自己的话当许可

### 自主与可靠性
- 主动找人、沉默追问、说完补一句，都有每日额度与时段
- 消息合并、去重、失败重投与撤回核对
- 回复依据页：本轮用了哪些记忆与资料，可预览修正或申请撤回

### 面板分组
| 分组 | 页面 |
|---|---|
| 她的小世界 | 今天的小世界、今天的小日程、私人手账、记忆星图 |
| 消息中心 | 对话记录、发送消息、会话管理、消息可靠性、回复依据 |
| 认识她 | 角色设定、对话偏好、主动互动、学习效果、情绪与学习、长期记忆 |
| 声音与照片 | 语音表达、歌曲与教唱、图像生成、照片来源、表情库、素材采集 |
| 系统设置 | 账号与连接、设备与同步、联系人与权限、模型与搜索、存储与缓存、运行日志、备份与迁移 |

---

## ⚠ 风险声明（务必先读）

本插件通过 NapCat 接管**真实 QQ 账号**，属于非官方自动化，**存在被风控、限制甚至封号的风险**。

- 风险随行为强度上升：频繁改资料、自动发说说、主动给多人发消息属于高危操作
- 建议先用小号；自主行为的每日额度尽量调低；出现验证码或异常登录提示立刻停用
- 账号被封、内容发错、被他人投诉等后果由使用者自行承担

## 安装

前置：

1. 已装 **DeepSeek Harness**（本插件作为 bundle 加载）
2. 已装 **NapCat**，并在 NapCat 里开启 **WebSocket 服务端**（记下端口和 token）
3. 一个能登录的 QQ 小号

安装插件：

```sh
dsh plugin --profile <你的 profile> add /path/to/this/repo
```

**安装人格预设**（可选但推荐；`agentPreset: whale` 默认依赖它）：

把仓库里的 `whale-preset/` 放到 DSH 的预设目录，或在 `cordis.patch.yml` 里用 `presetDir` 指向仓库根目录。预设目录的结构是：

```
<presetDir>/whale-preset/cordis.patch.yml
<presetDir>/whale-preset/package.json
```

本仓库根目录就是这个结构，所以把 `presetDir` 设成本仓库路径即可。

装好后打开 **设置 → QQ 桥接**：

1. 填 WebSocket 地址和 token（默认 `ws://127.0.0.1:3001`）
2. 「联系人与权限」页把自己的 QQ 加进白名单并设为号主
3. 「账号与连接」页点「本地快速登录」拉起 NapCat（或用已有的 NapCat）
4. 发一条消息，看到回复就通了

## 配置

`cordis.patch.yml` 里的 `config` 是初始配置；面板改过之后以 profile 的 `settings.json` 为准。

| 键 | 说明 |
|---|---|
| `wsUrl` | NapCat 的 OneBot 11 WebSocket 地址 |
| `accessToken` | NapCat 里设置的 token，没有就留空 |
| `allowUsers` | 允许私聊的 QQ 号；留空谁都不理 |
| `allowGroups` / `groupRequireAt` | 允许的群；群里是否必须 @ |
| `cwd` | 会话工作目录，省略则用 DSH 当前目录 |
| `agentPreset` | 新人设用哪个 preset |
| `presetDir` | 人设预设所在根目录（默认为 DSH 工作区） |
| `presetRev` | 人设文本改了要 +1，才会换新会话 |
| `model` | Session 级模型路由（provider / model） |
| `maxReplyChars` | 单条消息上限，超过拆条 |
| `proactive` / `silence` / `afterthought` | 主动找人、沉默追问、说完补一句的频率 |
| `selfTest` / `selfTestPrompt` | 用临时会话自检一次，结果写日志 |

面板里还能配：图像生成、语音与唱歌、语音识别 Key、搜索引擎、设备权限与设备同步、记忆与存放位置、缓存位置、开机自启。

### 环境变量

| 变量 | 作用 |
|---|---|
| `QQ_BRIDGE_BROWSER_PATH` | 指定 Chrome / Edge 可执行文件，默认自动查找 |
| `QQ_BRIDGE_SCORE_PYTHON` | 唱歌评分用的 Python；不设则读 `tools/media-runtime-desktop.json` |
| `DSH_HOME` | DSH 数据目录，默认 `~/.dsh` |

### 可选依赖

不装也能聊天，只是对应功能不可用：

| 功能 | 需要 |
|---|---|
| 语音合成（甜妹） | `edge-tts`（Python） |
| 视频抽帧 / 音频分析 | `ffmpeg`、`ffprobe`，可选 ImageMagick |
| 唱歌评分 | 评分用的 Python 环境（`numpy` / `librosa` 之类） |
| 内部浏览器 | 已内置 `vendor/playwright-core`，需要本机有 Chrome 或 Edge |
| 手机操作 | DSHBox + 已配对的安卓设备 + adb |

路径都在 `tools/media-runtime-desktop.json`（桌面）或 `tools/media-runtime-mobile.json`（手机）里改，留空表示不启用。

## QQ 里能用的指令

| 指令 | 作用 |
|---|---|
| `/new` | 结束当前会话，下条消息开新会话 |
| `/cancel` | 中止正在跑的这一轮 |
| `/帮助` | 列出号主能在聊天里改的设置 |
| `/档位 省\|标准\|高\|最高` | 切智力档位并重开会话 |
| `/语音 on\|off`、`/表情 on\|off`、`/主动 on\|off` | 开关对应能力 |
| `/白名单 加\|删 QQ号` | 增删私聊白名单 |
| `/搜索 host\|wikipedia\|ddg\|searx` | 切换搜索引擎 |
| `/记忆 压缩\|清除` | 立即压缩或清空记忆 |
| `/状态` | 看一眼连接、档位、人设与会话状态 |
| `[表情包:名字]` / `[表情包:搜 关键词]` | 发表情包 / 联网找图 |
| `[语音] …` | 合成语音发出来 |
| `[查:词]` | 查资料再用她的话答 |

（`[发送:…]` / `[群发:…]` / `[定时:…]` 仅号主可用。）

## 已知限制

- **一次只连一个机器人账号**：多账号是切换，不是同时在线
- 部分能力偏 Windows：隐藏启动 NapCat、开机自启、SAPI 兜底音色、桌面控制
- 手机端需要 DSHBox 与已配对设备，USB 同步不是云同步
- 语音识别与生图要第三方 Key（硅基流动 / RunningHub）
- 视频只看抽样画面，不解析音轨；没抽到的地方她会说不知道
- 记忆是「总结 + 本地检索」，不是向量库
- 内部浏览器不等于完整虚拟机，也不代替真的桌面环境

## 安全

- 白名单为空时她**不理任何人**，这是默认状态
- 号主指令的目标必须白名单内，否则直接拒绝并记日志
- 面板路由挂在 DSH 的本地 Web 服务上，只监听本机
- 第三方 Key 存在本机 profile 的 `settings.json` 里，接口不回传明文

## English

A QQ (NapCat / OneBot 11) bridge for DeepSeek Harness: personas and per-contact profiles, local memory with full-text recall, sticker library and image search, TTS (edge-tts / MiniMax / Breeze / custom HTTP / SAPI) plus speech-to-text, singing from confirmed scores, image generation via SiliconFlow or RunningHub, video frame sampling, audio analysis, web reading, an internal headless browser, desktop and Android (DSHBox) control, Live2D companion, and a 28-page management panel.

Install it as a DSH bundle, point it at your NapCat WebSocket, whitelist yourself — then talk to your harness from QQ.

## License

MIT
