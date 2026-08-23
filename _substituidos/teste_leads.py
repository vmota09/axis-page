"""
Testes do cadastro de e-mails da landing page.

O que estes testes protegem: o formulário é a única coisa nesta página que
guarda dado de outra pessoa. Um lead perdido não volta, e uma lista de
e-mails exposta é incidente de LGPD. Os dois casos estão cobertos aqui.

Rodar:  pytest -q
"""

import importlib
import os

import pytest
from fastapi.testclient import TestClient

TOKEN = "token-de-teste-123"


@pytest.fixture
def cliente(tmp_path, monkeypatch):
    """Sobe o servidor com banco novo a cada teste.

    O módulo abre o banco na importação (é um serviço de um arquivo só), então
    recarregar é o jeito honesto de isolar — mais simples que injetar o banco.
    """
    monkeypatch.setenv("AXIS_PAGE_DADOS", str(tmp_path))
    monkeypatch.setenv("AXIS_ADMIN_TOKEN", TOKEN)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    import servidor
    importlib.reload(servidor)
    return TestClient(servidor.app)


# ---------------------------------------------------------------------------
# 1. O caminho feliz
# ---------------------------------------------------------------------------

def test_cadastra_email_valido(cliente):
    r = cliente.post("/api/leads", json={"email": "maria@escritorio.com.br",
                                         "perfil": "profissional"})
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.json()["novo"] is True


def test_email_normalizado_para_minusculas(cliente):
    cliente.post("/api/leads", json={"email": "  Maria@Escritorio.COM.BR  "})
    leads = cliente.get("/api/leads", params={"token": TOKEN}).json()["leads"]
    assert leads[0]["email"] == "maria@escritorio.com.br"


# ---------------------------------------------------------------------------
# 2. Validação — o que não pode entrar na lista
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("email", ["", "semarroba", "sem@ponto", "a@b.c", "  "])
def test_email_invalido_recusado(cliente, email):
    r = cliente.post("/api/leads", json={"email": email})
    assert r.status_code == 422


def test_corpo_nao_json_nao_derruba_o_servidor(cliente):
    r = cliente.post("/api/leads", content=b"isto nao e json",
                     headers={"Content-Type": "application/json"})
    assert r.status_code == 400


def test_perfil_desconhecido_vira_outro(cliente):
    """Perfil vem do formulário, mas o POST é público: qualquer um manda o que
    quiser. Guardar texto livre aqui sujaria a segmentação da lista."""
    cliente.post("/api/leads", json={"email": "x@y.com.br", "perfil": "<script>"})
    leads = cliente.get("/api/leads", params={"token": TOKEN}).json()["leads"]
    assert leads[0]["perfil"] == "outro"


# ---------------------------------------------------------------------------
# 3. Reenvio — a fila offline da página reenvia sozinha
# ---------------------------------------------------------------------------

def test_mesmo_email_nao_duplica(cliente):
    cliente.post("/api/leads", json={"email": "ana@obra.com.br", "perfil": "publico"})
    r = cliente.post("/api/leads", json={"email": "ana@obra.com.br", "perfil": "publico"})
    assert r.json()["novo"] is False
    assert cliente.get("/api/saude").json()["leads"] == 1


def test_reenvio_atualiza_perfil_e_conta_envios(cliente):
    cliente.post("/api/leads", json={"email": "ana@obra.com.br", "perfil": "outro"})
    cliente.post("/api/leads", json={"email": "ana@obra.com.br", "perfil": "publico"})
    lead = cliente.get("/api/leads", params={"token": TOKEN}).json()["leads"][0]
    assert lead["perfil"] == "publico"
    assert lead["envios"] == 2


# ---------------------------------------------------------------------------
# 4. A lista de e-mails não pode vazar
# ---------------------------------------------------------------------------

def test_listagem_sem_token_e_proibida(cliente):
    assert cliente.get("/api/leads").status_code == 403


def test_listagem_com_token_errado_e_proibida(cliente):
    assert cliente.get("/api/leads", params={"token": "chute"}).status_code == 403


def test_sem_variavel_de_ambiente_ninguem_lista(tmp_path, monkeypatch):
    """Padrão seguro: esquecer de definir o token tranca a porta, não abre."""
    monkeypatch.setenv("AXIS_PAGE_DADOS", str(tmp_path))
    monkeypatch.delenv("AXIS_ADMIN_TOKEN", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    import servidor
    importlib.reload(servidor)
    c = TestClient(servidor.app)
    assert c.get("/api/leads").status_code == 403
    assert c.get("/api/leads", params={"token": ""}).status_code == 403


def test_csv_exige_token(cliente):
    assert cliente.get("/api/leads/exportar.csv").status_code == 403


def test_csv_traz_os_leads(cliente):
    cliente.post("/api/leads", json={"email": "ana@obra.com.br", "perfil": "publico"})
    r = cliente.get("/api/leads/exportar.csv", params={"token": TOKEN})
    assert r.status_code == 200
    assert "ana@obra.com.br" in r.text
    assert "attachment" in r.headers["content-disposition"]


# ---------------------------------------------------------------------------
# 5. Direito de exclusão (LGPD) — a página promete isso ao visitante
# ---------------------------------------------------------------------------

def test_remover_lead(cliente):
    cliente.post("/api/leads", json={"email": "ana@obra.com.br"})
    assert cliente.request("DELETE", "/api/leads/ana@obra.com.br",
                           params={"token": TOKEN}).status_code == 200
    assert cliente.get("/api/saude").json()["leads"] == 0


def test_remover_exige_token(cliente):
    cliente.post("/api/leads", json={"email": "ana@obra.com.br"})
    assert cliente.request("DELETE", "/api/leads/ana@obra.com.br").status_code == 403


# ---------------------------------------------------------------------------
# 6. Freio contra robô
# ---------------------------------------------------------------------------

def test_muitos_cadastros_do_mesmo_ip_sao_barrados(cliente):
    import servidor
    servidor._visitas.clear()
    for i in range(servidor._TETO):
        assert cliente.post("/api/leads",
                            json={"email": f"pessoa{i}@exemplo.com.br"}).status_code == 200
    r = cliente.post("/api/leads", json={"email": "gota@dagua.com.br"})
    assert r.status_code == 429


# ---------------------------------------------------------------------------
# 7. A página em si
# ---------------------------------------------------------------------------

def test_pagina_responde_na_raiz(cliente):
    r = cliente.get("/")
    assert r.status_code == 200
    assert "AXIS" in r.text


def test_laudo_de_exemplo_responde_e_esta_marcado_como_demonstracao(cliente):
    """A marcação de demonstração é o que impede o exemplo de circular como se
    fosse laudo de verdade. Se ela sumir num redesenho, este teste quebra."""
    r = cliente.get("/laudo-exemplo.html")
    assert r.status_code == 200
    assert "LAUDO DE DEMONSTRAÇÃO" in r.text
    assert "fictícios" in r.text


def test_pagina_aponta_para_o_laudo_de_exemplo(cliente):
    assert "laudo-exemplo.html" in cliente.get("/").text


def test_pagina_tem_o_formulario_e_o_endpoint_certo(cliente):
    """Guarda contra o erro clássico: mexer no HTML e desligar o formulário
    sem perceber, porque nada quebra visualmente."""
    html = cliente.get("/").text
    assert 'id="formLead"' in html
    assert "/api/leads" in html
