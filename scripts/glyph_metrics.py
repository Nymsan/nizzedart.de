#!/usr/bin/env python3
"""Measure the board's letters in the board font, for the table in js/glyph-metrics.js.

A letter on the board is a piece cut out around its own shape: it is as wide as
its ink, and the pieces are spaced evenly, edge to edge, without the font's
side bearings or kerning. The piece is drawn so that its ink is centred across
it, and so that the middle of the capitals is on the groove. The @ is centred
on its own ink instead: it has no place in a line of capitals. The arrow is not
a letter of the font but a drawing of its own (ARROW in js/board-view.js),
centred on its piece.

Everything is measured at the weight and size the board draws its letters in
(see .glyph in styles.css), and written out as js/glyph-metrics.js:

    python3 scripts/glyph_metrics.py fonts/NationalPark.woff2 > js/glyph-metrics.js

Needs fontTools (and brotli to read .woff2).
"""

import json
import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

# Keep in step with js/glyphs.js and .glyph in styles.css.
ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ0123456789@*'>-_,"
FONT_SIZE = 58.93  # board units: capitals 41.25 units tall
WEIGHT = 650
CENTRED = {"@"}  # centred on their own ink, not on the capitals
DRAWN = {">": 50.57}  # pieces that are drawings, not letters of the font: their width in board units


def instance(font):
    """The font at the weight of the board, if it is a variable font."""
    if "fvar" not in font:
        return font
    from fontTools.varLib import instancer

    location = {}
    for axis in font["fvar"].axes:
        wanted = WEIGHT if axis.axisTag == "wght" else axis.defaultValue
        location[axis.axisTag] = min(axis.maxValue, max(axis.minValue, wanted))
    return instancer.instantiateVariableFont(font, location)


def vertical_metrics(font):
    """Ascent and descent of a line, as browsers lay it out."""
    os2 = font["OS/2"]
    if os2.fsSelection & (1 << 7):  # USE_TYPO_METRICS
        return os2.sTypoAscender, -os2.sTypoDescender
    return font["hhea"].ascent, -font["hhea"].descent


def measure(path):
    font = instance(TTFont(path))
    upm = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    glyphs = font.getGlyphSet()
    ascent, descent = vertical_metrics(font)
    cap_middle = font["OS/2"].sCapHeight / 2

    # A glyph is laid out in a box one font size tall (line-height: 1) and as
    # wide as its advance, which the piece centres. Below, offsets are from the
    # middle of that box, in font units, downwards and to the right.
    baseline = (ascent - descent) / 2

    pieces, missing = {}, []
    for ch in ALPHABET:
        if ch in DRAWN:
            pieces[ch] = (DRAWN[ch], 0, 0)
            continue
        name = cmap.get(ord(ch))
        if name is None:
            missing.append(ch)
            continue
        pen = BoundsPen(glyphs)
        glyphs[name].draw(pen)
        x_min, y_min, x_max, y_max = pen.bounds
        advance = font["hmtx"][name][0]

        ink_x = (x_min + x_max) / 2 - advance / 2  # ink middle, from the middle of the box
        ink_y = baseline - (y_min + y_max) / 2
        # Where the ink middle should end up, from the middle of the piece.
        want_y = 0 if ch in CENTRED else cap_middle - (y_min + y_max) / 2
        dx = -ink_x
        dy = want_y - ink_y
        pieces[ch] = ((x_max - x_min) * FONT_SIZE / upm, dx / upm, dy / upm)
    return pieces, missing


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    pieces, missing = measure(sys.argv[1])
    if missing:
        sys.exit(f"Not in the font: {' '.join(missing)}")

    print(f"// Measured from {sys.argv[1]} by scripts/glyph_metrics.py. Do not edit by hand.")
    print("// For each letter: how wide its piece is, in board units, and how far to move")
    print("// the glyph, in em, so its ink sits in the middle of the piece.")
    print()
    print("export const PIECES = {")
    for ch, (width, dx, dy) in pieces.items():
        print(f"  {js_key(ch)}: [{round(width)}, {dx:.4f}, {dy:.4f}],")
    print("};")


def js_key(ch):
    return ch if ch.isalnum() else json.dumps(ch, ensure_ascii=False)


if __name__ == "__main__":
    main()
