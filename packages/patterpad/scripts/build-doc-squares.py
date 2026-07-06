#!/usr/bin/env python3
#
# Pad the page-shaped document-icon art (branding/document-icons/png/*-1024.png,
# taller than wide) onto a 1024x1024 TRANSPARENT square canvas, so the .icns /
# .ico build steps (build-mac-icons.sh / build-win-icons.mjs) can resize without
# stretching (sips -z forces an exact size and would distort a non-square source).
#
# Run by hand only when the page-shaped brand PNGs change - the squares it emits
# are committed and consumed by the icon build, which themselves run on package.
#
#   python3 packages/patterpad/scripts/build-doc-squares.py
#
# Input : branding/document-icons/png/{doc-patter,doc-patterproj,doc-patterc}-1024.png
# Output: branding/document-icons/square/{...}.png   (1024x1024, transparent pad)
#
# Requires Pillow (pip install Pillow); not a runtime/build dependency.

from pathlib import Path
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[3]
SRC = REPO_ROOT / "branding/document-icons/png"
OUT = REPO_ROOT / "branding/document-icons/square"
NAMES = ("doc-patter", "doc-patterproj", "doc-patterc", "doc-patterpack")
SIZE = 1024

OUT.mkdir(parents=True, exist_ok=True)
for name in NAMES:
    im = Image.open(SRC / f"{name}-1024.png").convert("RGBA")
    w, h = im.size
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - w) // 2, (side - h) // 2), im)
    if side != SIZE:
        canvas = canvas.resize((SIZE, SIZE), Image.LANCZOS)
    canvas.save(OUT / f"{name}.png")
    print(f"build-doc-squares: {name} {w}x{h} -> {SIZE}x{SIZE}")
