"""Generates the tray icons (0-100, idle, error) and the app icon.

Run: python3 scripts/make-icons.py   (needs Pillow)
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
TRAY = ROOT / "assets" / "tray"
TRAY.mkdir(parents=True, exist_ok=True)

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf"
SCALES = {"": 16, "@1.25x": 20, "@1.5x": 24, "@2x": 32}

OK = (31, 157, 99)
WARN = (214, 132, 8)
HIGH = (214, 52, 44)
GREY = (110, 110, 120)


def color(p):
    if p >= 90:
        return HIGH
    if p >= 75:
        return WARN
    return OK


def fit_font(text, box_w, box_h):
    size = box_h
    while size > 4:
        f = ImageFont.truetype(FONT, size)
        l, t, r, b = f.getbbox(text)
        if r - l <= box_w and b - t <= box_h:
            return f
        size -= 1
    return ImageFont.truetype(FONT, 4)


def tile(px, fill, text):
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = max(2, px // 5)
    d.rounded_rectangle([0, 0, px - 1, px - 1], radius=radius, fill=fill + (255,))
    pad = max(1, px // 16)
    f = fit_font(text, px - 2 * pad, int(px * 0.62))
    l, t, r, b = f.getbbox(text)
    x = (px - (r - l)) / 2 - l
    y = (px - (b - t)) / 2 - t
    d.text((x, y), text, font=f, fill=(255, 255, 255, 255))
    return img


def save_all(name, fill, text):
    for suffix, px in SCALES.items():
        tile(px, fill, text).save(TRAY / f"{name}{suffix}.png")


for p in range(0, 101):
    save_all(str(p), color(p), str(p))
save_all("idle", GREY, "…")
save_all("error", GREY, "!")


def app_icon(px):
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, px - 1, px - 1], radius=px // 5, fill=(32, 32, 36, 255))
    m = px * 0.16
    w = max(2, int(px * 0.11))
    box = [m, m, px - m, px - m]
    d.arc(box, start=135, end=405, fill=(70, 70, 78, 255), width=w)
    d.arc(box, start=135, end=135 + 270 * 0.62, fill=(217, 119, 87, 255), width=w)
    f = fit_font("%", px * 0.4, px * 0.36)
    l, t, r, b = f.getbbox("%")
    d.text(((px - (r - l)) / 2 - l, (px - (b - t)) / 2 - t + px * 0.04), "%", font=f, fill=(241, 241, 243, 255))
    return img


big = app_icon(256)
big.save(ROOT / "assets" / "icon.png")
big.save(ROOT / "assets" / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("icons written to", TRAY)
