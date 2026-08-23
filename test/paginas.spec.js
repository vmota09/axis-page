/**
 * Guardas sobre o conteúdo das duas páginas.
 *
 * Rodam no Node comum, não no workerd: aqui o que se testa é o HTML como
 * arquivo, e o runtime da Cloudflare não tem acesso ao disco.
 *
 * O que estes testes protegem: o erro clássico de mexer no visual e desligar
 * em silêncio algo que não quebra visualmente — o formulário, o aviso de
 * demonstração do laudo, o e-mail de contato do plano B.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (arquivo) => readFileSync(join(raiz, 'public', arquivo), 'utf-8');

const indexHtml = ler('index.html');
const laudoHtml = ler('laudo-exemplo.html');

describe('A página principal', () => {
  it('mantém o formulário ligado na rota de cadastro', () => {
    expect(indexHtml).toContain('id="formLead"');
    expect(indexHtml).toContain('/api/leads');
  });

  it('usa um e-mail de contato real no plano B, não o marcador', () => {
    expect(indexHtml).toContain('axis13042026@gmail.com');
    expect(indexHtml).not.toContain('contato@axis.tech');
  });

  it('mantém o campo-armadilha contra robô', () => {
    expect(indexHtml).toContain('id="leadEmpresa"');
  });

  it('não deixa o modo prévia ligado por engano na versão publicada', () => {
    // O modo prévia desliga o POST. Ligado sem querer no deploy real, o
    // formulário para de gravar e ninguém percebe — a página continua igual.
    expect(indexHtml).not.toContain('AXIS_MODO_PREVIA = true');
  });

  it('leva o visitante ao laudo de demonstração', () => {
    expect(indexHtml).toContain('laudo-exemplo.html');
  });
});

describe('O laudo de demonstração', () => {
  it('continua marcado como demonstração, com todas as letras', () => {
    // Sem esta faixa, um exemplo circulando por e-mail vira exatamente o
    // problema que o AXIS existe para combater: um documento afirmando
    // conformidade que ninguém apurou.
    expect(laudoHtml).toContain('LAUDO DE DEMONSTRAÇÃO');
    expect(laudoHtml).toContain('valores desta página são fictícios');
  });

  it('diz no título da aba que os dados são fictícios', () => {
    expect(laudoHtml).toMatch(/<title>[^<]*fictícios[^<]*<\/title>/);
  });

  it('mantém a ressalva de que não substitui laudo assinado', () => {
    expect(laudoHtml).toContain('profissional habilitado');
  });
});
