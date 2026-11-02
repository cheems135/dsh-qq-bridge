# dsh-im-bridge · QQ ⇄ DeepSeek Harness

把 DeepSeek Harness 接到 QQ 上：NapCat（OneBot 11）当网关，DSH 会话是她的脑子，QQ 是她的嘴。附一个 28 页的管理面板。

> 她在 QQ 里跟你聊天时，背后是一个真正的 DSH Session：同一套记忆、同一套工具，只是出口换成了 QQ。

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

## 人格模型：自我 + cosplay

```
自我层   空白起步，只给梗库、人类对话样例、真实经历；靠相处长出性格   ← 永久，唯一
cosplay  人设卡：名字、称呼、口吻、小动作；可以换，也可以为空            ← 临时
场合     群聊/私聊、当下情绪                                          ← 每轮
```

- 卡片为空 = 做自己，不加载任何角色文本
- 换卡只换外壳，**记忆、情绪、学习属于同一个人**
- 面板「角色设定」里可随时切换

---

## 权限

默认所有权限类操作都会先问你（桌面、命令、发布、评论、登录、付款）。做过一次明确同意后，同类操作 12 小时内不再重复问。

### 长期授权

在 `~/.dsh/im-bridge/settings.json` 里：

| 字段 | 作用 |
|---|---|
| `fullTrust: true` | 关闭全部权限拦截（**包括付款**） |
| `loginTrusted: true` | 账号已赠予时，登录提交不再单独确认 |

改完重启插件即可；收回时改回 `false`。

保留的边界：不能读 `.ssh`、`.aws`、browser-profiles、设置与记忆库；截图不能发给号主以外的人；未读到的附件不能假装看过。

---

## 情绪

每轮只在**对方明显带情绪**时注入一行理解（≤60 字），例如：

```
【对方现在不耐烦】懒得解释，语气变硬或直接不回；不要讲道理、劝冷静。
```

没命中就是 0 token。情绪底色按事件注入，不再每条都塞。

---

## 日程

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

`taskKind` 可选：`group / draw / browse / listen / social / write / digital / sleep / rest / local`。

---

## 群聊

| 情况 | 行为 |
|---|---|
| 有人 @ 她 | 进入判断，再决定说不说 |
| 没人 @ | 默认不发言 |
| 她自己排了群聊日程 | 到点进入该群，到点或满足 `leaveWhen` 退出 |

她被 @ 后仍可能 `[skip]`——@ 只是把发言权交给她，不是必须开口。

---

## 指令

| 指令 | 作用 |
|---|---|
| `/new` | 换新会话，保留记忆 |
| `/cancel` | 中止当前这轮 |
| `/帮助` | 列出号主可在聊天里改的设置 |
| `/档位 省\|标准\|高\|最高` | 切思考深度 |
| `/记忆 压缩\|清除` | 处理长期记忆 |
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

A QQ (NapCat / OneBot 11) bridge for DeepSeek Harness: a blank self that grows through experience, swappable cosplay persona cards, emotion-aware replies, schedule-driven group participation, local memory with evidence, TTS/ASR, image generation, browser and desktop control, and a 28-page panel. Permissions default to per-action asks and can be made standing via `fullTrust`.
