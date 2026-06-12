#!/usr/bin/env python3
"""Generate the iMessage App Icon set for the Messages extension.

Messages app icons are 3:2 (not square), so the regular AppIcon set can't be
reused. This composites the app's existing 👋-on-black mark
(public/icon-512x512.png, which has transparent rounded-rect corners) centered
on an opaque black canvas at each required size. Messages applies its own corner
masking, so a full-bleed black background is correct.

Run from the repo root: python3 scripts/ios/gen-imessage-icon.py
Outputs PNGs + Contents.json into the extension's iMessage App Icon set.
The PNGs are committed (the .gitignore has an override for this catalog).
"""
import os
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(REPO, "public", "icon-512x512.png")
OUT = os.path.join(
    REPO, "ios", "App", "MessagesExtension", "Assets.xcassets",
    "iMessage App Icon.appiconset",
)

# (idiom, size-string, scale, pixel W, pixel H) — the canonical Xcode iMessage
# App Icon set. The marketing entry (1024x768) is the Messages App Store icon
# and is required for TestFlight/App Store acceptance.
SPEC = [
    ("universal",     "27x20",     "2x",   54,   40),
    ("universal",     "27x20",     "3x",   81,   60),
    ("universal",     "32x24",     "2x",   64,   48),
    ("universal",     "32x24",     "3x",   96,   72),
    ("iphone",        "60x45",     "2x",  120,   90),
    ("iphone",        "60x45",     "3x",  180,  135),
    ("ipad",          "67x50",     "2x",  134,  100),
    ("ipad",          "74x55",     "2x",  148,  110),
    ("ios-marketing", "1024x768",  "1x", 1024,  768),
]


def filename(w: int, h: int) -> str:
    return f"icon-{w}x{h}.png"


def render(src: Image.Image, w: int, h: int) -> Image.Image:
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 255))  # opaque black
    # Scale the mark to ~88% of the canvas height, centered.
    target = int(min(w, h) * 0.88)
    mark = src.resize((target, target), Image.LANCZOS)
    x = (w - target) // 2
    y = (h - target) // 2
    canvas.alpha_composite(mark, (x, y))
    return canvas.convert("RGB")  # icons must be opaque, no alpha


def contents_json() -> str:
    import json
    images = []
    for idiom, size, scale, w, h in SPEC:
        entry = {
            "filename": filename(w, h),
            "idiom": idiom,
            "platform": "ios",
            "scale": scale,
            "size": size,
        }
        images.append(entry)
    return json.dumps(
        {"images": images, "info": {"author": "xcode", "version": 1}},
        indent=2,
    ) + "\n"


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    src = Image.open(SRC).convert("RGBA")
    for idiom, size, scale, w, h in SPEC:
        render(src, w, h).save(os.path.join(OUT, filename(w, h)))
        print(f"  wrote {filename(w, h)} ({w}x{h})")
    with open(os.path.join(OUT, "Contents.json"), "w") as f:
        f.write(contents_json())
    print(f"  wrote Contents.json ({len(SPEC)} images)")


if __name__ == "__main__":
    main()
