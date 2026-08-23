/**
 * Gera `docs/` a partir de `public/`.
 *
 * A diferença entre as duas pastas é uma linha: `docs/` liga o modo prévia,
 * que faz o formulário abrir o e-mail preenchido em vez de tentar gravar num
 * servidor que não existe ali. O nome `docs` não é escolha de estilo: é uma
 * das duas pastas que o GitHub Pages aceita publicar (a outra é a raiz).
 *
 * Rodar: npm run site
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const de = join(raiz, 'public');
const para = join(raiz, 'docs');
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

console.log('docs/ gerado a partir de public/ — commit e push publicam no GitHub Pages');
