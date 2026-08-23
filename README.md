# AXIS — landing page

Página pública de promoção do AXIS, com captura de e-mail para a lista de
acesso antecipado.

Projeto separado do repositório do produto de propósito: a página muda de
endereço, vai ao ar antes do produto e pode cair sem afetar ninguém em campo.
O app de auditoria não pode nada disso.

## Só quero um link para compartilhar

A pasta `site/` é a página inteira pronta para hospedar, sem servidor, sem
instalar nada. Arraste ela (ou o `axis-site.zip`) para qualquer host estático:

- **cloudflare.com/drop** — solta a pasta e sai um link na hora. O link vale
  1 hora; entrar na conta dentro desse prazo o torna permanente.
- **app.netlify.com/drop** — mesma ideia, com conta gratuita.

Nessa versão o formulário não grava e-mail: ele abre o e-mail já preenchido
para o visitante enviar. É `site/`, e não `public/`, justamente por isso — a
diferença entre as duas é uma linha (`AXIS_MODO_PREVIA`).

Quando o Worker estiver publicado, o link definitivo passa a servir `public/`,
e aí o cadastro grava sozinho. Ver [DEPLOY.md](DEPLOY.md).

Regerar a pasta depois de mexer em `public/index.html`:

```bash
npm run site
```

## Arquivos

```
site/                      Cópia pronta para host estático (sem servidor).
public/index.html          A página inteira — HTML, CSS e JS num arquivo só.
public/laudo-exemplo.html  Laudo de demonstração, com dados fictícios.
worker/index.js            Serve os estáticos e grava os e-mails no D1.
test/                      31 testes — Worker no runtime da Cloudflare, e o conteúdo das páginas.
schema.sql                 Tabelas do banco de leads.
wrangler.toml              Configuração do deploy.
DEPLOY.md                  Passo a passo para colocar no ar.
```

**Para publicar, siga o [DEPLOY.md](DEPLOY.md).**

Sem build step, sem bundler, sem framework de front — mesma decisão do app:
precisa abrir numa URL e funcionar. O símbolo da marca está embutido como
`data:` URI, então a página não depende de nenhum arquivo externo além das
fontes IBM Plex (que caem para a fonte do sistema se o Google Fonts não
responder).

## O laudo de demonstração

`laudo-exemplo.html` não foi escrito à mão. Ele saiu do motor de regras real do
AXIS (`app/rules.py` + `app/report.py`), rodado sobre um conjunto de medições
inventadas de uma "Escola Municipal Exemplo". Formato, códigos de item,
referências normativas, índice ponderado e plano de ação priorizado são
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
`public/laudo-exemplo.html`.

## Rodar

```bash
npm install
cp .dev.vars.exemplo .dev.vars   # e edite os dois valores
npm run banco:local              # cria as tabelas no D1 local
npm run dev                      # abre em http://localhost:8787
npm test                         # 23 testes
```

Os testes rodam dentro do workerd — o mesmo runtime que a Cloudflare executa em
produção — com um D1 local de verdade. Não é mock do banco.

## Onde os e-mails são gravados

`POST /api/leads` grava no Cloudflare D1 (SQLite gerenciado, replicado). O
banco é seu: sai inteiro em CSV a qualquer momento, sem depender de painel de
terceiro.

O mesmo e-mail enviado duas vezes não vira linha duplicada: atualiza o perfil
e conta o reenvio. Isso importa porque a página tem fila offline — se o
servidor não responder, o e-mail fica guardado no navegador do visitante e é
reenviado sozinho na visita seguinte.

### Ver e exportar a lista

A listagem **só** funciona com token. Sem `AXIS_ADMIN_TOKEN` definido,
ninguém lista — inclusive você. É proposital: deixar a lista de e-mails aberta
por esquecimento é vazamento de dado pessoal.

```bash
curl "https://SUA-URL/api/leads?token=SEU_TOKEN"
curl -O "https://SUA-URL/api/leads/exportar.csv?token=SEU_TOKEN"
```

O token é um secret na Cloudflare, definido com
`npx wrangler secret put AXIS_ADMIN_TOKEN`. A comparação é feita em tempo
constante, para que um atacante não descubra o token medindo o tempo de
resposta.

O CSV sai com `;` e BOM — abre direto no Excel em português, com acentuação
correta.

Para apagar um cadastro (a página promete isso ao visitante, é o direito de
exclusão da LGPD):

```bash
curl -X DELETE "https://SUA-URL/api/leads/pessoa@exemplo.com.br?token=SEU_TOKEN"
```

### Variáveis de ambiente

| Secret | Para quê | Sem ele |
| --- | --- | --- |
| `AXIS_ADMIN_TOKEN` | Libera listagem, CSV e exclusão | Tudo trancado, inclusive para você |
| `AXIS_SAL` | Embaralha o hash do IP no freio contra robô | Usa um valor padrão; o hash continua irreversível |

O IP do visitante nunca é gravado — só um hash truncado, e só para contar
cadastros na última hora.

## Antes de publicar — três coisas para trocar

1. **E-mail de contato.** No fim do `public/index.html`, `EMAIL_CONTATO` está como
   `contato@axis.tech`. É a caixa que recebe o fallback quando o servidor não
   responde. Se esse endereço ainda não existe, troque por um que exista —
   senão o plano B não leva a lugar nenhum.

2. **Endereço da API**, só se a página for publicada separada do Worker. No
   deploy descrito no DEPLOY.md, página e API vivem no mesmo domínio — não
   mexa em nada, o padrão é caminho relativo. Se um dia separar, adicione antes
   do `<script>` final:

   ```html
   <script>window.AXIS_API_BASE = 'https://seu-worker.exemplo.com';</script>
   ```

3. **Os números com ressalva.** A seção de planos e os textos dos resumos
   trazem preços marcados como estimativa não validada, e a seção de validação
   marca o que é relato profissional e o que é inferência. Isso é intencional —
   é o que sustenta o argumento diante de uma banca técnica. Se algum desses
   dados for validado depois, atualize o texto junto.

## Publicar

```bash
npm run deploy
```

Passo a passo completo, incluindo a primeira configuração da conta, em
[DEPLOY.md](DEPLOY.md).

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
- **Captura de e-mail** com perfil do visitante, fila offline e link de e-mail
  como plano B.

Acessibilidade — que num produto de acessibilidade não é detalhe: navegação
por teclado nos modais e no FAQ, foco visível, `prefers-reduced-motion`
respeitado, contraste conferido. O ciano nunca aparece como texto sobre fundo
branco (contraste ~1,9:1), só sobre grafite — a mesma regra que vale no laudo.
