/** Integration tests run against TEST_DATABASE_URL; never the development one. */
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL não definida — veja .env.example.");
}

/**
 * As credenciais da aplicação, guardadas antes de `DATABASE_URL` ser trocada.
 *
 * A suíte conecta como dono do banco, que pode tudo — é o que permite limpar
 * as tabelas entre os testes. Mas provar que o log é append-only exige
 * conectar como a aplicação conecta, e a URL dela desaparece na linha
 * seguinte. Então o usuário e a senha de `DATABASE_URL` são combinados com o
 * host e o banco de `TEST_DATABASE_URL` e guardados aqui.
 */
if (!process.env.TEST_APP_DATABASE_URL && process.env.DATABASE_URL) {
  const app = new URL(process.env.DATABASE_URL);
  const test = new URL(process.env.TEST_DATABASE_URL);
  test.username = app.username;
  test.password = app.password;
  process.env.TEST_APP_DATABASE_URL = test.toString();
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
// NODE_ENV is typed read-only by @types/node; assign through the record.
(process.env as Record<string, string>).NODE_ENV = "test";
