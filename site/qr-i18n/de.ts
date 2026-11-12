import { EXTENSION_NAME, MAX_DATA } from '../qr-core.ts';
import type { QrLanguage } from '../qr-text.ts';

const text: QrLanguage = {
  chrome: {
    signIn: 'Anmelden',
    dashboard: 'Dashboard',
    theme: 'Design wechseln',
    language: 'Sprache',
    inEnglish: 'Auf Englisch',
    nav: { analytics: 'Webanalyse', links: 'Kurzlinks', generators: 'Für Website-Generatoren', pricing: 'Preise', faq: 'Fragen', menu: 'Menü' },
    foot: { how: 'So funktioniert’s', openSource: 'Open Source', qr: 'QR-Code-Generator', company: '301.st', agents: 'Für KI-Agenten', api: 'API', privacy: 'Datenschutz', terms: 'Nutzungsbedingungen', source: 'Quellcode', contact: 'Kontakt' },
  },
  generator: {
    title: 'SVG-QR-Code-Generator kostenlos, ohne Anmeldung — clx',
    description: 'Erstellen Sie QR-Codes als kleines SVG im Browser: Größe und Fehlerkorrektur wählen, herunterladen oder den Bildlink kopieren. Kostenlos, ohne Anmeldung.',
    h1: 'Kostenloser SVG-QR-Code-Generator',
    lead: 'Geben Sie eine URL oder einen beliebigen Text ein: Der QR-Code entsteht in Ihrem Browser als kleines SVG – ein Rechteck und ein Pfad – und bleibt in jeder Größe scharf. Laden Sie ihn herunter, kopieren Sie ihn oder nehmen Sie einen Link auf dasselbe Bild für Ihre Seite.',
    form: { data: 'Text oder URL', hint: `Bis zu ${MAX_DATA.toLocaleString('de')} Zeichen. Wie viel in einen Code passt, hängt vom Text und von der Fehlerkorrektur ab.`, size: 'Größe', ecc: 'Fehlerkorrektur', quiet: 'Rand (Module)' },
    ecc: { L: 'L – 7 %', M: 'M – 15 %', Q: 'Q – 25 %', H: 'H – 30 %' },
    out: { download: 'SVG herunterladen', svg: 'SVG kopieren', link: 'Bildlink', copyLink: 'Link kopieren', embed: 'HTML für Ihre Seite', copyEmbed: 'HTML kopieren', noscript: 'Der Generator braucht JavaScript. Ohne JavaScript nutzen Sie die API: Ein Link mit Ihrem Text liefert das Bild.' },
    t: { empty: 'Geben Sie einen Text oder eine URL ein.', tooLong: `Der Text ist länger als ${MAX_DATA.toLocaleString('de')} Zeichen.`, noFit: 'Dieser Text passt nicht in einen QR-Code: Kürzen Sie ihn oder senken Sie die Fehlerkorrektur.', ready: 'SVG, {bytes} Byte.', copied: 'Kopiert.', failed: 'Der Browser hat das Kopieren nicht erlaubt: Markieren Sie den Text und kopieren Sie ihn selbst.', alt: 'QR-Code' },
    sections: [
      { h: 'Warum SVG', p: 'Ein Vektor-QR-Code bleibt scharf – auf dem Handy, im Druck und auf der Plakatwand. Dieser ist für eine kurze URL etwa 3 KB groß: ein weißes Rechteck und ein Pfad mit ganzzahligen Koordinaten, sonst nichts – leicht zu bearbeiten, direkt in HTML einzubetten und durch jede Pipeline zu schicken.' },
      { h: 'Nichts verlässt Ihren Browser', p: 'Der Code wird auf dieser Seite gezeichnet, von der offenen Bibliothek @spintax/qr-svg. Was Sie eingeben, wird nirgendwohin gesendet – keine Anfrage enthält es –, und der Generator braucht kein Konto und setzt kein Cookie.' },
      { h: 'Ein Link auf dasselbe Bild', p: 'Der Bildlink führt zur kostenlosen API unter qr.clx.cx, die aus dem Text im Link genau dasselbe SVG zeichnet. Setzen Sie ihn in ein <img>-Tag, eine README oder eine E-Mail; der Text steckt im Link selbst, deshalb speichern wir nichts.' },
      { h: 'Scans zählen', p: 'Ein gewöhnlicher QR-Code verrät nicht, wer ihn gescannt hat. Lassen Sie ihn auf einen clx-Kurzlink auf Ihrer eigenen Domain zeigen: Dann werden Scans als eigene Quelle gezählt, nach Land und Gerät – kostenlos, in Ihrem Cloudflare-Konto.' },
    ],
    faq: {
      h: 'Fragen',
      items: [
        ['Ist der Generator kostenlos?', 'Ja, ohne Anmeldung und ohne Begrenzung, wie viele Codes Sie erstellen: Die Codes werden in Ihrem Browser gezeichnet. Auch die API unter qr.clx.cx braucht keinen Schlüssel.'],
        ['Wie öffne ich eine Seite vom Computer auf dem Handy?', 'Fügen Sie hier die Adresse der Seite ein, scannen Sie den Code mit der Handykamera und tippen Sie auf den angezeigten Link: Die Seite öffnet sich auf dem Handy – ohne dass Sie sich den Link selbst schicken, ohne Konto. Die Browser-Erweiterung erspart Ihnen das Einfügen: Sie erstellt den Code der Seite, auf der Sie gerade sind.'],
        ['Gibt es eine Browser-Erweiterung?', `Ja, eine kostenlose: ${EXTENSION_NAME} für Chrome, Firefox und Edge. In einer Seitenleiste erstellt sie einen QR-Code für die aktuelle Seite oder für beliebigen Text – als SVG, Link und Snippets zum Einbetten, wie hier – und sendet nichts nach außen.`],
        ['Laufen hier erstellte QR-Codes ab?', 'Nein. Ein QR-Code enthält seinen Text selbst; er funktioniert, solange das funktioniert, worauf er verweist. Der Bildlink funktioniert, solange die API läuft.'],
        ['Welche Fehlerkorrektur soll ich wählen?', 'M für Bildschirme und die meisten Drucksachen; Q oder H für Drucke, die zerkratzt werden können oder über die ein Logo gelegt wird. Höhere Stufen machen den Code dichter.'],
        ['Kann ich ändern, wohin ein gedruckter Code führt?', 'Mit einem gewöhnlichen QR-Code nicht: Sein Text steht fest. Codieren Sie stattdessen einen Kurzlink und ändern Sie dessen Ziel, wann immer Sie wollen.'],
        ['Ist ein QR-Code vertraulich?', 'Nein. Wer ihn scannt oder seinen Bildlink öffnet, liest seinen Text. Codieren Sie keine Passwörter oder andere Geheimnisse.'],
      ],
    },
    ext: { link: 'Kostenlose Browser-Erweiterung →', group: `${EXTENSION_NAME} installieren` },
    more: [['Kurzlinks mit QR-Codes (auf Englisch)', '/short-links'], ['Browser-Erweiterung', '/qr-code-extension'], ['Datenschutz der QR-Code-Tools', '/qr-code-privacy']],
    api: 'QR-Code-API qr.clx.cx (auf Englisch)',
  },
  extension: {
    title: 'QR-Code-Generator als Browser-Erweiterung — clx',
    description: 'Kostenlose Browser-Erweiterung für SVG-QR-Codes in der Seitenleiste – für die aktuelle Seite oder jeden Text: herunterladen, kopieren, verlinken, einbetten.',
    lead: `${EXTENSION_NAME} ist eine kostenlose Browser-Erweiterung, die in einer Seitenleiste einen QR-Code erstellt – für die aktuelle Seite oder für beliebigen Text – als kleines SVG, mit Link und Snippets zum Einbetten. Sie sendet nichts nach außen.`,
    install: 'Installieren',
    blocks: [
      ['Erste Schritte', ['Klicken Sie auf das Symbol der Erweiterung: Es öffnet sich ihre Seitenleiste (in Firefox die Sidebar).', 'Mit „Beim Öffnen generieren“ zeigt sie sofort einen QR-Code für die aktuelle Seite.', 'Um dieselbe Seite auf dem Handy zu öffnen, scannen Sie den Code mit der Handykamera und tippen Sie auf den angezeigten Link – Sie müssen sich den Link nicht selbst schicken.', 'Kopieren Sie den Freigabelink, kopieren Sie das SVG oder laden Sie es herunter, oder nehmen Sie ein Snippet aus dem Tab „Einbetten“.']],
      ['Erstellen', ['„Aktuelle Seite“ – die Adresse des aktiven Tabs; klicken Sie nach dem Wechsel auf eine andere Seite auf Aktualisieren.', `„Eigener Text“ – eine beliebige URL oder ein beliebiger Text, bis zu ${MAX_DATA.toLocaleString('de')} Zeichen (ein Emoji zählt doppelt).`, 'Größe: 125, 200, 250 oder 300 px. ECC (Fehlerkorrektur): L 7 %, M 15 %, Q 25 %, H 30 % – höher ist robuster, aber dichter.', '„Link kopieren“ – ein Link auf das Bild bei der QR-Code-API, mit dem Text darin; für Text über 2.048 Zeichen gibt es keinen. „SVG kopieren“ und „SVG herunterladen“ funktionieren für jeden Code.']],
      ['Einbetten', ['Snippets mit demselben Link: HTML <img>, HTML <object>, Markdown, React und Vue – „Snippet kopieren“ oder „URL kopieren“ für den Link allein.', 'Links, die mit Versionen vor 1.1.0 kopiert wurden, enthielten keinen Text und funktionieren nicht mehr: Kopieren Sie sie erneut aus dem „Verlauf“.']],
      ['Verlauf und Optionen', ['Ein Code wird im „Verlauf“ gespeichert, wenn Sie im Tab „Erstellen“ auf „Link kopieren“ klicken: sein Text, die Uhrzeit, Größe und ECC. „Alle löschen“ leert den Verlauf.', 'Optionen: Standardgröße und Standard-ECC, „Beim Öffnen generieren“, „Verlaufslimit“ (25, 50 oder 100), das Design.', 'Verlauf und Optionen bleiben in Ihrem Browser (storage.local) und werden nicht synchronisiert.']],
      ['Datenschutz und Berechtigungen', ['Ab Version 1.1.0 stellt die Erweiterung keine Netzwerkanfragen: Codes und Links entstehen im Browser. Frühere Versionen schickten den Text jedes Codes an die alte API.', 'Ein Freigabelink enthält seinen Text: Wer ihn öffnet oder den Code scannt, kann ihn lesen.', 'Berechtigungen: Seitenleiste (ihr Fenster; Firefox hat eine Sidebar und braucht keine), Speicher (Optionen und Verlauf), Tabs (die Adresse der aktuellen Seite).']],
    ],
    more: 'Die vollständige Richtlinie: ',
    policy: 'Datenschutz der QR-Code-Tools',
    api: 'Die QR-Code-API, auf die ihre Links verweisen:',
    also: [['QR-Code-Generator im Web', '/qr-code-generator']],
  },
  keywords: {
    generator: {
      primary: 'kostenloser SVG-QR-Code-Generator',
      keywords: ['QR-Code-Generator online', 'SVG-QR-Codes direkt im Browser', 'QR-Code-Erstellung ohne Anmeldung', 'QR-Code als Vektorgrafik', 'QR-Code für Links aufs Handy'],
      tags: ['QR-Codes', 'Online-Tools'],
    },
    extension: {
      primary: 'QR-Code-Generator als Browser-Erweiterung',
      keywords: ['Browser-Erweiterung für QR-Codes', 'QR-Code-Erweiterung für Chrome', 'QR-Code in der Seitenleiste', 'Übertragung der aktuellen Seite aufs Handy'],
      tags: ['QR-Codes', 'Browser-Erweiterungen'],
    },
  },
};
export default text;
