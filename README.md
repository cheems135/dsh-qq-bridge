# dsh-im-bridge · QQ ⇄ DeepSeek Harness

把 DeepSeek Harness 接到 QQ 上：用 NapCat（OneBot 11）作为网关，你的 DSH 会话就是她的脑子，QQ 是她的嘴。附带一个完整的管理面板，人设、白名单、表情包、语音、记忆、模型全部可视化配置。

> 她在 QQ 里跟你聊天时，背后是一个真正的 DSH Session —— 同一套人设、同一套记忆、同一套工具能力，只是把出口从浏览器换成了 QQ。

---

## 它是什么

- **双向桥接**：NapCat 的 WebSocket → 桥接 → `sessionController` 创建/续聊 DSH 会话 → 回复拆成多条发回 QQ
- **像人一样说话**：回复按 `|||` 或空行拆成多个气泡，间隔 0.6–2.8 秒，模拟打字节奏
- **一个面板管全部**：8 个页面（概览 / 发消息 / 监听 / 人设 / 联系人 / 素材 / 记忆 / 模型）

## 功能

### 聊天与人格

- 内置两套人设预设（`whale` 日常口语 / `chiang` 训话腔），可直接在面板里改文本，保存即生效
- 自定义人设：名字 + 底座 + 提示词，支持导入导出
- 「底层性格」：排在所有人设之前的一层通用规则（情绪安抚、按时间问候、看图不描述画面），可编辑
- AI 生成人设：一句描述 → 模型写出提示词并入库
- 试聊预览：不经过 QQ，直接用人设提示词问一次模型，看她的语气对不对

### 记忆

- 按轮数自动压缩：聊到 N 轮就把最近对话压成一小段「给以后的自己看」的记忆，然后换新会话，记忆带进新会话
- 记忆文件和缓存目录都可以挪位置，换路径不丢配置
- 面板里能看到每条记忆的生成时间，可单独重压或清除

### 素材：表情包与语音

- 本地表情库：上传、分组（勾选批量分组）、启用/停用
- 她会自己在合适的时候发图（情绪词触发），也会用 `[表情包:名字]` 精确指定
- `[表情包:搜 关键词]`：手边没有合适的图时联网搜图、下载、发出去
- 语音：`[语音]` 标记 → 合成语音消息。引擎支持 edge-tts（微软在线音色）或自定义 HTTP TTS（GPT-SoVITS / CosyVoice 之类返回音频字节即可）
- 试听与音色对比样本，直接在面板里播放

### 查资料

- `[查:词]` → 桥接去查 → 用她的口吻转述
- 搜索引擎可选：DSH 自带 / 维基百科 API / DuckDuckGo API / 自建 SearXNG / 自定义 URL 模板；主引擎失败自动回退
- 以「查一下 X」开头的消息会直接触发查询，不经过模型

### 号主模式

- 指定一个或多个号主 QQ，号主说话时她会获得额外权限：
  - `[发送:QQ号|内容]` 给白名单里某人发消息
  - `[群发:内容]` 群发
  - `[定时:分钟|QQ号|内容]` 定时发送（最长 24 小时）
- 代发内容会在发送前清洗掉「号主让我转告」这类归属信息，对方看到的就是她在说话
- 三项权限可分别关闭；目标必须在白名单内

### 模型与成本

- 智力档位：`省 / 标准 / 高 / 最高`（对应 `off / low / high / max` thinking 深度），切换会重开会话
- 也可以直接在 QQ 里发 `/档位 max` 切换
- 每个会话可单独指定模型，其余跟随全局
- 面板按 DeepSeek 峰谷价实时记花费，能看到今日累计与单轮成本

### 运维

- 监听页：收发记录，按对话分组、按方向筛选、每 2 秒自动刷新、消息图片可直接看
- 存储：日志/监听历史/语音/表情包可以整体迁到别的盘，占用按类统计，支持一键清理
- 本地快速登录：面板点一下拉起 NapCat（隐藏窗口、无需 UAC），可选「开机自动登录」
- 连接可随时停用（保留配置），恢复后自动重连

## 安装

前置：

1. 已装 **DeepSeek Harness**（本插件作为 bundle 加载）
2. 已装 **NapCat**，并在 NapCat 里开启 **WebSocket 服务端**（记下端口和 token）
3. 一个能登录的 QQ 小号

安装本插件（在 DSH 的插件管理里）：

```sh
dsh plugin --profile <你的 profile> add /path/to/this/repo
```

或者把本仓库放进 profile 的 `cordis.patch.yml` 作为 bundle 引用。

装好后打开 **设置 → QQ 桥接**，按面板引导：

1. 填 WebSocket 地址和 token（默认 `ws://127.0.0.1:3001`）
2. 「联系人」页把自己的 QQ 加进白名单，并设为号主
3. 「概览」页点「本地快速登录」拉起 NapCat
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
| `presetRev` | 人设文本改了要 +1，才会换新会话 |
| `model` | Session 级模型路由（provider / model） |
| `maxReplyChars` | 单条消息上限，超过拆条 |
| `greeting` | 上线后主动打招呼的内容，留空不发 |
| `selfTest` | 用临时会话自检一次，结果写日志 |

面板里还能配：智力档位、主动行为（定时找你 / 沉默追问 / 说完补一句）、勿扰时段、搜索与语音引擎、号主与权限、记忆压缩与存放位置、缓存位置、开机自启。

## QQ 里能用的指令

| 指令 | 作用 |
|---|---|
| `/new` | 结束当前会话，下条消息开新会话（丢上下文，保留记忆） |
| `/档位 eco\|standard\|high\|max` | 切智力档位并重开会话 |
| `[表情包:名字]` / `[表情包:搜 关键词]` | 发表情包 / 联网找图 |
| `[语音] …` | 合成语音发出来 |
| `[查:词]` | 查资料再用她的话答 |

（`[发送:…]` / `[群发:…]` / `[定时:…]` 仅号主可用。）

## 已知限制

- **一次只连一个机器人账号**：多账号是切换，不是同时在线
- 部分能力是 Windows 向的：隐藏启动 NapCat、开机自启、SAPI 兜底音色；其它平台能跑但用不了这几项
- **没有语音识别**：她听不了你发的语音消息，只处理文字和图片
- 记忆压缩是「总结式」的，不是向量检索；压过头的细节找不回来

## 安全

- 白名单为空时她**不理任何人**，这是默认状态
- 号主指令的目标必须白名单内，否则直接拒绝并记日志
- 面板路由挂在 DSH 的本地 Web 服务上，只监听本机

## English

A QQ (NapCat / OneBot 11) bridge for DeepSeek Harness. It turns a DSH Session into a QQ chat partner: persona presets, custom personae, a baseline behaviour layer, sticker library with groups and web search, TTS voice notes (edge-tts or your own HTTP TTS), web lookup with pluggable engines, periodic memory compaction, a thinking-depth dial, owner-only relay commands, and an 8-page management panel with live monitoring and cost tracking.

Install it as a DSH bundle, point it at your NapCat WebSocket, whitelist yourself — then talk to your harness from QQ.

## License

MIT
