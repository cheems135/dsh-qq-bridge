# dsh-im-bridge · QQ ⇄ DeepSeek Harness

把 DeepSeek Harness 接到 QQ 上：NapCat（OneBot 11）当网关，DSH 会话是她的脑子，QQ 是她的嘴。附一个 28 页的管理面板。

![工作台](docs/screenshots/01-overview.png)

> 她在 QQ 里跟你聊天时，背后是一个真正的 DSH Session：同一套记忆、同一套工具，只是出口换成了 QQ。

---

## 功能

### 对话与群聊

| 场景 | 具体行为 |
|---|---|
| 私聊 | 直接回复。换行保留在同一条里，只有确实想另起一条时才分条 |
| 群聊 | 默认不发言。被 @ 或轮到自己才进入判断；判断完仍可 `[skip]`，@ 不是必须开口 |
| 气泡 | 群聊每条回复可设 1–8 条，默认按语境自主决定 |
| 媒体 | 图片、语音、视频、QQ 转发都能读；读不到就说读不到，不编造内容 |
| 表情 | `[表情包:名字]` 发内置表情，`[表情包:搜 关键词]` 联网找图 |
| 主动 | 可设时段、频率、每日额度；「我先忙 / 晚安 / 别再发」会暂停追聊，下一条用户消息恢复 |
| 分条 | 私聊由她自己决定长短；拟真模式可放开单条字数与重复检测 |

### 自我 + cosplay 人设

```
自我层   空白起步，给梗库、人类对话样例、真实经历；靠相处长出性格   ← 永久，唯一
cosplay  人设卡：名字、称呼、口吻、小动作；可以换，也可以为空        ← 临时
场合     群聊/私聊、当下情绪                                       ← 每轮
```

- 卡片为空 = 做自己，不加载任何角色文本
- 换卡只换外壳，**记忆、情绪、学习属于同一个人**
- 每张卡可填参考图，生图时按「像不像这个人」保持脸部一致
- 试聊只在面板里预览，不经过 QQ，也不影响真实会话
- 人设会成长：每天交流足够时留一条短期观察，自然月归档后再固化成长期设定，可回退

### 记忆与成长

- 记忆星图：人物、共同话题、发生过的事，按场景分开
- 小日记：一天记一两件事；「她学到了什么」记录实际使用与反馈
- 记忆按「总结 + 本地检索」组织，不依赖向量库，数据不出本机
- 面板「长期记忆」里可压缩、清除、迁移

### 情绪

每轮只在**对方明显带情绪**时注入一行理解（≤60 字），例如：

```
【对方现在不耐烦】懒得解释，语气变硬或直接不回；不要讲道理、劝冷静。
```

没命中就是 0 token。情绪底色按事件注入，不再每条都塞。

### 日程

她可以自己写日程，槽位支持能力绑定：

```json
{
  "start": "15:00", "end": "15:20",
  "taskKind": "group",
  "groupIds": ["686030141"],
  "activity": "去群里蹲一会儿，有人聊游戏就搭两句",
  "leaveWhen": "没人说话超过 20 分钟就回来"
}
```

`taskKind` 可选：`group / draw / browse / listen / social / write / digital / sleep / rest / local`。到点不强制切换，用户当前请求优先；开始不等于完成，实际结果按工具证据记。

### 声音与音乐

![语音表达](docs/screenshots/04-voice.png)

- 音色：`轻甜·晓伊`、`温柔·晓晓` 等预设，一键试听再保存
- 合成方式：内置甜妹（免费在线）、MiniMax（按量计费）、Breeze TTS 2（官方 API / 自建 vLLM-Omni）、原有 Edge 音色、自定义 HTTP TTS
- 语气：跟随内容 / 自然 / 开心 / 轻柔安慰 / 低落 / 惊喜 / 认真
- 唱歌：Breeze 短段清唱（试验），旋律自由生成，原曲与长歌尚不保证
- 音乐理解：在 QQ 里分享网易云歌曲即可取到可播放音频，并把真实波形图、频谱图、节奏和调性候选交给模型；音频留在本机

### 设备控制与同步

![设备与同步](docs/screenshots/03-devices.png)

- 浏览器：独立真实浏览器，可导航、点击、填表、截图、读字幕
- 桌面：Windows 输入与截图，先观察再操作，窗口坐标不跨设备混用
- 手机：通过 DSHBox Pilot 执行，权限最终由手机系统确认
- 同一个插件可保存手机版 / 电脑版两套配置，离线切换；「在手机运行 / 在电脑运行」决定实际运行设备
- 数据线一键同步：插件源码以版本号高的一端为准；资料按记录合并、去重；同名冲突保留双方副本；停用与删除标记优先

### 权限与操作账本

默认所有权限类操作都会先问你（桌面、命令、发布、评论、登录、付款）。做过一次明确同意后，同类操作 12 小时内不再重复问。

- 每次操作绑定真实目标与参数指纹，许可用一次就失效，不能换目标重放
- 支付、隐私/凭据、登录、删除、系统安全仍然逐次确认
- 面板会话默认也拿到号主设备权限：复用同一人设、记忆与许可账本，不经过 QQ 转发，手机自动化的拟真安全开关仍然生效

### 面板

- 28 页，四个区：她的小世界 / 消息中心 / 认识她 / 声音与照片 / 系统设置
- 实时状态、`Ctrl K` 搜索、主题跟随宿主
- 角色、记忆、语音、设备、日志、备份都在一个地方

---

## 安装

### 1. 前置

- 已安装 **DeepSeek Harness**
- 已安装 **NapCat**，并在其中开启 **WebSocket 服务端**（记下端口与 token）
- 一个能登录的 QQ 账号（建议小号）

### 2. 装插件

```sh
dsh plugin --profile <你的 profile> add /path/to/this/repo
```

或者把本仓库作为 bundle 引用进 profile 的 `cordis.patch.yml`。

### 3. 装人设（可选）

仓库里的 `assets/personae.json` 提供两张卡：

| 卡 | 作用 |
|---|---|
| 哦鲸鲸 | cosplay 用，只改口吻和称呼 |
| 不使用人设 | 空卡片，她只做自己 |

在面板「角色设定」导入即可；不导入也能用。

### 4. 首次启动

打开 **设置 → QQ 桥接**：

1. 填 WebSocket 地址与 token（默认 `ws://127.0.0.1:3001`）
2. 「联系人与权限」把自己的 QQ 加白名单并设为号主
3. 「账号与连接」点「本地快速登录」拉起 NapCat
4. 发一条消息，收到回复即通

---

## 权限：长期授权

在 `~/.dsh/im-bridge/settings.json` 里：

| 字段 | 作用 |
|---|---|
| `fullTrust: true` | 关闭全部权限拦截（**包括付款**） |
| `loginTrusted: true` | 账号已赠予时，登录提交不再单独确认 |
| `panelAccess: false` | 关闭面板会话的号主设备权限 |

改完重启插件即可；收回时改回 `false`。

保留的边界：不能读 `.ssh`、`.aws`、browser-profiles、设置与记忆库；截图不能发给号主以外的人；未读到的附件不能假装看过。

---

## 指令

| 指令 | 作用 |
|---|---|
| `/new` | 换新会话，保留记忆 |
| `/cancel` | 中止当前这轮 |
| `/帮助` | 列出号主可在聊天里改的设置 |
| `/档位 省 / 标准 / 高 / 最高` | 切思考深度 |
| `/记忆 压缩 / 清除` | 处理长期记忆 |
| `[表情包:名字]` / `[表情包:搜 关键词]` | 发表情 / 联网找图 |
| `[语音] …` | 合成语音 |
| `[查:词]` | 查资料再答 |

号主额外可用：`[发送:QQ号|内容]`、`[群发:内容]`、`[定时:分钟|QQ号|内容]`。

---

## 已知限制

- 一次只连一个机器人账号
- 部分能力偏 Windows：隐藏启动 NapCat、桌面控制、SAPI 兜底音色
- 语音识别与生图需要第三方 Key
- 视频只看抽样画面，不解析音轨
- 记忆是「总结 + 本地检索」，不是向量库
- 群聊日程执行器仍在完善，到点进入/退出目前按小时级触发

## 数据与隐私

- 设置：`~/.dsh/im-bridge/settings.json`
- 记忆：默认 `~/.dsh/im-bridge/memory-hub`，可在面板迁移
- 媒体引用：`~/.dsh/im-bridge/qq-media-refs.json`（保留 7 天）
- 所有数据只在本机，不上传

## 许可

MIT。第三方组件与数据见 `THIRD_PARTY_NOTICES.md`。

## English

A QQ (NapCat / OneBot 11) bridge for DeepSeek Harness: a blank self that grows through experience, swappable cosplay persona cards, emotion-aware replies, schedule-driven group participation, local memory with evidence, TTS/ASR, image generation, browser and desktop control, and a 28-page panel. Permissions default to per-action asks and can be made standing via `fullTrust`. Panel sessions (the DSH web UI) get the same owner device access by default; disable with `panelAccess: false`.
