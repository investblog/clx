// The shape of the QR code tools' words in a language (site/qr-pages.ts, ADRs 0045, 0046): English and
// Russian are written in site/qr-pages.ts, the extension's other languages in site/qr-i18n/<lang>.ts.
// Every language has every key: a missing one fails `tsc`, never falls back to English silently.
import type { Strings } from './i18n.ts';
import type { PageKeywords } from './keywords.ts';

/** The header's and the footer's words: a QR-only language has no product page, but its pages carry
 *  the site's header and footer, whose links lead to the English site. */
export type Chrome = Pick<Strings, 'signIn' | 'dashboard' | 'theme' | 'language' | 'nav' | 'foot'>;

/** /qr-code-generator. */
export interface GeneratorText {
  title: string;
  /** At most 160 characters. */
  description: string;
  h1: string;
  lead: string;
  form: { data: string; hint: string; size: string; ecc: string; quiet: string };
  ecc: { L: string; M: string; Q: string; H: string };
  out: { download: string; svg: string; link: string; copyLink: string; embed: string; copyEmbed: string; noscript: string };
  /** The script's words (site/qr.ts); `ready` keeps `{bytes}`. */
  t: { empty: string; tooLong: string; noFit: string; ready: string; copied: string; failed: string; alt: string };
  sections: { h: string; p: string }[];
  faq: { h: string; items: [string, string][] };
  /** The extension under the lead: the link to its page, the name of its store buttons' group. */
  ext: { link: string; group: string };
  /** "See also": [name, slug]; a slug the language lacks leads to the English page. */
  more: [string, string][];
  /** The link to the API's documentation, which is in English. */
  api?: string;
}

/** /qr-code-extension. */
export interface ExtensionText {
  title: string;
  /** At most 160 characters. */
  description: string;
  lead: string;
  install: string;
  blocks: [string, string[]][];
  /** "The policy in full: " + `policy` (the link). */
  more: string;
  policy: string;
  /** Before the link to the API, `qr.clx.cx`: "The QR code API it links to:". */
  api: string;
  /** "See also": [name, slug]; a slug the language lacks leads to the English page. */
  also: [string, string][];
}

/** A QR-only language (ADR 0046): its header and footer, the two pages, and their anchors. */
export interface QrLanguage {
  chrome: Chrome;
  generator: GeneratorText;
  extension: ExtensionText;
  keywords: { generator: PageKeywords; extension: PageKeywords };
}
