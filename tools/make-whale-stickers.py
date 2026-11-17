"""蓝色鲸鱼娘 · 80 张预设表情包生成器。

这套图随插件一起发布（assets/stickers/），第一次启用桥接时会自动铺进表情库。
画法是用几何图形拼一只平涂小鲸鱼，同一个角色、同一套配色，只是表情和台词不同。

想改台词就改下面的 CARDS 列表，然后：
    python tools/make-whale-stickers.py assets/stickers
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZE = 480
BLUE = (86, 156, 255)
BLUE_DEEP = (54, 118, 224)
BLUE_LIGHT = (150, 199, 255)
BELLY = (226, 240, 255)
INK = (28, 34, 48)
BLUSH = (255, 158, 178)
WHITE = (255, 255, 255)
HEART = (255, 122, 150)
ANGER = (255, 96, 96)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
]


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


# ---------------------------------------------------------------- drawing


def whale(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int, body: tuple[int, int, int]) -> None:
    draw.ellipse([cx - r, cy - r * 0.82, cx + r, cy + r * 0.82], fill=body)
    draw.ellipse([cx - r * 0.66, cy + r * 0.06, cx + r * 0.66, cy + r * 0.74], fill=BELLY)
    draw.polygon(
        [
            (cx - r * 0.96, cy + r * 0.05),
            (cx - r * 1.55, cy - r * 0.35),
            (cx - r * 1.42, cy + r * 0.02),
            (cx - r * 1.6, cy + r * 0.42),
        ],
        fill=body,
    )
    draw.ellipse([cx - r * 1.12, cy + r * 0.34, cx - r * 0.66, cy + r * 0.74], fill=BLUE_DEEP)
    draw.ellipse([cx - r * 0.14, cy - r * 0.9, cx + r * 0.08, cy - r * 0.74], fill=BLUE_DEEP)


def bubbles(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int) -> None:
    for dx, dy, scale in ((0.0, 1.34, 0.15), (-0.40, 1.16, 0.10), (0.40, 1.18, 0.11)):
        x = cx + r * dx
        y = cy - r * dy
        rr = r * scale
        draw.ellipse([x - rr, y - rr, x + rr, y + rr], fill=BLUE_LIGHT)
        draw.ellipse([x - rr * 0.34, y - rr * 0.5, x - rr * 0.02, y - rr * 0.16], fill=WHITE)


def eyes(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int, mood: str) -> None:
    left = (cx - r * 0.42, cy - r * 0.22)
    right = (cx + r * 0.16, cy - r * 0.22)
    for ex, ey in (left, right):
        if mood in ("happy", "squint"):
            draw.arc(
                [ex - r * 0.14, ey - r * 0.12, ex + r * 0.14, ey + r * 0.14],
                200,
                340,
                fill=INK,
                width=int(r * 0.055),
            )
        elif mood in ("angry", "annoyed"):
            draw.line([(ex - r * 0.12, ey - r * 0.12), (ex + r * 0.12, ey - r * 0.02)], fill=INK, width=int(r * 0.05))
            draw.line([(ex + r * 0.12, ey - r * 0.12), (ex - r * 0.12, ey - r * 0.02)], fill=INK, width=int(r * 0.05))
        elif mood == "cry":
            draw.ellipse([ex - r * 0.1, ey - r * 0.14, ex + r * 0.1, ey + r * 0.12], fill=INK)
            draw.ellipse([ex - r * 0.06, ey - r * 0.08, ex + r * 0.02, ey + r * 0.0], fill=WHITE)
            draw.line([(ex, ey + r * 0.1), (ex - r * 0.03, ey + r * 0.34)], fill=BLUE_LIGHT, width=int(r * 0.07))
        elif mood == "sleep":
            draw.arc([ex - r * 0.14, ey - r * 0.1, ex + r * 0.14, ey + r * 0.1], 20, 160, fill=INK, width=int(r * 0.05))
        elif mood == "shock":
            draw.ellipse(
                [ex - r * 0.12, ey - r * 0.16, ex + r * 0.12, ey + r * 0.16], fill=WHITE, outline=INK, width=int(r * 0.04)
            )
            draw.ellipse([ex - r * 0.04, ey - r * 0.04, ex + r * 0.04, ey + r * 0.06], fill=INK)
        elif mood == "shy":
            draw.arc([ex - r * 0.13, ey - r * 0.05, ex + r * 0.13, ey + r * 0.16], 200, 340, fill=INK, width=int(r * 0.05))
        elif mood == "love":
            heart = [
                (ex, ey + r * 0.1),
                (ex - r * 0.13, ey - r * 0.04),
                (ex - r * 0.05, ey - r * 0.14),
                (ex, ey - r * 0.05),
                (ex + r * 0.05, ey - r * 0.14),
                (ex + r * 0.13, ey - r * 0.04),
            ]
            draw.polygon(heart, fill=HEART)
        elif mood == "think":
            draw.ellipse([ex - r * 0.09, ey - r * 0.12, ex + r * 0.09, ey + r * 0.12], fill=INK)
            draw.ellipse([ex - r * 0.03, ey - r * 0.1, ex + r * 0.07, ey + r * 0.0], fill=WHITE)
        elif mood == "dead":
            draw.line([(ex - r * 0.12, ey - r * 0.12), (ex + r * 0.12, ey + r * 0.12)], fill=INK, width=int(r * 0.05))
            draw.line([(ex + r * 0.12, ey - r * 0.12), (ex - r * 0.12, ey + r * 0.12)], fill=INK, width=int(r * 0.05))
        else:
            draw.ellipse([ex - r * 0.09, ey - r * 0.12, ex + r * 0.09, ey + r * 0.12], fill=INK)
            draw.ellipse([ex - r * 0.05, ey - r * 0.08, ex, ey - r * 0.02], fill=WHITE)


def mouth(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int, mood: str) -> None:
    mx, my = cx + r * 0.04, cy + r * 0.2
    width = int(r * 0.05)
    if mood in ("happy", "love"):
        draw.arc([mx - r * 0.16, my - r * 0.1, mx + r * 0.16, my + r * 0.18], 10, 170, fill=INK, width=width)
    elif mood in ("cry", "angry", "annoyed"):
        draw.arc([mx - r * 0.14, my + r * 0.04, mx + r * 0.14, my + r * 0.26], 190, 350, fill=INK, width=width)
    elif mood == "shock":
        draw.ellipse([mx - r * 0.08, my - r * 0.02, mx + r * 0.08, my + r * 0.16], fill=INK)
    elif mood == "sleep":
        draw.line([(mx - r * 0.07, my + r * 0.04), (mx + r * 0.07, my + r * 0.04)], fill=INK, width=int(r * 0.045))
    elif mood == "shy":
        for ox in (-0.06, 0.06):
            draw.arc(
                [mx + r * ox - r * 0.06, my - r * 0.02, mx + r * ox + r * 0.06, my + r * 0.08],
                10,
                170,
                fill=INK,
                width=int(r * 0.04),
            )
    elif mood == "dead":
        draw.line([(mx - r * 0.1, my + r * 0.05), (mx + r * 0.1, my + r * 0.05)], fill=INK, width=width)
    else:
        draw.arc([mx - r * 0.13, my - r * 0.06, mx + r * 0.13, my + r * 0.12], 20, 160, fill=INK, width=width)


def blush(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int, strong: bool = False) -> None:
    colour = (255, 170, 190) if strong else (255, 196, 208)
    for ex in (cx - r * 0.5, cx + r * 0.28):
        draw.ellipse([ex, cy + r * 0.02, ex + r * 0.22, cy + r * 0.16], fill=colour)


def prop(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int, kind: str) -> None:
    """小道具/符号，画在右上角，别抢脸。"""
    x, y = SIZE - 92, 96
    if kind == "heart":
        draw.polygon(
            [(x, y + 26), (x - 30, y - 4), (x - 12, y - 30), (x, y - 12), (x + 12, y - 30), (x + 30, y - 4)],
            fill=HEART,
        )
    elif kind == "sweat":
        draw.polygon([(x, y - 30), (x - 16, y + 8), (x + 16, y + 8)], fill=BLUE_LIGHT)
        draw.ellipse([x - 16, y - 6, x + 16, y + 20], fill=BLUE_LIGHT)
    elif kind == "anger":
        draw.line([(x - 16, y - 16), (x + 16, y + 16)], fill=ANGER, width=8)
        draw.line([(x + 16, y - 16), (x - 16, y + 16)], fill=ANGER, width=8)
    elif kind == "question":
        draw.text((x, y), "?", font=load_font(72), fill=INK, anchor="mm")
    elif kind == "exclaim":
        draw.text((x, y), "!", font=load_font(72), fill=ANGER, anchor="mm")
    elif kind == "sparkle":
        for dx, dy, s in ((0, -24, 16), (-26, 10, 11), (26, 14, 9)):
            draw.line([(x + dx - s, y + dy), (x + dx + s, y + dy)], fill=BLUE_LIGHT, width=5)
            draw.line([(x + dx, y + dy - s), (x + dx, y + dy + s)], fill=BLUE_LIGHT, width=5)
    elif kind == "bowl":
        # 一碗饭：碗 + 冒尖的米饭，放左上角，别压台词
        draw.pieslice([54, 52, 176, 112], 0, 180, fill=(246, 250, 255), outline=BLUE_DEEP, width=5)
        draw.rectangle([54, 80, 176, 90], fill=BLUE_LIGHT)
        draw.ellipse([74, 34, 156, 78], fill=WHITE, outline=BLUE_DEEP, width=4)
        for dx, dy in ((96, 44), (118, 38), (136, 50)):
            draw.ellipse([dx - 3, dy - 3, dx + 3, dy + 3], fill=BLUE_LIGHT)
    elif kind == "zzz":
        draw.text((SIZE - 92, 74), "Z", font=load_font(46), fill=BLUE_DEEP, anchor="rm")
        draw.text((SIZE - 58, 40), "z", font=load_font(46), fill=BLUE_DEEP, anchor="rm")


def caption(draw: ImageDraw.ImageDraw, text: str) -> None:
    font = load_font(54 if len(text) <= 4 else 46)
    x, y = SIZE / 2, SIZE - 46
    for dx in (-2, 0, 2):
        for dy in (-2, 0, 2):
            draw.text((x + dx, y + dy), text, font=font, fill=WHITE, anchor="ms")
    draw.text((x, y), text, font=font, fill=INK, anchor="ms")


def make(mood: str, text: str, extra: str | None) -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx, cy, r = int(SIZE * 0.5), int(SIZE * 0.47), int(SIZE * 0.29)
    body = BLUE if mood not in ("angry", "annoyed", "dead") else (120, 150, 235)
    whale(draw, cx, cy, r, body)
    if mood in ("happy", "love", "shy"):
        bubbles(draw, cx, cy, r)
    eyes(draw, cx, cy, r, mood)
    mouth(draw, cx, cy, r, mood)
    if mood not in ("angry", "annoyed", "dead", "sleep"):
        blush(draw, cx, cy, r, strong=mood in ("shy", "love"))
    if extra:
        prop(draw, cx, cy, r, extra)
    caption(draw, text)
    return img


# ---------------------------------------------------------------- 80 张

H = "happy"
Q = "squint"
C = "cry"
A = "angry"
N = "annoyed"
S = "sleep"
K = "shock"
Y = "shy"
L = "love"
T = "think"
D = "dead"

CARDS: list[tuple[str, str, str | None]] = [
    # 吃饭 / 日常
    (H, "吃了", "bowl"),
    (H, "好饱", "bowl"),
    (C, "饿饿", None),
    (C, "要饭", None),
    (H, "喝奶茶", "sparkle"),
    (Q, "吃瓜", None),
    (D, "减肥失败", None),
    (H, "夜宵走起", "sparkle"),
    (H, "早安", "sparkle"),
    (S, "晚安", "zzz"),
    (S, "困了", "zzz"),
    (K, "醒了", None),
    (S, "睡了", "zzz"),
    (H, "下班", "sparkle"),
    (D, "上班", None),
    # 开心
    (H, "开心", "sparkle"),
    (H, "嘿嘿", None),
    (H, "好耶", "sparkle"),
    (Q, "得瑟", None),
    (L, "喜欢你", "heart"),
    (Y, "害羞", None),
    (L, "么么", "heart"),
    (H, "摸摸头", None),
    (H, "贴贴", "heart"),
    (H, "夸我", "sparkle"),
    # 难过
    (C, "委屈", None),
    (C, "难过", None),
    (C, "哭了", None),
    (C, "呜呜", "sweat"),
    (D, "破防了", None),
    (D, "心累", None),
    (T, "自闭", None),
    (C, "想你了", "heart"),
    (S, "不想说话", "zzz"),
    (D, "算了", None),
    # 生气
    (A, "生气", "anger"),
    (A, "炸毛", "anger"),
    (N, "不理你", None),
    (N, "走开", "anger"),
    (N, "别烦", "anger"),
    (Q, "呵呵", None),
    (Q, "就这", None),
    (K, "离谱", "exclaim"),
    (D, "服了", None),
    (Q, "翻白眼", None),
    # 疑惑 / 震惊
    (K, "啊？", "question"),
    (K, "真的假的", "question"),
    (T, "让我想想", "question"),
    (K, "什么鬼", "exclaim"),
    (K, "救命", "exclaim"),
    (K, "裂开", None),
    (T, "在吗", "question"),
    (T, "你是？", "question"),
    (K, "栓Q", None),
    (D, "社死", None),
    # 摆烂 / 吐槽
    (Q, "摆烂", None),
    (D, "我装的", None),
    (Q, "真香", None),
    (Q, "笑死", None),
    (D, "无语", None),
    (N, "别问了", None),
    (D, "已读不回", None),
    (Q, "你说的都对", None),
    (D, "上头", None),
    (D, "下头", None),
    # 互动
    (H, "抱抱", "heart"),
    (H, "陪我", None),
    (C, "理我", None),
    (Q, "等我", None),
    (H, "来了", "sparkle"),
    (Q, "忙", None),
    (H, "冲鸭", "sparkle"),
    (S, "摸鱼", "zzz"),
    (K, "开会", None),
    (D, "加班", None),
    # 收尾
    (Q, "嗯哼", None),
    (H, "好呀", None),
    (S, "累了", "zzz"),
    (L, "想你啦", "heart"),
    (A, "气死我了", "anger"),
    (Q, "你猜", "question"),
    (K, "我不信", "question"),
    (H, "谢谢", "sparkle"),
    (C, "别走", None),
    (H, "在呢", None),
]


def main() -> None:
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "out")
    out_dir.mkdir(parents=True, exist_ok=True)
    for index, (mood, text, extra) in enumerate(CARDS, start=1):
        make(mood, text, extra).save(out_dir / f"whale_{index:03d}.png")
    print(f"done: {len(CARDS)} stickers -> {out_dir}")


if __name__ == "__main__":
    main()
