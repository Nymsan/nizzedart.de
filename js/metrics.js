// Letters must sit centred on their groove, and stay there when turned upside
// down. Where capitals sit inside a line of text differs from font to font, so
// it is measured, and handed to the stylesheet as two offsets:
//   --cap-shift    moves a letter so the middle of its capitals is on the groove
//   --arrow-shift  the same for the arrow, which is centred on its own ink
//   --at-shift     and for the @, which the font hangs below the line

const SIZE = 48; // any size will do: the offsets are in em

export function measureBoardFont() {
  const root = document.documentElement;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return;
  context.font = `600 ${SIZE}px ${getComputedStyle(root).getPropertyValue("--board-font")}`;

  const capital = context.measureText("H");
  const ascent = capital.fontBoundingBoxAscent;
  const descent = capital.fontBoundingBoxDescent;
  if (!Number.isFinite(ascent) || !Number.isFinite(descent)) return;

  // In a line as tall as the font size, the baseline is this far from the top.
  const baseline = (SIZE - ascent - descent) / 2 + ascent;
  const shiftFor = (inkTop, inkBottom) => `${((SIZE / 2 - (baseline - (inkTop - inkBottom) / 2)) / SIZE).toFixed(4)}em`;

  const arrow = context.measureText("←");
  const at = context.measureText("@");
  root.style.setProperty("--cap-shift", shiftFor(capital.actualBoundingBoxAscent, 0));
  root.style.setProperty("--arrow-shift", shiftFor(arrow.actualBoundingBoxAscent, arrow.actualBoundingBoxDescent));
  root.style.setProperty("--at-shift", shiftFor(at.actualBoundingBoxAscent, at.actualBoundingBoxDescent));
}

/** Measure now, and again whenever a font has finished loading. */
export function watchBoardFont() {
  measureBoardFont();
  document.fonts?.addEventListener("loadingdone", measureBoardFont);
}
