// The words of the marketing languages (ADR 0047): the pages about clx in a language the app, the mail
// and the bot do not speak. One folder per language, `site/lang/<lang>/`, of one shape: a key missing
// fails `tsc`, never falls back to English silently. English and Russian stay where they were written,
// beside their templates; `byLocale` puts a marketing language beside them.
import type { FaqText } from '../faq.ts';
import type { Strings } from '../i18n.ts';
import type { PageKeywords } from '../keywords.ts';
import { MARKETING_LOCALES, type ContentLocale, type Locale, type MarketingLocale } from '../pages.ts';
import type { LinkCard, PricingText, ProductText } from '../products.ts';
import type { PromoCopy } from '../promo.ts';
import type { GeneratorText } from '../qr-text.ts';
import sr from './sr/index.ts';

export interface MarketingLanguage {
  /** The header, the footer, the home page, the example report, the 404. */
  strings: Strings;
  /** The pages of site/products.ts. */
  products: {
    analytics: ProductText;
    links: ProductText & { card: LinkCard };
    generators: ProductText & { flow: [string, string][] };
    pricing: PricingText;
    how: ProductText & { flow: [string, string][] };
    open: ProductText;
  };
  faq: FaqText;
  /** /qr-code-generator; its links to the extension, the API and the policy lead to English. */
  generator: GeneratorText;
  /** The banners of our other services, by their id in site/promo.ts. */
  promo: Record<string, PromoCopy>;
  /** The anchors of each page (site/keywords.ts), by its slug; unmeasured by search volume. */
  keywords: Record<string, PageKeywords>;
}

export const LANG_TEXT: Record<MarketingLocale, MarketingLanguage> = { sr };

/** A text of the pages about clx in every language: the site's own from `own`, each marketing
 *  language's from its folder. */
export const byLocale = <T>(own: Record<Locale, T>, pick: (t: MarketingLanguage) => T): Record<ContentLocale, T> =>
  ({ ...own, ...Object.fromEntries(MARKETING_LOCALES.map((l) => [l, pick(LANG_TEXT[l])])) }) as Record<ContentLocale, T>;
