// The script of /qr-code-generator (public/qr.js, built by scripts/build-ui.mjs with the MIT notice of
// @spintax/qr-svg): draws the QR code in the browser and builds its link on the API at qr.clx.cx
// (ADRs 0044, 0045). Nothing is sent anywhere — this script has no fetch; the link is only text to
// copy. The rules are site/qr-core.ts's.
import { MAX_DATA, PRESETS, linkFor, svgFor } from './qr-core.ts';

const form = document.getElementById('qr-form') as HTMLFormElement | null;
if (form) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const text = $<HTMLTextAreaElement>('qr-data');
  const size = $<HTMLSelectElement>('qr-size');
  const ecc = $<HTMLSelectElement>('qr-ecc');
  const quiet = $<HTMLSelectElement>('qr-quiet');
  const preview = $('qr-preview');
  const status = $('qr-status');
  const link = $('qr-link');
  const embed = $('qr-embed');
  const buttons = { download: $<HTMLButtonElement>('qr-download'), svg: $<HTMLButtonElement>('qr-copy-svg'), link: $<HTMLButtonElement>('qr-copy-link'), embed: $<HTMLButtonElement>('qr-copy-embed') };
  // The page's words, printed at build time in its language.
  const t = JSON.parse(form.dataset.t!) as { empty: string; tooLong: string; noFit: string; ready: string; copied: string; failed: string; alt: string };

  let svg = '';
  let run = 0;
  const say = (msg: string) => (status.textContent = msg);

  async function update(): Promise<void> {
    const mine = ++run;
    const data = text.value.trim();
    const preset = size.value;
    const level = ecc.value;
    const q = Number(quiet.value);
    // Whatever showed belongs to the old text: nothing of it may stay beside the new one.
    svg = '';
    link.textContent = '';
    embed.textContent = '';
    for (const b of Object.values(buttons)) b.disabled = true;
    if (!data || data.length > MAX_DATA) {
      preview.replaceChildren();
      say(data ? t.tooLong : t.empty);
      return;
    }
    const drawn = svgFor(data, preset, level, q);
    if (!drawn) {
      preview.replaceChildren();
      say(t.noFit);
      return;
    }
    // The library's SVG: one rect and one path of numbers — no text of the input is in it.
    preview.innerHTML = drawn;
    svg = drawn;
    buttons.download.disabled = buttons.svg.disabled = false;
    say(t.ready.replace('{bytes}', String(new TextEncoder().encode(drawn).length)));
    const url = await linkFor(data, preset, level, q);
    if (mine !== run) return; // a newer text came while the hash was computed
    link.textContent = url;
    const px = PRESETS[preset];
    embed.textContent = `<img src="${url.replaceAll('&', '&amp;')}" width="${px}" height="${px}" alt="${t.alt}">`;
    buttons.link.disabled = buttons.embed.disabled = false;
  }

  async function copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      say(t.copied);
    } catch {
      say(t.failed);
    }
  }

  buttons.download.addEventListener('click', () => {
    if (!svg) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    a.download = 'qr-code.svg';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  buttons.svg.addEventListener('click', () => void (svg && copy(svg)));
  buttons.link.addEventListener('click', () => void (link.textContent && copy(link.textContent)));
  buttons.embed.addEventListener('click', () => void (embed.textContent && copy(embed.textContent)));
  form.addEventListener('input', () => void update());
  form.addEventListener('change', () => void update());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void update();
  });
  void update();
}
