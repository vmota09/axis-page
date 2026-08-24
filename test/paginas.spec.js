/**
 * Guardas sobre o conteúdo das duas páginas publicadas em `docs/`.
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
const ler = (arquivo) => readFileSync(join(raiz, 'docs', arquivo), 'utf-8');

const indexHtml = ler('index.html');
const laudoHtml = ler('laudo-exemplo.html');

describe('A página principal', () => {
  it('tem o formulário de cadastro apontando para o iframe oculto', () => {
    // O `target` é o que evita o CORS do Apps Script. Trocar por um fetch()
    // faz o envio voltar a ser bloqueado pelo navegador — sem erro visível.
    expect(indexHtml).toContain('id="formLead"');
    expect(indexHtml).toContain('target="axis_vala"');
    expect(indexHtml).toContain('name="axis_vala"');
  });

  it('mantém o campo-armadilha contra robô', () => {
    expect(indexHtml).toContain('id="leadEmpresa"');
  });

  it('manda os três campos que a planilha espera', () => {
    for (const campo of ['name="email"', 'name="perfil"', 'name="origem"']) {
      expect(indexHtml).toContain(campo);
    }
  });

  it('não promete gravação quando o endereço da planilha está vazio', () => {
    // Sem destino configurado, o formulário precisa cair no e-mail — nunca
    // dizer "recebido" sem ter enviado para lugar nenhum.
    expect(indexHtml).toContain('if (!URL_PLANILHA)');
    expect(indexHtml).toContain('mailto:');
  });

  it('está apontando para um Apps Script publicado', () => {
    // Um /dev no lugar de /exec é o erro clássico: funciona para quem está
    // logado como dona do script e falha calado para todo mundo.
    expect(indexHtml).toMatch(/URL_PLANILHA = 'https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec'/);
  });

  it('o endereço de contato é real', () => {
    expect(indexHtml).toContain('axis13042026@gmail.com');
    expect(indexHtml).not.toContain('contato@axis.tech');
  });

  it('todo botão de conversão leva à seção de cadastro', () => {
    expect(indexHtml).not.toContain('#acesso"');
    expect(indexHtml).toContain('id="contato"');
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
