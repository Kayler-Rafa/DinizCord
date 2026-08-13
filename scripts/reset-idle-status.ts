/**
 * Corrige perfis que ficaram gravados como "ausente".
 *
 * Antes da distinção entre status escolhido e ausência automática, o "ausente
 * por inatividade" era persistido em `User.preferredStatus` — e a pessoa voltava
 * ausente em todo login. Este script normaliza os registros afetados.
 *
 * Uso: npx tsx scripts/reset-idle-status.ts
 */
import 'dotenv/config';
import { createPrismaClient } from '../lib/db/factory';

const prisma = createPrismaClient({ maxConnections: 2 });

try {
  const { count } = await prisma.user.updateMany({
    where: { preferredStatus: 'IDLE' },
    data: { preferredStatus: 'ONLINE' },
  });

  console.log(`Perfis normalizados: ${count}`);
} finally {
  await prisma.$disconnect();
}
