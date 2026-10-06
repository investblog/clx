// The tests of @301st/qr-svg, copied with it (src/qr): the SVG is read back with jsQR.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { generateMatrix, type QrMatrix } from '../src/qr/generate';
import { buildPathData, renderSvg } from '../src/qr/render';

const TEXT = 'https://example.com';
const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', `qr-${name}`), 'utf8').trim();

/** Modules to pixels, the way a screen or a camera would see them — the input jsQR takes. */
function rasterize(matrix: QrMatrix, { scale = 4, quiet = 4, invert = false } = {}) {
  const side = (matrix.size + 2 * quiet) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const moduleX = Math.floor(x / scale) - quiet;
      const moduleY = Math.floor(y / scale) - quiet;
      const inside = moduleX >= 0 && moduleY >= 0 && moduleX < matrix.size && moduleY < matrix.size;
      const dark = inside && (matrix.data[moduleY] as boolean[])[moduleX] === true;
      const value = dark === invert ? 255 : 0;
      const at = (y * side + x) * 4;
      pixels[at] = value;
      pixels[at + 1] = value;
      pixels[at + 2] = value;
      pixels[at + 3] = 255;
    }
  }
  return { data: pixels, width: side, height: side };
}

describe('generateMatrix', () => {
  it('encodes into a square matrix with no border of its own', () => {
    const matrix = generateMatrix(TEXT, { ecc: 'M' });
    // 25 modules, version 2 — the 33 in the golden file is this plus the quiet zone of 4 on each side.
    expect(matrix.size).toBe(25);
    expect(matrix.version).toBe(2);
    expect(matrix.data).toHaveLength(matrix.size);
    expect(matrix.data[0]).toHaveLength(matrix.size);
    // uqr adds a one-module border unless told otherwise; the quiet zone is the renderer's job, so the matrix
    // starts with a finder pattern in the very first module.
    expect((matrix.data[0] as boolean[])[0]).toBe(true);
  });

  it('honours the version range and the forced mask', () => {
    expect(generateMatrix(TEXT, { ecc: 'L', minVersion: 10 }).version).toBeGreaterThanOrEqual(10);
    // Mask 0 is a real choice, not a missing option.
    for (const mask of [0, 3, 7]) expect(generateMatrix(TEXT, { mask }).mask).toBe(mask);
    expect(generateMatrix(TEXT, {}).mask).toBeGreaterThanOrEqual(0);
  });

  it('boosts the error correction level when asked, without growing the QR', () => {
    const plain = generateMatrix(TEXT, { ecc: 'L' });
    const boosted = generateMatrix(TEXT, { ecc: 'L', boostEcc: true });
    // Same version — boosting only uses the room that was already paid for.
    expect(boosted.version).toBe(plain.version);
    expect(boosted.data).not.toEqual(plain.data);
  });

  it('refuses what cannot be encoded', () => {
    expect(() => generateMatrix(TEXT, { mask: 8 })).toThrow(RangeError);
    expect(() => generateMatrix('x'.repeat(200), { maxVersion: 1 })).toThrow(RangeError);
    expect(() => generateMatrix(TEXT, { minVersion: 41 })).toThrow(RangeError);
    // uqr checks ranges and ordering, but nothing checks that these are whole numbers - so this package does.
    expect(() => generateMatrix(TEXT, { mask: 0.5 })).toThrow(RangeError);
    expect(() => generateMatrix(TEXT, { mask: Number.NaN })).toThrow(RangeError);
    expect(() => generateMatrix(TEXT, { minVersion: 2.5 })).toThrow(RangeError);
    expect(() => generateMatrix(TEXT, { maxVersion: 0 })).toThrow(RangeError);
    expect(() => generateMatrix(TEXT, { minVersion: 10, maxVersion: 5 })).toThrow(RangeError);
    expect(() => generateMatrix('\ud800')).toThrow(URIError); // a lone surrogate is not encodable text
  });
});

describe('renderSvg', () => {
  const matrix = generateMatrix(TEXT, { ecc: 'M' });

  it('matches the SVG the source project produced, character for character', () => {
    // The fixture is the committed snapshot of qr-generator (the code this package was extracted from), so the
    // refactor into an options object is proven not to have moved a single module.
    expect(renderSvg(matrix, { quiet: 4, size: 250 })).toBe(fixture('example-com-250.svg'));
  });

  it('is one rect, one path and nothing else', () => {
    const svg = renderSvg(matrix, { quiet: 4, size: 250 });
    expect(svg).toMatch(/^<svg/);
    expect(svg).toMatch(/<\/svg>$/);
    expect(svg).not.toMatch(/[\r\n]/);
    expect(svg.match(/<rect /g)).toHaveLength(1);
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg).toContain('shape-rendering="crispEdges"');
    for (const forbidden of ['mask', 'clipPath', '<g', 'filter', 'style']) expect(svg).not.toContain(forbidden);
  });

  it('places every module on an integer coordinate', () => {
    const d = /d="([^"]+)"/.exec(renderSvg(matrix, { quiet: 4 }))?.[1] ?? '';
    expect(d).not.toBe('');
    for (const token of d.split(/[MhvzZ ]/)) expect(token).not.toContain('.');
  });

  it('keeps the drawing independent of the pixel size', () => {
    const small = renderSvg(matrix, { quiet: 4, size: 125 });
    const large = renderSvg(matrix, { quiet: 4, size: 300 });
    expect(/d="([^"]+)"/.exec(small)?.[1]).toBe(/d="([^"]+)"/.exec(large)?.[1]);
    expect(small).toContain('width="125"');
    expect(large).toContain('width="300"');
  });

  it('omits width and height when no size is given, so it scales to its container', () => {
    const svg = renderSvg(matrix, { quiet: 4 });
    expect(svg.slice(0, svg.indexOf('>'))).not.toMatch(/width="|height="/);
    expect(svg).toContain(`viewBox="0 0 ${matrix.size + 8} ${matrix.size + 8}"`);
  });

  it('adds the quiet zone to the viewBox and to every coordinate', () => {
    expect(renderSvg(matrix, { quiet: 0 })).toContain(`viewBox="0 0 ${matrix.size} ${matrix.size}"`);
    expect(renderSvg(matrix, { quiet: 2 })).toContain(`viewBox="0 0 ${matrix.size + 4} ${matrix.size + 4}"`);
    expect(buildPathData(matrix, 0).startsWith('M0 0')).toBe(true);
    expect(buildPathData(matrix, 2).startsWith('M2 2')).toBe(true);
    expect(buildPathData(matrix)).toBe(buildPathData(matrix, 4)); // the default is the quiet zone QR specifies
  });

  it('takes the colours it is given', () => {
    const svg = renderSvg(matrix, { quiet: 4, fg: '#ff2d92', bg: 'transparent' });
    expect(svg).toContain(`<rect width="${matrix.size + 8}" height="${matrix.size + 8}" fill="transparent"/>`);
    expect(svg).toContain('<path fill="#ff2d92"');
  });

  it('refuses a quiet zone or a size that makes no sense', () => {
    expect(() => renderSvg(matrix, { quiet: -1 })).toThrow(RangeError);
    expect(() => renderSvg(matrix, { quiet: 1.5 })).toThrow(RangeError);
    expect(() => renderSvg(matrix, { quiet: Number.MAX_VALUE })).toThrow(RangeError); // 2 * quiet would be Infinity
    expect(() => renderSvg(matrix, { size: 0 })).toThrow(RangeError);
    expect(() => renderSvg(matrix, { size: 12.5 })).toThrow(RangeError);
    expect(() => renderSvg(matrix, { size: Number.MAX_SAFE_INTEGER })).toThrow(RangeError);
  });

  it('refuses a colour that could carry markup or fetch a paint server', () => {
    // The colours land inside an attribute, so anything that could close it or reference a URL is refused.
    for (const hostile of [
      '#000" onload="alert(1)',
      '#000"/><script>alert(1)</script><rect fill="',
      'url(https://evil.example/paint.svg#p)',
      "url('#local')",
      '',
      'rgb(0,0,0) <',
      '#12345', // hex is 3, 4, 6 or 8 digits; anything else would fall back to black
      '#1234567',
      '#gg0000',
    ]) {
      expect(() => renderSvg(matrix, { fg: hostile }), hostile).toThrow(RangeError);
      expect(() => renderSvg(matrix, { bg: hostile }), hostile).toThrow(RangeError);
    }
    // …while the forms a caller actually needs keep working.
    for (const fine of ['#000', '#ff2d92', '#ff2d92cc', 'transparent', 'currentColor', 'rgb(255 45 146 / 80%)']) {
      expect(() => renderSvg(matrix, { fg: fine, bg: fine }), fine).not.toThrow();
    }
  });
});

/** Read the path back into modules: the only way to check the renderer itself without rasterizing an SVG. */
function matrixFromPath(path: string, size: number, quiet: number): boolean[][] {
  const data = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const runs = path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g);
  for (const [, xText, yText, widthText] of runs) {
    const x = Number(xText) - quiet;
    const y = Number(yText) - quiet;
    for (let i = 0; i < Number(widthText); i++) (data[y] as boolean[])[x + i] = true;
  }
  return data;
}

describe('the path is the matrix', () => {
  // The golden fixture pins one rendering; this pins every module of several, including a migration-sized QR where
  // a run-length bug would be easiest to hide.
  it.each([
    ['a small QR', TEXT, { ecc: 'M' as const }, 4],
    ['no quiet zone', TEXT, { ecc: 'H' as const }, 0],
    [
      'a migration payload near the phone-QR cap',
      `otpauth-migration://offline?data=${'A'.repeat(1100)}`,
      { ecc: 'L' as const, maxVersion: 25 },
      4,
    ],
  ])('%s', (_name, text, options, quiet) => {
    const matrix = generateMatrix(text, options);
    const decoded = matrixFromPath(buildPathData(matrix, quiet), matrix.size, quiet);
    expect(decoded).toEqual(matrix.data);
  });
});

describe('what we generate can be read back', () => {
  // A reader outside this package (jsQR) decodes the modules: the matrix is a real QR, not only a plausible picture.
  it.each([
    ['a URL', TEXT, { ecc: 'M' as const }],
    ['an otpauth URI', 'otpauth://totp/GitHub:user@example.com?secret=MZXW6YTBOI&issuer=GitHub&digits=6&period=30', {}],
    [
      'a migration payload at the version cap used for phone QR',
      `otpauth-migration://offline?data=${'A'.repeat(300)}`,
      { ecc: 'L' as const, maxVersion: 25 },
    ],
  ])('%s', (_name, text, options) => {
    const matrix = generateMatrix(text, options);
    const image = rasterize(matrix);
    expect(jsQR(image.data, image.width, image.height)?.data).toBe(text);
  });

  it('is readable at several scales', () => {
    const matrix = generateMatrix(TEXT, { ecc: 'M' });
    for (const scale of [2, 3, 8]) {
      const image = rasterize(matrix, { scale });
      expect(jsQR(image.data, image.width, image.height)?.data, `scale ${scale}`).toBe(TEXT);
    }
  });
});
