#!/usr/bin/env python3
"""Split the AI-generated instrument grid images in public/icons/sessions/ into
one square, transparent PNG per instrument.

Each grid cell holds a black line-art icon on white with a printed Korean label
underneath. We crop the cell, drop the label band, trim to the icon bbox, pad to
a centered square, resize to a uniform size, and key the white background out to
transparency (luminance -> alpha, black ink). Duplicate instruments (None in the
name list) are skipped. A labelled montage is written for visual verification.
"""
import os, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont

SRC = os.path.dirname(os.path.abspath(__file__)) + "/../public/icons/sessions"
SRC = os.path.normpath(SRC)
OUT = SRC
SIZE = 512          # uniform square output
MARGIN_FRAC = 0.12  # padding around trimmed icon
INSET = 8           # px inset per cell side to avoid neighbour/border bleed
INK = 200           # gray < INK is "ink"

# (filename, cols, rows, [ (slug, korean) | None ]) — order = left->right, top->bottom
GRIDS = [
    ("0.png", 4, 3, [
        ("vocal","보컬"), ("trumpet","트럼펫"), ("alto-saxophone","알토색소폰"), ("piano","피아노"),
        ("drum-kit","드럼"), ("contrabass","콘트라베이스"), ("electric-guitar","일렉기타"), ("vibraphone","비브라폰"),
        ("drum-kit-synth","드럼킷신스"), ("drum-kit-acoustic","드럼킷어쿠스틱"), ("drum-kit-brushes","드럼킷브러시"), ("drum-kit-latin","드럼킷라틴"),
    ]),
    ("2.png", 4, 2, [
        ("cornet","코넷"), ("flugelhorn","플뤼겔호른"), ("trombone","트롬본"), ("clarinet","클라리넷"),
        ("flute","플루트"), ("archtop-guitar","아치탑재즈기타"), ("electric-bass","일렉트릭베이스"), ("violin","바이올린"),
    ]),
    ("3.png", 4, 2, [
        ("bongos","봉고"), ("timbales","팀발레스"), ("cajon","카혼"), ("tambourine","탬버린"),
        ("maracas","마라카스"), ("cowbell","카우벨"), ("triangle","트라이앵글"), None,  # vibraphone dup
    ]),
    ("4.png", 4, 2, [
        ("marimba","마림바"), ("glockenspiel","글로켄슈필"), ("tubular-bells","튜뷸러벨"), ("handpan","핸드팬"),
        ("chromatic-harmonica","크로매틱하모니카"), ("whistling","휘파람"), ("kazoo","카주"), ("jug","저그"),
    ]),
    ("5.png", 4, 2, [
        None, ("djembe","젬베"), None, None,                       # cajon, _, tambourine, maracas dup
        ("cabasa","카바사"), None, ("shaker","쉐이커"), ("ukulele","우쿨렐레"),  # triangle dup
    ]),
    ("6.png", 4, 2, [
        None, ("agogo-bells","아고고벨"), ("guiro","귀로"), ("claves","클라베스"),  # cabasa dup
        ("pandeiro","판데이루"), ("steelpan","스틸팬"), None, ("woodblock","우드블록"),  # djembe dup
    ]),
    ("7.png", 4, 2, [
        ("accordion","아코디언"), ("harp","하프"), None, ("cello","첼로"),  # violin dup
        None, ("piccolo","피콜로"), ("french-horn","프렌치호른"), None,      # harmonica, electric-bass dup
    ]),
    ("image.png", 4, 2, [
        ("upright-piano","업라이트피아노"), ("rhodes-piano","로즈피아노"), ("hammond-organ","해먼드오르간"), None,  # accordion dup
        ("soprano-saxophone","소프라노색소폰"), ("tenor-saxophone","테너색소폰"), ("baritone-saxophone","바리톤색소폰"), None,  # trombone dup
    ]),
]


def extract_icon(cell):
    """Drop the printed label band (bottom-most ink band) and trim to icon bbox."""
    g = np.asarray(cell.convert("L"))
    h, w = g.shape
    ink = g < INK
    row_has = ink.sum(axis=1) > 2
    rows = np.where(row_has)[0]
    if len(rows) == 0:
        return None, "blank"
    # group inked rows into vertical bands (gap > 6 px splits)
    bands = []
    start = prev = rows[0]
    for r in rows[1:]:
        if r - prev > 6:
            bands.append((start, prev)); start = r
        prev = r
    bands.append((start, prev))
    # the label is the bottom-most band when it sits in the lower part of the cell
    if len(bands) >= 2 and bands[-1][0] > h * 0.55:
        cut = bands[-1][0]
        flag = "ok"
    elif bands[-1][1] > h * 0.80:
        cut = int(h * 0.80); flag = "fallback-cut"
    else:
        cut = h; flag = "no-label?"
    region = ink[:cut, :]
    rr = np.where(region.sum(axis=1) > 2)[0]
    cc = np.where(region.sum(axis=0) > 2)[0]
    if len(rr) == 0 or len(cc) == 0:
        return None, "blank-after-cut"
    return cell.crop((int(cc[0]), int(rr[0]), int(cc[-1]) + 1, int(rr[-1]) + 1)), flag


def to_square_transparent(icon):
    w, h = icon.size
    side = max(w, h)
    m = int(side * MARGIN_FRAC)
    cs = side + 2 * m
    canvas = Image.new("RGB", (cs, cs), (255, 255, 255))
    canvas.paste(icon, ((cs - w) // 2, (cs - h) // 2))
    canvas = canvas.resize((SIZE, SIZE), Image.LANCZOS)
    lum = np.asarray(canvas.convert("L")).astype(np.int16)
    alpha = np.clip(255 - lum, 0, 255).astype(np.uint8)
    alpha[lum >= 245] = 0
    rgb = np.zeros((SIZE, SIZE, 3), dtype=np.uint8)   # pure black ink
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


def main():
    saved = []   # (slug, ko, file, grid, flag)
    for fname, cols, rows, names in GRIDS:
        img = Image.open(os.path.join(SRC, fname)).convert("RGB")
        W, H = img.size
        cw, ch = W / cols, H / rows
        for i, entry in enumerate(names):
            if entry is None:
                continue
            slug, ko = entry
            r, c = divmod(i, cols)
            box = (int(c * cw) + INSET, int(r * ch) + INSET,
                   int((c + 1) * cw) - INSET, int((r + 1) * ch) - INSET)
            icon, flag = extract_icon(img.crop(box))
            if icon is None:
                print(f"!! {slug} ({fname} cell {i}): {flag}")
                continue
            out = to_square_transparent(icon)
            outname = f"{slug}_{ko}.png"
            out.save(os.path.join(OUT, outname))
            saved.append((slug, ko, outname, fname, flag))
            print(f"  {outname:40s}  <- {fname} cell {i}  [{flag}]")

    # manifest
    manifest = [{"slug": s, "ko": k, "file": f} for (s, k, f, g, fl) in saved]
    with open(os.path.join(OUT, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)

    # montage (white bg, slug label) for visual verification
    n = len(saved)
    mc = 7
    mr = (n + mc - 1) // mc
    cell, pad, labelh = 200, 12, 22
    MW = mc * (cell + pad) + pad
    MH = mr * (cell + pad + labelh) + pad
    mont = Image.new("RGB", (MW, MH), (245, 245, 245))
    draw = ImageDraw.Draw(mont)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 14)
    except Exception:
        font = ImageFont.load_default()
    for idx, (s, k, f, g, fl) in enumerate(saved):
        gr, gc = divmod(idx, mc)
        x = pad + gc * (cell + pad)
        y = pad + gr * (cell + pad + labelh)
        Image.new("RGB", (cell, cell), (255, 255, 255))
        ic = Image.open(os.path.join(OUT, f)).convert("RGBA").resize((cell, cell))
        bg = Image.new("RGB", (cell, cell), (255, 255, 255))
        bg.paste(ic, (0, 0), ic)
        mont.paste(bg, (x, y))
        col = (200, 0, 0) if fl != "ok" else (20, 20, 20)
        draw.text((x + 2, y + cell + 3), f"{idx+1}.{s}", fill=col, font=font)
    mont.save(os.path.join(OUT, "_montage.png"))
    print(f"\nSaved {n} icons. Montage -> _montage.png")
    flags = [(s, fl) for (s, k, f, g, fl) in saved if fl != "ok"]
    if flags:
        print("Flags (review):", flags)


if __name__ == "__main__":
    main()
