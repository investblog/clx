// The QR code tools in Spanish (ADR 0046): neutral international Spanish, «tú» as in the extension's
// es messages.json, whose labels the pages quote in «…».
import { EXTENSION_NAME, MAX_DATA } from '../qr-core.ts';
import type { QrLanguage } from '../qr-text.ts';

const text: QrLanguage = {
  chrome: {
    signIn: 'Iniciar sesión',
    dashboard: 'Panel',
    theme: 'Cambiar tema',
    language: 'Idioma',
    nav: { analytics: 'Analítica', links: 'Enlaces cortos', generators: 'Para generadores de sitios', pricing: 'Precios', faq: 'Preguntas', menu: 'Menú' },
    foot: { how: 'Cómo funciona', openSource: 'Código abierto', qr: 'Generador de códigos QR', company: '301.st', agents: 'Para agentes de IA', api: 'API', privacy: 'Privacidad', terms: 'Condiciones', source: 'Código fuente', contact: 'Contacto' },
  },
  generator: {
    title: 'Generador de códigos QR en SVG gratis, sin registro — clx',
    description: 'Crea en tu navegador un código QR en SVG ligero: elige el tamaño y la corrección de errores, descárgalo o copia un enlace a la imagen. Gratis y sin registro.',
    h1: 'Generador de códigos QR en SVG gratis',
    lead: 'Escribe una URL o cualquier texto: el código QR se dibuja en tu navegador como un SVG ligero (un rectángulo y un trazado), nítido a cualquier tamaño. Descárgalo, cópialo o toma un enlace a la misma imagen para ponerlo en una página.',
    form: { data: 'Texto o URL', hint: `Hasta ${MAX_DATA.toLocaleString('es')} caracteres. Cuánto cabe en un código depende del texto y de la corrección de errores.`, size: 'Tamaño', ecc: 'Corrección de errores', quiet: 'Margen (módulos)' },
    ecc: { L: 'L — 7 %', M: 'M — 15 %', Q: 'Q — 25 %', H: 'H — 30 %' },
    out: { download: 'Descargar SVG', svg: 'Copiar SVG', link: 'Enlace a la imagen', copyLink: 'Copiar enlace', embed: 'HTML para tu página', copyEmbed: 'Copiar HTML', noscript: 'El generador necesita JavaScript. Sin él, usa la API: un enlace con tu texto te devuelve la imagen.' },
    t: { empty: 'Escribe un texto o una URL.', tooLong: `El texto supera los ${MAX_DATA.toLocaleString('es')} caracteres.`, noFit: 'Este texto no cabe en un solo código QR: acórtalo o baja la corrección de errores.', ready: 'SVG, {bytes} bytes.', copied: 'Copiado.', failed: 'El navegador no permitió copiar: selecciona el texto y cópialo a mano.', alt: 'Código QR' },
    sections: [
      { h: 'Por qué SVG', p: 'Un código QR vectorial se ve nítido en el teléfono, impreso y en una valla publicitaria. Este pesa unos 3 KB para una URL corta: un rectángulo blanco y un único trazado con coordenadas enteras, nada más. Es fácil de editar, de insertar en el HTML y de pasar por cualquier flujo de trabajo.' },
      { h: 'Nada sale de tu navegador', p: 'El código se dibuja en esta página con la biblioteca de código abierto @spintax/qr-svg. Lo que escribes no se envía a ningún sitio (ninguna petición lo lleva), y el generador no necesita cuenta ni instala cookies.' },
      { h: 'Un enlace a la misma imagen', p: 'El enlace a la imagen apunta a la API gratuita de qr.clx.cx, que dibuja exactamente el mismo SVG a partir del texto del enlace. Ponlo en una etiqueta <img>, en un README o en un correo; el propio enlace lleva el texto, así que no guardamos nada.' },
      { h: 'Cuenta los escaneos', p: 'Un código QR normal no te dice quién lo ha escaneado. Haz que apunte a un enlace corto de clx en tu propio dominio y los escaneos se contarán como una fuente aparte, por país y dispositivo; gratis, en tu cuenta de Cloudflare.' },
    ],
    faq: {
      h: 'Preguntas',
      items: [
        ['¿El generador es gratis?', 'Sí, sin registro y sin límite de códigos: se dibujan en tu navegador. La API de qr.clx.cx tampoco necesita clave.'],
        ['¿Cómo abro en el teléfono una página que tengo en la computadora?', 'Pega aquí la dirección de la página, escanea el código con la cámara del teléfono y toca el enlace que aparece: la página se abre en el teléfono, sin enviarte el enlace y sin cuenta. La extensión para el navegador te ahorra pegarla: genera el código de la página en la que estás.'],
        ['¿Hay una extensión para el navegador?', `Sí, gratuita: ${EXTENSION_NAME}, para Chrome, Firefox y Edge. En un panel lateral genera un código QR de la página en la que estás o de cualquier texto (un SVG, un enlace y snippets para insertarlo, como aquí) y no envía nada a ningún sitio.`],
        ['¿Caducan los códigos QR creados aquí?', 'No. Un código QR lleva su texto dentro; funciona mientras funcione aquello a lo que apunta. El enlace a la imagen funciona mientras funcione la API.'],
        ['¿Qué corrección de errores elijo?', 'M para pantallas y la mayoría de los impresos; Q o H para impresos que puedan rayarse o llevar un logotipo encima. Cuanto más alto el nivel, más denso es el código.'],
        ['¿Puedo cambiar adónde lleva un código ya impreso?', 'Con un código QR normal, no: su texto es fijo. Codifica en su lugar un enlace corto y cambia su destino cuando quieras.'],
        ['¿Un código QR es privado?', 'No. Cualquiera que lo escanee o abra su enlace a la imagen puede leer su texto. No codifiques contraseñas ni otros secretos.'],
      ],
    },
    ext: { link: 'Extensión gratuita para el navegador →', group: `Instalar ${EXTENSION_NAME}` },
    more: [['Enlaces cortos con códigos QR (en inglés)', '/short-links'], ['Extensión para el navegador', '/qr-code-extension'], ['Privacidad de las herramientas QR', '/qr-code-privacy']],
    api: 'API de códigos QR qr.clx.cx (en inglés)',
  },
  extension: {
    title: 'Extensión de navegador para generar códigos QR — clx',
    description: 'Extensión gratuita para el navegador: códigos QR en SVG en un panel lateral, de la página abierta o de cualquier texto. Descarga, copia, comparte o inserta.',
    lead: `${EXTENSION_NAME} es una extensión gratuita para el navegador que genera un código QR en un panel lateral (de la página en la que estás o de cualquier texto) como un SVG ligero, con un enlace y snippets para insertarlo. No envía nada a ningún sitio.`,
    install: 'Instalar',
    blocks: [
      ['Primeros pasos', [
        'Haz clic en el icono de la extensión: se abre su panel lateral (una barra lateral en Firefox).',
        'Con «Generar al abrir», muestra al instante un código QR de la página actual.',
        'Para abrir la misma página en el teléfono, escanea el código con la cámara del teléfono y toca el enlace que aparece: no hace falta enviarte el enlace.',
        'Copia el enlace para compartir, copia o descarga el SVG, o toma un snippet de la pestaña «Insertar».',
      ]],
      ['Generar', [
        '«Página actual»: la dirección de la pestaña activa; pulsa el botón de actualizar después de pasar a otra página.',
        `«Texto propio»: cualquier URL o texto, hasta ${MAX_DATA.toLocaleString('es')} caracteres (un emoji cuenta como dos).`,
        'Tamaño: 125, 200, 250 o 300 px. ECC (corrección de errores): L 7 %, M 15 %, Q 25 %, H 30 %; cuanto más alto, más resistente, pero más denso.',
        '«Copiar enlace»: un enlace a la imagen en la API de códigos QR, con el texto dentro; no existe para textos de más de 2048 caracteres. «Copiar SVG» y «Descargar SVG» funcionan con cualquier código.',
      ]],
      ['Insertar', [
        'Snippets con el mismo enlace: HTML <img>, HTML <object>, Markdown, React y Vue; «Copiar snippet», o «Copiar URL» para el enlace solo.',
        'Los enlaces copiados con versiones anteriores a la 1.1.0 no llevaban el texto y ya no funcionan: vuelve a copiarlos desde el «Historial».',
      ]],
      ['Historial y ajustes', [
        'Un código se guarda en el «Historial» cuando pulsas «Copiar enlace» en la pestaña «Generar»: su texto, la hora, el tamaño y el ECC. «Borrar todo» vacía el historial.',
        'Ajustes: tamaño y ECC predeterminados, «Generar al abrir», «Límite del historial» (25, 50 o 100) y el tema.',
        'El historial y los ajustes se quedan en tu navegador (storage.local) y no se sincronizan.',
      ]],
      ['Privacidad y permisos', [
        'Desde la versión 1.1.0, la extensión no hace ninguna petición de red: los códigos y los enlaces se crean en el navegador. Las versiones anteriores enviaban el texto de cada código a la antigua API.',
        'Un enlace para compartir lleva su texto: quien lo abra o escanee el código puede leerlo.',
        'Permisos: panel lateral (su ventana; Firefox tiene una barra lateral y no lo necesita), almacenamiento (ajustes e historial), pestañas (la dirección de la página actual).',
      ]],
    ],
    more: 'La política completa: ',
    policy: 'privacidad de las herramientas QR',
    api: 'La API de códigos QR a la que enlaza:',
    also: [['Generador de códigos QR en la web', '/qr-code-generator']],
  },
  keywords: {
    generator: {
      primary: 'generador de códigos QR en SVG',
      keywords: ['generador gratuito de códigos QR', 'código QR online sin registro', 'código QR vectorial', 'creación de códigos QR en el navegador', 'código QR para pasar enlaces al teléfono'],
      tags: ['códigos QR', 'herramientas'],
    },
    extension: {
      primary: 'extensión para generar códigos QR',
      keywords: ['extensión de códigos QR para el navegador', 'extensión QR para Chrome', 'código QR en el panel lateral', 'envío de la página actual al teléfono'],
      tags: ['códigos QR', 'extensión de navegador'],
    },
  },
};

export default text;
