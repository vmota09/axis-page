# AXIS — landing page

Página pública de promoção do AXIS. Site estático, sem servidor.

Projeto separado do repositório do produto de propósito: a página muda de
endereço, vai ao ar antes do produto e pode cair sem afetar ninguém em campo.
O app de auditoria não pode nada disso.

## O site publicado — GitHub Pages

A pasta `docs/` é o que está no ar. O nome não é estilo: **raiz** e **`/docs`**
são as duas únicas pastas que o GitHub Pages aceita publicar de uma branch, e
a raiz aqui é ocupada pelo projeto.

Configuração no GitHub, uma vez só:
**Settings → Pages → Source: Deploy from a branch → Branch: `main` / `/docs`.**

Endereço: <https://vmota09.github.io/axis-page/>

Publicar uma alteração:

```bash
git add docs && git commit -m "atualiza a página" && git push
```

O Pages republica sozinho em 1 a 2 minutos.

**Repositório privado não funciona no plano Free do GitHub** — Pages a partir
de repo privado exige Pro. E, mesmo no Pro, o site publicado é público de
qualquer forma: o privado seria só o código. Como esta página existe para ser
lida por estranhos, repositório público é o caminho natural.

Alternativas de host, se um dia quiser sair do GitHub: **app.netlify.com/drop**
ou **cloudflare.com/drop** aceitam a pasta `docs/` arrastada, sem terminal.

## Arquivos

```
docs/index.html          A página inteira — HTML, CSS e JS num arquivo só.
docs/laudo-exemplo.html  Laudo de demonstração, com dados fictícios.
test/paginas.spec.js     Guardas sobre o conteúdo das páginas.
apps-script/Codigo.gs    Recebe os cadastros e grava na planilha do Google.
marca/                   QR code do link público.
```

E, guardado para quando houver captação de e-mail (ver abaixo):

```
worker/index.js       Endpoint de cadastro, pronto e testado.
test/leads.spec.js    23 testes do endpoint.
schema.sql            Tabelas do banco.
wrangler.toml         Configuração do deploy.
DEPLOY.md             Passo a passo.
```

Sem build step, sem bundler, sem framework de front — mesma decisão do app:
precisa abrir numa URL e funcionar. O símbolo da marca está embutido como
`data:` URI, então a página não depende de nenhum arquivo externo além das
fontes IBM Plex (que caem para a fonte do sistema se o Google Fonts não
responder).

## Rodar e testar

```bash
npm install
npm test                 # 33 testes
```

Para ver a página, basta abrir `docs/index.html` no navegador. Nada a compilar.

## A captação de e-mail — Google Sheets

Os cadastros caem na planilha **"AXIS — lista de espera (landing page)"**, no
seu Drive, via um Apps Script publicado como aplicativo da web.

Instalar (uma vez, tudo no navegador): as instruções estão no topo de
[`apps-script/Codigo.gs`](apps-script/Codigo.gs). No fim você recebe uma URL
terminada em `/exec` — cole-a em `docs/index.html`, na constante
`URL_PLANILHA`, e publique.

**Enquanto essa constante estiver vazia, o formulário não finge que grava.**
Ele abre o e-mail já preenchido para o visitante enviar. Um campo que parece
funcionar e some é pior que um que assume a limitação.

### Por que o envio é um formulário, e não `fetch()`

O Apps Script não devolve cabeçalho de CORS de forma confiável. Um `fetch()`
comum é bloqueado pelo navegador; um `fetch` com `mode:'no-cors'` passa, mas
volta cego — a página não teria como saber se gravou, e diria "recebido" no
escuro. Envio de formulário para um `<iframe>` oculto não passa por CORS, e o
evento de carga do iframe confirma que o servidor respondeu. Se em 15 segundos
não responder, a página assume a dúvida e oferece o e-mail.

Isso está protegido por teste: trocar o `target` do formulário por um `fetch`
quebra a suíte.

### Duplicatas e privacidade

O mesmo e-mail enviado duas vezes não vira linha nova: o script atualiza o
perfil e soma no contador `envios`. A planilha guarda data, e-mail, perfil,
origem e contagem — nada além disso, e nenhum IP.

### Alternativa mais robusta, para depois

`worker/index.js` (Cloudflare Worker + D1) faz o mesmo com banco próprio,
exportação em CSV, freio contra robô por IP e listagem trancada por token.
Está escrito e coberto por 23 testes; falta publicar. Ver [DEPLOY.md](DEPLOY.md).

## O laudo de demonstração

`docs/laudo-exemplo.html` não foi escrito à mão. Ele saiu do motor de regras
real do AXIS (`app/rules.py` + `app/report.py`), rodado sobre um conjunto de
medições inventadas de uma "Escola Municipal Exemplo". Formato, códigos de
item, referências normativas, índice ponderado e plano de ação priorizado são
exatamente o que o produto emite — só os números de entrada é que são fictícios.

Resultado: **63,8% · parcialmente conforme**, 8 de 15 critérios avaliados
conformes, 3 não avaliados.

O arquivo abre com uma faixa preta e âmbar dizendo, em letras grandes, que é
demonstração e que não vale como laudo. **Não remova essa faixa.** Sem ela, um
PDF de exemplo circulando por e-mail vira exatamente o problema que o produto
existe para combater — um documento afirmando conformidade que ninguém apurou.
Há um teste que quebra se a marcação sumir.

Para gerar de novo com outros valores, rode a partir da pasta do repositório do
produto, onde estão `app/rules.py` e `app/report.py`, e salve a saída em
`docs/laudo-exemplo.html`.

## O que a página tem

- **Hero** com três aparelhos mostrando a captura das três fotos — fachada,
  detalhe do solo e entrada — com visor, enquadramento guiado e disparo. As
  cenas dentro dos visores são desenhos vetoriais, não fotografias: a página não
  exibe registro de nenhuma edificação real.
- **Faixa de dados** com as quatro estatísticas que sustentam o problema, cada
  uma com a fonte visível.
- **Problema**, **como funciona** (3 etapas) e **o app por dentro**, com três
  telas navegáveis por abas.
- **As regras que o sistema não quebra** — as seis regras de arquitetura que
  respondem à objeção "e se a IA errar?".
- **Laudo de exemplo** renderizado na própria página, com botão que abre o
  laudo de demonstração completo e outro que explica o laudo item a item.
- **Resumos** em modal: resumo executivo, mercado e números, roadmap e
  validação.
- **Planos** (âncora `#planos`), com o aviso de que nenhum preço foi validado.
- **FAQ** com as perguntas que uma banca técnica faria.
- **Cadastro** na lista de espera, gravando na planilha do Google.

## Cuidado ao editar

Os números com ressalva são intencionais. A seção de planos marca os preços
como estimativa não validada, e a seção de validação separa o que é relato
profissional do que é inferência. É isso que sustenta o argumento diante de uma
banca técnica — não apague sem trocar por dado real.

Acessibilidade — que num produto de acessibilidade não é detalhe: navegação
por teclado nos modais e no FAQ, foco visível, `prefers-reduced-motion`
respeitado, contraste conferido. O ciano nunca aparece como texto sobre fundo
branco (contraste ~1,9:1), só sobre grafite — a mesma regra que vale no laudo.
