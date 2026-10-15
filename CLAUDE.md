# CLAUDE.md — convenções do projeto

Aplicação de gestão e acompanhamento do ciclo de vida de produtos para uma empresa de tecnologia.

## Idioma

- **Interface, labels, mensagens de erro, moeda e datas: português do Brasil.** `R$ 1.234,56`, `15/03/2024`, vírgula decimal. Tudo passa por `src/lib/format.ts` — não reescreva `Intl` em componente.
- **Código, tabelas, colunas, variáveis, funções e comentários: inglês.**
- Traduções dos domínios fixos ficam em `src/lib/labels.ts`. Domínios que o usuário administra vêm da tabela `enum_values` e não têm tradução no código.

## Stack

| Camada | Escolha | Por quê |
|---|---|---|
| Framework | Next.js 15 (App Router), React 19 | Server Components e Server Actions — validação e autorização no servidor sem uma camada de API à parte |
| Linguagem | TypeScript strict, com `noUncheckedIndexedAccess` | |
| Banco | PostgreSQL 16 no cluster local, **porta 5433** | Tipos nativos `numeric`, `date`, `jsonb`, `enum` |
| ORM | Drizzle ORM + postgres.js | Tipos derivados do schema; migrations em SQL versionado |
| Auth | Sessão própria: tabela `sessions` + cookie HttpOnly, senha em bcryptjs custo 12 | Sem dependência em beta; testável em integração |
| Validação | Zod, em `src/lib/schemas/` | O **mesmo** schema valida no cliente e no servidor |
| UI | Tailwind 3 + Radix UI + lucide-react | |
| Gráficos | Recharts | |
| Kanban | @dnd-kit | Traz sensor de teclado — a acessibilidade não é código paralelo |
| Gantt | Componente próprio | Nenhuma biblioteca livre entrega dependências + caminho crítico + arrastar |
| Testes | Vitest (`unit` e `integration`) | |

## Ambiente desta máquina

Node **não está no PATH**. Antes de qualquer `npm`:

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-arm64/bin:$PATH"
```

O cluster Postgres **não é serviço e não sobe sozinho após reiniciar**. Quando o app responder erro genérico de Server Component ou o log mostrar `ECONNREFUSED`, **cheque o banco antes do código**. O `predev` já faz isso: `npm run dev` chama `scripts/ensure-db.sh`, que sobe o cluster se estiver parado.

## Comandos

```bash
npm run db:setup      # uma vez: cria o papel portfolio_app e os bancos portfolio e portfolio_test
npm run db:generate   # gera nova migration SQL a partir de db/schema.ts
npm run db:migrate    # aplica migrations + reaplica os grants do papel da aplicação
npm run db:seed       # popula configurações, enums, usuários e dados demonstrativos
npm run db:seed:jira  # limpa os dados de produto e importa o quadro Roadmap do Jira
npm run db:packages:jira  # deriva os pacotes "Novo Produto" e "Nova Release" dos épicos
npm run db:seed:example   # um produto fictício com dados completos, para o painel ter o que mostrar
npm run setup:pptx    # venv com python-pptx, exigida pela exportação de status em PowerPoint
npm run db:reset      # derruba o schema, migra e semeia de novo (destrutivo)

npm run dev           # sobe o banco se preciso e roda o Next em desenvolvimento
npm run build         # build de produção
npm run typecheck
npm run lint
npm run test          # unitários (motor de cálculo)
npm run test:integration  # integração (auth e autorização), usa portfolio_test
npm run test:all
```

## Convenções

**Dinheiro** é `numeric(14,2)` no banco, lido como `number` (`mode: "number"`). Nunca `float`, nunca `string` circulando pelo motor de cálculo.

**Datas** de competência e prazo são `date` lidas como `"YYYY-MM-DD"` — competência é mês, não instante. Só auditoria usa `timestamptz`. Aritmética de data é feita com os helpers de `src/lib/format.ts` (`addDaysToIso`, `addMonthsToCompetence`, `daysBetween`), que trabalham em horário local: `new Date(iso)` interpreta como UTC e desloca o dia.

**Motor de cálculo** (`src/lib/engine/`) é feito de funções **puras**: recebem dados simples, devolvem números e o racional. Nenhuma toca no banco. Query fica em `src/lib/queries/`, cálculo fica no motor. É essa separação que deixa o motor coberto por teste unitário sem subir banco.

**Autorização** é verificada no servidor, em toda server action e todo route handler, via `src/lib/auth/guard.ts`. Esconder o botão na UI é consequência, nunca a defesa.

**Auditoria** é append-only e garantida pelo banco: o papel `portfolio_app` só tem `INSERT` e `SELECT` em `audit_logs` e `access_logs` (`scripts/grant-app.sql`, reaplicado a cada `db:migrate`). Se uma tabela nova precisar de escrita pela aplicação, o grant entra nesse arquivo.

**Nada de tela branca.** Toda rota tem estado de carregamento, de erro e de vazio — e o estado vazio diz o que fazer, não só que não há dados (`src/components/ui/states.tsx`).

**Uma regra, um lugar.** Se duas telas precisam da mesma conta, a conta vai para `src/lib/engine/` e as duas a importam. Escrever a regra inline "só desta vez" já custou caro uma vez: o painel executivo tinha a própria versão da realização de meta, ignorava o período da meta e devolvia zero onde a página do produto devolvia nulo — o mesmo produto lia diferente dependendo de onde se olhava. A regra voltou para `engine/goals.ts`.

**O que não pode ser medido devolve `null`, nunca zero.** Ausência de dado não é resultado ruim. Um produto sem nenhum mês de venda não atingiu 0% da meta: ele não tem meta medida. Isso vale em toda a cadeia — ROI sem custo, projeção sem receita, componente de saúde sem insumo, payback sem resultado recorrente positivo. Componente nulo sai da média com os pesos renormalizados, e quando sobra menos da metade do peso o Health Score inteiro passa a "sem medição" (`MIN_HEALTH_COVERAGE`). Um 100 construído sobre o único componente disponível é o número mais enganoso que o sistema poderia mostrar.

**Importação não inventa dado.** O `db:seed:jira` traz produtos e tarefas do quadro Roadmap e para por aí: o Jira não guarda receita, custo, meta nem plano, então nada disso é escrito. Os produtos entram com a saúde em "sem medição" — e é essa a resposta certa. Uma importação que preenche o que falta com números plausíveis transforma o painel em ficção com aparência de relatório.

**O deck de status não é desenhado aqui.** A rota monta o spec `plano-entregas` e um gerador externo, em `vendor/deck/`, desenha a partir do Master da marca. O diretório vem vazio: template e gerador são material de cada empresa e não acompanham o repositório — o contrato está no README de lá. Redesenhar o slide à mão sai parecido e errado — fonte, margem e paleta trocadas — e "parecido" é exatamente o que um padrão de marca existe para impedir. O gerador avisa (`AVISO:`) quando um texto estoura a caixa: **nenhum aviso é aceitável na entrega**, porque cada um deles é um pedaço de texto cortado no slide.

**Uma exportação não pode discordar da tela.** A tabela de entregas, o PowerPoint e o status em texto saem todos de `engine/status-report.ts`, sobre as tarefas **filtradas na tela**. Exportar um recorte diferente do que o autor acabou de olhar é entregar um status que ninguém conferiu. O que o motor não sabe — o impacto de cada item, o porquê de ele importar — ele não escreve: sai um rascunho que diz, no rodapé, o que falta acrescentar.

**Toda recomendação carrega o racional e a evidência.** `Recommendation` devolve `rationale: string[]` e `evidence: {label, value}[]`, e a tela mostra os dois. Recomendação que ninguém pode contestar é recomendação que ninguém deveria obedecer — e nenhuma delas é executada pelo sistema: o usuário registra a decisão.

## Armadilhas já encontradas

Cada uma destas custou tempo; estão aqui para não custarem de novo.

**`<title>` dentro de `<svg>` quebra a hidratação.** O React 19 trata `<title>` como metadado de documento e o hoista, então o servidor manda a tag vazia e o cliente a preenche. Use `aria-label` no elemento e, se o número precisa ser lido, uma linha de texto ao lado do gráfico — que serve mouse e teclado.

**`Intl` com `notation: "compact"` diverge entre Node e navegador.** O ICU de cada runtime formata diferente ("R$ 0" contra "R$ 0,0") e o resultado é erro de hidratação. `formatCurrencyCompact` é escrita à mão por isso.

**Subconsulta correlacionada precisa de nome de tabela qualificado.** `(select count(*) from task_templates t where t.package_id = ${taskPackages.id})` liga o `id` à tabela interna e conta sempre zero, sem erro nenhum. Escreva `task_packages.id` literal.

**Componentes do dnd-kit precisam de `id` estável.** Sem ele os `aria-describedby` diferem entre servidor e cliente.

**`"use server"` exige que todo export do arquivo seja `async`.** Um helper puro no meio de um arquivo de actions derruba o build — e o teste não pega, só o navegador.

**Checkbox desmarcada não envia nada.** `z.coerce.boolean().default(true)` faz o desmarcar não ter efeito; o padrão tem de ser `false`.

**`db:reset` também derruba o schema `drizzle`.** Ele guarda o diário de migrations; sobrevivendo ao `DROP SCHEMA public`, o drizzle acredita que tudo já foi aplicado e deixa o banco vazio atrás de um reset bem-sucedido.

**Contraste de cor de status é requisito, não enfeite.** Verde e âmbar vivos reprovam em texto pequeno sobre branco (3,77:1 e 2,94:1). A paleta de `globals.css` e as cores de fase em `labels.ts` estão todas em 3:1 ou melhor — quando a informação está na cor, quem não enxerga a cor não recebe a informação.

**`npm run build` com o `npm run dev` no ar corrompe o `.next`.** Os dois escrevem no mesmo diretório: o dev server passa a responder 500 com `Cannot find module './NNN.js'`, e o build falha em `Failed to collect page data`. Pare o dev server, `rm -rf .next` e rode de novo.

**A contagem D é em dias úteis, e o D0 é uma tarefa.** "Faltam 3 dias" tem de querer dizer três dias de trabalho; num fim de semana a diferença entre dias úteis e corridos é a diferença entre chegar e não chegar. E o D0 sai da entrega que é o lançamento (`findLaunchTask`), não da data cadastrada no produto: o plano gira em torno do dia em que a coisa sobe, e esse dia é um card que alguém move no quadro. Feriados não entram — a aplicação não tem calendário deles, e inventar um nacional para uma empresa em vários estados erraria em silêncio. A nota de rodapé do slide diz isso.

**Verificação no navegador exige aba nova.** As mensagens de console se acumulam por aba, e leitura de DOM por `javascript_tool` pega instantâneo velho. Clique de verdade e captura de tela são a checagem confiável.

## Estrutura

```
db/
  schema.ts          modelo de dados inteiro
  migrations/        SQL versionado gerado pelo drizzle-kit
  seed/              enums, usuários e dados demonstrativos
    jira-roadmap.json  extrato de exemplo de um quadro externo (fictício)
    jira.ts            importa esse extrato para o modelo da aplicação
    packages-jira.ts   deriva pacotes de tarefas dos épicos de lançamento
    example.ts         um produto fictício, rotulado como tal no próprio nome
scripts/
  ensure-db.sh       sobe o cluster se estiver parado (roda no predev)
  setup-db.sh        cria papel e bancos
  grant-app.sql      grants do papel da aplicação, com audit_logs append-only
src/
  app/               rotas (App Router); (app) é o shell autenticado
  components/        ui/ primitivos, layout/ navegação
  lib/
    engine/          cálculo puro: ROI, projeção, health, recomendação, cronograma, metas
    insights-engine/ sugestões a partir dos comentários, atrás de uma interface
    queries/         leitura do banco
    schemas/         zod compartilhado cliente/servidor
    auth/            sessão e autorização
    format.ts        formatação pt-BR
    labels.ts        rótulos dos domínios fixos
tests/
  unit/              motor de cálculo
  integration/       auth e autorização, contra portfolio_test
```
