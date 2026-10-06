import type { QrMatrix } from './generate';

// One `<rect>` for the background and one `<path>` for every dark module, on integer coordinates with
// `shape-rendering="crispEdges"`: no masks, no groups, no filters. Such an SVG survives an extension CSP, prints
// sharply, and stays small enough to inline.

/** The quiet zone QR specifies. A phone camera needs it; the on-screen preview keeps it too. */
export const DEFAULT_QUIET = 4;

/** Beyond this the margin is not a quiet zone any more, and the numbers stop being worth trusting. */
const MAX_QUIET = 64;
/** A QR larger than this is not a picture anyone displays; the cap keeps the arithmetic in safe-integer land. */
const MAX_SIZE = 10_000;

// An XML namespace identifier, not an address: nothing is ever fetched from it. Kept as its own constant so a
// ban on URL literals can tell the two apart.
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

// Colours go straight into an attribute, so only shapes that cannot carry markup or a reference are allowed:
// hex, the CSS functional forms, plain keywords. `url(...)` in particular is refused — a paint server is a fetch,
// and the SVG must make none.
// Hex is 3, 4, 6 or 8 digits — the lengths CSS defines; anything else would silently fall back to black and could
// leave the QR unreadable.
const COLOUR =
  /^(#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|[a-zA-Z]+|(rgb|rgba|hsl|hsla)\(\s*[0-9a-zA-Z.,%\s/+-]*\))$/;

export interface RenderOptions {
  /** Modules of empty margin on every side. */
  quiet?: number;
  /** Pixel size of the image. Omitted, the SVG has no width/height and scales to its container. */
  size?: number;
  /** Module colour. */
  fg?: string;
  /** Background colour. */
  bg?: string;
}

/**
 * Path data for the dark modules, in module units with the quiet zone added to every coordinate.
 * Runs of dark modules in a row become one subpath, which is what keeps the file small.
 */
export function buildPathData(matrix: QrMatrix, quiet = DEFAULT_QUIET): string {
  requireQuiet(quiet);
  const parts: string[] = [];
  for (let y = 0; y < matrix.size; y++) {
    const row = matrix.data[y] as boolean[];
    let x = 0;
    while (x < matrix.size) {
      if (!row[x]) {
        x++;
        continue;
      }
      const startX = x;
      while (x < matrix.size && row[x]) x++;
      const width = x - startX;
      parts.push(`M${startX + quiet} ${y + quiet}h${width}v1h-${width}z`);
    }
  }
  return parts.join('');
}

export function renderSvg(matrix: QrMatrix, options: RenderOptions = {}): string {
  const { quiet = DEFAULT_QUIET, size, fg = '#000', bg = '#fff' } = options;
  requireQuiet(quiet);
  if (size !== undefined && (!Number.isSafeInteger(size) || size <= 0 || size > MAX_SIZE)) {
    throw new RangeError(`size must be an integer 1-${MAX_SIZE}, got ${size}`);
  }
  requireColour(fg, 'fg');
  requireColour(bg, 'bg');

  const dimension = matrix.size + 2 * quiet;
  const path = buildPathData(matrix, quiet);
  const dimensions = size === undefined ? '' : ` width="${size}" height="${size}"`;
  return (
    `<svg xmlns="${SVG_NAMESPACE}" viewBox="0 0 ${dimension} ${dimension}"${dimensions}` +
    ` shape-rendering="crispEdges">` +
    `<rect width="${dimension}" height="${dimension}" fill="${bg}"/>` +
    (path ? `<path fill="${fg}" d="${path}"/>` : '') +
    `</svg>`
  );
}

function requireQuiet(quiet: number): void {
  if (!Number.isSafeInteger(quiet) || quiet < 0 || quiet > MAX_QUIET) {
    throw new RangeError(`quiet must be an integer 0-${MAX_QUIET}, got ${quiet}`);
  }
}

function requireColour(colour: string, what: string): void {
  if (typeof colour !== 'string' || !COLOUR.test(colour)) {
    throw new RangeError(`${what} must be a plain CSS colour, got ${JSON.stringify(colour)}`);
  }
}
