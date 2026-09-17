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

## Estrutura

```
db/
  schema.ts          modelo de dados inteiro
  migrations/        SQL versionado gerado pelo drizzle-kit
  seed/              enums, usuários e dados demonstrativos
scripts/
  ensure-db.sh       sobe o cluster se estiver parado (roda no predev)
  setup-db.sh        cria papel e bancos
  grant-app.sql      grants do papel da aplicação, com audit_logs append-only
src/
  app/               rotas (App Router); (app) é o shell autenticado
  components/        ui/ primitivos, layout/ navegação
  lib/
    engine/          cálculo puro: ROI, projeção, health, recomendação, cronograma
    queries/         leitura do banco
    schemas/         zod compartilhado cliente/servidor
    auth/            sessão e autorização
    format.ts        formatação pt-BR
    labels.ts        rótulos dos domínios fixos
tests/
  unit/              motor de cálculo
  integration/       auth e autorização, contra portfolio_test
```
