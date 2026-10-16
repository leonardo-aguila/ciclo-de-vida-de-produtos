/**
 * Liveness: o processo está de pé e respondendo.
 *
 * Não toca no banco de propósito. Esta é a rota que um orquestrador usa para
 * decidir **reiniciar o container**, e reiniciar a aplicação não conserta um
 * banco fora do ar — só transforma uma oscilação do Postgres numa sucessão de
 * reinícios que derruba quem ainda conseguiria navegar. Para saber se dá para
 * atender requisição de verdade, use /api/saude/pronto.
 *
 * Fica fora da autenticação: quem chama é o healthcheck, que não tem sessão.
 * Por isso não devolve versão, nome de host nem nada que ajude quem estiver
 * sondando de fora.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
