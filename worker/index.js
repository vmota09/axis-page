/**
 * AXIS — landing page publicada na Cloudflare.
 *
 * Um Worker só faz as duas coisas que a página precisa:
 *   1. servir os arquivos estáticos (index.html e laudo-exemplo.html);
 *   2. receber os e-mails do formulário de acesso antecipado e gravá-los no D1.
 *
 * POR QUE O WORKER, E NÃO UM SERVIDOR PYTHON
 * ------------------------------------------
 * Hospedagem gratuita de processo Python dorme por inatividade — no Render são
 * 15 minutos, com 30 a 60 segundos de espera para quem clicar depois disso.
 * Numa página que existe para ser mandada por link a avaliador de edital, essa
 * espera é a diferença entre ser lida e ser fechada. O Worker não dorme: não há
 * processo para acordar.
 *
 * O arquivo estático nem chega aqui — a Cloudflare devolve direto do CDN, sem
 * contar cota. Este código só roda nas rotas /api/.
 *
 * Rodar local:  npx wrangler dev
 * Publicar:     npx wrangler deploy
 */

const PADRAO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PERFIS = new Set(['profissional', 'escritorio', 'publico', 'instituicao', 'outro']);

// Freio contra robô: no máximo 12 cadastros por IP por hora.
const JANELA_MS = 60 * 60 * 1000;
const TETO = 12;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

/**
 * Compara o token sem vazar quanto dele estava certo.
 *
 * Um `===` normal sai no primeiro caractere diferente, e a diferença de tempo
 * entre "errou no primeiro" e "errou no último" é medível pela rede. Aqui a
 * lista de e-mails é o que está atrás da porta.
 */
function autorizado(url, env) {
  const esperado = (env.AXIS_ADMIN_TOKEN || '').trim();
  const recebido = url.searchParams.get('token') || '';
  // Sem token configurado, ninguém entra — inclusive quem esqueceu de
  // configurar. Deixar a lista aberta por descuido é vazamento de dado pessoal.
  if (!esperado) return false;
  if (esperado.length !== recebido.length) return false;
  let diferenca = 0;
  for (let i = 0; i < esperado.length; i++) {
    diferenca |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  }
  return diferenca === 0;
}

/**
 * Identificador do visitante para o freio, sem guardar o IP.
 *
 * IP é dado pessoal sob a LGPD, e ele não serve para nada além de contar
 * cadastros na última hora. O hash resolve a contagem e não permite voltar ao
 * endereço original.
 */
async function digitalDoVisitante(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const bytes = new TextEncoder().encode(ip + '|' + (env.AXIS_SAL || 'axis-freio'));
  const resumo = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(resumo)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

async function excedeuOFreio(request, env) {
  const chave = await digitalDoVisitante(request, env);
  const agora = Date.now();

  const linha = await env.DB.prepare(
    'SELECT janela_inicio, contagem FROM freio WHERE ip_hash = ?'
  ).bind(chave).first();

  if (linha && agora - Number(linha.janela_inicio) < JANELA_MS) {
    if (linha.contagem >= TETO) return true;
    await env.DB.prepare(
      'UPDATE freio SET contagem = contagem + 1 WHERE ip_hash = ?'
    ).bind(chave).run();
    return false;
  }

  // Janela nova (ou primeira vez): zera a contagem.
  await env.DB.prepare(
    'INSERT INTO freio (ip_hash, janela_inicio, contagem) VALUES (?, ?, 1) ' +
    'ON CONFLICT (ip_hash) DO UPDATE SET janela_inicio = excluded.janela_inicio, contagem = 1'
  ).bind(chave, String(agora)).run();
  return false;
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

async function saude(env) {
  const linha = await env.DB.prepare('SELECT COUNT(*) AS total FROM leads').first();
  return json({ status: 'ok', banco: 'd1', leads: linha ? linha.total : 0 });
}

async function cadastrar(request, env) {
  let corpo;
  try {
    corpo = await request.json();
  } catch {
    return json({ erro: 'corpo inválido' }, 400);
  }

  const email = String(corpo.email || '').trim().toLowerCase();
  if (!PADRAO_EMAIL.test(email) || email.length > 254) {
    return json({ erro: 'e-mail inválido' }, 422);
  }

  // O perfil vem do formulário, mas o POST é público: qualquer um manda o que
  // quiser. Texto livre aqui sujaria a segmentação da lista.
  let perfil = String(corpo.perfil || 'outro').trim().toLowerCase();
  if (!PERFIS.has(perfil)) perfil = 'outro';

  const origem = String(corpo.origem || 'landing-page').trim().slice(0, 60);

  if (await excedeuOFreio(request, env)) {
    return json({ erro: 'muitos cadastros deste endereço, tente mais tarde' }, 429);
  }

  const agora = new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
  const existente = await env.DB.prepare('SELECT 1 FROM leads WHERE email = ?')
    .bind(email).first();

  // Reenviar o mesmo e-mail não vira linha duplicada nem erro: atualiza o
  // perfil (a pessoa pode ter marcado errado) e conta o reenvio. A página tem
  // fila offline e reenvia sozinha na visita seguinte — sem isto, quem ficasse
  // sem rede geraria duplicata garantida.
  await env.DB.prepare(
    'INSERT INTO leads (email, perfil, origem, criado_em, atualizado_em, envios) ' +
    'VALUES (?, ?, ?, ?, ?, 1) ' +
    'ON CONFLICT (email) DO UPDATE SET ' +
    'perfil = excluded.perfil, atualizado_em = excluded.atualizado_em, ' +
    'envios = leads.envios + 1'
  ).bind(email, perfil, origem, agora, agora).run();

  return json({ ok: true, novo: !existente });
}

async function listarLeads(env) {
  const { results } = await env.DB.prepare(
    'SELECT email, perfil, origem, criado_em, atualizado_em, envios ' +
    'FROM leads ORDER BY criado_em DESC'
  ).all();
  return results || [];
}

async function listar(url, env) {
  if (!autorizado(url, env)) return json({ erro: 'não autorizado' }, 403);
  const leads = await listarLeads(env);
  return json({ total: leads.length, banco: 'd1', leads });
}

function celulaCsv(valor) {
  const texto = String(valor === null || valor === undefined ? '' : valor);
  return /[";\n]/.test(texto) ? '"' + texto.replace(/"/g, '""') + '"' : texto;
}

async function exportar(url, env) {
  if (!autorizado(url, env)) return json({ erro: 'não autorizado' }, 403);

  const leads = await listarLeads(env);
  const linhas = [['email', 'perfil', 'origem', 'criado_em', 'atualizado_em', 'envios']];
  for (const l of leads) {
    linhas.push([l.email, l.perfil, l.origem, l.criado_em, l.atualizado_em, l.envios]);
  }
  const csv = linhas.map((linha) => linha.map(celulaCsv).join(';')).join('\n');

  const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  // O BOM faz o Excel em português abrir a acentuação certa sem perguntar nada.
  return new Response('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="axis_leads_${carimbo}.csv"`,
      ...CORS,
    },
  });
}

async function remover(rota, url, env) {
  if (!autorizado(url, env)) return json({ erro: 'não autorizado' }, 403);
  const email = decodeURIComponent(rota.slice('/api/leads/'.length)).trim().toLowerCase();
  const r = await env.DB.prepare('DELETE FROM leads WHERE email = ?').bind(email).run();
  const apagou = r.meta && r.meta.changes > 0;
  return apagou ? json({ ok: true }) : json({ erro: 'não encontrado' }, 404);
}

// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const rota = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (rota === '/api/saude') return saude(env);
    if (rota === '/api/leads' && request.method === 'POST') return cadastrar(request, env);
    if (rota === '/api/leads' && request.method === 'GET') return listar(url, env);
    if (rota === '/api/leads/exportar.csv') return exportar(url, env);
    if (rota.startsWith('/api/leads/') && request.method === 'DELETE') {
      return remover(rota, url, env);
    }
    if (rota.startsWith('/api/')) return json({ erro: 'rota não encontrada' }, 404);

    // Na prática a Cloudflare já devolveu o arquivo estático antes de chegar
    // aqui. Este retorno cobre o caso de o Worker ser invocado mesmo assim.
    return env.ASSETS.fetch(request);
  },
};
