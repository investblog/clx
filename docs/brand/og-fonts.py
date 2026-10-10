# python -P og-fonts.py <Onest[wght].ttf> <dir>
# The two static cuts of Onest the OG cards are drawn with (scripts/build-og.mjs): opentype.js reads a
# variable font only at its default weight, so the weights are pinned here, once, with fontTools.
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

src, out = sys.argv[1], sys.argv[2]
for weight in (400, 600):
    font = instantiateVariableFont(TTFont(src), {'wght': weight}, updateFontNames=True)
    font.save(f'{out}/Onest-{weight}.ttf')
    print('Onest', weight)
