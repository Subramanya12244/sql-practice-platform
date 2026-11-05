"""Build the "core" DejaVu subsets used by Visual Learning Notes PDFs.

The subsets cover what DataForge content uses: Latin, Latin-1 and Latin Extended-A, punctuation,
super/subscript digits, € and ₹, arrows, common maths, a few box/shape glyphs and check marks.
Hinting is dropped (irrelevant in PDFs).
Documents containing any character outside these ranges fall back to the full fonts at runtime,
so Unicode coverage is unchanged. Also writes core-ranges.json, which the PDF worker reads.

Usage (fontTools 4.55.3):  python scripts/subset_pdf_fonts.py
"""
import json, os
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "frontend/node_modules/dejavu-fonts-ttf/ttf")
OUT = os.path.join(ROOT, "frontend/src/site/lib/notes/fonts")
RANGES = [(0x20, 0x7E), (0xA0, 0x17F), (0x2010, 0x2027), (0x2030, 0x203A), (0x2070, 0x2079), (0x2080, 0x2089), (0x20AC, 0x20AC), (0x20B9, 0x20B9),
          (0x2122, 0x2122), (0x2190, 0x2199), (0x21AA, 0x21AA), (0x21D0, 0x21D4), (0x2200, 0x2264), (0x2265, 0x2265), (0x2500, 0x2503), (0x2514, 0x251C), (0x25A0, 0x25CF),
          (0x2605, 0x2606), (0x26A0, 0x26A0), (0x2713, 0x2718), (0xFFFD, 0xFFFD)]
FILES = ["DejaVuSans", "DejaVuSans-Bold", "DejaVuSans-Oblique", "DejaVuSansMono", "DejaVuSansMono-Bold"]

os.makedirs(OUT, exist_ok=True)
covered = None
for name in FILES:
    opts = subset.Options()
    opts.hinting = False
    opts.layout_features = ["kern", "liga", "ccmp", "locl", "mark", "mkmk"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    font = TTFont(os.path.join(SRC, name + ".ttf"))
    s = subset.Subsetter(opts)
    s.populate(unicodes=[u for a, b in RANGES for u in range(a, b + 1)])
    s.subset(font)
    path = os.path.join(OUT, name + ".core.ttf")
    font.save(path)
    cmap = set(font.getBestCmap())
    covered = cmap if covered is None else covered & cmap
    print(f"{name}: {os.path.getsize(os.path.join(SRC, name + '.ttf')):>8} -> {os.path.getsize(path):>7} bytes, {len(cmap)} chars")

def to_ranges(points):
    out = []
    for p in sorted(points):
        if out and p == out[-1][1] + 1:
            out[-1][1] = p
        else:
            out.append([p, p])
    return out

# Code points every core font can draw, and every full font can draw (the fallback is only
# worth loading for characters the full fonts actually contain).
full = None
for name in FILES:
    cmap = set(TTFont(os.path.join(SRC, name + ".ttf")).getBestCmap())
    full = cmap if full is None else full & cmap
for fname, pts in (("core-ranges.json", covered), ("full-ranges.json", full)):
    r = to_ranges(pts)
    with open(os.path.join(OUT, fname), "w") as f:
        json.dump(r, f, separators=(",", ":"))
    print(fname, len(pts), "code points in", len(r), "ranges")
