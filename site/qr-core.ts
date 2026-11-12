// The QR code tools' rules, shared by the generator's script (site/qr.ts → public/qr.js) and its pages
// (site/qr-pages.ts, at build time). They follow the API's contract (ADR 0044): the data trimmed, at
// most 2,048 UTF-16 units, the preset in the path, ecc and q always in the query, SHA-256 of
// `${data}|p=…|ecc=…|q=…|fg=000|bg=fff|r=v1` as the name. @spintax/qr-svg draws the same SVG the API
// serves for the same parameters (scripts/probe-qr.mjs checks it on every run).
import QR from '@spintax/qr-svg';

export const API = 'https://qr.clx.cx';
export const MAX_DATA = 2048;
export const PRESETS: Record<string, number> = { sq125: 125, sq200: 200, sq250: 250, sq300: 300 };

/** encodeURIComponent, and !'()* too: a link pasted into Markdown or a shell stays whole. */
export const encodeData = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/gu, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** The canonical URL of the image on the API. */
export async function linkFor(data: string, preset: string, ecc: string, q: number): Promise<string> {
  const bytes = new TextEncoder().encode(`${data}|p=${preset}|ecc=${ecc}|q=${q}|fg=000|bg=fff|r=v1`);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${API}/qr/${preset}/${hash}.svg?data=${encodeData(data)}&ecc=${ecc}&q=${q}`;
}

/** The SVG for the parameters, or null when the text does not fit one QR code (or is not Unicode). */
export function svgFor(data: string, preset: string, ecc: string, q: number): string | null {
  try {
    return QR.renderSvg(QR.generateMatrix(data, { ecc: ecc as 'L' | 'M' | 'Q' | 'H' }), { quiet: q, size: PRESETS[preset] });
  } catch {
    return null;
  }
}
