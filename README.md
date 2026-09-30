# portfolio

Aplicação web para gerir e acompanhar o **ciclo de vida de produtos** de uma empresa de tecnologia: cadastro, metas, finanças, execução, Business Plan, saúde do produto e recomendação de continuidade — com um painel executivo que consolida o portfólio inteiro.

A pergunta que o sistema existe para responder é uma só: **faz sentido continuar investindo neste produto?** Ele responde com número, racional e evidência — e **nunca executa a decisão**. Quem decide é o usuário, e a decisão fica no histórico do produto.

---

## Subir o projeto

Pré-requisitos: **Node 22+** e **PostgreSQL 16** rodando na porta **5433**.

```bash
npm install
npm run db:setup     # cria o papel portfolio_app e os bancos portfolio e portfolio_test
npm run db:migrate   # aplica as migrations e os grants
npm run db:seed      # popula configurações, usuários e os 5 produtos demonstrativos
npm run dev          # http://localhost:3000
```

Depois disso, `npm run dev` é o **único comando** necessário no dia a dia: ele roda `scripts/ensure-db.sh` antes de subir, que verifica o cluster e o inicia se estiver parado.

Para recomeçar do zero a qualquer momento:

```bash
npm run db:reset
```

### Nesta máquina

O Node **não está no PATH** e o cluster Postgres **não é serviço** — não sobe sozinho depois de reiniciar. Antes de qualquer `npm`:

```bash
export PATH="$HOME/.local/node-v22.23.2-darwin-arm64/bin:$PATH"
```

O cluster fica em `~/.local/pgdata-ponteiro`, na porta 5433. O `predev` cuida de subi-lo; se algum comando de banco falhar com `ECONNREFUSED`, rode `bash scripts/ensure-db.sh`.

### Variáveis de ambiente

Copie `.env.example` para `.env.local`. São três:

| Variável | Para quê |
|---|---|
| `DATABASE_URL` | conexão da aplicação, como o papel **não-superusuário** `portfolio_app` |
| `MIGRATION_DATABASE_URL` | conexão das migrations e do seed, como o dono do banco |
| `TEST_DATABASE_URL` | banco `portfolio_test`, usado pelos testes de integração |

A separação entre as duas primeiras não é cerimônia: é o que torna o log de auditoria **append-only de verdade**. O papel `portfolio_app` tem apenas `INSERT` e `SELECT` em `audit_logs` e `access_logs`, então nem um bug nem uma server action mal escrita conseguem apagar uma linha do log.

---

## Acesso

O seed cria um administrador, `admin`. **A senha não está neste repositório** — ela é definida no momento do seed e impressa no terminal, ou rotacionada depois. Se você perdeu a sua:

```bash
npm run db:seed         # RESET_USERS=1 para recriar o admin do zero
```

Os responsáveis importados do Jira aparecem como usuários **inativos**: existem para serem citados como donos de produto e não conseguem entrar no sistema.

Para ver a autorização funcionando com papéis diferentes, crie usuários em `/usuarios` — `product_manager` edita os produtos que possui, `collaborator` só o que lhe é atribuído e `executive` é somente leitura. O importante é que a UI esconder o botão é consequência: o servidor recusa a mutação de qualquer jeito.

---

## O que vem no seed

Cinco produtos em pontos diferentes do ciclo de vida, com 13 a 24 meses de histórico, escolhidos para que cada caso interessante esteja a um clique:

| Código | Fase | Situação | Recomendação |
|---|---|---|---|
| `SKY-LAKE` | Maturidade | Saudável, ROI de 60%, meta em dia | **Escalar** |
| `SKY-SHIELD` | Crescimento | Cresce rápido, ainda pagando o CAPEX | **Manter** |
| `SKY-VM` | Declínio | ROI −42%, receita em queda há 23 meses | **Descontinuar** |
| `SKY-AIOPS` | Desenvolvimento | Pré-lançamento, sem nenhuma venda | Observar |
| `SKY-COPILOT` | Concepção | Criado há poucos dias, sem histórico | *sem medição* |

Os dois últimos existem para mostrar como o sistema se comporta **sem dados**: o `SKY-COPILOT` não recebe um Health Score inventado, recebe "sem medição" e a explicação do que falta cadastrar.

O seed é ancorado no mês atual, então continua atual por mais tempo que passe entre escrevê-lo e rodá-lo.

---

## Importar do Jira

O portfólio pode ser populado a partir do quadro **Roadmap** do projeto `PRD — Produtos` (exemplo.atlassian.net), em vez dos dados demonstrativos:

```bash
npm run db:seed:jira
```

O comando **apaga os dados de produto** (produtos, tarefas, metas, finanças, planos, insights, comentários, decisões e snapshots) e reescreve a partir do extrato em `db/seed/jira-roadmap.json`. Configuração — enums, pacotes de tarefas, settings — e as contas de acesso permanecem.

**Escopo:** exatamente o que o quadro mostra. O Roadmap tem filtro próprio, `labels IN (lancamento-2027, lancamento-2028)`, e são esses 108 itens que entram: 8 épicos de lançamento e os 100 itens sob eles.

| No Jira | No portfólio |
|---|---|
| Épico de lançamento | **Produto** — nome do produto lançado; o épico e o link ficam na descrição |
| Responsável do épico | Responsável do produto |
| Data limite do épico | Lançamento previsto |
| Status do épico | Fase (backlog → concepção, em progresso → desenvolvimento, concluído → lançamento) |
| Etiquetas do épico | Tags |
| História / Tarefa filha | **Tarefa**, com início, prazo, responsável e prioridade |
| Status da tarefa | Coluna do Kanban (On Hold e Cancelled → Bloqueado) |

O extrato é versionado junto com o código, então a importação é reproduzível sem acesso ao Jira e dá para comparar com o quadro linha a linha. Para atualizar, releia o quadro e regrave o arquivo.

### O que o Jira não tem

Receita, custo, meta, Business Plan. **Nada disso é inventado na importação** — e a consequência é visível de propósito: os oito produtos entram com o Health Score em "sem medição", o ROI em "sem custo" e a matriz de portfólio vazia, porque a matriz precisa de ROI para posicionar. Só os componentes de execução e risco têm insumo, e 30 dos 100 pontos de peso não sustentam um score.

Para que o painel ganhe sentido financeiro, os lançamentos e as metas precisam ser cadastrados na própria aplicação. Preencher essas telas com números plausíveis deixaria o painel bonito e errado.

### Pacotes de tarefas a partir dos épicos

```bash
npm run db:packages:jira
```

Transforma dois lançamentos reais em pacotes reaplicáveis, com as datas viradas em deslocamentos:

| Pacote | Origem | Modelos | Âncora | Para quando |
|---|---|---|---|---|
| **Novo Produto** | DEMO-160, Nimbus Astra 2027 | 28 | Data de início do produto | Concepção — go-to-market de algo que ainda não existe |
| **Nova Release** | DEMO-148, Studio 2027 | 11 | Lançamento previsto | Crescimento — ciclo de uma versão nova |

Os dois são construídos de pontas opostas. Um produto que ainda não existe não tem data de lançamento para contar de trás, então o plano corre para frente a partir do início. Uma release tem: o dia zero é a subida da versão, o que vem antes fica negativo (`T-45 · atualizar documentação`) e o que vem depois, positivo (`D+25 · retrospectiva e desligamento da versão anterior`).

O dia zero da release não é a data-limite do épico — essa é o fim da iniciativa inteira. É o início do `F3 · Realizar rollout em ondas`, declarado em `anchorIssueKey` no código, porque é a data de que o plano todo depende. Se o produto não tiver lançamento previsto, a aplicação avisa e calcula a partir da data de início.

Os nomes perdem o prefixo do produto (`[Astra 2027 · Pocket] F1 · Definir pricing` vira `F1 · Definir pricing`) e cada modelo guarda na descrição o item do Jira de onde saiu. A categoria é uma leitura do texto, não veio do Jira — o que as regras não reconhecem fica em branco em vez de ser empurrado para uma gaveta.

O comando é reaplicável: pacote de mesmo nome é substituído, não duplicado.

### Um produto de exemplo, para o painel funcionar

```bash
npm run db:seed:example
```

Cadastra (ou substitui) **um** produto fictício ao lado dos oito do Jira, com receita, custo, metas, Business Plan, plano de ação, insights e comentários — o bastante para o painel executivo mostrar todos os painéis: ROI consolidado, matriz de portfólio, ranking por Health Score, alertas e sugestões a partir dos comentários.

As tarefas vêm do pacote **Novo Produto**, então o cronograma é o go-to-market real derivado do lançamento do Astra, e não uma segunda invenção. Rode `npm run db:packages:jira` antes.

Ele se chama **"Produto Exemplo (dados fictícios)"**, e o aviso está no nome e não numa nota de rodapé, porque o nome é o que viaja: aparece na matriz, no ranking, no CSV exportado e no PDF impresso. Ao lado de oito lançamentos reais com colegas de verdade anexados, um R$ 894 mil inventado que não esteja marcado como inventado é um número esperando para ser citado numa reunião.

O comando não toca em mais nada — os produtos do Jira e os pacotes ficam como estão.

### Responsáveis

As pessoas que aparecem como responsáveis vêm do Jira e existem apenas como referência: entram **inativas**, com senha aleatória que ninguém possui, e não conseguem entrar no sistema. Criar login de colega com senha conhecida seria distribuir conta que ninguém pediu. Para usar a aplicação, entre como `admin`.

---

## Comandos

```bash
npm run dev               # desenvolvimento (sobe o banco antes, se preciso)
npm run build             # build de produção
npm start                 # serve o build

npm run typecheck         # tsc --noEmit
npm run lint

npm run test              # unitários: motor de cálculo inteiro
npm run test:integration  # integração: autenticação e autorização, contra portfolio_test
npm run test:all          # os dois

npm run db:setup          # uma vez: papel e bancos
npm run db:generate       # gera migration SQL a partir de db/schema.ts
npm run db:migrate        # aplica migrations + grants
npm run db:seed           # popula com os dados demonstrativos (RESET_USERS=1 recria os usuários)
npm run db:seed:jira      # limpa e popula a partir do quadro Roadmap do Jira
npm run db:packages:jira  # cria os pacotes "Novo Produto" e "Nova Release" a partir dos épicos
npm run db:seed:example   # cadastra um produto fictício com dados completos
npm run db:reset          # destrói e refaz tudo
npm run db:recalc         # recalcula os snapshots de saúde (--backfill reconstrói o passado)
```

---

## Arquitetura em uma página

**Next.js 15 (App Router) + React 19.** Server Components carregam, Server Actions gravam. Não há camada de API separada porque não é preciso: a validação e a autorização acontecem no servidor de qualquer maneira.

**O cálculo mora em `src/lib/engine/`,** em funções **puras** que não conhecem o banco. Elas recebem números e devolvem números e o racional. É essa separação que deixa o motor inteiro coberto por teste unitário sem subir Postgres, e é por isso que a mesma regra não é reescrita em duas telas.

```
Banco ──> src/lib/queries/ ──> src/lib/engine/ ──> componentes
          (lê linhas)          (calcula, puro)     (mostram)
```

`src/lib/queries/metrics.ts` é o orquestrador do produto e `src/lib/queries/dashboard.ts` o do portfólio. Os dois chamam as mesmas funções do motor — quando um deles teve uma cópia própria de uma regra, as duas telas passaram a mostrar números diferentes para o mesmo produto, e foi preciso extrair a regra de volta para o motor.

| Camada | Onde | O que faz |
|---|---|---|
| Motor | `src/lib/engine/` | ROI, projeção, payback, Health Score, recomendação, cronograma, metas, plano |
| Consultas | `src/lib/queries/` | lê o banco e entrega dados simples ao motor |
| Sugestões | `src/lib/insights-engine/` | destila comentários em temas recorrentes, atrás de uma interface |
| Validação | `src/lib/schemas/` | Zod, **o mesmo** schema no formulário e na server action |
| Autorização | `src/lib/auth/` | sessão, políticas e o guard de toda mutação |
| Formatação | `src/lib/format.ts` | todo pt-BR passa por aqui |

### Health Score

Cinco componentes com pesos configuráveis (meta 30, financeiro 25, execução 20, Business Plan 15, risco 10) e semáforo em 75 / 50.

O que o diferencia de uma média qualquer: **um componente que não pode ser medido devolve nulo e sai da conta**, com os pesos restantes renormalizados. Um produto não é punido por informação que ainda não existe — nem premiado por ela. E quando sobra menos da metade do peso, o score deixa de ser reportado: a tela diz "sem medição", porque um 100 construído sobre o único componente que existe diria mais sobre a falta de dados do que sobre o produto.

### Recomendação de continuidade

Cinco regras, avaliadas da mais severa para a mais branda, lendo os limites das configurações. Cada resultado carrega as frases que o justificam e os números que as sustentam.

**A recomendação nunca é executada.** Ela aparece num card com dois botões — aceitar ou rejeitar — e o que o usuário escolher vira uma linha no histórico do produto, com justificativa obrigatória e um retrato dos números daquele momento.

### Motor de sugestões

`src/lib/insights-engine/` lê os comentários dos produtos e devolve temas recorrentes com tendência, produtos afetados e correlação com a variação do Health Score. Hoje roda por regras, em português, sem chamada de LLM: normalização, stopwords, unigramas e bigramas, agrupamento por coeficiente de sobreposição, tf-idf para rotular.

Está atrás da interface `CommentAnalyzer`. Trocar por um LLM é escrever outra implementação dessa interface e mudar uma linha em `index.ts` — nada mais no aplicativo sabe como as sugestões são produzidas. Cada sugestão carrega os ids dos comentários que a originaram, e o card abre para mostrá-los: sugestão que não dá para conferir é sugestão que se aceita por fé.

---

## Testes

```bash
npm run test:all
```

**Unitários** cobrem o motor inteiro, incluindo os casos de borda que quebram cálculo financeiro: custo zero, produto sem nenhuma venda, divisão por zero, produto recém-criado sem histórico, meta com alvo zero, cronograma que ainda não começou, série de receita inteiramente nula.

**Integração** roda contra o banco `portfolio_test` e prova o que a UI não pode provar: login com senha certa e errada, bloqueio após 5 tentativas, sessão expirada, e uma matriz de autorização em que `collaborator` e `executive` recebem negativa **do servidor** em mutações que a interface esconderia.

---

## Decisões que valem explicação

**Sessão própria em vez de biblioteca de autenticação.** Tabela `sessions` + cookie HttpOnly/SameSite=Lax, token de 32 bytes guardado apenas como SHA-256, senha em bcrypt custo 12, bloqueio após 5 tentativas por 15 minutos. Sem dependência em beta e testável em integração, que era requisito.

**Dinheiro é `numeric(14,2)` no banco, lido como `number`.** Nunca `float` na persistência, nunca `string` circulando pelo motor.

**Competência é `date`, não `timestamp`.** Mês é mês, não instante. Só a auditoria usa `timestamptz`.

**Gantt e matriz de esforço × impacto são componentes próprios.** Nenhuma biblioteca livre entrega setas de dependência, caminho crítico, zoom e arrastar/redimensionar com React 19 — e o Gantt é a maior peça de interface do projeto.

**Kanban com @dnd-kit.** Traz sensor de teclado nativo, então a alternativa acessível ao arrastar não é código paralelo. Cada card também tem botões de mover, nomeados com o nome da tarefa.

**Moeda compacta escrita à mão.** O ICU do Node e o do navegador discordam na notação compacta do `Intl`, e cada discordância é um erro de hidratação numa página que renderiza o mesmo número dos dois lados.

---

## O que ficou de fora

- **Sem upload de arquivo.** Anexos são URL + rótulo.
- **Sem editor rico.** Descrições, premissas e comentários são texto simples.
- **Sem LLM.** O motor de sugestões roda por regras; a interface existe para a troca.
- **Sem multi-tenant, sem notificação por e-mail, sem tempo real.** Server Actions e revalidação, não websocket.
- **Sem exportação PDF por biblioteca.** O botão usa a impressão do navegador sobre uma folha de estilo de impressão — o resultado é um PDF com cabeçalho, data e os filtros aplicados. Trocar por `jspdf` depois não muda nada além do botão.
- **Metas de NPS, market share e adoção podem ser cadastradas, mas não medidas.** O sistema não coleta esses dados, então o realizado volta nulo em vez de zero — dizer "0% da meta" seria inventar uma medição.

---

## Convenções

Interface, mensagens, moeda e datas em **português do Brasil**. Código, tabelas, colunas, variáveis e comentários em **inglês**. O detalhe das convenções está em [CLAUDE.md](CLAUDE.md).
