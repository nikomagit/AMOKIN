"""Build 2:3 LATAM TV posters from public channel logos.

This is a development-only asset generator. The generated PNG files are served
by AMOKIN; Pillow is not needed by the production application.
"""

from __future__ import annotations

import io
import json
import textwrap
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


LOGOS_INDEX = "https://iptv-org.github.io/api/logos.json"
OUTPUT = Path(__file__).resolve().parents[1] / "assets" / "latam-tv" / "posters"
USER_AGENT = "AMOKIN poster builder/1.0"

# slug: (display name, genre, iptv-org channel id)
CHANNELS: dict[str, tuple[str, str, str | None]] = {
    "directvsports": ("DSport", "Deportes", "DSports.us"),
    "directvsportsplus": ("DSport+", "Deportes", "DSportsPlus.us"),
    "espn": ("ESPN", "Deportes", "ESPNLatinAmerica.us"),
    "espn2": ("ESPN2", "Deportes", "ESPN2LatinAmerica.us"),
    "espn3": ("ESPN3", "Deportes", "ESPN3LatinAmerica.us"),
}
OVERRIDES: dict[str, str] = {}


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=25) as response:
        return response.read()


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def source_index() -> dict[str, list[str]]:
    records = json.loads(fetch(LOGOS_INDEX))
    selected: dict[str, list[str]] = {}
    for record in records:
        channel = record.get("channel")
        image_format = str(record.get("format", "")).upper()
        if (
            channel
            and record.get("in_use")
            and image_format in {"PNG", "JPEG", "JPG", "WEBP", "SVG"}
        ):
            selected.setdefault(channel, []).append(record["url"])
    for urls in selected.values():
        urls.sort(key=lambda url: ("upload.wikimedia.org" in url, "wikimedia.org" in url))
    return selected


LOGO_CACHE: dict[str, Image.Image | None] = {}


def logo_image(urls: list[str]) -> Image.Image | None:
    for url in urls:
        download_url = url
        if "upload.wikimedia.org" in url or url.lower().endswith(".svg"):
            encoded = urllib.parse.quote(url, safe="")
            download_url = f"https://wsrv.nl/?url={encoded}&w=400&output=png"
        if download_url not in LOGO_CACHE:
            try:
                LOGO_CACHE[download_url] = Image.open(io.BytesIO(fetch(download_url))).convert("RGBA")
            except Exception:  # one bad public logo must not stop the full set
                LOGO_CACHE[download_url] = None
        cached = LOGO_CACHE[download_url]
        if cached:
            image = cached.copy()
            image.thumbnail((360, 190), Image.Resampling.LANCZOS)
            return image
    return None


def make_poster(name: str, genre: str, logo: Image.Image | None) -> Image.Image:
    width, height = 480, 720
    top = (8, 50, 76) if genre == "Deportes" else (58, 24, 88)
    bottom = (3, 12, 22) if genre == "Deportes" else (17, 8, 28)
    poster = Image.new("RGB", (width, height))
    pixels = poster.load()
    for y in range(height):
        ratio = y / (height - 1)
        color = tuple(round(top[i] * (1 - ratio) + bottom[i] * ratio) for i in range(3))
        for x in range(width):
            pixels[x, y] = color

    draw = ImageDraw.Draw(poster)
    accent = (20, 210, 170) if genre == "Deportes" else (224, 108, 255)
    draw.rounded_rectangle((30, 30, 190, 75), radius=22, fill=accent)
    draw.text((50, 43), genre.upper(), font=font(19), fill=(5, 15, 22))
    draw.rounded_rectangle((40, 145, 440, 385), radius=28, fill=(250, 250, 252))

    if logo:
        x = (width - logo.width) // 2
        y = 265 - logo.height // 2
        poster.paste(logo, (x, y), logo)
    else:
        initials = "".join(word[0] for word in name.split()[:3])
        fallback_font = font(82)
        bounds = draw.textbbox((0, 0), initials, font=fallback_font)
        draw.text(((width - (bounds[2] - bounds[0])) / 2, 215), initials, font=fallback_font, fill=top)

    name_font = font(38 if len(name) < 19 else 32)
    lines = textwrap.wrap(name, width=19 if len(name) < 19 else 23) or [name]
    lines = lines[:3]
    total = sum(draw.textbbox((0, 0), line, font=name_font)[3] + 8 for line in lines)
    y = 500 - total / 2
    for line in lines:
        bounds = draw.textbbox((0, 0), line, font=name_font)
        draw.text(((width - (bounds[2] - bounds[0])) / 2, y), line, font=name_font, fill=(255, 255, 255))
        y += bounds[3] + 8

    draw.text((40, 660), "AMOKIN  •  EN VIVO", font=font(19), fill=(180, 194, 206))
    return poster


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    logos = source_index()
    with_logo = 0
    for slug, (name, genre, channel_id) in CHANNELS.items():
        sources = ([OVERRIDES[slug]] if slug in OVERRIDES else (logos.get(channel_id, []) if channel_id else []))
        logo = logo_image(sources)
        with_logo += int(logo is not None)
        make_poster(name, genre, logo).save(OUTPUT / f"{slug}.png", optimize=True)
        print(f"{slug}: {'logo' if logo else 'text fallback'}")
    print(f"Generated {len(CHANNELS)} posters ({with_logo} with public logos)")


if __name__ == "__main__":
    main()
