/**
 * Readiness: a aplicação consegue atender — ou seja, o banco responde.
 *
 * É esta que o proxy e o monitoramento consultam antes de mandar tráfego, e
 * **não** a que decide reiniciar o container: a separação existe para que uma
 * queda do banco apareça como indisponibilidade, e não vire um laço de
 * reinícios da aplicação, que não resolveria nada.
 *
 * Fica fora da autenticação, como a de liveness, e por isso não diz mais do
 * que pronto ou não pronto — a causa vai para o log do servidor.
 */
import { sql } from "drizzle-orm";
import { db } from "@db";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "pronto" }, { headers });
  } catch (error) {
    console.error("readiness: banco não respondeu", error);
    return Response.json({ status: "indisponivel" }, { status: 503, headers });
  }
}
