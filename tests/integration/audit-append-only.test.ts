/**
 * A garantia central do projeto, provada contra um banco de verdade.
 *
 * O resto da suíte conecta como dono do banco, que pode tudo — então nenhum
 * teste até aqui mostrava que o papel da aplicação *não* pode alterar o log.
 * Esconder o botão de editar na tela, ou não escrever o UPDATE no código, não
 * é a defesa: a defesa é o papel não ter o privilégio. É isso que se verifica
 * aqui, conectando com as credenciais que a aplicação usa de verdade.
 *
 * O teste também prova o contrário em seguida — que o mesmo papel escreve
 * normalmente numa tabela comum. Sem esse par, um papel sem acesso nenhum
 * passaria por "append-only" e o log estaria protegido por estar quebrado.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * As credenciais da aplicação, preparadas por `setup.ts` antes de ele trocar
 * `DATABASE_URL` pela do banco de teste. Uma variável a mais no `.env` seria
 * uma variável a mais para alguém esquecer — e um teste de privilégio que não
 * roda por falta de configuração é pior do que não existir.
 */
function appUrlForTestDatabase(): string {
  const url = process.env.TEST_APP_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_APP_DATABASE_URL não definida: ela é derivada de DATABASE_URL em " +
        "tests/integration/setup.ts. Confira o .env.local.",
    );
  }
  return url;
}

const PERMISSION_DENIED = "42501";

describe("audit_logs é append-only para o papel da aplicação", () => {
  let client: postgres.Sql;

  beforeAll(() => {
    client = postgres(appUrlForTestDatabase(), { max: 1, onnotice: () => {} });
  });

  afterAll(async () => {
    await client?.end();
  });

  it("o papel conectado é o da aplicação, não o dono do banco", async () => {
    // Se a suíte rodasse como dono, todo o resto deste arquivo passaria à toa.
    const [row] = await client`select current_user, usesuper from pg_user where usename = current_user`;
    expect(row?.usesuper).toBe(false);
  });

  it("escreve e lê o log", async () => {
    const inserted = await client`
      insert into audit_logs (entity_type, entity_id, action, field, new_value)
      values ('product', gen_random_uuid(), 'create', 'name', 'Produto')
      returning id
    `;
    expect(inserted).toHaveLength(1);

    const read = await client`select id from audit_logs where id = ${inserted[0]!.id}`;
    expect(read).toHaveLength(1);
  });

  it("não altera o que já foi gravado", async () => {
    await expect(
      client`update audit_logs set new_value = 'adulterado'`,
    ).rejects.toMatchObject({ code: PERMISSION_DENIED });
  });

  it("não apaga o que já foi gravado", async () => {
    await expect(client`delete from audit_logs`).rejects.toMatchObject({
      code: PERMISSION_DENIED,
    });
    await expect(client`truncate table audit_logs`).rejects.toMatchObject({
      code: PERMISSION_DENIED,
    });
  });

  it("vale igual para o log de acesso", async () => {
    await expect(client`update access_logs set success = true`).rejects.toMatchObject({
      code: PERMISSION_DENIED,
    });
    await expect(client`delete from access_logs`).rejects.toMatchObject({
      code: PERMISSION_DENIED,
    });
  });

  it("continua escrevendo normalmente numa tabela comum", async () => {
    // O contraponto: a restrição é dirigida ao log, não um papel sem acesso.
    const [enumValue] = await client`
      insert into enum_values (kind, code, label, sort_order)
      values ('task_category', ${`teste-${Date.now()}`}, 'Teste', 999)
      returning id
    `;
    await client`update enum_values set label = 'Teste alterado' where id = ${enumValue!.id}`;
    await client`delete from enum_values where id = ${enumValue!.id}`;
  });
});
