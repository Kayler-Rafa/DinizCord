import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * Configuração do ESLint (flat config).
 *
 * O `eslint-config-next` já expõe flat configs prontos, então não há necessidade
 * do `FlatCompat` — que, com este pacote, quebra por referência circular.
 */
const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'coverage/**',
      '.pgdata/**',
      'lib/db/generated/**',
      'next-env.d.ts',
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypescript,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // O logger estruturado é o caminho oficial no backend; console fica para
      // avisos reais no navegador.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },

  {
    // Scripts operacionais e seed rodam no terminal: console é a saída correta.
    files: ['scripts/**/*.{ts,mjs}', 'prisma/seed.ts'],
    rules: { 'no-console': 'off' },
  },
];

export default config;
