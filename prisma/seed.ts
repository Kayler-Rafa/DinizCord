import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import { createPrismaClient } from '../lib/db/factory';
import { avatarColorFor, slugifyChannelName } from '../lib/utils';

/**
 * Seed idempotente.
 *
 * Roda quantas vezes for preciso sem duplicar nada: tudo usa `upsert` ou checa
 * existência antes. Isso importa porque o seed é parte do fluxo de setup
 * (`npm run db:seed`) e alguém vai rodá-lo duas vezes.
 *
 * Credenciais do dono podem ser sobrescritas por variáveis de ambiente:
 *   SEED_OWNER_EMAIL, SEED_OWNER_USERNAME, SEED_OWNER_PASSWORD, SEED_OWNER_NAME
 */

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? 'rafael@dinizcord.local';
const OWNER_USERNAME = process.env.SEED_OWNER_USERNAME ?? 'rafael';
const OWNER_NAME = process.env.SEED_OWNER_NAME ?? 'Rafael';
const OWNER_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'dinizcord2026';

/**
 * A senha padrão só serve para desenvolvimento local.
 *
 * Este repositório é público: qualquer pessoa lê o valor acima. Semear uma
 * instância exposta na internet com ele entregaria a conta do dono a quem
 * descobrisse a URL. Por isso, em produção a senha tem de ser informada.
 */
if (process.env.NODE_ENV === 'production' && !process.env.SEED_OWNER_PASSWORD) {
  console.error('');
  console.error('  Recusando semear em produção com a senha padrão.');
  console.error('  A senha padrão está no código-fonte e é pública.');
  console.error('');
  console.error('  Rode novamente definindo as credenciais do dono:');
  console.error('    SEED_OWNER_EMAIL="voce@exemplo.com" \\');
  console.error('    SEED_OWNER_PASSWORD="uma-senha-com-10-ou-mais" \\');
  console.error('    npm run db:seed');
  console.error('');
  process.exit(1);
}

const SERVER_NAME = 'Amigos';

const CHANNELS = [
  { name: 'geral', type: 'TEXT' as const, topic: 'Conversa do dia a dia', position: 0 },
  { name: 'memes', type: 'TEXT' as const, topic: 'Só o que presta', position: 1 },
  { name: 'jogos', type: 'TEXT' as const, topic: 'Combinando as partidas', position: 2 },
  { name: 'programacao', type: 'TEXT' as const, topic: 'Código, dúvidas e achados', position: 3 },
  { name: 'Geral', type: 'VOICE' as const, topic: null, position: 0 },
  { name: 'Jogos', type: 'VOICE' as const, topic: null, position: 1 },
];

async function main() {
  const prisma = createPrismaClient({ maxConnections: 2 });

  try {
    const passwordHash = await hash(OWNER_PASSWORD, {
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: {
        email: OWNER_EMAIL,
        username: OWNER_USERNAME,
        displayName: OWNER_NAME,
        passwordHash,
        avatarColor: avatarColorFor(OWNER_USERNAME),
      },
      select: { id: true, username: true },
    });

    const slug = slugifyChannelName(SERVER_NAME) || 'amigos';

    const server = await prisma.server.upsert({
      where: { slug },
      update: {},
      create: {
        name: SERVER_NAME,
        slug,
        iconEmoji: '🏠',
        ownerId: owner.id,
      },
      select: { id: true, name: true },
    });

    await prisma.serverMember.upsert({
      where: { serverId_userId: { serverId: server.id, userId: owner.id } },
      update: { role: 'OWNER' },
      create: { serverId: server.id, userId: owner.id, role: 'OWNER' },
    });

    for (const channel of CHANNELS) {
      await prisma.channel.upsert({
        where: {
          serverId_type_name: { serverId: server.id, type: channel.type, name: channel.name },
        },
        update: { topic: channel.topic, position: channel.position },
        create: {
          serverId: server.id,
          name: channel.name,
          type: channel.type,
          topic: channel.topic,
          position: channel.position,
        },
      });
    }

    const textChannels = CHANNELS.filter((channel) => channel.type === 'TEXT').length;
    const voiceChannels = CHANNELS.length - textChannels;

    console.log('');
    console.log('  Seed concluído.');
    console.log('  ─────────────────────────────────────────────');
    console.log(`  Servidor : ${server.name}`);
    console.log(`  Canais   : ${textChannels} de texto, ${voiceChannels} de voz`);
    console.log(`  Dono     : ${OWNER_NAME} (@${owner.username})`);
    console.log('');
    console.log('  Credenciais de acesso:');
    console.log(`    e-mail : ${OWNER_EMAIL}`);
    console.log(`    senha  : ${OWNER_PASSWORD}`);
    console.log('');
    console.log('  Troque a senha após o primeiro login.');
    console.log('');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Falha ao executar o seed:', error);
  process.exit(1);
});
