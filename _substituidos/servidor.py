"""
Servidor da landing page do AXIS.

Serve `index.html` e grava os e-mails do formulário de acesso antecipado.

POR QUE ISTO É UM SERVIÇO SEPARADO DO AXIS
------------------------------------------
A landing page é material de marketing: muda de endereço, vai para o ar antes
do produto, pode ser publicada num host estático e pode cair sem que ninguém
em campo seja afetado. O app de auditoria não pode nada disso. Misturar os
dois faria a página de promoção compartilhar o banco, o deploy e o risco de
uma ferramenta que alguém usa em cima de uma rampa.

Mesma stack do AXIS de propósito (FastAPI + SQLite, SQL cru, sem ORM): quem
souber mexer em um sabe mexer no outro.

Rodar:
    pip install -r requirements.txt
    uvicorn servidor:app --reload --port 8080
    # abra http://localhost:8080

Ver quem se cadastrou (exige o token, veja LISTAGEM abaixo):
    AXIS_ADMIN_TOKEN=umsegredolongo uvicorn servidor:app --port 8080
    curl "http://localhost:8080/api/leads/exportar.csv?token=umsegredolongo"
"""

import csv
import io
import os
import re
import sqlite3
import sys
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response

BASE = Path(__file__).resolve().parent
PAGINA = BASE / "index.html"
LAUDO_EXEMPLO = BASE / "laudo-exemplo.html"

# Onde gravar. Configurável porque em alguns hosts a pasta da aplicação é
# somente-leitura. Se o caminho pedido não aceitar escrita, cai para ./dados
# com aviso no log — perder o cadastro de quem acabou de digitar o e-mail é
# pior do que perder a persistência entre reinícios.
RESERVA = BASE / "dados"


def _preparar(pasta: Path) -> Path:
    pasta.mkdir(parents=True, exist_ok=True)
    sonda = pasta / ".escrita"
    sonda.write_text("ok", encoding="utf-8")
    sonda.unlink()
    return pasta


def _resolver_dados() -> Path:
    pedida = Path(os.getenv("AXIS_PAGE_DADOS") or RESERVA)
    try:
        return _preparar(pedida)
    except OSError as e:
        if pedida == RESERVA:
            raise
        print(f"AVISO: AXIS_PAGE_DADOS={pedida} não é gravável ({e}). "
              f"Usando {RESERVA} — os leads NÃO sobrevivem a um reinício. "
              f"Exporte o CSV com frequência.", file=sys.stderr, flush=True)
        return _preparar(RESERVA)


DADOS = _resolver_dados()
BANCO = DADOS / "leads.db"

# Aceita o que um servidor de e-mail aceitaria, sem tentar validar o que só a
# entrega comprova. Regex de e-mail "completa" reprova endereço válido — e um
# lead perdido por excesso de rigor não volta.
PADRAO_EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")

PERFIS = ("profissional", "escritorio", "publico", "instituicao", "outro")


# ---------------------------------------------------------------------------
# Persistência — todo o SQL vive aqui, como no AXIS
# ---------------------------------------------------------------------------

def _url_postgres() -> str | None:
    """Normaliza o esquema legado `postgres://`, que vários hosts ainda usam."""
    url = (os.getenv("DATABASE_URL") or "").strip()
    if not url:
        return None
    if url.lower().startswith("postgres://"):
        return "postgresql://" + url[len("postgres://"):]
    return url


class Banco:
    """Leads gravados em SQLite ou Postgres, com a mesma interface."""

    def __init__(self, motor: str, caminho: Path | None = None, url: str | None = None):
        self.motor = motor
        self.caminho = caminho
        self.url = url
        self._ph = "%s" if motor == "postgres" else "?"

    @contextmanager
    def _conexao(self):
        if self.motor == "postgres":
            import psycopg
            con = psycopg.connect(self.url)
        else:
            con = sqlite3.connect(self.caminho)
        try:
            yield con
            con.commit()
        finally:
            con.close()

    def iniciar(self):
        with self._conexao() as con:
            con.execute("""CREATE TABLE IF NOT EXISTS leads (
                email TEXT PRIMARY KEY,
                perfil TEXT,
                origem TEXT,
                criado_em TEXT NOT NULL,
                atualizado_em TEXT NOT NULL,
                envios INTEGER NOT NULL DEFAULT 1
            )""")
        return self

    def salvar(self, email: str, perfil: str, origem: str) -> bool:
        """Grava o lead. Devolve True se for e-mail novo.

        O mesmo e-mail reenviado não vira linha duplicada nem erro: atualiza o
        perfil (a pessoa pode ter escolhido errado da primeira vez) e conta o
        reenvio. A fila offline da página reenvia sozinha na visita seguinte —
        sem isto, quem ficasse sem rede geraria duplicata garantida.
        """
        agora = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with self._conexao() as con:
            novo = con.execute(
                f"SELECT 1 FROM leads WHERE email={self._ph}", (email,)).fetchone() is None
            con.execute(
                f"INSERT INTO leads (email,perfil,origem,criado_em,atualizado_em,envios) "
                f"VALUES ({self._ph},{self._ph},{self._ph},{self._ph},{self._ph},1) "
                f"ON CONFLICT (email) DO UPDATE SET "
                f"perfil=EXCLUDED.perfil, atualizado_em=EXCLUDED.atualizado_em, "
                f"envios=leads.envios+1",
                (email, perfil, origem, agora, agora))
        return novo

    def listar(self) -> list[dict]:
        colunas = ("email", "perfil", "origem", "criado_em", "atualizado_em", "envios")
        with self._conexao() as con:
            linhas = con.execute(
                f"SELECT {','.join(colunas)} FROM leads ORDER BY criado_em DESC").fetchall()
        return [dict(zip(colunas, linha)) for linha in linhas]

    def contar(self) -> int:
        with self._conexao() as con:
            return con.execute("SELECT COUNT(*) FROM leads").fetchone()[0]

    def apagar(self, email: str) -> bool:
        """Direito de exclusão (LGPD). A página promete isso ao visitante."""
        with self._conexao() as con:
            cur = con.execute(f"DELETE FROM leads WHERE email={self._ph}", (email,))
            return cur.rowcount > 0


def abrir() -> Banco:
    url = _url_postgres()
    if url:
        try:
            return Banco("postgres", url=url).iniciar()
        except Exception as e:  # noqa: BLE001 — driver ausente, rede, senha…
            print(f"AVISO: DATABASE_URL definida, mas o Postgres não respondeu "
                  f"({type(e).__name__}: {e}). Usando SQLite em {BANCO}.",
                  file=sys.stderr, flush=True)
    return Banco("sqlite", caminho=BANCO).iniciar()


# ---------------------------------------------------------------------------
# Aplicação
# ---------------------------------------------------------------------------

app = FastAPI(title="AXIS — landing page", version="1.0.0", docs_url=None, redoc_url=None)
BD = abrir()

# A página pode ser publicada num host estático (GitHub Pages, Netlify) e
# apontar para este servidor em outro domínio. Sem CORS, o navegador bloqueia
# o POST. Só o cadastro é aberto: a listagem exige token e ignora o CORS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Content-Type"],
    allow_credentials=False,
)

# Freio simples por IP, em memória. Não é proteção séria contra ataque
# distribuído — é o que impede um script bobo de encher a tabela em um minuto.
# Em memória de propósito: o custo de um Redis não se paga numa lista de espera.
_JANELA = 3600      # segundos
_TETO = 12          # cadastros por IP por janela
_visitas: dict[str, list[float]] = {}


def _excedeu(ip: str) -> bool:
    agora = time.time()
    fila = [t for t in _visitas.get(ip, []) if agora - t < _JANELA]
    _visitas[ip] = fila
    if len(fila) >= _TETO:
        return True
    fila.append(agora)
    return False


def _autorizado(token: str | None) -> bool:
    """Listagem só com token. Sem AXIS_ADMIN_TOKEN definido, ninguém entra.

    Deixar a lista de e-mails aberta por padrão seria vazamento de dado
    pessoal por esquecimento — o padrão precisa ser o seguro.
    """
    esperado = (os.getenv("AXIS_ADMIN_TOKEN") or "").strip()
    return bool(esperado) and token == esperado


@app.get("/api/saude")
def saude():
    return {"status": "ok", "banco": BD.motor, "leads": BD.contar()}


@app.post("/api/leads")
async def cadastrar(request: Request):
    """Recebe o e-mail do formulário de acesso antecipado."""
    try:
        corpo = await request.json()
    except Exception:  # noqa: BLE001 — corpo vazio ou não-JSON
        return JSONResponse({"erro": "corpo inválido"}, status_code=400)

    email = str(corpo.get("email") or "").strip().lower()
    if not PADRAO_EMAIL.match(email) or len(email) > 254:
        return JSONResponse({"erro": "e-mail inválido"}, status_code=422)

    perfil = str(corpo.get("perfil") or "outro").strip().lower()
    if perfil not in PERFIS:
        perfil = "outro"

    origem = str(corpo.get("origem") or "landing-page").strip()[:60]

    ip = (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
          or (request.client.host if request.client else "desconhecido"))
    if _excedeu(ip):
        return JSONResponse({"erro": "muitos cadastros deste endereço, tente mais tarde"},
                            status_code=429)

    novo = BD.salvar(email, perfil, origem)
    return {"ok": True, "novo": novo}


@app.get("/api/leads")
def listar(token: str | None = None):
    if not _autorizado(token):
        return JSONResponse({"erro": "não autorizado"}, status_code=403)
    return {"total": BD.contar(), "banco": BD.motor, "leads": BD.listar()}


@app.get("/api/leads/exportar.csv")
def exportar(token: str | None = None):
    """Lista em CSV, pronta para abrir no Excel ou importar num disparador."""
    if not _autorizado(token):
        return JSONResponse({"erro": "não autorizado"}, status_code=403)

    buffer = io.StringIO()
    escritor = csv.writer(buffer, delimiter=";")
    escritor.writerow(["email", "perfil", "origem", "criado_em", "atualizado_em", "envios"])
    for lead in BD.listar():
        escritor.writerow([lead["email"], lead["perfil"], lead["origem"],
                           lead["criado_em"], lead["atualizado_em"], lead["envios"]])

    nome = "axis_leads_" + datetime.now().strftime("%Y%m%d_%H%M") + ".csv"
    # BOM para o Excel em português abrir acentuação sem perguntar nada.
    return Response(content="﻿" + buffer.getvalue(),
                    media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{nome}"'})


@app.delete("/api/leads/{email}")
def remover(email: str, token: str | None = None):
    if not _autorizado(token):
        return JSONResponse({"erro": "não autorizado"}, status_code=403)
    if not BD.apagar(email.strip().lower()):
        return JSONResponse({"erro": "não encontrado"}, status_code=404)
    return {"ok": True}


@app.get("/laudo-exemplo.html")
def laudo_exemplo():
    """Laudo de demonstração, com dados fictícios.

    Rota explícita em vez de montar a pasta inteira como estática: nesta pasta
    também moram o código do servidor e o banco de leads, e um `StaticFiles`
    na raiz publicaria os dois por descuido.
    """
    if not LAUDO_EXEMPLO.exists():
        return JSONResponse({"erro": "laudo-exemplo.html não encontrado"}, status_code=404)
    return FileResponse(LAUDO_EXEMPLO, media_type="text/html")


@app.get("/")
def pagina():
    if not PAGINA.exists():
        return JSONResponse({"erro": "index.html não encontrado"}, status_code=500)
    return FileResponse(PAGINA, media_type="text/html")
