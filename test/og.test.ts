// The Open Graph cards (scripts/build-og.mjs): the words keep to their column whatever they are, and the
// card's SVG carries nothing but outlines.
import { describe, expect, it } from 'vitest';

interface Font {
  getAdvanceWidth(text: string, size: number): number;
}
const og = (await import('../scripts/build-og.mjs' as string)) as {
  fit: (font: Font, text: string, sizes: number[], width: number, max: number) => { size: number; lines: string[] };
  cardSvg: (title: string, description: string | null) => string;
  semibold: Font;
  regular: Font;
  TEXT_W: number;
};

describe('the card’s words', () => {
  const sizes = [64, 58, 52, 46, 40];
  const within = (r: { size: number; lines: string[] }, font: Font) => r.lines.every((l) => font.getAdvanceWidth(l, r.size) <= og.TEXT_W);

  it('a heading of the site fits at the largest size it can, in at most three lines', () => {
    const r = og.fit(og.semibold, 'Analytics and short links that live in your Cloudflare account', sizes, og.TEXT_W, 3);
    expect(r.lines.length).toBeLessThanOrEqual(3);
    expect(within(r, og.semibold)).toBe(true);
  });

  it('a word wider than the column is cut into pieces, not drawn over the chart', () => {
    const long = `https://go.example.com/${'a'.repeat(80)}`;
    const r = og.fit(og.semibold, `See ${long}`, sizes, og.TEXT_W, 3);
    expect(within(r, og.semibold)).toBe(true);
  });

  it('too much text ends in an ellipsis that still fits', () => {
    const r = og.fit(og.regular, 'Счётчик посещений без cookie и короткие ссылки. '.repeat(12), [28, 26, 24], og.TEXT_W, 3);
    expect(r.lines).toHaveLength(3);
    expect(r.lines[2]!.endsWith('…')).toBe(true);
    expect(within(r, og.regular)).toBe(true);
  });

  it('the SVG has no <text> and nothing of the input as markup', () => {
    const svg = og.cardSvg('A <script>alert(1)</script> & "quotes"', 'Cyrillic: Тарифы — бесплатно');
    expect(svg).not.toMatch(/<text|<script|alert/u);
    expect(svg).toContain('width="1200" height="630"');
  });
});
