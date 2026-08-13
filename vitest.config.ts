import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // `server-only` lança ao ser importado fora do bundler do Next. Nos testes
      // (Node puro) apontamos para o stub vazio que o próprio pacote fornece.
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    globalSetup: ['tests/global-setup.ts'],
    // Os testes de integração compartilham um banco PostgreSQL real; rodar em
    // paralelo causaria interferência entre suites.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['lib/**/*.ts', 'server/**/*.ts', 'app/api/**/*.ts'],
      exclude: ['lib/db/generated/**'],
    },
  },
});
