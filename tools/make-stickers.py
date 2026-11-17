"""Draw a tiny set of original whale-girl stickers (no third-party art).

Each image is 512x512 with a transparent background, drawn at 4x and
downsampled so the edges stay smooth. Expressions live in the eyes/mouth and
one accessory, which is enough for a chat reaction.
"""

from pathlib import Path
import os

from PIL import Image, ImageDraw, ImageFont

S = 4  # supersample factor
W = 512
OUT = Path(os.environ.get("DSH_BRIDGE_STICKERS_DIR", str(Path.home() / ".dsh" / "im-bridge" / "stickers")))
OUT.mkdir(parents=True, exist_ok=True)

BODY = (126, 183, 235, 255)
BODY_DARK = (90, 145, 205, 255)
BELLY = (240, 248, 255, 255)
INK = (38, 52, 74, 255)
BLUSH = (247, 170, 180, 255)
RICE = (252, 250, 244, 255)
NORI = (52, 78, 62, 255)


def canvas():
    image = Image.new("RGBA", (W * S, W * S), (0, 0, 0, 0))
    return image, ImageDraw.Draw(image)


def body(draw, dy=0):
    draw.ellipse([70 * S, (130 + dy) * S, 442 * S, (430 + dy) * S], fill=BODY, outline=BODY_DARK, width=6 * S)
    draw.ellipse([120 * S, (250 + dy) * S, 392 * S, (415 + dy) * S], fill=BELLY)
    # tail
    draw.polygon(
        [(70 * S, (300 + dy) * S), (18 * S, (262 + dy) * S), (26 * S, (352 + dy) * S)],
        fill=BODY,
        outline=BODY_DARK,
    )
    # rice ball on the head
    draw.ellipse([196 * S, 52 * S, 316 * S, 150 * S], fill=RICE, outline=(214, 210, 196, 255), width=3 * S)
    draw.rectangle([236 * S, 108 * S, 276 * S, 146 * S], fill=NORI)


def eyes_open(draw, dx=0, dy=0):
    draw.ellipse([(186 + dx) * S, (236 + dy) * S, (222 + dx) * S, (286 + dy) * S], fill=INK)
    draw.ellipse([(290 + dx) * S, (236 + dy) * S, (326 + dx) * S, (286 + dy) * S], fill=INK)
    draw.ellipse([(198 + dx) * S, (246 + dy) * S, (210 + dx) * S, (258 + dy) * S], fill=(255, 255, 255, 255))
    draw.ellipse([(302 + dx) * S, (246 + dy) * S, (314 + dx) * S, (258 + dy) * S], fill=(255, 255, 255, 255))


def eyes_closed_happy(draw):
    draw.arc([186 * S, 240 * S, 226 * S, 276 * S], 200, 340, fill=INK, width=6 * S)
    draw.arc([286 * S, 240 * S, 326 * S, 276 * S], 200, 340, fill=INK, width=6 * S)


def eyes_flat(draw):
    draw.rectangle([186 * S, 258 * S, 226 * S, 266 * S], fill=INK)
    draw.rectangle([286 * S, 258 * S, 326 * S, 266 * S], fill=INK)


def eyes_sleepy(draw):
    draw.arc([186 * S, 250 * S, 226 * S, 286 * S], 20, 160, fill=INK, width=6 * S)
    draw.arc([286 * S, 250 * S, 326 * S, 286 * S], 20, 160, fill=INK, width=6 * S)


def mouth_smile(draw, w=6):
    draw.arc([226 * S, 292 * S, 286 * S, 336 * S], 20, 160, fill=INK, width=w * S)


def mouth_flat(draw):
    draw.line([232 * S, 316 * S, 280 * S, 316 * S], fill=INK, width=6 * S)


def blush(draw):
    draw.ellipse([150 * S, 292 * S, 196 * S, 318 * S], fill=BLUSH)
    draw.ellipse([316 * S, 292 * S, 362 * S, 318 * S], fill=BLUSH)


def text(draw, value, xy, size=64):
    try:
        font = ImageFont.truetype("arial.ttf", size * S)
    except OSError:
        font = ImageFont.load_default()
    draw.text((xy[0] * S, xy[1] * S), value, font=font, fill=INK)


def save(image, name):
    image.resize((W, W), Image.LANCZOS).save(OUT / f"{name}.png")
    print("wrote", OUT / f"{name}.png")


def happy():
    image, draw = canvas()
    body(draw)
    eyes_closed_happy(draw)
    mouth_smile(draw)
    blush(draw)
    save(image, "开心")


def speechless():
    image, draw = canvas()
    body(draw)
    eyes_flat(draw)
    mouth_flat(draw)
    text(draw, "...", (360, 210), 56)
    save(image, "无语")


def sleepy():
    image, draw = canvas()
    body(draw)
    eyes_sleepy(draw)
    mouth_smile(draw, 4)
    text(draw, "z", (360, 190), 48)
    text(draw, "z", (400, 150), 40)
    save(image, "困")


def eating():
    image, draw = canvas()
    body(draw)
    eyes_open(draw, dy=4)
    mouth_smile(draw, 5)
    blush(draw)
    # rice ball in front
    draw.ellipse([196 * S, 330 * S, 316 * S, 424 * S], fill=RICE, outline=(214, 210, 196, 255), width=4 * S)
    draw.rectangle([244 * S, 372 * S, 268 * S, 424 * S], fill=NORI)
    save(image, "吃米")


def confused():
    image, draw = canvas()
    body(draw)
    eyes_open(draw)
    mouth_flat(draw)
    draw.arc([232 * S, 300 * S, 280 * S, 330 * S], 200, 340, fill=INK, width=5 * S)
    text(draw, "?", (368, 180), 72)
    save(image, "问号")


for builder in (happy, speechless, sleepy, eating, confused):
    builder()
