import { encode } from 'uqr';

// QR encoding on top of uqr (MIT, a port of Nayuki's generator). The package deliberately stops at the matrix: what
// the modules are drawn into is the renderer's business, and nothing here knows about the product.
export type EccLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrMatrix {
  /** Row-major, `data[y][x]`, `true` = dark. */
  readonly data: boolean[][];
  /** Module count per side, without a quiet zone. */
  readonly size: number;
  readonly version: number;
  /** The mask uqr chose, 0-7. */
  readonly mask: number;
}

export interface GenerateOptions {
  ecc?: EccLevel;
  minVersion?: number;
  maxVersion?: number;
  /** Raise the error correction level while it fits the same version. uqr's own `encode` default is off. */
  boostEcc?: boolean;
  /** 0-7 to force a mask; omitted means uqr picks one. */
  mask?: number;
}

/**
 * Encode `text` into a module matrix.
 *
 * Throws `RangeError` when an option is out of range or not an integer, and when the data does not fit the version
 * range; `URIError` from uqr for text it cannot encode, such as a lone surrogate.
 */
export function generateMatrix(text: string, options: GenerateOptions = {}): QrMatrix {
  const { ecc = 'M', minVersion = 1, maxVersion = 40, boostEcc = false, mask } = options;
  // uqr checks bounds and ordering for versions and the range of a mask, but none of them for integrality: a
  // fractional value would produce a QR whose format bits and applied mask disagree - readable by nothing.
  requireInteger(minVersion, 1, 40, 'minVersion');
  requireInteger(maxVersion, 1, 40, 'maxVersion');
  if (minVersion > maxVersion) throw new RangeError(`minVersion ${minVersion} is above maxVersion ${maxVersion}`);
  if (mask !== undefined) requireInteger(mask, 0, 7, 'mask');
  const result = encode(text, {
    ecc,
    minVersion,
    maxVersion,
    boostEcc,
    // uqr calls it `maskPattern` and takes -1 for "choose one".
    maskPattern: mask ?? -1,
    // uqr's own default is 1, which would stack with the quiet zone the renderer adds (FORMAT of the SVG, not of QR).
    border: 0,
  });
  return { data: result.data, size: result.size, version: result.version, mask: result.maskPattern };
}

function requireInteger(value: number, min: number, max: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${what} must be an integer ${min}-${max}, got ${value}`);
  }
}
