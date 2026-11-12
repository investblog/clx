// The QR code tools' words in the browser extension's languages beyond the site's own (ADR 0046).
import type { QrOnlyLocale } from '../pages.ts';
import type { QrLanguage } from '../qr-text.ts';
import de from './de.ts';
import es from './es.ts';
import fr from './fr.ts';
import ptBr from './pt-br.ts';
import tr from './tr.ts';

export const QR_TEXT: Record<QrOnlyLocale, QrLanguage> = { de, es, fr, 'pt-br': ptBr, tr };
