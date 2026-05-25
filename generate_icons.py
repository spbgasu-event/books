#!/usr/bin/env python3
"""
Генерирует иконки PWA для LinguaRead.

Айдентика:
- Фон: тёмный (--bg #0e0e0f) с легчайшим радиальным акцентом
- Лого: буква 'L' цвета --accent (#c8a96e), Playfair Display-подобный засечный шрифт
- Maskable: с безопасной зоной 20% по периметру (Android обрежет в форму платформы)
"""

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT_DIR = Path(__file__).parent / "icons"
OUT_DIR.mkdir(exist_ok=True)

BG = (14, 14, 15)
ACCENT = (200, 169, 110)
ACCENT2 = (126, 184, 201)
SUBTLE = (40, 32, 18)

FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"


def make_icon(size: int, maskable: bool = False) -> Image.Image:
    """Создаёт квадратную иконку.

    Для maskable иконок реальный логотип занимает только центральные 60% площади
    (safe zone), остальное — фон, который Android может скруглить или обрезать.
    """
    img = Image.new("RGB", (size, size), BG)
    draw = ImageDraw.Draw(img, "RGBA")

    cx, cy = size / 2, size / 2
    max_r = int(size * 0.7)
    for r in range(max_r, 0, -2):
        alpha = int(30 * (1 - r / max_r) ** 2)
        if alpha <= 0:
            continue
        draw.ellipse(
            (cx - r, cy - r, cx + r, cy + r),
            fill=(*ACCENT, alpha),
        )

    if maskable:
        logo_area = int(size * 0.6)
    else:
        logo_area = int(size * 0.85)

    font_size = int(logo_area * 0.85)
    font = ImageFont.truetype(FONT_PATH, font_size)

    text = "L"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (size - tw) / 2 - bbox[0]
    ty = (size - th) / 2 - bbox[1] - int(size * 0.02)

    draw.text((tx, ty), text, font=font, fill=ACCENT)

    dot_r = max(2, int(size * 0.025))
    dot_x = tx + tw + int(size * 0.01)
    dot_y = ty + th - dot_r * 2
    draw.ellipse(
        (dot_x, dot_y, dot_x + dot_r * 2, dot_y + dot_r * 2),
        fill=ACCENT2,
    )

    return img


for size in (192, 512):
    icon = make_icon(size, maskable=False)
    icon.save(OUT_DIR / f"icon-{size}.png", optimize=True)
    print(f"icon-{size}.png saved")

    masked = make_icon(size, maskable=True)
    masked.save(OUT_DIR / f"icon-maskable-{size}.png", optimize=True)
    print(f"icon-maskable-{size}.png saved")

print("Готово.")
