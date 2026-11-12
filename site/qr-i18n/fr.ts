import { EXTENSION_NAME, MAX_DATA } from '../qr-core.ts';
import type { QrLanguage } from '../qr-text.ts';

const text: QrLanguage = {
  chrome: {
    signIn: 'Se connecter',
    dashboard: 'Tableau de bord',
    theme: 'Changer de thème',
    language: 'Langue',
    inEnglish: 'En anglais',
    nav: { analytics: 'Statistiques', links: 'Liens courts', generators: 'Pour les générateurs de sites', pricing: 'Tarifs', faq: 'Questions', menu: 'Menu' },
    foot: { how: 'Comment ça marche', openSource: 'Open source', qr: 'Générateur de QR code', company: '301.st', agents: 'Pour les agents IA', api: 'API', privacy: 'Confidentialité', terms: 'Conditions', source: 'Code source', contact: 'Contact' },
  },
  generator: {
    title: 'Générateur de QR code SVG gratuit, sans inscription — clx',
    description: 'Créez un QR code en SVG léger dans votre navigateur : taille et correction d’erreurs au choix, téléchargement ou lien vers l’image. Gratuit, sans inscription.',
    h1: 'Générateur de QR code SVG gratuit',
    lead: 'Saisissez une URL ou n’importe quel texte : le QR code est dessiné dans votre navigateur en SVG léger — un rectangle et un tracé —, net à toutes les tailles. Téléchargez-le, copiez-le ou prenez un lien vers la même image pour l’afficher sur une page.',
    form: { data: 'Texte ou URL', hint: `Jusqu’à ${MAX_DATA.toLocaleString('fr')} caractères. Ce qui tient dans un code dépend du texte et de la correction d’erreurs.`, size: 'Taille', ecc: 'Correction d’erreurs', quiet: 'Marge (modules)' },
    ecc: { L: 'L — 7 %', M: 'M — 15 %', Q: 'Q — 25 %', H: 'H — 30 %' },
    out: { download: 'Télécharger le SVG', svg: 'Copier le SVG', link: 'Lien de l’image', copyLink: 'Copier le lien', embed: 'HTML pour votre page', copyEmbed: 'Copier le HTML', noscript: 'Le générateur a besoin de JavaScript. Sans lui, utilisez l’API : un lien contenant votre texte vous donne l’image.' },
    t: { empty: 'Saisissez un texte ou une URL.', tooLong: `Le texte dépasse ${MAX_DATA.toLocaleString('fr')} caractères.`, noFit: 'Ce texte ne tient pas dans un seul QR code : raccourcissez-le ou baissez la correction d’erreurs.', ready: 'SVG, {bytes} octets.', copied: 'Copié.', failed: 'Le navigateur n’a pas autorisé la copie : sélectionnez le texte et copiez-le vous-même.', alt: 'QR code' },
    sections: [
      { h: 'Pourquoi SVG', p: 'Un QR code vectoriel reste net sur un téléphone, à l’impression comme sur un panneau publicitaire. Celui-ci pèse environ 3 Ko pour une URL courte : un rectangle blanc et un seul tracé aux coordonnées entières, rien d’autre — facile à modifier, à intégrer dans du HTML et à faire passer par n’importe quelle chaîne de traitement.' },
      { h: 'Rien ne quitte votre navigateur', p: 'Le code est dessiné sur cette page par la bibliothèque open source @spintax/qr-svg. Ce que vous saisissez n’est envoyé nulle part — aucune requête ne le transporte —, et le générateur ne demande aucun compte et ne dépose aucun cookie.' },
      { h: 'Un lien vers la même image', p: 'Le lien de l’image pointe vers l’API gratuite qr.clx.cx, qui dessine exactement le même SVG à partir du texte contenu dans le lien. Placez-le dans une balise <img>, un README ou un e-mail ; le texte est dans le lien lui-même, nous ne conservons donc rien.' },
      { h: 'Suivez les scans', p: 'Un QR code ordinaire ne dit pas qui l’a scanné. Faites-le pointer vers un lien court clx sur votre propre domaine : les scans sont comptés comme une source à part, par pays et par appareil — gratuitement, dans votre compte Cloudflare.' },
    ],
    faq: {
      h: 'Questions',
      items: [
        ['Le générateur est-il gratuit ?', 'Oui, sans inscription et sans limite sur le nombre de codes : ils sont dessinés dans votre navigateur. L’API qr.clx.cx ne demande pas de clé non plus.'],
        ['Comment ouvrir sur mon téléphone une page affichée sur mon ordinateur ?', 'Collez ici l’adresse de la page, scannez le code avec l’appareil photo du téléphone et touchez le lien qui apparaît : la page s’ouvre sur le téléphone — sans vous envoyer le lien, sans compte. L’extension de navigateur vous évite de coller l’adresse : elle crée le code de la page sur laquelle vous êtes.'],
        ['Existe-t-il une extension de navigateur ?', `Oui, gratuite : ${EXTENSION_NAME}, pour Chrome, Firefox et Edge. Dans un panneau latéral, elle crée un QR code pour la page ouverte ou pour n’importe quel texte — un SVG, un lien et des snippets à intégrer, comme ici — et n’envoie rien nulle part.`],
        ['Les QR codes créés ici expirent-ils ?', 'Non. Un QR code contient lui-même son texte ; il fonctionne tant que ce vers quoi il pointe fonctionne. Le lien de l’image fonctionne tant que l’API fonctionne.'],
        ['Quelle correction d’erreurs choisir ?', 'M pour les écrans et la plupart des impressions ; Q ou H pour un support imprimé qui risque d’être rayé ou sur lequel on pose un logo. Plus le niveau est élevé, plus le code est dense.'],
        ['Peut-on changer la destination d’un code déjà imprimé ?', 'Pas avec un QR code ordinaire : son texte est figé. Encodez plutôt un lien court, et changez sa destination quand vous le souhaitez.'],
        ['Un QR code est-il confidentiel ?', 'Non. Quiconque le scanne, ou ouvre le lien de son image, lit son texte. N’encodez pas de mots de passe ni d’autres secrets.'],
      ] as [string, string][],
    },
    ext: { link: 'Extension de navigateur gratuite →', group: `Installer ${EXTENSION_NAME}` },
    more: [['Liens courts avec QR codes (en anglais)', '/short-links'], ['Extension de navigateur', '/qr-code-extension'], ['Confidentialité des outils QR code', '/qr-code-privacy']] as [string, string][],
    api: 'API de QR codes qr.clx.cx (en anglais)',
  },
  extension: {
    title: 'Générateur de QR code : extension de navigateur — clx',
    description: 'Extension de navigateur gratuite : QR codes SVG dans un panneau latéral pour la page ouverte ou tout texte. Téléchargez, copiez, partagez un lien ou un snippet.',
    lead: `${EXTENSION_NAME} est une extension de navigateur gratuite qui crée un QR code dans un panneau latéral — pour la page ouverte ou pour n’importe quel texte — en SVG léger, avec un lien et des snippets pour l’intégrer. Elle n’envoie rien nulle part.`,
    install: 'Installer',
    blocks: [
      ['Premiers pas', ['Cliquez sur l’icône de l’extension : son panneau latéral s’ouvre (une barre latérale dans Firefox).', 'Avec « Générer à l’ouverture », il affiche aussitôt un QR code pour la page actuelle.', 'Pour ouvrir la même page sur votre téléphone, scannez le code avec l’appareil photo du téléphone et touchez le lien qui apparaît : inutile de vous envoyer le lien.', 'Copiez le lien de partage, copiez ou téléchargez le SVG, ou prenez un snippet dans l’onglet « Intégrer ».']],
      ['Générer', ['« Page actuelle » — l’adresse de l’onglet actif ; après être passé à une autre page, cliquez sur le bouton d’actualisation.', `« Texte libre » — n’importe quelle URL ou n’importe quel texte, jusqu’à ${MAX_DATA.toLocaleString('fr')} caractères (un emoji compte pour deux).`, 'Taille : 125, 200, 250 ou 300 px. ECC (correction d’erreurs) : L 7 %, M 15 %, Q 25 %, H 30 % — plus le niveau est élevé, plus le code est robuste, mais plus il est dense.', '« Copier le lien » — un lien vers l’image sur l’API de QR codes, texte inclus ; il n’y en a pas pour un texte de plus de 2 048 caractères. « Copier le SVG » et « Télécharger le SVG » fonctionnent pour tous les codes.']],
      ['Intégrer', ['Des snippets avec le même lien : HTML <img>, HTML <object>, Markdown, React et Vue — « Copier le snippet », ou « Copier l’URL » pour le lien seul.', 'Les liens copiés avec les versions antérieures à 1.1.0 ne contenaient pas le texte et ne fonctionnent plus : copiez-les de nouveau depuis l’onglet « Historique ».']],
      ['Historique et réglages', ['Un code est ajouté à l’onglet « Historique » quand vous cliquez sur « Copier le lien » dans l’onglet « Générer » : son texte, l’heure, la taille et l’ECC. « Tout effacer » efface tout l’historique.', 'Réglages : taille et ECC par défaut, « Générer à l’ouverture », « Limite de l’historique » (25, 50 ou 100), le thème.', 'L’historique et les réglages restent dans votre navigateur (storage.local) et ne sont pas synchronisés.']],
      ['Confidentialité et autorisations', ['Depuis la version 1.1.0, l’extension n’effectue aucune requête réseau : codes et liens sont créés dans le navigateur. Les versions précédentes envoyaient le texte de chaque code à l’ancienne API.', 'Un lien de partage contient son texte : quiconque l’ouvre ou scanne le code peut le lire.', 'Autorisations : panneau latéral (sa fenêtre ; Firefox a une barre latérale et n’en a pas besoin), stockage (réglages et historique), onglets (l’adresse de la page actuelle).']],
    ] as [string, string[]][],
    more: 'La politique complète : ',
    policy: 'confidentialité des outils QR code',
    api: 'L’API de QR codes vers laquelle pointent ses liens :',
    also: [['Générateur de QR code en ligne', '/qr-code-generator']] as [string, string][],
  },
  keywords: {
    generator: {
      primary: 'générateur de QR code SVG gratuit',
      keywords: ['générateur de QR code en ligne', 'QR codes SVG dans le navigateur', 'création de QR code sans inscription', 'QR code vectoriel', 'lien envoyé au téléphone par QR code'],
      tags: ['QR codes', 'outils'],
    },
    extension: {
      primary: 'extension pour générer des QR codes',
      keywords: ['extension de navigateur pour QR codes', 'extension Chrome pour créer des QR codes', 'QR code dans le panneau latéral', 'page actuelle envoyée sur le téléphone'],
      tags: ['QR codes', 'extension de navigateur'],
    },
  },
};
export default text;
