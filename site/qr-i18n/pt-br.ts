// The QR code tools' words in Brazilian Portuguese (ADR 0046). The extension's labels are its own
// (_locales/pt_BR/messages.json): "QR code", “Gerar”, “Código”, “Copiar link”, “Gerar ao abrir”…
import { EXTENSION_NAME, MAX_DATA } from '../qr-core.ts';
import type { QrLanguage } from '../qr-text.ts';

const text: QrLanguage = {
  chrome: {
    signIn: 'Entrar',
    dashboard: 'Painel',
    theme: 'Alternar tema',
    language: 'Idioma',
    inEnglish: 'Em inglês',
    nav: { analytics: 'Análises', links: 'Links curtos', generators: 'Para geradores de sites', pricing: 'Preços', faq: 'Perguntas', menu: 'Menu' },
    foot: { how: 'Como funciona', openSource: 'Código aberto', qr: 'Gerador de QR code', company: '301.st', agents: 'Para agentes de IA', api: 'API', privacy: 'Privacidade', terms: 'Termos', source: 'Código-fonte', contact: 'Contato' },
  },
  generator: {
    title: 'Gerador de QR code SVG grátis, sem cadastro — clx',
    description: 'Crie um QR code em SVG leve no seu navegador: escolha o tamanho e a correção de erros, baixe o arquivo ou copie o link da imagem. Grátis, sem cadastro.',
    h1: 'Gerador de QR code SVG grátis',
    lead: 'Digite uma URL ou qualquer texto: o QR code é desenhado no seu navegador como um SVG leve — um retângulo e um único path —, nítido em qualquer tamanho. Baixe, copie ou pegue um link para a mesma imagem e coloque-o numa página.',
    form: { data: 'Texto ou URL', hint: `Até ${MAX_DATA.toLocaleString('pt-BR')} caracteres. Quanto cabe em um código depende do texto e da correção de erros.`, size: 'Tamanho', ecc: 'Correção de erros', quiet: 'Margem (módulos)' },
    ecc: { L: 'L — 7%', M: 'M — 15%', Q: 'Q — 25%', H: 'H — 30%' },
    out: { download: 'Baixar SVG', svg: 'Copiar SVG', link: 'Link da imagem', copyLink: 'Copiar link', embed: 'HTML para a sua página', copyEmbed: 'Copiar HTML', noscript: 'O gerador precisa de JavaScript. Sem ele, use a API: um link com o seu texto devolve a imagem.' },
    t: { empty: 'Digite um texto ou uma URL.', tooLong: `O texto tem mais de ${MAX_DATA.toLocaleString('pt-BR')} caracteres.`, noFit: 'Este texto não cabe em um QR code: encurte-o ou diminua a correção de erros.', ready: 'SVG, {bytes} bytes.', copied: 'Copiado.', failed: 'O navegador não permitiu copiar: selecione o texto e copie você mesmo.', alt: 'QR code' },
    sections: [
      { h: 'Por que SVG', p: 'Um QR code vetorial continua nítido no celular, no papel e num outdoor. Este tem cerca de 3 KB para uma URL curta: um retângulo branco e um único path com coordenadas inteiras, nada mais — fácil de editar, de colocar direto no HTML e de passar por qualquer pipeline.' },
      { h: 'Nada sai do seu navegador', p: 'O código é desenhado nesta página pela biblioteca aberta @spintax/qr-svg. O que você digita não é enviado a lugar nenhum — nenhuma requisição o leva —, e o gerador não pede conta nem grava cookies.' },
      { h: 'Um link para a mesma imagem', p: 'O link da imagem aponta para a API gratuita em qr.clx.cx, que desenha exatamente o mesmo SVG a partir do texto do link. Use-o numa tag <img>, num README ou num e-mail; o próprio link carrega o texto, então não guardamos nada.' },
      { h: 'Acompanhe os escaneamentos', p: 'Um QR code comum não diz quem o escaneou. Aponte-o para um link curto do clx no seu próprio domínio, e os escaneamentos são contados como uma origem à parte, por país e dispositivo — grátis, na sua conta Cloudflare.' },
    ],
    faq: {
      h: 'Perguntas',
      items: [
        ['O gerador é grátis?', 'Sim, sem cadastro e sem limite de quantos códigos você cria: eles são desenhados no seu navegador. A API em qr.clx.cx também não exige chave.'],
        ['Como abrir no celular uma página que está no computador?', 'Cole aqui o endereço da página, escaneie o código com a câmera do celular e toque no link que aparecer: a página abre no celular — sem mandar o link para você mesmo, sem conta. A extensão para navegador poupa você de colar: ela gera o código da página em que você está.'],
        ['Existe uma extensão para navegador?', `Sim, gratuita: ${EXTENSION_NAME}, para Chrome, Firefox e Edge. Num painel lateral, ela gera um QR code para a página em que você está ou para qualquer texto — um SVG, um link e snippets para incorporar, como aqui — e não envia nada a lugar nenhum.`],
        ['Os QR codes criados aqui expiram?', 'Não. O QR code guarda o próprio texto e funciona enquanto o destino dele funcionar. O link da imagem funciona enquanto a API funcionar.'],
        ['Qual correção de erros devo escolher?', 'M para telas e para a maior parte dos impressos; Q ou H para impressos que podem ser arranhados ou receber um logo por cima. Níveis mais altos deixam o código mais denso.'],
        ['Posso mudar o destino de um código já impresso?', 'Não com um QR code comum: o texto dele é fixo. Codifique um link curto e mude o destino do link quando quiser.'],
        ['Um QR code é privado?', 'Não. Qualquer pessoa que o escaneie ou abra o link da imagem lê o texto. Não codifique senhas nem outros segredos.'],
      ],
    },
    ext: { link: 'Extensão grátis para navegador →', group: `Instalar ${EXTENSION_NAME}` },
    more: [['Links curtos com QR codes (em inglês)', '/short-links'], ['Extensão para navegador', '/qr-code-extension'], ['Privacidade das ferramentas de QR code', '/qr-code-privacy']],
    api: 'API de QR code qr.clx.cx (em inglês)',
  },
  extension: {
    title: 'Gerador de QR code: extensão para navegador — clx',
    description: 'Extensão grátis para navegador: QR codes em SVG num painel lateral, para a página aberta ou qualquer texto — baixe, copie, compartilhe um link ou um snippet.',
    lead: `${EXTENSION_NAME} é uma extensão gratuita para navegador que gera um QR code num painel lateral — para a página em que você está ou para qualquer texto — como um SVG leve, com um link e snippets para incorporá-lo. Ela não envia nada a lugar nenhum.`,
    install: 'Instalar',
    blocks: [
      ['Primeiros passos', ['Clique no ícone da extensão: o painel lateral dela se abre (no Firefox, uma barra lateral).', 'Com “Gerar ao abrir” ativado, ela mostra na hora o QR code da página atual.', 'Para abrir a mesma página no celular, escaneie o código com a câmera do celular e toque no link que aparecer: não precisa mandar o link para você mesmo.', 'Copie o link de compartilhamento, copie ou baixe o SVG, ou pegue um snippet na aba “Código”.']],
      ['Gerar', ['“Página atual” — o endereço da aba ativa; depois de ir para outra página, clique em atualizar.', `“Texto livre” — qualquer URL ou texto, até ${MAX_DATA.toLocaleString('pt-BR')} caracteres (um emoji conta como dois).`, 'Tamanho: 125, 200, 250 ou 300 px. ECC (correção de erros): L 7%, M 15%, Q 25%, H 30% — quanto mais alto, mais resistente, porém mais denso.', '“Copiar link” — um link para a imagem na API de QR code, com o texto dentro; não há link para textos com mais de 2.048 caracteres. “Copiar SVG” e “Baixar SVG” funcionam com qualquer código.']],
      ['Código', ['Snippets com o mesmo link: HTML <img>, HTML <object>, Markdown, React e Vue — “Copiar snippet”, ou “Copiar URL” para só o link.', 'Links copiados com versões anteriores à 1.1.0 não traziam o texto e não funcionam mais: copie-os de novo no “Histórico”.']],
      ['Histórico e ajustes', ['Um código vai para o “Histórico” quando você clica em “Copiar link” na aba “Gerar”: o texto, a hora, o tamanho e o ECC. “Limpar tudo” apaga o histórico.', 'Ajustes: tamanho e ECC padrão, “Gerar ao abrir”, “Limite do histórico” (25, 50 ou 100), o tema.', 'O histórico e os ajustes ficam no seu navegador (storage.local) e não são sincronizados.']],
      ['Privacidade e permissões', ['Desde a versão 1.1.0, a extensão não faz nenhuma requisição de rede: códigos e links são gerados no navegador. As versões anteriores enviavam o texto de cada código para a API antiga.', 'Um link de compartilhamento carrega o próprio texto: quem abrir o link ou escanear o código pode lê-lo.', 'Permissões: painel lateral (a janela dela; o Firefox tem uma barra lateral e não precisa dessa permissão), armazenamento (ajustes e histórico), abas (o endereço da página atual).']],
    ],
    more: 'A política completa: ',
    policy: 'privacidade das ferramentas de QR code',
    api: 'A API de QR code para a qual os links apontam:',
    also: [['Gerador de QR code na web', '/qr-code-generator']],
  },
  keywords: {
    generator: {
      primary: 'gerador de QR code SVG grátis',
      keywords: ['QR code online sem cadastro', 'gerador de código QR', 'criador de QR code vetorial', 'QR codes em SVG no navegador', 'QR code para abrir links no celular'],
      tags: ['QR codes', 'ferramentas'],
    },
    extension: {
      primary: 'extensão geradora de QR code',
      keywords: ['extensão de QR code para navegador', 'extensão do Chrome para QR codes', 'QR code no painel lateral', 'envio da página atual para o celular'],
      tags: ['QR codes', 'extensão de navegador'],
    },
  },
};
export default text;
