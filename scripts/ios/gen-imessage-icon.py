#!/usr/bin/env python3
"""Generate the iMessage App Icon set for the Messages extension.

actool requires the COMPLETE Xcode-canonical iMessage App Icon set (13 images):
square 29x29 app-icon sizes + square 1024x1024 marketing + the 3:2 Messages
sizes + the 1024x768 Messages App Store icon. A partial set fails the asset
catalog compile during archive. The SPEC + filenames here mirror exactly what
Xcode emits (including the per-entry `platform` field, present only on the
universal + 1024x768 entries).

This composites the app's existing 👋-on-black mark (public/icon-512x512.png,
which has transparent rounded-rect corners) centered on an opaque black canvas
at each size — square entries render square, 3:2 entries render 3:2. Messages
applies its own corner masking, so a full-bleed black background is correct.

Run from the repo root: python3 scripts/ios/gen-imessage-icon.py
Outputs PNGs + Contents.json into the extension's iMessage App Icon set.
The PNGs are committed (the .gitignore has an override for this catalog).
"""
import json
import os
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO, "public", "icon-512x512.png")
OUT = os.path.join(
    REPO, "ios", "App", "MessagesExtension", "Assets.xcassets",
    "iMessage App Icon.appiconset",
)

# (idiom, size, scale, platform|None, pixel W, pixel H) — the canonical Xcode
# iMessage App Icon set. Order + fields mirror Xcode's output exactly.
SPEC = [
    ("iphone",        "29x29",    "2x", None,    58,   58),
    ("iphone",        "29x29",    "3x", None,    87,   87),
    ("iphone",        "60x45",    "2x", None,   120,   90),
    ("iphone",        "60x45",    "3x", None,   180,  135),
    ("ipad",          "29x29",    "2x", None,    58,   58),
    ("ipad",          "67x50",    "2x", None,   134,  100),
    ("ipad",          "74x55",    "2x", None,   148,  110),
    ("ios-marketing", "1024x1024","1x", None,  1024, 1024),
    ("universal",     "27x20",    "2x", "ios",   54,   40),
    ("universal",     "27x20",    "3x", "ios",   81,   60),
    ("universal",     "32x24",    "2x", "ios",   64,   48),
    ("universal",     "32x24",    "3x", "ios",   96,   72),
    ("ios-marketing", "1024x768", "1x", "ios", 1024,  768),
]


def filename(idiom: str, size: str, scale: str) -> str:
    return f"{idiom}_{size}_{scale}.png"


def render(src: Image.Image, w: int, h: int) -> Image.Image:
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 255))  # opaque black
    target = int(min(w, h) * 0.88)  # ~88% of the short edge, centered
    mark = src.resize((target, target), Image.LANCZOS)
    canvas.alpha_composite(mark, ((w - target) // 2, (h - target) // 2))
    return canvas.convert("RGB")  # icons must be opaque, no alpha


def contents_json() -> str:
    images = []
    for idiom, size, scale, platform, _w, _h in SPEC:
        entry = {
            "size": size,
            "idiom": idiom,
            "filename": filename(idiom, size, scale),
            "scale": scale,
        }
        if platform:
            entry["platform"] = platform
        images.append(entry)
    return json.dumps(
        {"images": images, "info": {"version": 1, "author": "xcode"}},
        indent=2,
    ) + "\n"


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    # Clear any stale PNGs from a prior naming scheme.
    for f in os.listdir(OUT):
        if f.endswith(".png"):
            os.remove(os.path.join(OUT, f))
    src = Image.open(SRC).convert("RGBA")
    for idiom, size, scale, _platform, w, h in SPEC:
        name = filename(idiom, size, scale)
        render(src, w, h).save(os.path.join(OUT, name))
        print(f"  wrote {name} ({w}x{h})")
    with open(os.path.join(OUT, "Contents.json"), "w") as f:
        f.write(contents_json())
    print(f"  wrote Contents.json ({len(SPEC)} images)")


if __name__ == "__main__":
    main()
