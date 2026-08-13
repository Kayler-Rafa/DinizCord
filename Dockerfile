# Imagem da aplicação Next.js.
#
# Serve para quem preferir hospedar tudo por conta própria em vez de usar a
# Vercel. Multi-stage para que a imagem final não carregue o toolchain de build.

# ---------------------------------------------------------------------------
# Dependências
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# Só os manifestos primeiro: enquanto eles não mudarem, o Docker reaproveita a
# camada de `npm ci`, que é de longe a etapa mais cara.
COPY package.json package-lock.json ./
# `--ignore-scripts` porque o postinstall roda `prisma generate`, e o schema
# ainda não foi copiado. A geração acontece no estágio de build.
RUN npm ci --ignore-scripts

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Variáveis NEXT_PUBLIC_* são embutidas no bundle em tempo de build, então
# precisam existir aqui — e não apenas em runtime.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_STUN_SERVER
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_STUN_SERVER=$NEXT_PUBLIC_STUN_SERVER

ENV NEXT_TELEMETRY_DISABLED=1

RUN npx prisma generate && npm run build

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Usuário sem privilégios: um comprometimento do processo não vira root no
# container.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.ts ./next.config.ts
# Necessários para rodar `prisma migrate deploy` no start.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["npm", "run", "start"]
