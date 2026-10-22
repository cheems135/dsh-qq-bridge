"""裁掉硅基流动生图右下角的「AI生成」水印。

水印在右下角固定位置，裁掉底部一条既保住主体又去掉标记。
用法：python crop-watermark.py <图片路径>
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


def main() -> None:
    if len(sys.argv) < 2:
        return
    target = Path(sys.argv[1])
    if not target.exists():
        return
    image = Image.open(target)
    width, height = image.size
    # 底部 8% 足以覆盖水印，同时不切到主体
    cropped = image.crop((0, 0, width, int(height * 0.92)))
    if target.suffix.lower() == ".png":
        cropped.save(target, optimize=True)
    else:
        cropped.save(target, quality=92)


if __name__ == "__main__":
    main()
