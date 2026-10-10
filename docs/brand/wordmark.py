# python -I wordmark.py <Onest.ttf> <outdir>
# The clx logo: the mark (the 100-unit geometry of gen.mjs) beside "clx" set in Onest 600, as outlines.
import math
import sys

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

src, out = sys.argv[1], sys.argv[2]
font = instantiateVariableFont(TTFont(src), {'wght': 600})
glyphs = font.getGlyphSet()
cmap = font.getBestCmap()
upm = font['head'].unitsPerEm

TEXT = 'clx'
TRACK = -0.01 * upm  # a touch tighter than the font's own spacing, as a wordmark usually is

# Lay the letters out in font units (y up), collect their bounds.
x = 0
parts = []
for ch in TEXT:
    name = cmap[ord(ch)]
    parts.append((name, x))
    x += glyphs[name].width + TRACK
bounds = BoundsPen(glyphs)
for name, dx in parts:
    glyphs[name].draw(TransformPen(bounds, (1, 0, 0, 1, dx, 0)))
xmin, ymin, xmax, ymax = bounds.bounds  # ymax: the top of the l; ymin: a hair below the baseline (the c and x overshoot)

# The mark is 100 units high; the l's height matches it, the baseline sits on the mark's bottom.
MARK = 100
scale = MARK / ymax
gap = 26
ox = MARK + gap - xmin * scale


def word_path() -> str:
    pen = SVGPathPen(glyphs, ntos=lambda v: f'{v:.1f}'.rstrip('0').rstrip('.'))
    for name, dx in parts:
        # font units → logo units: scale, flip y, baseline at y = 100
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, ox + dx * scale, MARK)))
    return pen.getCommands()


LINK = 'M64 5H91Q95 5 95 9V36Q95 38 93.6 39.4L39.4 93.6Q38 95 36 95H9Q5 95 5 91V64Q5 62 6.4 60.6L60.6 6.4Q62 5 64 5Z'
BRACKET = 'M46.58 1H20.34L1 20.34V46.58L9 38.58V23.66L23.66 9H38.58Z'
width = round(ox + (xmax) * scale + 2)
# The canvas reaches as low as the letters do: the round c overshoots the baseline by about a unit.
height = max(MARK, math.ceil(MARK - ymin * scale + 1))
word = word_path()


def logo(mark: str, text: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" aria-label="clx">'
        f'<path d="{LINK}" fill="none" stroke="{mark}" stroke-width="10" stroke-linejoin="round"/>'
        f'<g fill="{mark}" stroke="{mark}" stroke-width="2" stroke-linejoin="round"><path d="{BRACKET}"/><path d="{BRACKET}" transform="rotate(180 50 50)"/></g>'
        f'<path d="{word}" fill="{text}"/></svg>\n'
    )


open(f'{out}/logo.svg', 'w', encoding='utf-8', newline='\n').write(logo('#4D48ED', '#111111'))
open(f'{out}/logo-dark.svg', 'w', encoding='utf-8', newline='\n').write(logo('#8B87FF', '#FFFFFF'))
print('width', width, 'scale', round(scale, 4), 'l-top', ymax)
