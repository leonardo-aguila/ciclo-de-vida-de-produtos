/**
 * Reapplies the application role's grants.
 *
 * This is what makes the audit trail append-only at the database level: the
 * role `portfolio_app` gets DML everywhere except `audit_logs` and
 * `access_logs`, where it may only INSERT and SELECT. A new table created by a
 * migration would otherwise be unreachable by the application, so it runs
 * after every migration.
 *
 * It runs through postgres.js rather than the `psql` binary. The previous
 * version shelled out to a hard-coded Postgres.app path, fell back to `psql`
 * on the PATH, and — when neither existed — printed a warning and carried on.
 * That failure mode is the dangerous one: when the role already exists from an
 * earlier run with wider privileges, nothing breaks, nothing complains, and
 * the audit log quietly stops being immutable. The guarantee the whole project
 * rests on would be gone with a warning nobody reads.
 *
 * So: no external binary, and a failure here is an error, never a warning.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

export const GRANTS_FILE = "scripts/grant-app.sql";

/** O papel da aplicação, como está escrito no SQL dos grants. */
const APP_ROLE = "portfolio_app";

/** Tabelas em que o papel só pode acrescentar, nunca alterar nem apagar. */
const APPEND_ONLY_TABLES = ["audit_logs", "access_logs"];

export async function applyGrants(url: string, file = GRANTS_FILE): Promise<void> {
  const sql = readFileSync(file, "utf8");
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    try {
      // Several statements in one go: postgres.js uses the simple query
      // protocol when there are no parameters, which accepts them.
      await client.unsafe(sql);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `não foi possível aplicar os grants de ${file}: ${reason}\n` +
          "Sem eles o papel da aplicação fica sem acesso às tabelas — ou, pior, " +
          "mantém o acesso largo de antes e audit_logs deixa de ser append-only. " +
          "Confira se o papel portfolio_app existe (npm run db:setup).",
      );
    }
    // Fora do catch acima de propósito: o que a verificação encontra já vem
    // com a explicação certa, e embrulhá-la em "não foi possível aplicar"
    // apontaria para o lado errado do problema.
    await assertAppendOnly(client);
  } finally {
    await client.end();
  }
}

/**
 * Confere o estado final, porque aplicar o SQL não prova que ele fez efeito.
 *
 * `GRANT` e `REVOKE` emitidos por quem não tem direito sobre a tabela não dão
 * erro: o Postgres emite um **aviso** e segue. Quer dizer que rodar os grants
 * com a URL errada — a da própria aplicação, por exemplo, em vez da do dono —
 * termina com "grants aplicados" na tela e nada aplicado no banco. Essa é a
 * mesma falha silenciosa que o `psql` ausente causava, só que por outro
 * caminho, e é por isso que a verificação vem logo depois.
 *
 * O que se afirma é o par: o papel escreve no log e **não** consegue alterar
 * nem apagar o que escreveu. Só a segunda metade deixaria passar um papel sem
 * acesso nenhum.
 */
async function assertAppendOnly(client: postgres.Sql): Promise<void> {
  const rows = await client<{ table_name: string; privilege_type: string }[]>`
    select table_name, privilege_type
      from information_schema.table_privileges
     where grantee = ${APP_ROLE}
       and table_schema = 'public'
       and table_name in ${client(APPEND_ONLY_TABLES)}
  `;

  for (const table of APPEND_ONLY_TABLES) {
    const granted = new Set(
      rows.filter((row) => row.table_name === table).map((row) => row.privilege_type),
    );
    if (granted.size === 0) {
      throw new Error(
        `o papel ${APP_ROLE} não tem privilégio nenhum em ${table} — ` +
          "o papel existe? os grants foram aplicados com a URL do dono do banco?",
      );
    }
    for (const forbidden of ["UPDATE", "DELETE", "TRUNCATE"]) {
      if (granted.has(forbidden)) {
        throw new Error(
          `o papel ${APP_ROLE} ainda tem ${forbidden} em ${table}: o log não é append-only. ` +
            "Os grants foram aplicados por um papel sem direito sobre a tabela " +
            "(GRANT/REVOKE indevido vira aviso, não erro).",
        );
      }
    }
    if (!granted.has("INSERT") || !granted.has("SELECT")) {
      throw new Error(`o papel ${APP_ROLE} precisa de INSERT e SELECT em ${table}.`);
    }
  }
}
