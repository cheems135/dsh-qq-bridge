#!/usr/bin/env python3
"""Pad a character reference to a target aspect ratio without cropping the subject.

The original image is pasted, uncropped, over a blurred cover background. Image-edit
workflows (for example Qwen Image Edit) inherit the input canvas ratio, so this is
what makes the panel's aspect-ratio option reach the final image.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

MAX_SIDE = 2048
MIN_SIDE = 512


def target_size(width: int, height: int, ratio_w: float, ratio_h: float) -> tuple[int, int]:
    ratio = ratio_w / ratio_h
    current = width / height
    if abs(current - ratio) / ratio < 0.02:
        return width, height
    if current > ratio:
        # Too wide: extend the height.
        new_w, new_h = width, round(width / ratio)
    else:
        # Too tall: extend the width.
        new_w, new_h = round(height * ratio), height
    long_side = max(new_w, new_h)
    if long_side > MAX_SIDE:
        scale = MAX_SIDE / long_side
        new_w, new_h = round(new_w * scale), round(new_h * scale)
    if min(new_w, new_h) < MIN_SIDE:
        scale = MIN_SIDE / min(new_w, new_h)
        new_w, new_h = round(new_w * scale), round(new_h * scale)
    return max(1, new_w), max(1, new_h)


def main() -> int:
    if len(sys.argv) != 5:
        return 2
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    ratio_w, ratio_h = float(sys.argv[3]), float(sys.argv[4])
    if ratio_w <= 0 or ratio_h <= 0:
        return 2
    with Image.open(src) as opened:
        image = opened.convert("RGB")
    width, height = image.size
    new_w, new_h = target_size(width, height, ratio_w, ratio_h)
    if (new_w, new_h) == (width, height):
        image.save(dst, "PNG", optimize=True)
        return 0
    # A clean edge-coloured canvas avoids duplicated limbs and ghost figures that a
    # blurred cover would introduce into an identity reference.
    rgb = image.convert("RGB")
    border = []
    for x in range(width):
        border.append(rgb.getpixel((x, 0)))
        border.append(rgb.getpixel((x, height - 1)))
    for y in range(height):
        border.append(rgb.getpixel((0, y)))
        border.append(rgb.getpixel((width - 1, y)))
    channel = []
    for index in range(3):
        values = sorted(pixel[index] for pixel in border)
        channel.append(values[len(values) // 2] if values else 255)
    background = Image.new("RGB", (new_w, new_h), tuple(channel))
    foreground = image.copy()
    foreground.thumbnail((new_w, new_h), Image.Resampling.LANCZOS)
    left = (new_w - foreground.width) // 2
    top = (new_h - foreground.height) // 2
    background.paste(foreground, (left, top))
    dst.parent.mkdir(parents=True, exist_ok=True)
    background.save(dst, "PNG", optimize=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
