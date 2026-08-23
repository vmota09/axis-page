# Colocar a landing page no ar

Guia do zero até a página pública captando e-mail. São uns 20 minutos na
primeira vez, e `npm run deploy` nas vezes seguintes.

**No fim você tem:** a página em `https://axis-page.SEU-SUBDOMINIO.workers.dev`,
de graça, sem dormir por inatividade, com os e-mails caindo num banco que é seu
e sai em CSV quando você quiser.

---

## Por que Cloudflare, e não Render/Vercel/Fly

Foi a única combinação que atendeu às três exigências ao mesmo tempo: custo
zero, sem espera para quem clica, e o banco de e-mails na sua mão.

| Opção | Por que não |
| --- | --- |
| Render (grátis) | O serviço dorme após 15 min sem acesso e leva 30 a 60 s para acordar. Quem abre o link depois disso encara uma tela branca. O Postgres grátis ainda expira em 30 dias. |
| Vercel (Hobby) | As regras de uso justa proíbem uso comercial — e uma página que anuncia um produto conta como comercial desde o primeiro dia, mesmo antes de faturar. |
| Fly.io | O free tier acabou. |
| Railway | US$ 5 de crédito de teste, depois é pago. |
| Cloudflare | Arquivo estático servido do CDN sem contar cota; o código só roda nas rotas `/api/`; 100 mil requisições/dia e 5 GB de banco no plano gratuito. Não dorme porque não há processo para acordar. |

O custo de escolher a Cloudflare foi reescrever o endpoint de cadastro de
Python para JavaScript (`worker/index.js`). É o mesmo comportamento, com os
mesmos 23 testes.

---

## 0. Antes de começar

Você precisa do Node.js 20 ou mais novo:

```bash
node -v
```

Se não tiver, instale em <https://nodejs.org>.

---

## 1. Criar a conta na Cloudflare

<https://dash.cloudflare.com/sign-up> — gratuita, não pede cartão.

## 2. Entrar pelo terminal

```bash
cd axis-page
npm install
npx wrangler login
```

O último comando abre o navegador para você autorizar. É uma vez só.

## 3. Criar o banco dos e-mails

```bash
npx wrangler d1 create axis-leads
```

A saída traz um `database_id`. **Copie esse número e cole no `wrangler.toml`**,
no lugar do `00000000-0000-0000-0000-000000000000`.

## 4. Criar as tabelas

```bash
npm run banco:producao
```

## 5. Definir os dois segredos

```bash
npx wrangler secret put AXIS_ADMIN_TOKEN
npx wrangler secret put AXIS_SAL
```

Cada comando pergunta o valor e não mostra o que você digita.

- `AXIS_ADMIN_TOKEN` — a senha que libera ver e exportar a lista de e-mails.
  Use algo longo e aleatório, e guarde num gerenciador de senhas. **Sem ele
  definido, ninguém acessa a lista — nem você.** É proposital: lista de e-mails
  aberta por esquecimento é vazamento de dado pessoal.
- `AXIS_SAL` — qualquer texto fixo. Serve para embaralhar o hash do IP usado no
  freio contra robô, de modo que o endereço de rede de ninguém fique guardado.

## 6. Publicar

```bash
npm run deploy
```

O wrangler devolve a URL no fim. Está no ar.

## 7. Conferir antes de divulgar

1. Abra a URL num navegador anônimo e no celular.
2. Cadastre um e-mail seu no formulário do rodapé.
3. Baixe a lista e confirme que ele chegou:

```bash
curl -O "https://SUA-URL/api/leads/exportar.csv?token=SEU_TOKEN"
```

4. Confirme que sem token está trancado — isto tem que devolver 403:

```bash
curl -i "https://SUA-URL/api/leads"
```

---

## Rodar na sua máquina antes de publicar

```bash
cp .dev.vars.exemplo .dev.vars     # e edite os dois valores
npm run banco:local
npm run dev                        # abre em http://localhost:8787
```

Rodar os testes:

```bash
npm test                           # 23 testes
```

Os testes rodam dentro do mesmo runtime que a Cloudflare executa em produção,
com um D1 local de verdade — não é simulação.

---

## Depois: plugar o domínio próprio

Funciona sem republicar nada. No painel da Cloudflare:

**Workers & Pages → axis-page → Settings → Domains & Routes → Add custom domain.**

Se o domínio estiver registrado em outro lugar, primeiro adicione-o à sua conta
Cloudflare (**Add a site**) e aponte os nameservers no registrador. O
certificado HTTPS sai automático e de graça.

Sobre qual domínio comprar, vale rever a decisão do `.tech`: a renovação custa
entre US$ 45 e US$ 62 por ano na maioria dos registradores, mesmo quando o
primeiro ano sai por menos de US$ 5. Um `.com.br` no Registro.br custa R$ 40 por
ano, com desconto progressivo para vários anos — e, para prefeitura, CAU/CREA e
edital de incubação, sinaliza empresa brasileira.

---

## Antes de mandar o link para alguém

1. **Troque o e-mail de contato.** Em `public/index.html`, procure
   `EMAIL_CONTATO`. Está como `contato@axis.tech`, que provavelmente ainda não
   existe. É a caixa que recebe o visitante quando o servidor não responde — se
   o endereço não existir, o plano B não leva a lugar nenhum.
2. **Exporte o CSV de vez em quando.** O D1 é confiável, mas backup é backup.
3. **Confira os avisos de estimativa.** A seção de planos e os resumos marcam
   explicitamente o que ainda não foi validado. Isso é o que sustenta o
   argumento diante de uma banca técnica — não apague sem trocar por dado real.

---

## Quando isso deixa de ser grátis

O plano gratuito cobre, por dia: 100 mil requisições ao código (o arquivo
estático não conta), 5 milhões de linhas lidas e 100 mil escritas no banco, e
5 GB de armazenamento.

Traduzindo para esta página: cada visitante que só lê a página custa **zero**
requisição de Worker. Só o envio do formulário custa. Você precisaria de
dezenas de milhares de cadastros por dia para chegar perto do teto — e nesse
cenário o problema já seria outro.

---

## Se algo der errado

| Sintoma | Causa provável |
| --- | --- |
| `npm run deploy` reclama de `database_id` | O passo 3 não foi colado no `wrangler.toml`. |
| Formulário responde "anotamos aqui no seu navegador" | O Worker não respondeu. Veja os logs: `npx wrangler tail`. |
| `/api/leads` devolve 403 mesmo com token | O secret não foi definido, ou foi definido em outro projeto. Refaça o passo 5. |
| A página abre mas o laudo de exemplo dá 404 | O arquivo `public/laudo-exemplo.html` não subiu — confirme que ele está dentro de `public/`. |
| Erro de tabela inexistente | O passo 4 não rodou, ou rodou com `--local` em vez de `--remote`. |

Para ver o que está acontecendo em produção, em tempo real:

```bash
npx wrangler tail
```
