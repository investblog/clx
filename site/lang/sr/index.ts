// Serbian (ADR 0047): Latin script and ekavian only — `sr-Latn` in lang and hreflang. Terms, once for
// the whole site: nalog (account), sajt, brojač poseta, kratki link, preusmeravanje, izveštaj,
// pregledi / posetioci, worker and snippet as Cloudflare's and the app's own words, saldo, dopuna.
// Not a single Cyrillic letter, no ijekavian or Croatian form, đ and never dj: test/site-sr.test.ts.
// What the site has in English only (the legal texts, the extension, the docs for agents) is linked as
// English and says so. Machine-translated against the English; a native reader is welcome.
import { EXTENSION_NAME, MAX_DATA } from '../../qr-core.ts';
import type { MarketingLanguage } from '../index.ts';
import { analytics, generators, how, links, open, pricing } from './products.ts';

const n = (v: number) => v.toLocaleString('sr-Latn');

const text: MarketingLanguage = {
  strings: {
    brand: 'clx',
    signIn: 'Prijava',
    dashboard: 'Kontrolna tabla',
    theme: 'Promeni temu',
    language: 'Jezik',
    inEnglish: 'Na engleskom',
    home: {
      title: 'clx — analitika bez kolačića i kratki linkovi u Cloudflare-u',
      description: 'Brojač poseta bez kolačića i kratki linkovi sa QR kodovima koji rade u vašem Cloudflare nalogu. Besplatno, otvoreni kod, API za generatore sajtova.',
      h1: 'Analitika i kratki linkovi koji žive u vašem Cloudflare nalogu',
      lead: 'clx instalira mali worker i D1 bazu u vaš Cloudflare nalog. Vaši sajtovi tamo broje posete, vaši kratki linkovi odatle preusmeravaju, a clx.cx čuva samo zbirne podatke.',
      start: 'Počnite besplatno',
      source: 'Izvorni kod',
      bot: 'Otvorite Telegram bot',
      signIn: 'Prijava na clx.cx',
      note: 'Besplatni plan, bez kartice. Otvoreni kod pod licencom AGPL-3.0.',
      how: {
        h2: 'Kako radi',
        more: 'Kako clx radi, detaljno',
        steps: [
          ['Povežite Cloudflare', 'Nalepite jednokratni bootstrap token. clx iz njega izdaje sopstveni radni token, a zatim briše bootstrap token — ili vam kaže da ga obrišete, ako Cloudflare to ne dozvoli.'],
          ['clx instalira svoj worker', 'U vašem nalogu se pojavljuju worker i D1 baza i rade na vašim kvotama — besplatne su dovoljne za većinu sajtova.'],
          ['Dodajte sajt ili link', 'Postavite snippet od jednog reda na svoj sajt ili napravite kratki link na sopstvenom domenu, sa QR kodom i pravilima.'],
        ],
      },
      tools: {
        h2: 'Dva alata, jedan worker',
        items: [
          {
            h: 'Brojač poseta',
            link: ['Analitika sajta bez kolačića', '/analytics'],
            p: 'Pregledi i posetioci svakog sajta: po satima za danas, po danima za 7 i 30 dana; dnevni zbirovi se čuvaju 400 dana.',
            points: ['Bez kolačića, bez tuđe adrese u vašim stranicama', 'Stranice, izvori, zemlje, uređaji, pregledači, sistemi', 'Botovi se broje odvojeno: pretraživači, AI crawleri, monitoring'],
          },
          {
            h: 'Kratki linkovi',
            link: ['Kratki linkovi na vašem domenu', '/short-links'],
            p: 'Linkovi na vašem domenu, koje opslužuje worker u vašem nalogu.',
            points: ['QR kod za svaki link, u SVG formatu', 'Pravila po zemlji i uređaju', 'Klikovi po izvoru, zemlji i uređaju'],
          },
        ],
      },
      why: {
        h2: 'Zašto clx',
        links: [['Gde žive vaši podaci', '/how-it-works'], ['Bez zajedničkog traga, detaljno', '/for-site-generators'], ['Otvoreni kod', '/open-source'], ['clx i 301.st (na engleskom)', '/vs-301']],
        items: [
          ['Vaši podaci ostaju kod vas', 'Posete, klikovi i njihove raspodele žive u D1 bazi u vašem Cloudflare nalogu. clx.cx čuva samo zbirove po satima i po danima.'],
          ['Bez zajedničkog traga među vašim sajtovima', 'Svaki sajt dobija sopstvenu putanju, imena skripte i kolektora i kod snippeta, generisane iz nasumičnog semena. Brojač se učitava sa vašeg domena i šalje podatke na njega, bez kolačića i bez tuđeg hosta: ništa u stranicama ne povezuje vaše sajtove međusobno niti sa clx-om. Sajt koji nije na Cloudflare-u (Pro) umesto toga šalje podatke hostu vaše zone, i njegove stranice navode taj host.'],
          ['Besplatni Cloudflare plan je često dovoljan', 'Workers Free dozvoljava 100.000 zahteva i 100.000 upisa u D1 dnevno po nalogu, deljeno sa vašim drugim workerima: za tipičan nalog najmanje oko 11.000 izbrojanih događaja dnevno, obično nekoliko puta više. clx vas upozorava kada se nalog približi kvoti.'],
          ['Otvoreni kod', 'Worker, clx.cx i ove stranice su otvoreni pod licencom AGPL-3.0: pročitajte šta radi u vašem nalogu.'],
        ],
      },
      api: {
        h2: 'Napravljeno za generatore sajtova i agente',
        p: 'Sve što aplikacija radi je poziv API-ja. Generator sajtova dodaje sajt i ubacuje snippet u stranicu koju gradi; AI agent podešava clx za korisnika na osnovu jedne stranice dokumentacije.',
        agents: 'Dokumentacija za AI agente (na engleskom)',
        reference: 'API referenca (na engleskom)',
        generators: 'Za generatore sajtova',
      },
      plans: {
        h2: 'Planovi',
        items: [
          { name: 'Besplatni', price: '$0', points: ['1 Cloudflare nalog', '10 sajtova, 200 linkova', '1 API ključ'] },
          { name: 'Pro', price: '$9 za 30 dana', points: ['50 Cloudflare naloga', '500 sajtova, uključujući sajtove van Cloudflare-a', '10.000 linkova, 5 API ključeva'] },
        ],
        note: 'Pro se plaća sa unapred uplaćenog salda, po danu. Cloudflare plan Workers Paid nije potreban ni na jednom planu.',
        more: 'Planovi detaljno',
      },
      faq: {
        h2: 'Pitanja',
        items: [
          ['Da li mi treba Cloudflare nalog?', 'Da, sa vašim domenom na njemu: kroz clx.cx ne prolazi ništa od vašeg saobraćaja. clx broji sajtove koje opslužuje Cloudflare; na Pro planu i sajtove hostovane drugde, preko hosta tog domena. I kratkim linkovima je potreban domen tamo.'],
          ['Šta clx pravi u mom nalogu?', 'Jedan worker, jednu D1 bazu, rute vaših sajtova i prilagođene domene vaših hostova za linkove, sa sopstvenim radnim tokenom. Prekid veze uklanja ono što je clx napravio i navodi sve što nije uspeo da ukloni; radni token opozivate sami u Cloudflare-u — clx vam daje link.'],
          ['Da li nešto košta?', 'Besplatni plan ne košta ništa i ne traži karticu. Pro je $9 za 30 dana sa salda koji dopunjujete kriptovalutom ili sa Telegram Stars. U oba slučaja worker radi na vašim Cloudflare kvotama.'],
          ['Mogu li da pročitam kod?', 'Ceo, na GitHub-u, pod licencom AGPL-3.0.'],
        ],
        more: 'Sva pitanja',
      },
      final: 'Brojte posete i skraćujte linkove — detalji ostaju u vašem nalogu',
    },
    demo: {
      period: 'Poslednjih 14 dana',
      tiles: ['Posetioci', 'Pregledi', 'Po posetiocu', 'Udeo botova'],
      views: 'Pregledi',
      visitors: 'Posetioci',
      sourcesTitle: 'Izvori',
      sources: ['Direktno', 'google.com', 't.me', 'github.com', 'Ostalo'],
      devicesTitle: 'Uređaji',
      devices: ['Telefon', 'Računar'],
      pagesTitle: 'Stranice',
      pages: ['/', '/pricing', '/blog/cloudflare-d1-limits', '/docs/install', 'Ostalo'],
      countriesTitle: 'Zemlje',
      countries: ['Srbija', 'Nemačka', 'SAD', 'Hrvatska', 'Ostalo'],
      note: 'Primer podataka, nacrtan istim grafikonima kao izveštaj u aplikaciji.',
    },
    nav: { analytics: 'Analitika', links: 'Kratki linkovi', generators: 'Za generatore sajtova', pricing: 'Cene', faq: 'Pitanja', menu: 'Meni' },
    notFound: { title: 'Stranica nije pronađena', text: 'Na clx.cx nema takve stranice.', back: 'Na početnu stranicu' },
    foot: { how: 'Kako radi', openSource: 'Otvoreni kod', qr: 'Generator QR kodova', company: '301.st', agents: 'Za AI agente', api: 'API', privacy: 'Privatnost (na engleskom)', terms: 'Uslovi korišćenja (na engleskom)', source: 'Izvorni kod', contact: 'Kontakt' },
  },
  products: { analytics, links, generators, pricing, how, open },
  faq: {
    title: 'Pitanja o clx-u — analitika i kratki linkovi',
    description: 'Odgovori o clx-u: šta pravi u vašem Cloudflare nalogu, kako rade brojač bez kolačića i kratki linkovi, API za generatore sajtova i planovi.',
    h1: 'Pitanja',
    lead: 'Šta clx radi u vašem Cloudflare nalogu, kako rade brojanje i linkovi i koliko to košta.',
    groups: { general: 'Opšte', analytics: 'Analitika', links: 'Kratki linkovi', generators: 'Generatori sajtova', pricing: 'Cene' },
    start: 'Počnite besplatno',
  },
  generator: {
    title: 'Besplatni SVG generator QR kodova, bez registracije — clx',
    description: 'Napravite QR kod kao mali SVG u pregledaču: izaberite veličinu i korekciju grešaka, preuzmite ga ili kopirajte link do slike. Besplatno, bez registracije.',
    h1: 'Besplatni SVG generator QR kodova',
    lead: 'Unesite URL ili bilo koji tekst: QR kod se crta u vašem pregledaču kao mali SVG — jedan pravougaonik i jedna putanja — oštar u svakoj veličini. Preuzmite ga, kopirajte ili uzmite link do iste slike da ga postavite na stranicu.',
    form: { data: 'Tekst ili URL', hint: `Do ${n(MAX_DATA)} znakova. Koliko staje u jedan kod zavisi od teksta i korekcije grešaka.`, size: 'Veličina', ecc: 'Korekcija grešaka', quiet: 'Margina (moduli)' },
    ecc: { L: 'L — 7%', M: 'M — 15%', Q: 'Q — 25%', H: 'H — 30%' },
    out: { download: 'Preuzmi SVG', svg: 'Kopiraj SVG', link: 'Link do slike', copyLink: 'Kopiraj link', embed: 'HTML za vašu stranicu', copyEmbed: 'Kopiraj HTML', noscript: 'Generatoru je potreban JavaScript. Bez njega koristite API: link sa vašim tekstom daje sliku.' },
    t: { empty: 'Unesite tekst ili URL.', tooLong: `Tekst je duži od ${n(MAX_DATA)} znakova.`, noFit: 'Ovaj tekst ne staje u jedan QR kod: skratite ga ili smanjite korekciju grešaka.', ready: 'SVG, {bytes} bajtova.', copied: 'Kopirano.', failed: 'Pregledač nije dozvolio kopiranje: označite tekst i kopirajte ga sami.', alt: 'QR kod' },
    sections: [
      { h: 'Zašto SVG', p: 'Vektorski QR kod ostaje oštar na telefonu, u štampi i na bilbordu. Ovaj ima oko 3 KB za kratak URL: beli pravougaonik i jedna putanja sa celobrojnim koordinatama, ništa više — lako se menja, ugrađuje u HTML i provlači kroz bilo koji lanac obrade.' },
      { h: 'Ništa ne napušta vaš pregledač', p: 'Kod se crta na ovoj stranici, otvorenom bibliotekom @spintax/qr-svg. Ono što unesete ne šalje se nikuda — nijedan zahtev to ne nosi — a generator ne traži nalog i ne postavlja kolačić.' },
      { h: 'Link do iste slike', p: 'Link do slike vodi na besplatni API na qr.clx.cx, koji iz teksta u linku crta potpuno isti SVG. Stavite ga u <img> tag, README ili e-poruku; sam link nosi tekst, pa mi ništa ne čuvamo.' },
      { h: 'Pratite skeniranja', p: 'Običan QR kod ne može da vam kaže ko ga je skenirao. Usmerite ga na clx kratki link na sopstvenom domenu i skeniranja se broje kao zaseban izvor, po zemlji i uređaju — besplatno, u vašem Cloudflare nalogu.' },
    ],
    faq: {
      h: 'Pitanja',
      items: [
        ['Da li je generator besplatan?', 'Da, bez registracije i bez ograničenja broja kodova: crtaju se u vašem pregledaču. Ni API na qr.clx.cx ne traži ključ.'],
        ['Kako da otvorim stranicu sa računara na telefonu?', 'Nalepite ovde adresu stranice, skenirajte kod kamerom telefona i dodirnite link koji se pojavi: stranica se otvara na telefonu — bez slanja linka samom sebi, bez naloga. Proširenje za pregledač vas pošteđuje lepljenja: pravi kod stranice na kojoj se nalazite.'],
        ['Postoji li proširenje za pregledač?', `Da, besplatno: ${EXTENSION_NAME}, za Chrome, Firefox i Edge. U bočnom panelu pravi QR kod za stranicu na kojoj ste ili za bilo koji tekst — SVG, link i isečke koda za ugrađivanje, kao ovde — i ništa ne šalje nikuda.`],
        ['Da li QR kodovi napravljeni ovde ističu?', 'Ne. QR kod sam nosi svoj tekst; radi dokle god radi ono na šta upućuje. Link do slike radi dokle god radi API.'],
        ['Koju korekciju grešaka da izaberem?', 'M za ekrane i većinu štampe; Q ili H za štampu koja se može izgrebati ili preko koje ide logo. Viši nivoi čine kod gušćim.'],
        ['Mogu li da promenim kuda vodi odštampani kod?', 'Ne sa običnim QR kodom: njegov tekst je fiksan. Umesto toga kodirajte kratki link i menjajte njegovo odredište kad god želite.'],
        ['Da li je QR kod privatan?', 'Ne. Svako ko ga skenira ili otvori link do slike čita njegov tekst. Ne kodirajte lozinke ni druge tajne.'],
      ],
    },
    ext: { link: 'Besplatno proširenje za pregledač (na engleskom) →', group: `Instalirajte ${EXTENSION_NAME}` },
    more: [['Kratki linkovi sa QR kodovima', '/short-links'], ['Proširenje za pregledač (na engleskom)', '/qr-code-extension'], ['Privatnost QR alata (na engleskom)', '/qr-code-privacy']],
    api: 'API qr.clx.cx (na engleskom)',
  },
  promo: {
    '301': {
      eyebrow: 'Od istog tima',
      title: 'Domeni i preusmeravanja na vašem Cloudflare-u',
      text: 'Portfolio domena, masovna edge preusmeravanja, geo-rutiranje i praćenje konverzija u jednoj kontrolnoj tabli, na vašem Cloudflare nalogu. Besplatno tokom otvorene bete.',
      cta: 'Otvorite 301.st',
    },
    catchall: {
      eyebrow: 'Od istog tima',
      title: 'Treba vam OTP pošta na sopstvenom domenu?',
      text: 'Catchall pravi catch-all sanduče na poddomenu vašeg domena. Vaši alati preuzimaju kodove za potvrdu preko POP3S / IMAPS. $10 po domenu za 30 dana.',
      cta: 'Isprobajte Catchall',
    },
    generator: {
      title: 'Generator sajtova',
      text: 'Objavljuje statičke sajtove direktno na vaš Cloudflare Pages — čist HTML i CSS, vaš domen, vaš hosting. Bez tuđeg runtime-a, bez vezivanja za dobavljača.',
      cta: 'generator.ink',
    },
  },
  keywords: {
    '/': { primary: 'clx brojač poseta', keywords: ['clx u vašem Cloudflare nalogu', 'clx analitika i skraćivač linkova', 'brojač i skraćivač otvorenog koda'], tags: ['analitika', 'kratki linkovi'] },
    '/analytics': { primary: 'brojač poseta za sajt', keywords: ['analitika sajta bez kolačića', 'statistika poseta sajta', 'brojač jedinstvenih posetilaca', 'veb analitika bez kolačića'], tags: ['analitika', 'privatnost'] },
    '/short-links': { primary: 'skraćivač linkova', keywords: ['kratki linkovi na sopstvenom domenu', 'servis za skraćivanje linkova', 'praćenje klikova na linkove', 'skraćivač linkova sa QR kodom'], tags: ['kratki linkovi', 'QR kodovi'] },
    '/for-site-generators': { primary: 'analitika za generatore sajtova', keywords: ['poseban brojač za svaki sajt', 'API statistike za generisane sajtove', 'analitika za mnogo sajtova'], tags: ['generatori sajtova', 'analitika'] },
    '/pricing': { primary: 'besplatna veb analitika', keywords: ['cene clx planova', 'besplatno skraćivanje linkova', 'cene analitike i linkova'], tags: ['cene'] },
    '/faq': { primary: 'pitanja o analitici sajta', keywords: ['odgovori o kratkim linkovima', 'clx pomoć', 'postavljanje brojača na sajt'], tags: ['pomoć'] },
    '/how-it-works': { primary: 'analitika na vašem Cloudflare nalogu', keywords: ['pregledi stranica na Cloudflare Workers', 'podaci o posetama u vašoj bazi', 'kako radi clx brojač'], tags: ['platforma', 'analitika'] },
    '/open-source': { primary: 'skraćivač linkova otvorenog koda', keywords: ['analitika sajta otvorenog koda', 'clx izvorni kod', 'licenca AGPL za analitiku'], tags: ['otvoreni kod'] },
    '/qr-code-generator': { primary: 'besplatni SVG generator QR kodova', keywords: ['generator QR kodova onlajn', 'QR kod bez registracije', 'vektorski QR kod', 'QR kod za slanje linka na telefon'], tags: ['QR kodovi', 'alati'] },
  },
};

export default text;
