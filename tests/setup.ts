import 'dotenv/config';
import { testDatabaseUrl } from './helpers/db';

/**
 * Executado em cada worker antes dos testes.
 *
 * Redireciona o DATABASE_URL para o banco de testes ANTES de qualquer import de
 * módulo da aplicação, e garante um AUTH_SECRET determinístico para que hashes
 * de sessão sejam estáveis entre execuções.
 */
// `NODE_ENV` é somente-leitura nos tipos do Node; a atribuição em runtime é
// válida e necessária aqui.
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl();
process.env.AUTH_SECRET ??= 'segredo-de-teste-com-tamanho-mais-que-suficiente-1234567890';
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
process.env.LOG_LEVEL = 'silent';
