# Colocar o DinizCord no ar

Guia passo a passo, do zero até o app funcionando.

## Por que são três serviços

A Vercel **não mantém conexões WebSocket abertas** — funções serverless morrem
em segundos. Como o chat em tempo real, a presença e a chamada de voz dependem
de um socket permanentemente aberto, o projeto separa isso em um processo
próprio, que precisa de um host que segure processos.

| Peça | Onde | Custo |
| --- | --- | --- |
| Banco PostgreSQL | Neon | grátis |
| Aplicação (site) | Vercel | grátis |
| Gateway WebSocket | Railway | ~US$ 5/mês (tem crédito inicial grátis) |

Se preferir tudo em um lugar só, dá para rodar aplicação **e** gateway no
Railway e dispensar a Vercel. O passo 3 explica.

---

## Antes de começar

Gere o segredo de autenticação — você vai colar o **mesmo valor** em dois
lugares:

```bash
openssl rand -base64 48
```

No Windows, sem `openssl`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Guarde esse valor. Chamaremos de `SEU_AUTH_SECRET`.

> Ele assina os tickets que autorizam a conexão WebSocket. Se a aplicação e o
> gateway tiverem segredos diferentes, o chat conecta e cai em seguida.

---

## Passo 1 — Banco de dados (Neon)

1. Crie uma conta em <https://neon.tech> e um projeto novo.
2. Escolha a região mais perto de vocês (`South America (São Paulo)` se for no
   Brasil).
3. Na tela do projeto, copie a **connection string**. Ela é parecida com:

```
postgresql://usuario:senha@ep-algo-123.sa-east-1.aws.neon.tech/neondb?sslmode=require
```

Guarde como `SUA_DATABASE_URL`.

### ⚠️ Você precisa das DUAS URLs do Neon

Esta é a pegadinha que mais quebra o projeto, e ela **falha em silêncio**.

O Neon oferece dois endereços para o mesmo banco. Eles diferem só pelo sufixo
`-pooler` no host:

```
pooled:  ...@ep-algo-123-pooler.sa-east-1.aws.neon.tech/neondb?...
direta:  ...@ep-algo-123.sa-east-1.aws.neon.tech/neondb?...
```

| Serviço | Qual usar | Por quê |
| --- | --- | --- |
| **Vercel** (site) | **pooled** | Serverless abre muitas conexões curtas; sem pooler o banco esgota. |
| **Railway** (gateway) | **direta** | O tempo real depende de `LISTEN/NOTIFY`, e o pooler não entrega notificações. |

O pooler roda em modo *transaction*: ele **aceita** o comando `LISTEN` sem dar
erro e simplesmente nunca entrega nada. O resultado é um chat que carrega o
histórico normalmente e nunca recebe mensagem nova em tempo real — sem nenhum
erro no log para indicar o motivo.

Para conferir qualquer URL antes de usar:

```bash
DATABASE_URL="a-url-que-quer-testar" npm run check:realtime
```

O gateway também faz esse teste sozinho ao subir. Se você vir
`BARRAMENTO REALTIME INOPERANTE` nos logs do Railway, é isto: troque para a URL
direta.

### Criar as tabelas e o servidor inicial

No seu computador, dentro da pasta do projeto:

```bash
npm install
```

Depois rode, **trocando pela sua URL**:

```bash
npx cross-env DATABASE_URL="SUA_DATABASE_URL" npm run db:deploy
```

Se `cross-env` não estiver disponível, no PowerShell:

```bash
$env:DATABASE_URL="SUA_DATABASE_URL"; npm run db:deploy; npm run db:seed
```

E no Linux/macOS:

```bash
DATABASE_URL="SUA_DATABASE_URL" npm run db:deploy && DATABASE_URL="SUA_DATABASE_URL" npm run db:seed
```

O `db:seed` cria o servidor "Amigos", os canais e a sua conta de dono:

```
e-mail: rafael@dinizcord.local
senha:  dinizcord2026
```

**Troque essa senha no primeiro login** (Configurações → Segurança).

Para usar seu e-mail de verdade, defina antes:

```bash
SEED_OWNER_EMAIL="voce@gmail.com" SEED_OWNER_PASSWORD="uma-senha-boa-123"
```

---

## Passo 2 — Gateway WebSocket (Railway)

Faça isso **antes** da Vercel, porque a aplicação precisa saber o endereço do
gateway no momento do build.

1. Entre em <https://railway.app> e faça login com o GitHub.
2. **New Project** → **Deploy from GitHub repo** → escolha `DinizCord`.
3. Abra o serviço criado → aba **Settings**:
   - Em **Build**, defina o *Dockerfile Path* como `Dockerfile.gateway`.
   - Em **Networking**, clique em **Generate Domain** e escolha a porta `3001`.
     Você recebe algo como `dinizcord-gateway-production.up.railway.app`.
4. Aba **Variables**, adicione:

```
DATABASE_URL   = a URL DIRETA do Neon (sem "-pooler" no host)
AUTH_SECRET    = SEU_AUTH_SECRET
WS_PORT        = 3001
WS_ALLOWED_ORIGINS = https://dinizcord.vercel.app
```

> Repare: aqui vai a URL **direta**, diferente da que a Vercel usa. Ver o aviso
> no passo 1.

> `WS_ALLOWED_ORIGINS` é o endereço do **site**, não do gateway. Você ainda não
> o tem — coloque um valor provisório agora e volte para corrigir no passo 4.
> Sem isso certo, o navegador é recusado no handshake.

5. **Escolha a região.** O Railway não tem região na América do Sul e costuma
   provisionar em Amsterdã — o pior caso aqui, porque cada consulta do gateway
   ao banco (em `sa-east-1`) atravessaria o Atlântico. Use `us-east`, a mais
   próxima do Brasil:

```bash
railway service scale --service gateway us-east=1 ams=0
```

> `ams` e `eu-west` são regiões **distintas** no Railway: zerar só `eu-west`
> não remove uma réplica que esteja em `ams`. Confira com `railway status`.

6. Aguarde o deploy. Teste no navegador:

```
https://SEU-GATEWAY.up.railway.app/health
```

Deve responder `{"status":"ok","connections":0}`.

7. Guarde o endereço trocando `https` por `wss`:

```
wss://SEU-GATEWAY.up.railway.app
```

Chamaremos de `SUA_WS_URL`.

---

## Passo 3 — Aplicação (Vercel)

1. Entre em <https://vercel.com> e faça login com o GitHub.
2. **Add New** → **Project** → importe `DinizCord`.
3. Não mude o Framework Preset (ele detecta Next.js sozinho).
4. Abra **Environment Variables** e adicione **todas** antes de fazer o deploy:

```
DATABASE_URL            = a URL POOLED do Neon (com "-pooler" no host)
AUTH_SECRET             = SEU_AUTH_SECRET
NEXT_PUBLIC_APP_URL     = https://dinizcord.vercel.app
NEXT_PUBLIC_WS_URL      = SUA_WS_URL
NEXT_PUBLIC_STUN_SERVER = stun:stun.l.google.com:19302
REGISTRATION_INVITE_ONLY = true
```

> `NEXT_PUBLIC_APP_URL` você ainda não sabe com certeza. Use
> `https://dinizcord.vercel.app` — a Vercel costuma dar esse nome se estiver
> livre. Se der outro, corrija no passo 4.

5. Clique em **Deploy**.

As migrations rodam sozinhas no build (script `vercel-build`), então não há
passo manual aqui.

> **Se o build falhar** com *"NEXT_PUBLIC_WS_URL precisa estar definida"*, é
> porque a variável não foi salva antes do deploy. Adicione e clique em
> **Redeploy**.

---

## Passo 4 — Fechar o círculo

Agora você sabe os dois endereços reais. Confira se batem:

**Na Vercel** (Settings → Environment Variables):
- `NEXT_PUBLIC_APP_URL` = a URL real do site
- `NEXT_PUBLIC_WS_URL` = `wss://` + domínio do Railway

**No Railway** (Variables):
- `WS_ALLOWED_ORIGINS` = a URL real do site, **sem barra no final**

Se mudou algo na Vercel, faça **Redeploy** — variáveis `NEXT_PUBLIC_*` são
gravadas dentro do JavaScript durante o build, então não valem sem um build novo.

Se mudou algo no Railway, ele reinicia sozinho.

---

## Passo 5 — Testar

1. Abra o site e entre com as credenciais do seed.
2. Se aparecer a faixa laranja *"Sua conexão foi interrompida. Reconectando…"*,
   o gateway não está sendo aceito — veja a seção de problemas abaixo.
3. Mande uma mensagem.
4. Abra o menu do servidor → **Convidar pessoas** → gere o link e mande no
   grupo. Como `REGISTRATION_INVITE_ONLY=true`, só quem tiver o link consegue
   criar conta.
5. Para testar voz, precisa de duas pessoas em máquinas diferentes (o navegador
   pede permissão de microfone).

---

## Problemas comuns

**A faixa de "reconectando" não some.**
Abra o console do navegador (F12). Os erros costumam ser:
- `WebSocket connection failed` → `NEXT_PUBLIC_WS_URL` errada, ou o gateway
  fora do ar. Teste o `/health`.
- Erro de CSP → `NEXT_PUBLIC_WS_URL` no build é diferente da que está sendo
  usada. Refaça o deploy na Vercel.
- Conecta e cai logo em seguida → `AUTH_SECRET` diferente entre Vercel e
  Railway, ou `WS_ALLOWED_ORIGINS` não bate com a URL do site.

**Mixed content / bloqueado por HTTPS.**
Um site em `https://` não abre socket `ws://`. Use `wss://`.

**A voz conecta mas ninguém se ouve.**
Falta TURN. Em 4G e Wi-Fi corporativo o P2P direto não fecha. Veja a próxima
seção.

**Build da Vercel falha em `prisma migrate deploy`.**
`DATABASE_URL` não está nas variáveis da Vercel, ou o Neon está pausado
(o plano grátis suspende após inatividade — abra o painel para acordar).

---

## Opcional: TURN, para a voz funcionar em qualquer rede

Sem TURN, quem estiver em rede móvel ou corporativa pode não conseguir
completar a chamada. A própria interface avisa (Configurações → Voz).

O jeito mais rápido é um serviço gerenciado (Metered, Twilio, Cloudflare
Calls). Pegue as credenciais e adicione **na Vercel**:

```
TURN_SERVER_URL = turn:endereco-do-servico:3478
TURN_USERNAME   = usuario
TURN_PASSWORD   = senha
```

Não precisa mexer no Railway — as credenciais são entregues ao navegador pela
aplicação, só para quem está autenticado.

---

## Alternativa: tudo no Railway, sem Vercel

Se preferir simplificar para dois serviços em vez de três:

1. No mesmo projeto do Railway, **New** → **GitHub Repo** → `DinizCord` de novo.
2. Nesse segundo serviço, deixe o *Dockerfile Path* como `Dockerfile`.
3. Em **Settings → Build**, adicione os build args:
   `NEXT_PUBLIC_APP_URL` e `NEXT_PUBLIC_WS_URL`.
4. As variáveis de runtime são as mesmas do passo 3.

Fica mais caro que a Vercel (que é grátis para este uso), mas concentra tudo
em um painel só.
