# DinizCord

Plataforma privada de comunicação para um grupo pequeno de amigos: canais de
texto com histórico, canais de voz por WebRTC, compartilhamento de tela,
presença em tempo real e convites por link.

Não é um clone do Discord — nenhum asset, código ou identidade visual de
terceiros foi usado. A inspiração é conceitual: a disposição de três colunas e o
modelo de servidor/canais são convenções do gênero.

---

## Sumário

- [Stack](#stack)
- [Arquitetura](#arquitetura)
- [WebSockets e Vercel](#websockets-e-vercel)
- [Instalação](#instalação)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Banco de dados](#banco-de-dados)
- [Execução local](#execução-local)
- [Testes](#testes)
- [Docker](#docker)
- [Deploy](#deploy)
- [WebRTC, STUN e TURN](#webrtc-stun-e-turn)
- [Segurança](#segurança)
- [Limitações conhecidas](#limitações-conhecidas)

---

## Stack

| Camada | Escolha |
| --- | --- |
| Linguagem | TypeScript (strict, `noUncheckedIndexedAccess`) |
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS 4 |
| Componentes | Primitivas Radix escritas à mão no estilo shadcn/ui, ícones Lucide |
| Backend | Route handlers do Next + gateway WebSocket em Node (`ws`) |
| Banco | PostgreSQL 17 + Prisma 7 (driver adapter `@prisma/adapter-pg`) |
| Realtime | WebSocket + `LISTEN/NOTIFY` do PostgreSQL |
| Mídia | WebRTC P2P (mesh), `getDisplayMedia` para tela |
| Validação | Zod 4, compartilhado entre cliente e servidor |
| Senhas | Argon2id (`@node-rs/argon2`) |
| Testes | Vitest contra PostgreSQL real |
| Logs | Pino (JSON estruturado, com redação de campos sensíveis) |

Nada de Redis, Kafka ou Kubernetes: o PostgreSQL já é dependência obrigatória e
dá conta do volume de um app privado.

---

## Arquitetura

```
┌──────────────┐   HTTP/REST    ┌────────────────────┐
│              │───────────────▶│  Next.js           │
│  Navegador   │                │  (rotas + SSR)     │
│              │◀───────────────│                    │
└──────┬───────┘                └─────────┬──────────┘
       │                                  │  INSERT em RealtimeEvent
       │ WebSocket                        ▼
       │                        ┌────────────────────┐
       │                        │   PostgreSQL       │
       │                        │  + trigger         │
       │                        │    pg_notify       │
       │                        └─────────┬──────────┘
       │                                  │  LISTEN dinizcord_events
       │                        ┌─────────▼──────────┐
       └───────────────────────▶│  Gateway WS        │
                                │  (processo à parte)│
                                └────────────────────┘

        Áudio e tela vão direto entre navegadores (WebRTC).
        O gateway só transporta o signaling.
```

### Fluxo de um evento realtime

1. O navegador faz `POST /api/channels/:id/messages`.
2. O route handler grava a mensagem **e** insere uma linha em `RealtimeEvent`.
3. Um trigger dispara `pg_notify('dinizcord_events', <id>)`.
4. Toda instância do gateway está em `LISTEN` nesse canal; cada uma busca a
   linha (em lote, com janela de 5 ms) e entrega aos seus WebSockets.
5. O cliente aplica o evento no store e a interface reage.

O payload não viaja dentro do `NOTIFY` porque o limite dele é de 8000 bytes —
uma mensagem de 4000 caracteres em UTF-8 estoura esse teto. Daí o padrão
*outbox*: o `NOTIFY` carrega só o id.

**Por que isso importa:** essa é a peça que permite rodar mais de uma instância
do gateway sem Redis. Cada instância enxerga todos os eventos, e o roteamento
por tópico (`server:<id>`, `user:<id>`, `session:<id>`) decide quem recebe o quê.

### Estado efêmero

Presença e participação em voz vivem nas tabelas `PresenceSession` e
`VoiceSession`, com heartbeat e TTL — **nunca só em memória**. Se um processo
morrer com `kill -9`, o *sweeper* (protegido por um advisory lock do PostgreSQL,
para que só uma instância varra por vez) limpa as sessões órfãs e anuncia quem
ficou offline.

### Organização

```
app/                 Rotas do App Router (páginas + API)
components/
├── auth/            Login, cadastro
├── channels/        Lista e gestão de canais
├── chat/            Histórico, composer, mensagens
├── layout/          Shell de três colunas, painel do usuário
├── members/         Lista de membros
├── providers/       AppProvider (store + socket), VoiceProvider
├── screen-share/    Palco e superfície de vídeo
├── server/          Menu do servidor, convites, configurações
├── settings/        Perfil, aparência, voz, senha
├── ui/              Primitivas (botão, diálogo, avatar, toast…)
└── voice/           Itens de canal de voz
hooks/               useAuth, usePresence, useWebSocket, useWebRTC,
                     useVoiceChannel, useScreenShare, useMessages…
lib/
├── api/             Erros, guards de autorização, rate limit, CSRF
├── auth/            Sessão, senha, tickets, tentativas de login
├── client/          Cliente HTTP, store, socket
├── db/              Prisma (factory + singleton), mappers
├── messages/        Regras de mensagens
├── realtime/        Tópicos e publicação no outbox
├── servers/         Regras de servidor, canais e convites
├── validation/      Schemas Zod compartilhados
├── webrtc/          Motor de voz, peer connection, detecção de fala
└── websocket/       Protocolo (Zod + tipos)
prisma/              schema.prisma, migrations, seed
server/              Gateway WebSocket (processo separado)
scripts/             PostgreSQL embutido, dev-all, manutenção
tests/               Suíte de integração
```

---

## WebSockets e Vercel

**A Vercel não mantém conexões WebSocket de longa duração.** Funções serverless
têm tempo de vida curto e não seguram um socket aberto.

A resposta deste projeto não é contornar a limitação com polling, e sim **isolar
o realtime em um processo próprio** (`server/`), que roda em qualquer host
capaz de manter processos: Railway, Fly.io, Render, uma VPS.

O que torna isso indolor:

- O frontend conhece o gateway **apenas** pela variável `NEXT_PUBLIC_WS_URL`.
  Trocar de host é mudar uma variável de ambiente — nenhum componente muda.
- A autenticação do socket usa um **ticket JWT de 60 segundos**
  (`POST /api/gateway/ticket`), então o gateway não precisa do cookie de sessão
  nem compartilhar domínio com a aplicação.
- Todo o estado durável está no PostgreSQL. O gateway é descartável.

Se um dia a Vercel passar a suportar sockets persistentes, o `server/` pode ser
adaptado sem tocar no cliente.

---

## Instalação

Pré-requisitos: **Node.js 20.11+** e um **PostgreSQL 14+**.

```bash
git clone <url-do-repositorio> dinizcord
cd dinizcord
npm install
cp .env.example .env
```

Gere o `AUTH_SECRET`:

```bash
openssl rand -base64 48
```

Cole o valor em `AUTH_SECRET` no `.env`.

---

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `DATABASE_URL` | sim | Connection string do PostgreSQL. **O gateway precisa de uma conexão direta, sem pooler** — ver aviso abaixo. |
| `AUTH_SECRET` | sim | Mínimo 32 caracteres. Assina os tickets do WebSocket e deriva os hashes de sessão. |
| `NEXT_PUBLIC_APP_URL` | sim | URL pública da aplicação. Usada nos links de convite e na checagem de origem. |
| `NEXT_PUBLIC_WS_URL` | sim | URL do gateway (`ws://` em dev, `wss://` em produção). |
| `WS_PORT` | não | Porta do gateway. Padrão `3001`. |
| `WS_ALLOWED_ORIGINS` | não | Origens autorizadas a abrir WebSocket, separadas por vírgula. |
| `NEXT_PUBLIC_STUN_SERVER` | não | Servidor STUN. Padrão: STUN público do Google. |
| `TURN_SERVER_URL` | não | Servidor TURN. Sem ele, algumas redes não fecham a chamada. |
| `TURN_USERNAME` / `TURN_PASSWORD` | não | Credenciais do TURN. Nunca vão para o bundle. |
| `LOG_LEVEL` | não | `trace`…`fatal` ou `silent`. Padrão `info`. |
| `REGISTRATION_INVITE_ONLY` | não | `true` fecha o cadastro a quem tem link de convite. |

O arquivo é validado com Zod na inicialização (`lib/env.server.ts`): um
`AUTH_SECRET` curto derruba o processo com mensagem clara, em vez de gerar
sessões forjáveis em silêncio.

### Poolers e o barramento realtime

Provedores serverless (Neon, Supabase) oferecem um endpoint "pooled" que roda
PgBouncer em modo *transaction*. Esse modo **aceita o comando `LISTEN` e nunca
entrega notificação nenhuma** — sem erro, sem aviso.

Consequência: a aplicação Next pode (e deve) usar a URL com pooler, mas o
**gateway precisa da conexão direta**. Se ele rodar através do pooler, o chat
carrega o histórico e nunca recebe nada em tempo real.

O gateway detecta isso sozinho ao subir e registra `BARRAMENTO REALTIME
INOPERANTE` no log. Para conferir uma URL antes de usá-la:

```bash
DATABASE_URL="..." npm run check:realtime
```

---

## Banco de dados

### Subir o PostgreSQL

Caminho recomendado — Docker:

```bash
docker compose up -d
```

Sem Docker na máquina, há um PostgreSQL embutido (binário real, não SQLite):

```bash
npm run db:embedded
```

Ele sobe na porta `5433` e persiste em `.pgdata/`. Ajuste o `DATABASE_URL` para
`postgresql://dinizcord:dinizcord@localhost:5433/dinizcord?schema=public`.

### Migrations e seed

```bash
npm run db:migrate      # aplica migrations em desenvolvimento
npm run db:deploy       # aplica migrations em produção
npm run db:seed         # cria o servidor "Amigos" e os canais iniciais
npm run db:studio       # inspeção visual
```

O seed é **idempotente** — rodar duas vezes não duplica nada. Ele cria:

```
Servidor: Amigos
Texto:    #geral  #memes  #jogos  #programacao
Voz:      Geral   Jogos
Dono:     rafael@dinizcord.local / dinizcord2026
```

Troque a senha no primeiro login (Configurações → Segurança). As credenciais do
seed podem ser sobrescritas por `SEED_OWNER_EMAIL`, `SEED_OWNER_USERNAME`,
`SEED_OWNER_PASSWORD` e `SEED_OWNER_NAME`.

### Modelo de dados

`User`, `UserSession`, `LoginAttempt`, `Server`, `ServerMember`, `Channel`,
`Message`, `MessageReaction`, `ChannelReadState`, `Invite`, `RealtimeEvent`,
`PresenceSession`, `VoiceSession`.

Mensagens usam **exclusão lógica**: o conteúdo é zerado, mas a linha permanece
para que respostas a ela não percam a referência.

---

## Execução local

```bash
docker compose up -d    # ou: npm run db:embedded
npm install
npm run db:migrate
npm run db:seed
npm run dev:all
```

`dev:all` sobe os dois processos com prefixo por serviço e encerra ambos no
Ctrl+C. Para rodá-los separadamente:

```bash
npm run dev        # Next em http://localhost:3000
npm run gateway    # gateway em ws://localhost:3001
```

### Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Aplicação Next em modo desenvolvimento. |
| `npm run dev:all` | Next + gateway juntos. |
| `npm run gateway` | Apenas o gateway. |
| `npm run gateway:dev` | Gateway com reinício automático. |
| `npm run build` | `prisma generate` + build de produção. |
| `npm run start` | Sobe a build de produção. |
| `npm run lint` | ESLint. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm test` | Suíte completa. |
| `npm run test:watch` | Testes em watch. |
| `npm run test:coverage` | Cobertura. |
| `npm run db:embedded` | PostgreSQL embutido (sem Docker). |

---

## Testes

```bash
npm test
```

**116 testes** cobrindo autenticação, autorização, mensagens, canais, convites,
presença e signaling WebRTC.

Os testes rodam contra um PostgreSQL **real** (banco `dinizcord_test`, criado e
migrado automaticamente), e não contra mocks: constraints, transações, cascade e
ordenação só se comportam como em produção no motor de verdade. Os testes de
gateway sobem um servidor WebSocket completo e falam o protocolo real, com
handshake, ticket e `LISTEN/NOTIFY`.

O que é verificado, entre outras coisas:

- senha nunca sai em texto puro nem em hash pela API;
- tempo de resposta do login não revela quais e-mails existem;
- bloqueio por força bruta resiste mesmo com a senha correta;
- quem não é membro recebe **404** (e não 403) — não descobre nem que o recurso
  existe;
- administradores não podem editar mensagens alheias, só apagar;
- paginação percorre o histórico sem repetir nem pular mensagens;
- signaling WebRTC é recusado entre usuários em canais diferentes;
- ausência automática não sobrescreve o status escolhido pelo usuário;
- uma aba em segundo plano não deixa a pessoa "ausente" para os outros.

---

## Docker

Ambiente local com banco em container:

```bash
docker compose up -d
```

Stack inteira em containers (aplicação + gateway + banco):

```bash
export AUTH_SECRET="$(openssl rand -base64 48)"
docker compose --profile full up --build
```

Imagens separadas:

```bash
docker build -t dinizcord-web \
  --build-arg NEXT_PUBLIC_APP_URL=https://seu-dominio \
  --build-arg NEXT_PUBLIC_WS_URL=wss://gateway.seu-dominio .

docker build -t dinizcord-gateway -f Dockerfile.gateway .
```

As variáveis `NEXT_PUBLIC_*` entram como `--build-arg` porque o Next as embute no
bundle em tempo de build; passá-las só em runtime não teria efeito.

---

## Deploy

> **Passo a passo completo, com provedores concretos e solução de problemas:
> [DEPLOY.md](DEPLOY.md).** A seção abaixo é o resumo.

São três peças: banco, aplicação e gateway.

### 1. Banco

Qualquer PostgreSQL gerenciado (Neon, Supabase, Railway, RDS). Aplique as
migrations antes do primeiro deploy:

```bash
DATABASE_URL="<url-de-producao>" npm run db:deploy
DATABASE_URL="<url-de-producao>" npm run db:seed
```

### 2. Aplicação (Vercel)

Importe o repositório e configure as variáveis. A Vercel usa automaticamente o
script `vercel-build`, que aplica as migrations antes do build — não há passo
manual de migração a cada deploy.

Cuidado: `NEXT_PUBLIC_WS_URL` precisa ser **`wss://`** — uma página em HTTPS não
abre socket `ws://` sem criptografia.

### 3. Gateway

Deploy da `Dockerfile.gateway` em Railway, Fly.io, Render ou VPS. Configure:

```env
DATABASE_URL=<mesma url do banco da aplicação>
AUTH_SECRET=<exatamente o mesmo secret da aplicação>
WS_PORT=3001
WS_ALLOWED_ORIGINS=https://seu-dominio
```

O `AUTH_SECRET` precisa ser **idêntico** nos dois: é ele que valida os tickets.

Um `GET /health` responde com o número de conexões abertas — use como
healthcheck.

O gateway escala horizontalmente: várias instâncias compartilham o estado pelo
`LISTEN/NOTIFY` e pelas tabelas de sessão efêmera.

---

## WebRTC, STUN e TURN

Áudio e tela usam **topologia mesh**: cada participante abre uma conexão direta
com cada outro. O servidor nunca transporta mídia — só o signaling (SDP e
candidatos ICE).

Para o tamanho deste projeto o mesh é a escolha certa: latência mínima, custo de
servidor zero, nenhuma infraestrutura de SFU. Em troca, o upload de cada pessoa
cresce linearmente com o número de participantes — o limite prático fica em
torno de **6 a 8 pessoas** com tela compartilhada.

A negociação usa o padrão **perfect negotiation** do W3C: os dois lados podem
iniciar uma renegociação (é o que acontece quando alguém começa a compartilhar a
tela), e a colisão é resolvida por um papel fixo derivado da comparação dos ids
de sessão.

### STUN e TURN

- **STUN** descobre o endereço público de cada participante. Vem configurado
  por padrão e resolve a maioria dos casos.
- **TURN** retransmite a mídia quando a conexão direta não é possível — típico
  em NAT simétrico (redes móveis, Wi-Fi corporativo).

```env
NEXT_PUBLIC_STUN_SERVER=stun:stun.l.google.com:19302
TURN_SERVER_URL=turn:seu-turn.exemplo:3478
TURN_USERNAME=usuario
TURN_PASSWORD=senha
```

As credenciais do TURN **não** vão para o bundle: são entregues por
`GET /api/webrtc/ice` apenas a usuários autenticados. Sem TURN configurado, a
aba Configurações → Voz avisa explicitamente sobre a limitação.

Para hospedar um TURN próprio, [coturn](https://github.com/coturn/coturn) é a
opção usual.

---

## Segurança

| Risco | Tratamento |
| --- | --- |
| Senhas | Argon2id com parâmetros do OWASP (19 MiB, 2 iterações). |
| Sessão | Token opaco de 256 bits; o banco guarda só o HMAC-SHA256. Cookie `httpOnly`, `SameSite=Lax`, `Secure` em produção. |
| XSS | Nenhum `dangerouslySetInnerHTML`. O texto vira nós do React, que escapam tudo. Formatação limitada a negrito, itálico, código e links `http(s)`. CSP restritiva. |
| CSRF | `SameSite=Lax` + validação de `Origin` em toda requisição que altera estado. |
| SQL injection | Prisma parametriza tudo; o único SQL cru usa placeholders. |
| Autorização | O servidor é sempre derivado do recurso, nunca informado pelo cliente. Quem não é membro recebe 404. |
| Força bruta | Contadores no PostgreSQL por identificador e por IP — sobrevivem a restart e funcionam com várias instâncias. |
| Enumeração de contas | Login com conta inexistente gasta o mesmo tempo de um Argon2 real e devolve a mesma mensagem. |
| Abuso de WebSocket | Validação Zod em toda mensagem, teto de 64 KB, janela deslizante por conexão, heartbeat obrigatório. |
| WebSocket cross-site | Validação de `Origin` antes do handshake. |
| Signaling indevido | Só é encaminhado entre participantes do **mesmo** canal de voz. |
| Exposição de secrets | Segredos só no servidor; TURN entregue sob demanda; logs com redação de senha, token e cookie. |
| Dados pessoais | IPs são armazenados apenas como HMAC. |

Cabeçalhos aplicados a todas as respostas: `Content-Security-Policy`,
`Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy` e `Permissions-Policy`.

---

## Limitações conhecidas

**Vercel não hospeda o gateway.** O WebSocket exige um processo persistente.
Está isolado em `server/` justamente para poder ser movido sem tocar no cliente.

**Mesh não escala além de ~8 pessoas.** Cada participante envia sua mídia a
todos os outros. Para grupos maiores seria preciso um SFU (mediasoup, LiveKit) —
o que muda a arquitetura de mídia, mas não o protocolo de signaling.

**Rate limit da API é por instância.** A camada em memória (`lib/api/rate-limit.ts`)
não é compartilhada entre instâncias: com N réplicas, o limite efetivo vira
N × limite. O rate limit **do login**, que é o que protege senhas, é persistido
no banco e não tem esse problema.

**Sem TURN, algumas redes não conectam.** NAT simétrico impede P2P direto. A
interface avisa quando o TURN não está configurado.

**Sem upload de arquivos ou imagens.** Só texto e emojis. Avatares são gerados a
partir das iniciais com cor determinística.

**Sem notificações push.** Não há service worker; as não lidas aparecem apenas
com o app aberto.

**Mensagens não são criptografadas ponta a ponta.** Quem tem acesso ao banco lê o
histórico. Áudio e vídeo, esses sim, nunca passam pelo servidor.

**Um servidor por instalação, na prática.** O modelo de dados suporta vários
servidores e a interface já tem a trilha lateral, mas não existe tela de "criar
servidor" — novos servidores precisam ser criados via seed ou diretamente no
banco.
