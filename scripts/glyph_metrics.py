#!/usr/bin/env python3
"""Measure the board's letters in a font file, for the tables in js/glyphs.js.

Each letter on a board is as wide as its advance in the font: the letter plus
the space the type designer put on either side of it. Pairs the font kerns
(A next to V, L next to T, ...) get the font's kerning too. Everything is
measured at the size, weight and optical size the board draws its letters in
(see .glyph in styles.css), and written out in board units as js/glyph-metrics.js:

    python3 scripts/glyph_metrics.py fonts/FiraSans-SemiBold.woff2 > js/glyph-metrics.js

Needs fontTools (and brotli to read .woff2).
"""

import json
import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

# Keep in step with js/glyphs.js and .glyph in styles.css.
ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ0123456789@*'<"
PRINTED = {"<": "←"}
FONT_SIZE = 46.4  # board units
ARROW_SIZE = 40
AXES = {"wght": 600}  # only used if the font is a variable font


def instance(font):
    """The font at the weight and optical size of the board, if it is a variable font."""
    if "fvar" not in font:
        return font
    from fontTools.varLib import instancer

    location = {}
    for axis in font["fvar"].axes:
        wanted = AXES.get(axis.axisTag, axis.defaultValue)
        location[axis.axisTag] = min(axis.maxValue, max(axis.minValue, wanted))
    return instancer.instantiateVariableFont(font, location)


def kerning_lookups(gpos):
    """The pair adjustment subtables of the font's 'kern' feature, in the order they apply."""
    table = gpos.table
    indices = sorted(
        {index for record in table.FeatureList.FeatureRecord if record.FeatureTag == "kern" for index in record.Feature.LookupListIndex}
    )
    for index in indices:
        lookup = table.LookupList.Lookup[index]
        subtables = []
        for subtable in lookup.SubTable:
            if lookup.LookupType == 9:
                subtable = subtable.ExtSubTable
            if subtable.LookupType == 2:
                subtables.append(subtable)
        if subtables:
            yield subtables


def pair_kerning(subtables, left, right):
    """The kerning of one lookup for a pair of glyph names, or None if the lookup has nothing to say."""
    for subtable in subtables:
        if left not in subtable.Coverage.glyphs:
            continue
        if subtable.Format == 1:
            pairs = subtable.PairSet[subtable.Coverage.glyphs.index(left)].PairValueRecord
            for record in pairs:
                if record.SecondGlyph == right:
                    return getattr(record.Value1, "XAdvance", 0) or 0
            continue
        first = subtable.ClassDef1.classDefs.get(left, 0)
        second = subtable.ClassDef2.classDefs.get(right, 0)
        value = subtable.Class1Record[first].Class2Record[second].Value1
        return getattr(value, "XAdvance", 0) or 0
    return None


def measure(path):
    font = instance(TTFont(path))
    per_unit = 1 / font["head"].unitsPerEm
    cmap = font.getBestCmap()
    glyphs = font.getGlyphSet()
    names = {ch: cmap.get(ord(PRINTED.get(ch, ch))) for ch in ALPHABET}

    def size(ch):
        return ARROW_SIZE if ch == "<" else FONT_SIZE

    widths, ink, missing = {}, {}, []
    for ch, name in names.items():
        if name is None:
            missing.append(ch)
            continue
        widths[ch] = font["hmtx"][name][0] * per_unit * size(ch)
        pen = BoundsPen(glyphs)
        glyphs[name].draw(pen)
        if pen.bounds:
            x_min, _, x_max, _ = pen.bounds
            ink[ch] = (x_max - x_min) * per_unit * size(ch)

    kerning = {}
    if "GPOS" in font:
        lookups = list(kerning_lookups(font["GPOS"]))
        for left, left_name in names.items():
            for right, right_name in names.items():
                if left_name is None or right_name is None or "<" in (left, right):
                    continue
                total = sum(pair_kerning(subtables, left_name, right_name) or 0 for subtables in lookups)
                if total:
                    kerning[left + right] = total * per_unit * FONT_SIZE
    return widths, ink, kerning, missing


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    widths, ink, kerning, missing = measure(sys.argv[1])
    if missing:
        sys.exit(f"Not in the font: {' '.join(missing)}")

    print(f"// Measured from {sys.argv[1]} by scripts/glyph_metrics.py. Do not edit by hand.")
    print("// Board units: how wide each letter is, and what the font kerns between two letters.")
    print()
    entries = ", ".join(f"{js_key(ch)}: {round(width)}" for ch, width in widths.items())
    print(f"export const WIDTHS = {{ {entries} }};")
    print()
    pairs = [f"{js_string(pair)}: {round(value)}" for pair, value in sorted(kerning.items()) if round(value)]
    print("export const KERNING = {")
    for start in range(0, len(pairs), 10):
        print("  " + ", ".join(pairs[start : start + 10]) + ",")
    print("};")

    print(file=sys.stderr)
    for ch, width in widths.items():
        print(f"  {ch}  advance {width:6.2f}  ink {ink.get(ch, 0):6.2f}", file=sys.stderr)


def js_key(ch):
    return ch if ch.isalnum() else js_string(ch)


def js_string(text):
    return json.dumps(text, ensure_ascii=False)


if __name__ == "__main__":
    main()
