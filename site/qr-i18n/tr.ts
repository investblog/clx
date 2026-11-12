import { EXTENSION_NAME, MAX_DATA } from '../qr-core.ts';
import type { QrLanguage } from '../qr-text.ts';

const text: QrLanguage = {
  chrome: {
    signIn: 'Giriş yap',
    dashboard: 'Panel',
    theme: 'Temayı değiştir',
    language: 'Dil',
    inEnglish: 'İngilizce',
    nav: { analytics: 'Analitik', links: 'Kısa bağlantılar', generators: 'Site oluşturucular için', pricing: 'Fiyatlar', faq: 'Sorular', menu: 'Menü' },
    foot: { how: 'Nasıl çalışır', openSource: 'Açık kaynak', qr: 'QR kod oluşturucu', company: '301.st', agents: 'Yapay zekâ ajanları için', api: 'API', privacy: 'Gizlilik', terms: 'Kullanım koşulları', source: 'Kaynak kod', contact: 'İletişim' },
  },
  generator: {
    title: 'Ücretsiz SVG QR kod oluşturucu, üyeliksiz — clx',
    description: "Tarayıcınızda küçük bir SVG olarak QR kod oluşturun: boyutu ve hata düzeltmeyi seçin, indirin ya da sayfanız için görsel bağlantısı alın. Ücretsiz, üyeliksiz.",
    h1: 'Ücretsiz SVG QR kod oluşturucu',
    lead: 'Bir URL veya herhangi bir metin yazın: QR kod tarayıcınızda küçük bir SVG olarak çizilir — tek bir dikdörtgen ve tek bir yol — ve her boyutta keskin kalır. İndirin, kopyalayın ya da aynı görselin bağlantısını alıp bir sayfaya koyun.',
    form: { data: 'Metin veya URL', hint: `En fazla ${MAX_DATA.toLocaleString('tr')} karakter. Bir koda ne kadarının sığacağı metne ve hata düzeltme düzeyine bağlıdır.`, size: 'Boyut', ecc: 'Hata düzeltme', quiet: 'Kenar boşluğu (modül)' },
    ecc: { L: 'L — %7', M: 'M — %15', Q: 'Q — %25', H: 'H — %30' },
    out: { download: "SVG'yi indir", svg: "SVG'yi kopyala", link: 'Görsel bağlantısı', copyLink: 'Bağlantıyı kopyala', embed: 'Sayfanız için HTML', copyEmbed: "HTML'yi kopyala", noscript: "Oluşturucu JavaScript gerektirir. JavaScript olmadan API'yi kullanın: metninizi içeren bir bağlantı size görseli verir." },
    t: { empty: 'Bir metin veya URL yazın.', tooLong: `Metin ${MAX_DATA.toLocaleString('tr')} karakterden uzun.`, noFit: 'Bu metin tek bir QR koda sığmıyor: metni kısaltın ya da hata düzeltme düzeyini düşürün.', ready: 'SVG, {bytes} bayt.', copied: 'Kopyalandı.', failed: 'Tarayıcı kopyalamaya izin vermedi: metni seçip kendiniz kopyalayın.', alt: 'QR kod' },
    sections: [
      { h: 'Neden SVG', p: "Vektörel bir QR kod telefonda, baskıda ve reklam panosunda keskin kalır. Bu kod, kısa bir URL için yaklaşık 3 KB tutar: beyaz bir dikdörtgen ve tam sayı koordinatlı tek bir yol, başka hiçbir şey yok — düzenlemesi, HTML'nin içine gömmesi ve herhangi bir iş akışından geçirmesi kolaydır." },
      { h: 'Hiçbir şey tarayıcınızdan çıkmaz', p: 'Kod bu sayfada, açık kaynaklı @spintax/qr-svg kütüphanesiyle çizilir. Yazdığınız metin hiçbir yere gönderilmez — hiçbir istek onu taşımaz — ve oluşturucu ne hesap ister ne de çerez bırakır.' },
      { h: 'Aynı görselin bağlantısı', p: "Görsel bağlantısı, qr.clx.cx adresindeki ücretsiz API'ye gider; API, bağlantıdaki metinden birebir aynı SVG'yi çizer. Bağlantıyı bir <img> etiketine, bir README dosyasına ya da bir e-postaya koyun; metni bağlantının kendisi taşıdığı için biz hiçbir şey saklamayız." },
      { h: 'Taramaları sayın', p: 'Sıradan bir QR kod, onu kimin taradığını söyleyemez. Kodu kendi alan adınızdaki bir clx kısa bağlantısına yönlendirin; taramalar ayrı bir kaynak olarak, ülkeye ve cihaza göre sayılır — ücretsiz, kendi Cloudflare hesabınızda.' },
    ],
    faq: {
      h: 'Sorular',
      items: [
        ['Oluşturucu ücretsiz mi?', 'Evet; üyelik gerekmez ve oluşturabileceğiniz kod sayısında sınır yoktur: kodlar tarayıcınızda çizilir. qr.clx.cx adresindeki API de anahtar istemez.'],
        ['Bilgisayarımdaki bir sayfayı telefonumda nasıl açarım?', 'Sayfanın adresini buraya yapıştırın, kodu telefonun kamerasıyla tarayın ve beliren bağlantıya dokunun: sayfa telefonda açılır — bağlantıyı kendinize göndermeniz ya da hesap açmanız gerekmez. Tarayıcı uzantısı yapıştırma zahmetini de ortadan kaldırır: bulunduğunuz sayfanın kodunu kendisi oluşturur.'],
        ['Tarayıcı uzantısı var mı?', `Evet, ücretsiz bir uzantı var: Chrome, Firefox ve Edge için ${EXTENSION_NAME}. Yan panelde, bulunduğunuz sayfa ya da herhangi bir metin için QR kod oluşturur — burada olduğu gibi bir SVG, bir bağlantı ve yerleştirme kodları — ve hiçbir yere bir şey göndermez.`],
        ['Burada oluşturulan QR kodların süresi dolar mı?', "Hayır. QR kod, metnini kendi içinde taşır; yönlendirdiği yer çalıştığı sürece çalışır. Görsel bağlantısı da API çalıştığı sürece çalışır."],
        ['Hangi hata düzeltme düzeyini seçmeliyim?', 'Ekranlar ve çoğu baskı için M; çizilebilecek ya da üzerine logo konacak baskılar için Q veya H. Düzey yükseldikçe kod daha yoğun olur.'],
        ['Basılı bir kodun yönlendirdiği yeri değiştirebilir miyim?', 'Sıradan bir QR kodla hayır: metni sabittir. Bunun yerine kısa bir bağlantıyı kodlayın ve bağlantının hedefini istediğiniz zaman değiştirin.'],
        ['QR kod gizli midir?', 'Hayır. Onu tarayan ya da görsel bağlantısını açan herkes metnini okur. Parolaları ve başka gizli bilgileri kodlamayın.'],
      ],
    },
    ext: { link: 'Ücretsiz tarayıcı uzantısı →', group: `${EXTENSION_NAME} uzantısını yükleyin` },
    more: [['QR kodlu kısa bağlantılar (İngilizce)', '/short-links'], ['Tarayıcı uzantısı', '/qr-code-extension'], ['QR araçlarının gizliliği', '/qr-code-privacy']],
    api: "qr.clx.cx QR kod API'si (İngilizce)",
  },
  extension: {
    title: 'QR kod oluşturucu tarayıcı eklentisi — clx',
    description: 'Ücretsiz tarayıcı uzantısı: açık sayfa ya da istediğiniz metin için yan panelde SVG QR kod. İndirin, kopyalayın, bağlantı veya yerleştirme kodu paylaşın.',
    lead: `${EXTENSION_NAME}, bulunduğunuz sayfa ya da herhangi bir metin için yan panelde QR kod oluşturan ücretsiz bir tarayıcı uzantısıdır: kodu küçük bir SVG olarak, bir bağlantı ve yerleştirme kodlarıyla birlikte verir. Hiçbir yere bir şey göndermez.`,
    install: 'Kurulum',
    blocks: [
      ['Başlarken', [
        "Uzantının simgesine tıklayın: yan paneli açılır (Firefox'ta kenar çubuğu).",
        '“Açılışta oluştur” açıksa geçerli sayfanın QR kodunu hemen gösterir.',
        'Aynı sayfayı telefonunuzda açmak için kodu telefonun kamerasıyla tarayın ve beliren bağlantıya dokunun: bağlantıyı kendinize göndermeniz gerekmez.',
        "Paylaşım bağlantısını kopyalayın, SVG'yi kopyalayın ya da indirin veya “Yerleştir” sekmesinden bir yerleştirme kodu alın.",
      ]],
      ['Oluştur', [
        '“Geçerli sayfa”: etkin sekmenin adresi; başka bir sayfaya geçtikten sonra yenileme düğmesine basın.',
        `“Özel metin”: herhangi bir URL veya metin, en fazla ${MAX_DATA.toLocaleString('tr')} karakter (bir emoji iki karakter sayılır).`,
        'Boyut: 125, 200, 250 veya 300 px. ECC (hata düzeltme): L %7, M %15, Q %25, H %30 — düzey yükseldikçe kod daha dayanıklı ama daha yoğun olur.',
        "“Bağlantıyı kopyala”: QR kod API'sindeki görselin bağlantısı, metni de içinde taşır; 2.048 karakterden uzun metinler için bağlantı yoktur. “SVG'yi kopyala” ve “SVG'yi indir” her kod için çalışır.",
      ]],
      ['Yerleştir', [
        'Aynı bağlantıyı taşıyan yerleştirme kodları: HTML <img>, HTML <object>, Markdown, React ve Vue — “Yerleştirme kodunu kopyala” ya da yalnızca bağlantı için “URL\'yi kopyala”.',
        "1.1.0 öncesi sürümlerle kopyalanan bağlantılar metin içermiyordu ve artık çalışmıyor: onları Geçmiş'ten yeniden kopyalayın.",
      ]],
      ['Geçmiş ve ayarlar', [
        "“Oluştur” sekmesinde “Bağlantıyı kopyala” düğmesine bastığınızda kod Geçmiş'e kaydedilir: metni, zamanı, boyutu ve ECC düzeyi. “Tümünü temizle” geçmişi siler.",
        'Ayarlar: varsayılan boyut ve ECC, “Açılışta oluştur”, “Geçmiş sınırı” (25, 50 veya 100), tema.',
        'Geçmiş ve ayarlar tarayıcınızda (storage.local) kalır ve eşitlenmez.',
      ]],
      ['Gizlilik ve izinler', [
        "1.1.0 sürümünden itibaren uzantı hiçbir ağ isteği yapmaz: kodlar ve bağlantılar tarayıcıda oluşturulur. Önceki sürümler her kodun metnini eski API'ye gönderiyordu.",
        'Paylaşım bağlantısı kendi metnini taşır: bağlantıyı açan ya da kodu tarayan herkes onu okuyabilir.',
        "İzinler: yan panel (uzantının penceresi; Firefox'ta kenar çubuğu vardır ve izin gerekmez), depolama (ayarlar ve geçmiş), sekmeler (geçerli sayfanın adresi).",
      ]],
    ],
    more: 'Politikanın tamamı: ',
    policy: 'QR araçlarının gizliliği',
    api: "Bağlantılarının yönlendirdiği QR kod API'si:",
    also: [['Çevrimiçi QR kod oluşturucu', '/qr-code-generator']],
  },
  keywords: {
    generator: {
      primary: 'ücretsiz SVG QR kod oluşturucu',
      keywords: ['online QR kod oluşturma', 'tarayıcıda SVG formatında QR kod', 'üyeliksiz QR kod yapma aracı', 'vektörel QR kod oluşturucu', 'bağlantıları telefona göndermek için QR kod'],
      tags: ['QR kodlar', 'web araçları'],
    },
    extension: {
      primary: 'QR kod oluşturucu tarayıcı eklentisi',
      keywords: ['Chrome için QR kod uzantısı', 'yan panelde QR kod oluşturma', 'ücretsiz QR kod eklentisi', 'geçerli sayfayı telefona gönderme'],
      tags: ['tarayıcı uzantıları', 'QR kod araçları'],
    },
  },
};

export default text;
