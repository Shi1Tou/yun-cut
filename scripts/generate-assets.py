from __future__ import annotations

import math
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
PUBLIC.mkdir(exist_ok=True)

FONT_REGULAR = "C:/Windows/Fonts/msyh.ttc"
FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
FONT_MONO = "C:/Windows/Fonts/consola.ttf"


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.truetype(FONT_REGULAR, size)


def linear_gradient(size: int, start: tuple[int, int, int], end: tuple[int, int, int]) -> Image.Image:
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    t = np.clip((x + y) / (2 * (size - 1)), 0, 1)
    rgb = np.stack([
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
        start[2] + (end[2] - start[2]) * t,
    ], axis=-1).astype(np.uint8)
    alpha = np.full((size, size, 1), 255, dtype=np.uint8)
    return Image.fromarray(np.concatenate([rgb, alpha], axis=-1), "RGBA")


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def make_icon(size: int) -> Image.Image:
    scale = 4
    s = size * scale
    radius = int(s * 0.29)
    base = linear_gradient(s, (59, 130, 246), (139, 92, 246))
    base.putalpha(rounded_mask(s, radius))

    shadow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((s * 0.2, s * 0.22, s * 0.75, s * 0.85), radius=int(s * 0.11), fill=(49, 46, 129, 70))
    shadow = shadow.filter(ImageFilter.GaussianBlur(int(s * 0.035)))
    base = Image.alpha_composite(base, shadow)

    card1 = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d1 = ImageDraw.Draw(card1)
    d1.rounded_rectangle((s * 0.2, s * 0.17, s * 0.62, s * 0.8), radius=int(s * 0.09), fill=(255, 255, 255, 72))
    card1 = card1.rotate(-9, resample=Image.Resampling.BICUBIC, center=(s * 0.4, s * 0.48))
    base = Image.alpha_composite(base, card1)

    card2 = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d2 = ImageDraw.Draw(card2)
    d2.rounded_rectangle((s * 0.29, s * 0.21, s * 0.68, s * 0.82), radius=int(s * 0.085), fill=(255, 255, 255, 255))
    base = Image.alpha_composite(base, card2)

    draw = ImageDraw.Draw(base)
    line_color = (79, 70, 229, 255)
    x1, x2 = int(s * 0.375), int(s * 0.585)
    for y, width in [(0.38, 0.21), (0.47, 0.21), (0.56, 0.135)]:
        draw.rounded_rectangle((x1, int(s * y), x1 + int(s * width), int(s * y + s * 0.026)), radius=int(s * 0.013), fill=line_color)
    draw.ellipse((s * 0.29, s * 0.21, s * 0.35, s * 0.27), fill=(255, 255, 255, 255))
    draw.ellipse((s * 0.305, s * 0.225, s * 0.335, s * 0.255), fill=(99, 102, 241, 255))
    return base.resize((size, size), Image.Resampling.LANCZOS)


def make_og() -> Image.Image:
    width, height = 1200, 630
    base = Image.new("RGB", (width, height), "#f7f9fd")
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.ellipse((-220, -260, 460, 380), fill=(59, 130, 246, 46))
    od.ellipse((760, -190, 1360, 330), fill=(139, 92, 246, 38))
    od.ellipse((660, 360, 1240, 820), fill=(6, 182, 212, 22))
    overlay = overlay.filter(ImageFilter.GaussianBlur(95))
    base = Image.alpha_composite(base.convert("RGBA"), overlay)

    draw = ImageDraw.Draw(base)
    # top brand
    icon = make_icon(44)
    base.alpha_composite(icon, (74, 58))
    draw.text((130, 66), "云夹", font=font(FONT_BOLD, 24), fill=(16, 24, 40))
    draw.text((74, 116), "YUNCLIP  /  ONLINE CLIPBOARD", font=font(FONT_MONO, 13), fill=(100, 116, 139))

    # headline
    draw.text((74, 184), "文字留在云端，", font=font(FONT_BOLD, 68), fill=(16, 24, 40))
    draw.text((74, 265), "灵感跟着你走。", font=font(FONT_BOLD, 68), fill=(49, 94, 251))
    draw.text((78, 364), "免登录 · 跨设备 · 即写即达", font=font(FONT_REGULAR, 24), fill=(71, 85, 105))

    # chips
    chips = [("无需注册", 78, 425, 132), ("自动保存", 224, 425, 132), ("密码保护", 370, 425, 132)]
    for label, x, y, w in chips:
        draw.rounded_rectangle((x, y, x + w, y + 38), radius=19, fill=(255, 255, 255, 220), outline=(226, 232, 240), width=1)
        draw.text((x + 20, y + 8), label, font=font(FONT_REGULAR, 16), fill=(71, 85, 105))

    draw.text((78, 560), "EDGEONE PAGES  ·  YOUR DATA, YOUR KV", font=font(FONT_MONO, 12), fill=(148, 163, 184))

    # card shadow
    shadow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((744, 112, 1112, 526), radius=30, fill=(15, 23, 42, 55))
    shadow = shadow.filter(ImageFilter.GaussianBlur(28))
    base = Image.alpha_composite(base, shadow)

    card = Image.new("RGBA", (390, 420), (0, 0, 0, 0))
    cd = ImageDraw.Draw(card)
    cd.rounded_rectangle((0, 0, 389, 419), radius=26, fill=(255, 255, 255, 255), outline=(226, 232, 240), width=1)
    # top bar
    cd.rounded_rectangle((0, 0, 389, 56), radius=26, fill=(248, 250, 253, 255))
    cd.rectangle((0, 30, 389, 56), fill=(248, 250, 253, 255))
    for i, color in enumerate([(255, 138, 128), (255, 209, 102), (110, 231, 183)]):
        cd.ellipse((20 + i * 13, 22, 27 + i * 13, 29), fill=color)
    cd.text((68, 18), "/n/design-notes", font=font(FONT_MONO, 12), fill=(148, 163, 184))
    cd.text((24, 82), "周五的产品草稿", font=font(FONT_BOLD, 27), fill=(16, 24, 40))
    lines = [
        "把「复制」这件事，做得再轻一点。",
        "1. 打开就能写，不打断思路",
        "2. 换设备时，链接还在原地",
        "3. 只留下真正重要的内容",
    ]
    for i, line in enumerate(lines):
        color = (100, 116, 139) if i else (71, 85, 105)
        cd.text((24, 132 + i * 39), line, font=font(FONT_REGULAR, 15), fill=color)
    cd.line((24, 320, 365, 320), fill=(232, 237, 244), width=1)
    cd.text((24, 338), "326 字", font=font(FONT_MONO, 11), fill=(148, 163, 184))
    cd.rounded_rectangle((276, 332, 365, 362), radius=15, fill=(234, 240, 255))
    cd.text((291, 340), "已加密", font=font(FONT_REGULAR, 12), fill=(49, 94, 251))
    cd.rounded_rectangle((24, 382, 365, 384), radius=1, fill=(49, 94, 251, 20))
    cd.rounded_rectangle((24, 380, 240, 386), radius=3, fill=(49, 94, 251))

    base.alpha_composite(card, (744, 112))
    return base.convert("RGB")


def main() -> None:
    icon = make_icon(512)
    icon.save(PUBLIC / "icon-512.png")
    icon.resize((180, 180), Image.Resampling.LANCZOS).save(PUBLIC / "apple-touch-icon.png")
    icon.resize((32, 32), Image.Resampling.LANCZOS).save(PUBLIC / "favicon-32.png")
    icon.save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    make_og().save(PUBLIC / "og.png", optimize=True)
    print("assets generated")


if __name__ == "__main__":
    main()
