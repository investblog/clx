// The product pages' words in Serbian (Latin script, ekavian) — translated from the English in site/products.ts (ADR 0047).
import type { LinkCard, PricingText, ProductText } from '../../products.ts';

export const analytics: ProductText = {
  title: 'Analitika sajta bez kolačića na Cloudflare-u — clx',
  description: 'Brojač poseta bez kolačića koji radi u vašem Cloudflare nalogu: stranice, izvori, zemlje, uređaji i botovi, a detalji su u vašoj D1 bazi. Besplatno.',
  h1: 'Analitika sajta bez kolačića u vašem Cloudflare nalogu',
  lead: 'Snippet od jednog reda broji preglede i posetioce vašeg sajta. Brojač je worker u vašem Cloudflare nalogu, podaci su u vašoj D1 bazi, a clx.cx čuva samo zbirne podatke.',
  start: 'Počnite besplatno',
  steps: ['Povežite Cloudflare', 'Dodajte sajt', 'Ubacite snippet'],
  sections: [
    {
      h: 'Bez kolačića i bez trećih strana',
      p: 'Snippet se učitava sa vašeg domena, sa putanje vašeg sajta (za sajt koji nije na Cloudflare-u, na planu Pro: sa hosta vaše zone), i ne postavlja kolačiće. Posetilac se broji jednom dnevno po hešu nasumične dnevne soli, sajta, IP adrese i oznake pregledača; heš i so se brišu kad se dan zatvori, a IP adresa i oznaka pregledača se nikad ne zapisuju.',
    },
    {
      h: 'Šta izveštaj prikazuje',
      p: 'Preglede i posetioce po satima za danas i po danima za 7 ili 30 dana, sa raspodelama:',
      points: ['Stranice i izvori', 'Zemlje i uređaji', 'Pregledači i operativni sistemi', 'Botovi odvojeno od ljudi: pretraživači, AI crawleri, monitoring, provera oglasa, pretpregledi linkova, headless pregledači'],
    },
    {
      h: 'Vaši podaci, vaše kvote',
      p: 'Raspodele se čitaju iz D1 baze u vašem nalogu kad otvorite izveštaj. clx.cx čuva samo zbirne podatke: po satima za dva dana, po danima za 400. Worker radi na vašim Cloudflare kvotama — Workers Free je obično dovoljan, a clx vas upozorava kad se nalog približi granici.',
    },
  ],
  setup: {
    h: 'Jedan red na vašim stranicama',
    p: 'Dodajte sajt u aplikaciji ili preko API-ja i ubacite njegov snippet u šablon — kao script tag ili kao ugrađenu skriptu (manje od 600 bajtova za sajt na Cloudflare-u). Generator sajtova to radi pri izgradnji.',
    code: '<!-- snippet vašeg sajta; putanja je samo njegova -->\n<script defer src="/lumora/k3.js"></script>',
  },
  faq: {
    h: 'Pitanja',
    items: [
      ['Koje sajtove clx može da broji?', 'Sajtove koje Cloudflare opslužuje u nalogu koji povežete: zonu u tom nalogu ili njen poddomen. Na planu Pro i sajtove hostovane drugde: njihove posete idu na host jedne zone u tom nalogu, broji ih isti worker, a njihove stranice navode taj host. Deset sajtova na besplatnom planu, 500 na planu Pro.'],
      ['Kako se botovi razlikuju od ljudi?', 'Po poznatim potpisima u oznaci pregledača, uključujući headless pregledače: broje se u posebnom izveštaju, po vrsti, i nikad se ne mešaju u preglede ni u posetioce.'],
      ['Mogu li da dobijem sirove posete?', 'Ne: clx ne vodi dnevnik poseta, samo brojače. Izveštaji su dostupni u aplikaciji i preko API-ja.'],
      ['Šta ako prekinem vezu?', 'clx uklanja svoj worker, bazu i rute iz vašeg naloga i navodi sve što nije mogao da ukloni; zbirni podaci na clx.cx brišu se zajedno sa vašim clx nalogom kad ga obrišete.'],
    ],
  },
  faqKey: 'analytics',
  more: [['Kratki linkovi na istom workeru', '/short-links'], ['clx naspram Plausible-a (na engleskom)', '/plausible-alternative'], ['Kako clx radi', '/how-it-works']],
  final: 'Brojite posete u svom Cloudflare nalogu',
};

export const links: ProductText & { card: LinkCard } = {
  title: 'Skraćivač linkova na vašem domenu, na Cloudflare-u — clx',
  description: 'Kratki linkovi na vašem domenu sa QR kodovima, pravilima po zemlji i uređaju i praćenjem klikova, preko workera u vašem Cloudflare nalogu. Besplatno, uz API.',
  h1: 'Skraćivač linkova na vašem domenu',
  lead: 'Kratki linkovi na vašim domenima, sa posebnim hostom za svaki sajt, na primer k7q.example.com, koje opslužuje worker u vašem Cloudflare nalogu — sa QR kodom za svaki link, pravilima po zemlji i uređaju i praćenjem klikova.',
  start: 'Počnite besplatno',
  steps: ['Povežite Cloudflare', 'Izaberite host za linkove', 'Napravite link'],
  sections: [
    {
      h: 'Vaš domen, ne naš',
      p: 'Svaki sajt može imati sopstveni host za linkove — nasumično ime od tri znaka pod njegovom adresom, na primer k7q.example.com — pa linkovi jednog sajta nemaju ništa zajedničko sa linkovima drugog. clx sam pravi host: Cloudflare kreira njegov DNS zapis i sertifikat, i nikad preko zapisa koji već imate. Link odgovara običnim preusmeravanjem 302 bez keširanja, pa svaki klik stiže do workera; sve ostalo na hostu je prazan 404.',
    },
    {
      h: 'QR kod za svaki link',
      p: 'Preuzmite ga kao SVG iz aplikacije ili preko API-ja. Skeniranje se beleži kao poseban izvor, a kod se nikad ne menja — promenite odredište ili pravila, i odštampani kodovi nastavljaju da rade.',
    },
    {
      h: 'Pravila po zemlji, uređaju i botu',
      p: 'Do deset pravila po linku: Nemačku pošaljite na nemačku stranicu, telefone u aplikaciju, a pretpreglede linkova ili pretraživače na posebnu stranicu. Važi prvo pravilo koje se poklopi; ako nijedno ne važi, glavno odredište.',
    },
    {
      h: 'Praćenje linkova',
      p: 'Klikovi i posetioci svakog linka, po danima, sa izvorima, zemljama, uređajima, pregledačima i sistemima — a za link sa pravilima i koje je pravilo preuzelo koje klikove. Botovi se takođe preusmeravaju, ali se broje odvojeno.',
    },
  ],
  setup: {
    h: 'Link je jedan API poziv',
    p: 'Pravite linkove u aplikaciji ili to prepustite svom generatoru sajtova ili agentu:',
    code: 'curl https://clx.cx/v1/links \\\n  -H "Authorization: Bearer clx_…" \\\n  -H "Idempotency-Key: $(uuidgen)" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"link_host_id":"…","url":"https://example.com/spring-sale","code":"spring",\n       "rules":[{"countries":["DE","AT"],"url":"https://example.de/fruehling"}]}\'\n\n# → 201 { "link": { "short_url": "https://k7q.example.com/spring", … } }',
  },
  faq: {
    h: 'Pitanja',
    items: [
      ['Mogu li da koristim clx bez sopstvenog domena?', 'Ne. Linkovi žive na vašem hostu u vašem Cloudflare nalogu: kroz clx.cx ne prolazi ništa od vašeg saobraćaja.'],
      ['Šta se dešava sa odštampanim QR kodom ako se stranica preseli?', 'Promenite odredište linka: kod i QR kod ostaju isti.'],
      ['Koliko linkova mogu da imam?', '200 na besplatnom planu, 10.000 na planu Pro.'],
      ['Kako se link bira po zemlji?', 'Po zemlji iz koje Cloudflare vidi klik; uređaj je telefon ili računar.'],
    ],
  },
  faqKey: 'links',
  more: [['Brojač poseta na istom workeru', '/analytics'], ['clx naspram Bitly-ja (na engleskom)', '/bitly-alternative'], ['Besplatan generator QR kodova', '/qr-code-generator'], ['Kako clx radi', '/how-it-works']],
  final: 'Skraćujte linkove na svom domenu',
  card: {
    short: 'k7q.example.com/spring',
    target: 'example.com/spring-sale',
    qr: 'QR kod',
    rulesTitle: 'Pravila',
    rules: [['Nemačka, Austrija', 'example.de/fruehling'], ['Telefon', 'example.com/app']],
    clicksTitle: 'Klikovi po zemljama',
    countries: ['SAD', 'Nemačka', 'Austrija', 'Ostalo'],
    note: 'Primer linka.',
    flows: {
      h: 'Koje je pravilo preuzelo koje klikove',
      p: 'Sa pravilima, jedan link šalje ljude različitim putevima. Izveštaj to prikazuje na jednoj slici: od svakog izvora do adrese na koju je klik poslat, pa vidite šta svako pravilo zaista radi.',
      title: 'Kuda su otišli klikovi',
      sources: ['QR kod', 'Direktno', 'news.example.net', 'blog.example.org'],
      to: ['Glavna adresa', 'Pravilo 1 (DE, AT)', 'Pravilo 2 (telefon)'],
      note: 'Izveštaj primera linka za 30 dana: odštampani QR kod je deljen u Nemačkoj, a blog se čita na telefonima.',
    },
  },
};

export const generators: ProductText & { flow: [string, string][] } = {
  title: 'API brojača poseta i linkova za generatore sajtova — clx',
  description: 'Dodajte sajt preko API-ja, pri izgradnji ugradite brojač bez zajedničkog traga i čitajte zbirne podatke. clx radi u Cloudflare nalozima vaših klijenata.',
  h1: 'Analitika i kratki linkovi za sajtove koje generišete',
  lead: 'Generator sajtova dodaje sajt preko API-ja, ubacuje njegov brojač u stranice koje gradi i čita zbirne podatke. Svaki brojač radi u sopstvenom Cloudflare nalogu klijenta.',
  start: 'Počnite besplatno',
  flow: [
    ['Vaš generator', 'dodaje sajt i dobija njegov snippet'],
    ['clx API', 'postavlja rutu u nalog klijenta'],
    ['Izgrađene stranice', 'broje posete na domenu klijenta'],
  ],
  sections: [
    {
      h: 'Bez zajedničkog traga',
      p: 'Svaki sajt dobija sopstvenu putanju, nazive fajlova i kod snippeta, generisane iz nasumičnog semena, i nema hosta treće strane: nijedan potpis u stranici, adresama ili odgovorima nije zajednički za clx sajtove niti pominje clx. Vidljivo ostaje, otvoreno rečeno, sledeće: POST ka istom sajtu pri svakom pregledu stranice, na koji stiže prazan odgovor 204, i nazivi API-ja samog pregledača. To važi za sajt na Cloudflare-u; sajt koji se broji spolja (Pro) šalje POST ka hostu zone klijenta, a taj host dele svi sajtovi koji se na njemu broje.',
    },
    {
      h: 'Napravljeno za procese izgradnje',
      p: 'Svaki upis prima ključ idempotentnosti: upis koji je prošao, a ponovo je poslat sa istim ključem u roku od 24 sata, ne pravi istu izmenu dvaput. Ključ dobija samo ovlašćenja koja su mu potrebna — procesu izgradnje dovoljni su sajtovi i izveštaji.',
    },
    {
      h: 'Mnogo klijenata, jedna integracija',
      p: 'Pro pokriva 50 Cloudflare naloga, 500 sajtova i 10.000 linkova, sa pet ključeva; ključ se može ograničiti na pojedine naloge i IP adrese klijenta, tako da ključ jednog klijenta ne može da dopre do drugog.',
    },
    {
      h: 'Radi sa Cloudflare Pages',
      p: 'Ruta brojača stoji na sopstvenom hostu sajta, pored Pages sajta, i sve ostalo propušta dalje. Potrošnja naloga meri se svakog dana, a API vam javlja kada klijent treba da pređe na Workers Paid.',
    },
  ],
  setup: {
    h: 'Tri koraka u izgradnji',
    p: 'Kada je Cloudflare nalog klijenta povezan: dodajte sajt jednom, ugradite njegov snippet u svaku stranicu i čitajte izveštaj kad vam zatreba. Kompletna specifikacija je u API dokumentaciji.',
    code: '# 1. dodajte sajt (ovlašćenje: sites)\ncurl https://clx.cx/v1/sites \\\n  -H "Authorization: Bearer clx_…" \\\n  -H "Idempotency-Key: build-42-example.com" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"account_id":"…","host":"example.com"}\'\n# → 202 { "site": { "id": "…", "snippet": { "inline": "<script>…</script>", … } } }\n\n# 2. ubacite snippet.inline u <head> svake stranice koju gradite\n\n# 3. pročitajte zbirne podatke (ovlašćenje: reports)\ncurl "https://clx.cx/v1/sites/{id}/report?period=7d" -H "Authorization: Bearer clx_…"',
  },
  faq: {
    h: 'Pitanja',
    items: [
      ['Da li moji klijenti moraju da imaju sopstvene Cloudflare naloge?', 'Da: brojač radi u nalogu iz kog se sajt opslužuje — ili, za sajt hostovan drugde (Pro), u nalogu njegovog hosta za prikupljanje. Klijent ga povezuje jednom, bootstrap tokenom, ručno ili kroz vašu integraciju.'],
      ['Mogu li skeneri tragova ili blokatori oglasa da prepoznaju clx?', 'Nijedan potpis u stranici, adresama ili odgovorima nije zajednički za clx sajtove niti pominje clx, osim naziva API-ja samog pregledača. Neko ko posmatra ipak može da vidi ponašanje — POST ka istom sajtu sa praznim odgovorom 204, ili, kod sajta hostovanog drugde, POST ka hostu za prikupljanje.'],
      ['Postoji li SDK?', 'Ne: API je običan HTTP sa OpenAPI specifikacijom, a AI agenti imaju posebno uputstvo korak po korak.'],
      ['Koliko košta?', 'Pro je $9 za 30 dana i plaća se iz unapred uplaćenog salda, dan po dan; besplatni plan ima jedan ključ, jedan Cloudflare nalog i 10 sajtova. Workers Paid nikad nije obavezan.'],
    ],
  },
  faqKey: 'generators',
  more: [['Cene', '/pricing'], ['Kako clx radi', '/how-it-works'], ['Otvoreni kod', '/open-source']],
  final: 'Dajte svakom sajtu koji izgradite sopstveni brojač',
};

export const pricing: PricingText = {
  title: 'Cene clx-a — besplatni plan i Pro: $9 za 30 dana',
  description: 'clx je besplatan za jedan Cloudflare nalog, 10 sajtova i 200 linkova. Pro je $9 za 30 dana: 500 sajtova, uključujući one van Cloudflare-a, 10.000 linkova.',
  h1: 'Besplatni plan i Pro: $9 za 30 dana',
  lead: 'Worker radi u vašem Cloudflare nalogu, na njegovim kvotama, pa clx nikad ne naplaćuje saobraćaj. Planovi se razlikuju po ograničenjima, a Pro broji i sajtove koji nisu na Cloudflare-u.',
  start: 'Počnite besplatno',
  plans: [
    { name: 'Besplatni', price: '$0', points: ['1 Cloudflare nalog', '10 sajtova', '200 linkova, po 10 pravila', '1 API ključ'] },
    { name: 'Pro', price: '$9 za 30 dana', points: ['50 Cloudflare naloga', '500 sajtova, uključujući sajtove van Cloudflare-a', '10.000 linkova, po 10 pravila', '5 API ključeva, ograničenih po nalogu i IP adresi'] },
  ],
  note: 'Pro se plaća iz unapred uplaćenog salda: $0,30 dnevno, naplaćuje se dan po dan dok je uključen. Bez kartice i bez pretplate.',
  sections: [
    {
      h: 'Kako se plaća Pro',
      p: 'Dopunite saldo na stranici „Balance“ u aplikaciji kriptovalutom USDT (TRON, BNB Smart Chain, Ethereum) ili USDC (Ethereum), od $9 do $1.000, ili sa 750 ili 2.500 Telegram Stars u botu (/pay). Pri uključivanju plana Pro naplaćuje se prvi dan, a zatim redom svaki sledeći dan (UTC). Kad ga isključite, Pro se završava posle već plaćenog dana, a ostatak ostaje na saldu.',
    },
    {
      h: 'Ako se saldo potroši',
      p: 'Pro radi još 3 dana, a clx vas obaveštava e-poštom i u Telegramu. Bez dopune nalog se vraća na besplatni plan: ono što prelazi njegova ograničenja se pauzira — ne broji se, ali se ni ne briše — i ponovo radi čim se Pro uključi.',
    },
    {
      h: 'Povraćaj novca',
      p: 'Nepotrošen novac možete zatražiti nazad sa stranice „Balance“ u roku od 90 dana od dopune kojom je uplaćen: kriptovalutu umanjenu za naknadu mreže, na adresu koju navedete; Stars u celosti, nazad na Telegram. Detalji su u uslovima korišćenja.',
    },
    {
      h: 'Šta Cloudflare daje besplatno',
      p: 'Workers Free dozvoljava 100.000 zahteva i 100.000 D1 upisa dnevno po nalogu, zajedno za sve njegove workere. Za tipičan nalog to je oko 11.000 izbrojanih događaja dnevno u najgorem slučaju, a obično nekoliko puta više.',
    },
    {
      h: 'Kada preći na Workers Paid',
      p: 'clx meri potrošnju naloga jednom dnevno, pravi prognozu i upozorava vas pre nego što se kvota potroši. Sam clx nikad ne zahteva Workers Paid.',
    },
    {
      h: 'Ako se kvota potroši',
      p: 'Kad ponestane zahteva ka workerima (100.000 dnevno), putanja brojača odgovara greškom, a kratki linkovi prestaju da rade; same vaše stranice to ne pogađa. Kad ponestane D1 upisa, brojač prestaje da broji, a linkovi i dalje preusmeravaju. Kad ponestane D1 čitanja (5 miliona dnevno), linkovi odgovaraju „pokušajte ponovo kasnije“ (503). Svako od toga traje dok se kvota ne obnovi.',
    },
  ],
  faq: {
    h: 'Pitanja',
    items: [
      ['Da li mi treba kartica?', 'Ne: za registraciju i besplatni plan nije potrebna, a Pro se plaća kriptovalutom ili Telegram Stars.'],
      ['Šta Pro donosi osim viših ograničenja?', 'Sajtove koji nisu na Cloudflare-u: njihove posete idu na host jedne zone u vašem Cloudflare nalogu i tamo ih broji isti worker. Besplatni plan broji samo sajtove koje opslužuje Cloudflare.'],
      ['Da li clx naplaćuje saobraćaj?', 'Ne: vaše posete i klikovi prolaze kroz vaš Cloudflare nalog i njegove kvote, a ne kroz clx.cx.'],
      ['Šta se računa u ograničenja?', 'Povezani Cloudflare nalozi, sajtovi, linkovi i API ključevi; posete i klikove ograničavaju samo vaše Cloudflare kvote.'],
      ['Postoji li partnerski program?', 'Svaki nalog ima partnerski link na stranici „Partners“ u aplikaciji: 30% od svake dopune ljudi koji se preko njega registruju, sve dok plaćaju. Posle 30 dana iznos možete prebaciti na svoj saldo ili zatražiti isplatu u USDT (TRON), od $20.'],
    ],
  },
  faqKey: 'pricing',
  more: [['Za generatore sajtova', '/for-site-generators'], ['Kako clx radi', '/how-it-works']],
  final: 'Počnite sa besplatnim planom',
};

export const how: ProductText & { flow: [string, string][] } = {
  title: 'Kako clx radi: worker u vašem Cloudflare nalogu — clx',
  description: 'clx instalira jedan worker i jednu D1 bazu u vaš Cloudflare nalog, uz token samo sa potrebnim pravima. Šta gde radi, šta se čuva i kako da odete.',
  h1: 'Kako clx radi',
  lead: 'clx postavlja jedan worker u vaš Cloudflare nalog. On broji posete i opslužuje kratke linkove na vašim domenima, čuva detalje u vašoj D1 bazi i šalje na clx.cx samo zbirne podatke.',
  start: 'Počnite besplatno',
  steps: ['Povežite Cloudflare', 'Dodajte sajt ili host za linkove', 'Pročitajte izveštaj'],
  flow: [
    ['Posetilac', 'otvara stranicu vašeg sajta ili kratki link na vašem domenu'],
    ['clx-edge, u vašem nalogu', 'broji pregled ili preusmerava klik, upisuje detalje u vašu D1'],
    ['clx.cx', 'svakog sata dobija zbirne podatke i čita vašu D1 kad otvorite izveštaj'],
  ],
  sections: [
    {
      h: 'Token samo sa potrebnim pravima',
      p: 'Napravite jednodnevni bootstrap token preko linka sa šablonom. clx ga pretvara u radni token za taj jedan nalog, koji važi godinu dana, i briše bootstrap token — ili vam kaže da ga opozovete, ako Cloudflare to ne dozvoli. Radni token se čuva šifrovan i ima samo ova prava:',
      points: ['Workers skripte i rute: instalacija workera i njegovih ruta', 'D1: baza workera', 'Čitanje zona: koje domene možete da izaberete', 'Čitanje podešavanja i analitike naloga: naziv naloga i upozorenje pre nego što se kvota potroši'],
    },
    {
      h: 'Šta clx kreira, i samo to',
      p: 'Jedan worker i jednu bazu, oba sa imenom clx-edge, rutu za svaki sajt i prilagođeni domen za svaki host za linkove. clx beleži šta je napravio. Ako tamo već postoji clx-edge koji on nije napravio, zaustavlja se i ništa ne dira; pre nego što zameni ili ukloni worker, proverava da li je kod u njemu iz nekog njegovog izdanja.',
    },
    {
      h: 'Gde su vaši podaci',
      p: 'Detalji — stranice, izvori, zemlje, uređaji, pregledači, sistemi — ostaju u D1 bazi u vašem nalogu: po satima 31 dan, po danima 400. clx.cx čuva vaša podešavanja i zbirne podatke. Posetilac se broji po hešu sa dnevnom soli; heš i so se brišu kad se dan zatvori i nikad ne napuštaju vaš nalog.',
    },
    {
      h: 'Ažuriranja i kako da odete',
      p: 'clx ažurira worker jednim proverenim izdanjem za sve naloge, a pre toga migrira njegovu bazu. Prekid veze uklanja worker, bazu i rute i navodi sve što nije mogao da ukloni; radni token opozivate u Cloudflare-u preko linka koji vam clx da, a zbirni podaci na clx.cx brišu se posle 30 dana ili odmah. Sam opoziv tokena sprečava clx da bilo šta menja; ako sami obrišete clx-edge, brojanje i linkovi odmah prestaju.',
    },
  ],
  more: [['Otvoreni kod', '/open-source'], ['Cene', '/pricing'], ['Pitanja', '/faq']],
  final: 'Isprobajte u svom Cloudflare nalogu',
};

export const open: ProductText = {
  title: 'Analitika i skraćivač linkova otvorenog koda, AGPL — clx',
  description: 'clx je otvorenog koda pod AGPL-3.0: servis, worker koji instalira u vaš Cloudflare nalog i sajt. Pogledajte šta radi u vašem nalogu ili pokrenite svoj.',
  h1: 'clx je otvorenog koda',
  lead: 'Servis na clx.cx, worker koji on instalira u vaš Cloudflare nalog i ovaj sajt čine jedan javni repozitorijum pod AGPL-3.0. Pogledajte šta radi u vašem nalogu ili pokrenite sopstveni clx.',
  start: 'Počnite besplatno',
  sections: [
    {
      h: 'AGPL-3.0',
      p: 'Kod možete da čitate, menjate i pokrećete. Ako izmenjenu kopiju nudite drugima kao servis, njeni korisnici dobijaju i njen izvorni kod.',
    },
    {
      h: 'Šta radi u vašem nalogu',
      p: 'Worker se gradi iz foldera edge/ u repozitorijumu; izgrađeni paket se čuva u repozitorijumu zajedno sa svojim sha256, a pored njega je spisak svih izdanja ikad objavljenih. clx zamenjuje ili uklanja worker u vašem nalogu samo kada je njegov kod jedno od njih.',
    },
    {
      h: 'Sopstveni clx',
      p: 'Sam clx.cx je Worker sa D1 bazom i KV imenskim prostorom: jedan Cloudflare nalog pokreće njegovu kopiju, sa istom aplikacijom, API-jem i workerom za naloge vaših korisnika.',
    },
    {
      h: 'Biblioteka za QR kodove',
      p: 'QR kodove crta @spintax/qr-svg, zasebna biblioteka na npm-u pod MIT licencom, bez sopstvenih zavisnosti.',
    },
  ],
  setup: {
    h: 'Pokrenite sopstvenu kopiju',
    p: 'Potrebni su Node.js 22 i pnpm. README sadrži sve korake, uključujući tajne.',
    code: 'git clone https://github.com/investblog/clx && cd clx\npnpm install\nnode scripts/wrangler.mjs login\nnode scripts/wrangler.mjs d1 create clx\nnode scripts/wrangler.mjs kv namespace create SESSIONS\ncp wrangler.example.jsonc wrangler.jsonc   # vaša ruta, id-jevi, HOOK_URL\nnode scripts/wrangler.mjs d1 migrations apply clx --remote\nnode scripts/secrets.mjs JWT_SECRET\nnode scripts/secrets.mjs MASTER_KEYS\npnpm run deploy\nnode scripts/user.mjs add you@example.com',
  },
  more: [['Kako clx radi', '/how-it-works'], ['Za generatore sajtova', '/for-site-generators']],
  final: 'Ili koristite clx.cx, besplatno',
};
