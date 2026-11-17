# fx-lab 使用说明

只为一件事：**让调音效变得便宜**。同一句台词只合成一次，之后所有参数实验都在本地跑，不花积分。

## 命令

| 命令 | 作用 | 花不花积分 |
|---|---|---|
| `synth --line "…" --emotion moan` | 合成台词并缓存，返回 take id | **花**（按字数） |
| `import --file x.mp3` | 把已有音频收进素材库 | 不花 |
| `extract --file video.mp4 --start 00:10 --dur 8` | 从视频/音频抽一段当素材（ffmpeg，不联网） | 不花 |
| `takes` | 列出素材 | 不花 |
| `render --take <id> --scene <场景> [--method filter\|world] [--set pole=270:0.4,cutoff=3600] [--events suck:0.1,wet:0.4] [--auto 1] [--react 0.4:0.6] [--out x.mp3]` | 出成品，附频段 | 不花 |
| `sweep --take <id> --scene <场景> --param cutoff --values 3000,4000,5000` | 批量变体，逐个报频段 | 不花 |

## 两个模式的取舍

- `filter`（EQ only）：只改频响，**没有 WORLD 二次声码器，不会有电音**。缺辅音闷化，适合要求干净的场景。
- `world`：能改谱包络（鼻音、反共振、辅音帧），表现力强，但双重声码器会带一点电音味。

## 事件层（只用嘴能发出来的）

`kisssuck` 亲嘴吸吮（负压 + 唇分爆音）、`suck` 吞吐吸吮（负压在末尾释放）、`swallow` 吞咽（主频 690Hz，文献取值）、`wet` 湿声、`squelch` 粘稠、`breath` 喘息。

`--auto 1` 会把事件自动落在台词静音段，不用手写时间点。

## 场景参数

存在 `voice-scenes.json`，每个场景三样：官方中文标签、fx 频响参数、events 事件层。改场景改那个文件，不用动代码。
