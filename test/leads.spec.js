/**
 * Testes do Worker da landing page.
 *
 * O que estes testes protegem: o formulário é a única coisa nesta página que
 * guarda dado de outra pessoa. Um lead perdido não volta, e uma lista de
 * e-mails exposta é incidente de LGPD. Os dois casos estão aqui.
 *
 * Rodam dentro do workerd — o mesmo runtime que a Cloudflare executa em
 * produção — com um D1 em memória. Não é mock do banco: é o D1 de verdade,
 * local.
 *
 * Rodar:  npm test
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../worker/index.js';

const TOKEN = 'token-de-teste-123';

async function chamar(caminho, opcoes = {}) {
  const req = new Request('https://axis.exemplo' + caminho, opcoes);
  const ctx = createExecutionContext();
  const resposta = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return resposta;
}

const cadastrar = (corpo, cabecalhos = {}) =>
  chamar('/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cabecalhos },
    body: JSON.stringify(corpo),
  });

// IPs diferentes por teste evitam que o freio de um caso derrube o seguinte.
let contadorIp = 0;
const ipNovo = () => ({ 'CF-Connecting-IP': `203.0.113.${++contadorIp % 250}` });

beforeEach(async () => {
  await env.DB.exec(
    'CREATE TABLE IF NOT EXISTS leads (email TEXT PRIMARY KEY, perfil TEXT, origem TEXT, criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL, envios INTEGER NOT NULL DEFAULT 1)'
  );
  await env.DB.exec(
    'CREATE TABLE IF NOT EXISTS freio (ip_hash TEXT PRIMARY KEY, janela_inicio TEXT NOT NULL, contagem INTEGER NOT NULL DEFAULT 0)'
  );
  await env.DB.exec('DELETE FROM leads');
  await env.DB.exec('DELETE FROM freio');
});

describe('1. O caminho feliz', () => {
  it('cadastra e-mail válido', async () => {
    const r = await cadastrar({ email: 'maria@escritorio.com.br', perfil: 'profissional' }, ipNovo());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, novo: true });
  });

  it('normaliza o e-mail para minúsculas e sem espaços', async () => {
    await cadastrar({ email: '  Maria@Escritorio.COM.BR  ' }, ipNovo());
    const { leads } = await (await chamar('/api/leads?token=' + TOKEN)).json();
    expect(leads[0].email).toBe('maria@escritorio.com.br');
  });
});

describe('2. Validação — o que não entra na lista', () => {
  it.each(['', 'semarroba', 'sem@ponto', 'a@b.c', '   '])('recusa %j', async (email) => {
    const r = await cadastrar({ email }, ipNovo());
    expect(r.status).toBe(422);
  });

  it('corpo que não é JSON não derruba o Worker', async () => {
    const r = await chamar('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ipNovo() },
      body: 'isto nao e json',
    });
    expect(r.status).toBe(400);
  });

  it('perfil desconhecido vira "outro"', async () => {
    await cadastrar({ email: 'x@y.com.br', perfil: '<script>' }, ipNovo());
    const { leads } = await (await chamar('/api/leads?token=' + TOKEN)).json();
    expect(leads[0].perfil).toBe('outro');
  });
});

describe('3. Reenvio — a fila offline da página reenvia sozinha', () => {
  it('mesmo e-mail não duplica', async () => {
    const ip = ipNovo();
    await cadastrar({ email: 'ana@obra.com.br', perfil: 'publico' }, ip);
    const r = await cadastrar({ email: 'ana@obra.com.br', perfil: 'publico' }, ip);
    expect((await r.json()).novo).toBe(false);
    expect((await (await chamar('/api/saude')).json()).leads).toBe(1);
  });

  it('reenvio atualiza o perfil e conta os envios', async () => {
    const ip = ipNovo();
    await cadastrar({ email: 'ana@obra.com.br', perfil: 'outro' }, ip);
    await cadastrar({ email: 'ana@obra.com.br', perfil: 'publico' }, ip);
    const { leads } = await (await chamar('/api/leads?token=' + TOKEN)).json();
    expect(leads[0].perfil).toBe('publico');
    expect(leads[0].envios).toBe(2);
  });
});

describe('4. A lista de e-mails não pode vazar', () => {
  it('listagem sem token é proibida', async () => {
    expect((await chamar('/api/leads')).status).toBe(403);
  });

  it('listagem com token errado é proibida', async () => {
    expect((await chamar('/api/leads?token=chute')).status).toBe(403);
  });

  it('token do tamanho certo mas com caractere errado é proibido', async () => {
    const quase = TOKEN.slice(0, -1) + 'X';
    expect((await chamar('/api/leads?token=' + quase)).status).toBe(403);
  });

  it('CSV exige token', async () => {
    expect((await chamar('/api/leads/exportar.csv')).status).toBe(403);
  });

  it('CSV traz os leads e vem como anexo', async () => {
    await cadastrar({ email: 'ana@obra.com.br', perfil: 'publico' }, ipNovo());
    const r = await chamar('/api/leads/exportar.csv?token=' + TOKEN);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('ana@obra.com.br');
    expect(r.headers.get('content-disposition')).toContain('attachment');
  });
});

describe('5. Direito de exclusão (LGPD) — a página promete isso ao visitante', () => {
  it('remove o lead', async () => {
    await cadastrar({ email: 'ana@obra.com.br' }, ipNovo());
    const r = await chamar('/api/leads/ana@obra.com.br?token=' + TOKEN, { method: 'DELETE' });
    expect(r.status).toBe(200);
    expect((await (await chamar('/api/saude')).json()).leads).toBe(0);
  });

  it('remover exige token', async () => {
    await cadastrar({ email: 'ana@obra.com.br' }, ipNovo());
    const r = await chamar('/api/leads/ana@obra.com.br', { method: 'DELETE' });
    expect(r.status).toBe(403);
  });

  it('remover quem não existe devolve 404', async () => {
    const r = await chamar('/api/leads/ninguem@lugar.com.br?token=' + TOKEN, { method: 'DELETE' });
    expect(r.status).toBe(404);
  });
});

describe('6. Freio contra robô', () => {
  it('barra muitos cadastros do mesmo IP', async () => {
    const ip = ipNovo();
    for (let i = 0; i < 12; i++) {
      const r = await cadastrar({ email: `pessoa${i}@exemplo.com.br` }, ip);
      expect(r.status).toBe(200);
    }
    const r = await cadastrar({ email: 'gota@dagua.com.br' }, ip);
    expect(r.status).toBe(429);
  });

  it('IP diferente não é afetado pelo freio do vizinho', async () => {
    const ip = ipNovo();
    for (let i = 0; i < 12; i++) await cadastrar({ email: `a${i}@exemplo.com.br` }, ip);
    const r = await cadastrar({ email: 'outro@exemplo.com.br' }, ipNovo());
    expect(r.status).toBe(200);
  });
});

describe('7. Rotas', () => {
  it('rota de API desconhecida devolve 404 em JSON, não a página', async () => {
    const r = await chamar('/api/inventada');
    expect(r.status).toBe(404);
    expect(r.headers.get('content-type')).toContain('json');
  });

  it('responde ao preflight de CORS', async () => {
    const r = await chamar('/api/leads', { method: 'OPTIONS' });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-methods')).toContain('POST');
  });
});
