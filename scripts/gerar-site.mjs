/**
 * Gera `site/` a partir de `public/`.
 *
 * A diferença entre as duas pastas é uma linha: `site/` liga o modo prévia,
 * que faz o formulário abrir o e-mail preenchido em vez de tentar gravar num
 * servidor que não existe ali. Use `site/` em host estático (Cloudflare Drop,
 * Netlify Drop) e `public/` no deploy com Worker.
 *
 * Rodar: npm run site
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const de = join(raiz, 'public');
const para = join(raiz, 'site');
mkdirSync(para, { recursive: true });

const bandeira =
  '<!-- Versão estática: sem servidor atrás. O formulário abre o e-mail\n' +
  '     preenchido em vez de tentar gravar. Ao publicar o Worker, use a\n' +
  '     pasta public/ no lugar desta. -->\n' +
  '<script>window.AXIS_MODO_PREVIA = true;</script>\n</head>';

const html = readFileSync(join(de, 'index.html'), 'utf-8');
if (!html.includes('</head>')) throw new Error('index.html sem </head> — nada foi gerado');
writeFileSync(join(para, 'index.html'), html.replace('</head>', bandeira, 1));
copyFileSync(join(de, 'laudo-exemplo.html'), join(para, 'laudo-exemplo.html'));

console.log('site/ gerado a partir de public/');
