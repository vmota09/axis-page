-- Banco de leads da landing page do AXIS (Cloudflare D1).
--
-- Aplicar:
--   npx wrangler d1 execute axis-leads --remote --file=./schema.sql
--
-- Rodar de novo é seguro: tudo é IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS leads (
  email         TEXT PRIMARY KEY,
  perfil        TEXT,
  origem        TEXT,
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  envios        INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_leads_criado_em ON leads (criado_em DESC);

-- Freio contra robô. Guarda um hash do IP, nunca o IP: ele só serve para
-- contar cadastros na última hora, e endereço de rede é dado pessoal.
CREATE TABLE IF NOT EXISTS freio (
  ip_hash       TEXT PRIMARY KEY,
  janela_inicio TEXT NOT NULL,
  contagem      INTEGER NOT NULL DEFAULT 0
);
