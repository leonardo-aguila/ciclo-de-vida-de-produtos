# portfolio

Gestão e acompanhamento do ciclo de vida de produtos: concepção ao sunset, com visão
financeira, de execução e de saúde de cada produto, e um painel executivo que consolida
o portfólio.

## Requisitos

- Node 22+ — nesta máquina está em `~/.local/node-v22.23.2-darwin-arm64/bin`, **fora do PATH**
- PostgreSQL 16 (Postgres.app), cluster local em `~/.local/pgdata-ponteiro`, porta **5433**

## Setup

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-arm64/bin:$PATH"
npm install
cp .env.example .env.local
npm run db:setup      # cria o papel portfolio_app e os bancos portfolio e portfolio_test
npm run db:migrate
npm run db:seed
npm run dev           # http://localhost:3000
```

`npm run dev` sobe o cluster Postgres automaticamente se ele estiver parado — ele não é
serviço e não volta sozinho depois de reiniciar a máquina.

## Credenciais do seed

| Login | Senha | Perfil |
|---|---|---|
| `admin` | `***SENHA-REMOVIDA***` | Administrador |
| `marina` | `***SENHA-REMOVIDA***` | Gestor de produto |
| `rafael` | `***SENHA-REMOVIDA***` | Gestor de produto |
| `camila` | `***SENHA-REMOVIDA***` | Colaborador |
| `paulo` | `***SENHA-REMOVIDA***` | Executivo |

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Desenvolvimento (sobe o banco antes) |
| `npm run build` | Build de produção |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` | Testes unitários do motor de cálculo |
| `npm run test:integration` | Testes de integração de autenticação e autorização |
| `npm run db:generate` | Gera migration a partir de `db/schema.ts` |
| `npm run db:migrate` | Aplica migrations e reaplica grants |
| `npm run db:seed` | Popula o banco |
| `npm run db:reset` | Recria o schema do zero (destrutivo) |

## Arquitetura

Next.js 15 (App Router) com Server Components e Server Actions; PostgreSQL com Drizzle ORM
e migrations SQL versionadas; autenticação por sessão própria (tabela + cookie HttpOnly,
senha em bcrypt). O cálculo — ROI, projeções, payback, Health Score, recomendação de
continuidade — vive em `src/lib/engine/` como funções puras, sem acesso a banco, e é por
isso que é coberto por teste unitário. As convenções estão em [CLAUDE.md](CLAUDE.md).

A trilha de auditoria é append-only garantida pelo banco: o papel da aplicação só tem
`INSERT` e `SELECT` em `audit_logs`.

## Nota sobre dependências

`npm audit` acusa duas advisories transitivas (`postcss` e `esbuild`) que vêm de dentro do
próprio Next 15 e só se resolvem subindo para o Next 16. São de build, não de runtime, e a
aplicação roda local. As demais foram corrigidas subindo as versões diretas.
