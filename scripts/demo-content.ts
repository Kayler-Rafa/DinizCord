/**
 * Popula a instância local com uma conversa realista, para capturas de tela.
 *
 * NÃO use isto em produção: cria contas com senha conhecida. É uma ferramenta de
 * documentação, não de seed.
 *
 * Uso: npx tsx scripts/demo-content.ts
 */
import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import { createPrismaClient } from '../lib/db/factory';
import { avatarColorFor } from '../lib/utils';
import { TERMS_VERSION } from '../lib/terms';

const prisma = createPrismaClient({ maxConnections: 3 });

const PESSOAS = [
  { username: 'joao', displayName: 'João', cor: '#f97316' },
  { username: 'pedro', displayName: 'Pedro', cor: '#22c55e' },
  { username: 'lucas', displayName: 'Lucas', cor: '#0ea5e9' },
  { username: 'bia', displayName: 'Bia', cor: '#ec4899' },
];

/** Conversa plausível: combinar de jogar, com resposta, menção e reações. */
const CONVERSA: Array<{ autor: string; texto: string; minutosAtras: number }> = [
  { autor: 'joao', texto: 'boa noite pessoal, alguém pra uma ranked hoje?', minutosAtras: 48 },
  { autor: 'bia', texto: 'to dentro, só terminar de jantar aqui', minutosAtras: 45 },
  { autor: 'pedro', texto: 'mesma coisa, me dá uns 20 min', minutosAtras: 43 },
  { autor: 'rafael', texto: 'subi o servidor novo, tá bem mais rápido agora', minutosAtras: 38 },
  {
    autor: 'lucas',
    texto: 'testei aqui e o compartilhamento de tela ficou muito melhor mesmo',
    minutosAtras: 34,
  },
  {
    autor: 'rafael',
    texto: 'troquei o gateway de região, tava em Amsterdã por padrão\ncom o banco em São Paulo isso ia e voltava o Atlântico a cada mensagem',
    minutosAtras: 31,
  },
  { autor: 'joao', texto: '@rafael boa, deu pra sentir a diferença', minutosAtras: 27 },
  { autor: 'bia', texto: 'terminei aqui, bora', minutosAtras: 12 },
  { autor: 'pedro', texto: 'entrando na call', minutosAtras: 9 },
];

const REACOES = [
  { indiceDaMensagem: 5, emoji: '🔥', porQuem: ['joao', 'lucas', 'bia'] },
  { indiceDaMensagem: 5, emoji: '🚀', porQuem: ['pedro'] },
  { indiceDaMensagem: 3, emoji: '👏', porQuem: ['bia', 'pedro'] },
  { indiceDaMensagem: 8, emoji: '👍', porQuem: ['joao'] },
];

async function main() {
  const senha = await hash('demo-dinizcord-123', {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  const servidor = await prisma.server.findFirst({ select: { id: true } });
  if (!servidor) throw new Error('Rode o seed antes: npm run db:seed');

  const canal = await prisma.channel.findFirst({
    where: { serverId: servidor.id, type: 'TEXT', name: 'geral' },
    select: { id: true },
  });
  const canalDeVoz = await prisma.channel.findFirst({
    where: { serverId: servidor.id, type: 'VOICE' },
    select: { id: true },
  });
  if (!canal || !canalDeVoz) throw new Error('Canais não encontrados.');

  const idsPorNome = new Map<string, string>();

  for (const pessoa of PESSOAS) {
    const user = await prisma.user.upsert({
      where: { username: pessoa.username },
      update: {},
      create: {
        email: `${pessoa.username}@dinizcord.local`,
        username: pessoa.username,
        displayName: pessoa.displayName,
        passwordHash: senha,
        avatarColor: pessoa.cor || avatarColorFor(pessoa.username),
        termsAcceptedAt: new Date(),
        termsAcceptedVersion: TERMS_VERSION,
      },
      select: { id: true },
    });

    idsPorNome.set(pessoa.username, user.id);

    await prisma.serverMember.upsert({
      where: { serverId_userId: { serverId: servidor.id, userId: user.id } },
      update: {},
      create: { serverId: servidor.id, userId: user.id, role: 'MEMBER' },
    });
  }

  const dono = await prisma.user.findFirst({
    where: { memberships: { some: { serverId: servidor.id, role: 'OWNER' } } },
    select: { id: true },
  });
  if (dono) idsPorNome.set('rafael', dono.id);

  // Recomeça a conversa do zero a cada execução, para a captura ficar igual.
  await prisma.message.deleteMany({ where: { channelId: canal.id } });

  const criadas: string[] = [];
  for (const linha of CONVERSA) {
    const autorId = idsPorNome.get(linha.autor);
    if (!autorId) continue;

    const mencoes = [...linha.texto.matchAll(/@([a-z0-9._-]+)/gi)]
      .map((m) => idsPorNome.get((m[1] ?? '').toLowerCase()))
      .filter((id): id is string => Boolean(id) && id !== autorId);

    const mensagem = await prisma.message.create({
      data: {
        channelId: canal.id,
        authorId: autorId,
        content: linha.texto,
        createdAt: new Date(Date.now() - linha.minutosAtras * 60_000),
        mentions: mencoes,
      },
      select: { id: true },
    });

    criadas.push(mensagem.id);
  }

  for (const reacao of REACOES) {
    const messageId = criadas[reacao.indiceDaMensagem];
    if (!messageId) continue;

    for (const nome of reacao.porQuem) {
      const userId = idsPorNome.get(nome);
      if (!userId) continue;

      await prisma.messageReaction.upsert({
        where: { messageId_userId_emoji: { messageId, userId, emoji: reacao.emoji } },
        update: {},
        create: { messageId, userId, emoji: reacao.emoji },
      });
    }
  }

  // Presença e voz: linhas efêmeras com heartbeat recente, para a interface
  // mostrar gente online e uma sala de voz ocupada.
  await prisma.presenceSession.deleteMany({ where: { instanceId: 'demo' } });
  await prisma.voiceSession.deleteMany({ where: { instanceId: 'demo' } });

  const online = ['joao', 'bia', 'pedro'];
  for (const nome of online) {
    const userId = idsPorNome.get(nome);
    if (!userId) continue;

    await prisma.presenceSession.create({
      data: {
        id: `demo-presenca-${nome}`,
        userId,
        instanceId: 'demo',
        status: nome === 'pedro' ? 'DO_NOT_DISTURB' : 'ONLINE',
        activity: nome === 'joao' ? 'Jogando Assetto Corsa EVO' : null,
      },
    });
  }

  for (const nome of ['bia', 'pedro']) {
    const userId = idsPorNome.get(nome);
    if (!userId) continue;

    await prisma.voiceSession.create({
      data: {
        id: `demo-voz-${nome}`,
        userId,
        channelId: canalDeVoz.id,
        instanceId: 'demo',
        selfMute: nome === 'pedro',
        screenSharing: nome === 'bia',
      },
    });
  }

  console.log('Conteúdo de demonstração criado.');
  console.log(`  ${CONVERSA.length} mensagens, ${REACOES.length} grupos de reação`);
  console.log(`  ${online.length} pessoas online, 2 em chamada`);
}

main()
  .catch((erro: unknown) => {
    console.error('Falhou:', erro);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
