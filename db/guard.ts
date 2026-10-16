/**
 * Recusa, em produção, os comandos que escrevem dado fictício ou apagam dado real.
 *
 * O `db:reset` já tinha essa trava em linha; os outros não tinham nenhuma — e
 * são piores do que ele num ponto: não parecem destrutivos. `db:seed` cria
 * usuários fictícios com senha conhecida, e `db:seed:jira` limpa os produtos
 * antes de importar. Rodar qualquer um dos dois por engano contra o banco
 * publicado é um incidente, não um contratempo, e a diferença entre "banco de
 * desenvolvimento" e "banco de produção" numa linha de comando é uma variável
 * de ambiente que ninguém relê.
 */
export function refuseInProduction(command: string): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `${command} não roda em produção: ele escreve dado fictício ou apaga dado real. ` +
        "Para povoar um ambiente publicado, use um seed próprio de produção.",
    );
  }
}
