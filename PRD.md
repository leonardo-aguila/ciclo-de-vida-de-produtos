# PRD — Gestão de ciclo de vida de produtos

> **Como usar este documento.** Ele foi escrito para ser colado inteiro numa ferramenta de desenvolvimento assistido (Claude Code, Cursor, Lovable, v0, Bolt, Replit Agent) e produzir um resultado equivalente em uma passada.
>
> As seções estão em ordem de construção. A parte que mais importa é a **§3 — Regras inegociáveis**: são decisões que não aparecem numa especificação funcional comum e que, se você não escrever, a ferramenta não inventa. Elas são a diferença entre um painel bonito e um painel em que se pode confiar.
>
> Se a ferramenta tiver contexto curto, mande **§1 a §4** primeiro, construa, e depois mande uma seção por vez.

---

## 1. O produto

Uma aplicação web multiusuário onde um gerente de produto acompanha o portfólio inteiro: cadastro, metas, finanças, execução, Business Plan, saúde do produto e recomendação de continuidade — com um painel executivo que consolida tudo.

A aplicação existe para responder **uma pergunta**:

> Faz sentido continuar investindo neste produto?

Ela responde com número, racional e evidência. E **nunca executa a decisão** — quem decide é a pessoa, e a decisão fica no histórico.

Hoje essa pergunta é respondida por planilha e memória, porque as fases do ciclo de vida, o dinheiro, a execução e o plano vivem em lugares separados.

---

## 2. Idioma e convenções

- **Interface, mensagens, moeda e datas em português do Brasil.** `R$ 1.234,56`, `15/03/2024`, vírgula decimal. Toda formatação passa por um único módulo — nunca reescreva `Intl` dentro de um componente.
- **Código, tabelas, colunas, variáveis, funções e comentários em inglês.**
- Domínios fixos (fases, papéis) são enum no banco, com tradução no código. Domínios que o usuário administra (categorias, colunas do quadro, tipos de meta) vivem numa tabela de valores e **não têm tradução no código**.

---

## 3. Regras inegociáveis

Estas dez regras são o núcleo. Cada uma nasceu de um erro real que o sistema cometeu antes de ser corrigido. Trate-as como requisitos, não como estilo.

### 3.1 O que não pode ser medido devolve nulo, nunca zero

Ausência de dado não é resultado ruim. Um produto sem nenhum mês de venda **não atingiu 0% da meta** — ele não tem meta medida.

Vale em toda a cadeia:

| Situação | Errado | Certo |
|---|---|---|
| ROI com custo zero | `0%` ou divisão por zero | `null` |
| Meta sem nenhum mês de venda | `0% do alvo` | `null` + "ainda não há histórico para medir" |
| Projeção sobre receita toda zerada | `−100%` com alta confiança | `null` |
| Componente de saúde sem insumo | `0` | `null`, sai da média |
| Payback sem resultado recorrente positivo | data inventada | `unreachable` |
| Meta de um tipo que o sistema não coleta | `0%` | `null` + "o sistema não coleta esse dado" |

**Distinção que importa:** um mês que existe e veio zerado *é* medição e vale zero. A ausência de meses é que não é.

> Por que: um zero se parece com um resultado e vai parar num slide. Um nulo força a tela a dizer o que falta.

### 3.2 Score construído sobre pouco dado não é score

O Health Score combina cinco componentes com pesos. Um componente nulo sai da conta e os pesos restantes são **renormalizados** — o produto não é punido nem premiado pela informação que falta.

Mas há um piso: **se menos da metade do peso total pôde ser medida, o score não é exibido.** A tela mostra "sem medição" e explica o que cadastrar.

> Por que: um produto recém-criado só tem o componente "nenhum risco em aberto", que vale 100 de graça. Renormalizado, vira **Health 100, semáforo verde** — e ele lidera o ranking dos produtos mais saudáveis do portfólio. É o número mais enganoso que a aplicação poderia mostrar.

Isso se propaga: o produto sem medição some do ranking ordenado por saúde (vai para o fim), não entra na contagem de "produtos em vermelho", e a recomendação dele não pode afirmar um Health Score.

### 3.3 Uma regra, um lugar

Todo cálculo mora num **motor de funções puras** que não conhece o banco. Recebe números, devolve números e o racional. A consulta ao banco fica numa camada separada.

```
Banco ──> camada de consultas ──> motor (puro) ──> componentes
          (lê linhas)             (calcula)        (mostram)
```

Se duas telas precisam da mesma conta, as duas importam a mesma função. Escrever a regra inline "só desta vez" é proibido.

> Por que: o painel executivo tinha a própria versão do cálculo de meta realizada. Ela ignorava o período da meta e devolvia zero onde a página do produto devolvia nulo. **O mesmo produto lia diferente dependendo de onde se olhava** — e ninguém percebeu até alguém comparar as duas telas.

Benefício colateral: o motor inteiro fica coberto por teste unitário sem subir banco.

### 3.4 A recomendação nunca é executada

O sistema calcula uma recomendação de continuidade (escalar / manter / observar / pivotar / descontinuar). Ela aparece num card com:

- as **frases** que a justificam, na ordem em que devem ser lidas;
- os **números** que sustentam cada frase, ao lado do texto;
- dois botões: **aceitar** e **rejeitar**.

A escolha vira uma linha no histórico do produto, com justificativa obrigatória e um retrato dos números daquele momento.

> Por que: recomendação que ninguém pode contestar é recomendação que ninguém deveria obedecer. E um sistema que descontinua produto sozinho é um sistema que ninguém vai ligar.

### 3.5 O realizado das metas é derivado, nunca digitado

Não existe campo "realizado". Ele é calculado a partir dos lançamentos:

| Tipo de meta | Vem de | Cálculo |
|---|---|---|
| Novo MRR | vendas mensais | soma na janela do período (1 / 3 / 12 meses) |
| ARR | vendas mensais | receita recorrente do último mês × 12 |
| Receita única | série financeira | soma na janela do período |
| Nº de clientes | vendas mensais | clientes ativos do último mês |
| Redução de custo | lançamentos | queda do custo corrente contra o primeiro mês |
| NPS, market share, adoção | — | `null`: o sistema não coleta |

A janela do período importa: uma meta **trimestral** soma os três últimos meses, não o último.

> Por que: um campo "realizado" é mais um número para manter à mão, e ele diverge do financeiro no primeiro mês em que alguém esquecer.

### 3.6 Auditoria append-only garantida pelo banco, não pelo código

Toda criação, edição e exclusão grava quem, quando, qual campo, valor anterior e valor novo. O log é visível em aba própria e **não pode ser editado**.

A garantia não é uma regra de código: o papel de banco que a aplicação usa tem apenas `INSERT` e `SELECT` nas tabelas de log. Migrations rodam com outro papel.

> Por que: nem um bug, nem uma rota mal escrita, nem um `DELETE` esquecido conseguem apagar uma linha. Uma regra no código é uma promessa; um `GRANT` é uma garantia.

Corolário: exclusão de lançamento financeiro é **lógica** (`deleted_at`), porque o log precisa continuar apontando para uma linha que existe.

### 3.7 Autorização verificada no servidor, sempre

Toda mutação e toda rota passa por um guard no servidor. Esconder o botão na interface é consequência, **nunca** a defesa.

Quatro papéis:

| Papel | Pode |
|---|---|
| administrador | tudo, inclusive usuários e configurações |
| gerente de produto | CRUD completo nos produtos que possui; leitura nos demais |
| colaborador | edita tarefas e comentários atribuídos a si; leitura no resto |
| executivo | somente leitura, com painel executivo |

O teste de integração tem de provar que um colaborador e um executivo **recebem negativa do servidor** em mutações que a interface esconderia.

### 3.8 Importação não inventa dado

Se a aplicação importa de uma fonte externa (Jira, planilha, CRM), ela traz o que a fonte tem e para por aí. Fonte sem receita não vira receita estimada.

A consequência tem de ser visível: produtos importados entram com a saúde em "sem medição" e os painéis financeiros vazios, com o estado vazio explicando por quê.

> Por que: uma importação que preenche o que falta com números plausíveis transforma o painel em ficção com aparência de relatório.

E quando dados fictícios forem necessários (demonstração, exemplo), **o rótulo vai no nome do registro**, não numa nota de rodapé — porque o nome é o que viaja para a matriz, o ranking, o CSV exportado e o PDF impresso.

### 3.9 Nada de tela branca

Toda rota tem estado de **carregamento**, de **erro** e de **vazio**. O estado vazio diz o que fazer, não só que não há dados:

> "A matriz precisa de ROI, que só existe quando há custo lançado. Registre lançamentos financeiros para ver o portfólio aqui."

### 3.10 Acessibilidade é requisito, não acabamento

- **Contraste:** toda cor de status precisa de 4,5:1 contra o fundo em texto pequeno e 3:1 em elemento de interface. Verde e âmbar "vivos" reprovam — o verde `#10b981` dá 2,54:1. Quando a informação está na cor, quem não enxerga a cor não recebe a informação.
- **Teclado:** o quadro Kanban precisa de alternativa ao arrastar. Botões de mover nomeados com o **nome da tarefa** — onze botões anunciados como "Mover" são onze botões inúteis para leitor de tela.
- Um `h1` por página, sem salto de nível de cabeçalho, todo controle com nome acessível, todo campo com rótulo.

---

## 4. Stack

Esta é a stack de referência. O que estiver marcado como **substituível** pode trocar sem afetar o resto do documento; o que estiver marcado como **estrutural** carrega uma das regras da §3.

| Camada | Escolha | |
|---|---|---|
| Framework | Next.js 15 (App Router) + React 19 | substituível |
| Linguagem | TypeScript strict, com `noUncheckedIndexedAccess` | **estrutural** |
| Banco | PostgreSQL 16 | **estrutural** (precisa de `numeric`, `date`, `jsonb`, enum e papéis) |
| ORM | Drizzle ORM | substituível, desde que gere **migrations SQL versionadas** |
| Autenticação | Sessão própria: tabela + cookie HttpOnly/SameSite=Lax | substituível |
| Validação | Zod, com o **mesmo schema** no cliente e no servidor | **estrutural** |
| Interface | Tailwind + biblioteca de componentes acessíveis | substituível |
| Gráficos | Recharts para linhas e barras | substituível |
| Kanban | biblioteca com **sensor de teclado nativo** | **estrutural** (§3.10) |
| Gantt | componente próprio | ver nota |
| Testes | Vitest ou Jest, com projetos separados `unit` e `integration` | substituível |

**Nota sobre o Gantt:** não existe biblioteca livre madura que entregue setas de dependência + caminho crítico + zoom + arrastar/redimensionar. É a maior peça de interface do projeto. Se o prazo apertar, corte o arrastar antes de cortar as setas.

**Convenções de tipo:**

- **Dinheiro** é `numeric(14,2)` no banco, lido como número. Nunca ponto flutuante na persistência, nunca string circulando pelo motor.
- **Competência e prazo** são `date` lidos como `"AAAA-MM-DD"`. Competência é mês, não instante. Só a auditoria usa timestamp com fuso.
- **Aritmética de data em horário local.** `new Date("2026-03-15")` é interpretado como UTC e desloca o dia. Escreva helpers próprios.

---

## 5. Modelo de dados

Identificadores são UUID. Nomes em inglês.

### Acesso e governança

| Tabela | Campos que importam |
|---|---|
| `users` | name, email, login, password_hash, role, active, last_login_at, failed_attempts, locked_until, must_change_password |
| `sessions` | user_id, token_hash, expires_at, last_seen_at, ip, user_agent |
| `access_logs` | login_attempted, success, reason, ip, user_agent — **toda** tentativa, inclusive falha |
| `audit_logs` | entity_type, entity_id, action, field, old_value, new_value, actor_id, created_at — **append-only** |

Política de senha: mínimo 10 caracteres com letra e número, hash bcrypt custo 12, bloqueio após **5 tentativas por 15 minutos**, troca pelo próprio usuário, reset pelo administrador. O token de sessão são 32 bytes aleatórios guardados **apenas como SHA-256**.

### Configuração

| Tabela | Conteúdo |
|---|---|
| `app_settings` | linha única: pesos do Health Score, limites do semáforo, regras de recomendação, parâmetros de projeção, limite de desvio do BP, moeda — tudo `jsonb`, lido pelo motor |
| `enum_values` | kind, code, label, sort_order, color, active, is_system, `meta` jsonb |

`enum_values.kind` cobre: tipo de meta, categoria de tarefa, coluna do quadro, tipo de lançamento financeiro, categoria de comentário, categoria de produto, origem de insight.

O `meta` jsonb carrega as flags que o motor consulta: `isDone` na coluna que conclui a tarefa, `isVariable` no tipo de custo que entra na margem de contribuição, `unit` no tipo de meta. Linhas `is_system` podem ser renomeadas e desativadas, nunca excluídas.

### Produto

| Tabela | Campos que importam |
|---|---|
| `products` | code (único), name, short_description, owner_id, team, category_id, **phase** (7 fases), status, start_date, planned_launch_date, actual_launch_date, segment, pricing_model, competitors, tags |
| `product_phase_history` | phase, started_at, ended_at, changed_by — alimenta "tempo em cada fase" |
| `product_goals` | goal_type_id, target_value, unit, period, deadline, **is_primary** (índice único parcial: uma por produto) |
| `product_decisions` | recommended, outcome, justification, **metrics_snapshot** jsonb, decided_by |
| `product_comments` | author_id, category_id, body, comment_date |

Fases: `conception`, `development`, `launch`, `growth`, `maturity`, `decline`, `discontinued`.

### Tarefas

| Tabela | Campos que importam |
|---|---|
| `task_packages` | name, description, target_phase, active |
| `task_templates` | package_id, name, category_id, priority, initial_status, estimated_hours, **anchor**, **start_offset_days**, **end_offset_days**, order_index, parent_template_id |
| `task_template_dependencies` | (template_id, depends_on_template_id) |
| `tasks` | product_id, name, category_id, assignee_id, status, priority, progress, start_date, due_date, done_date, estimated_hours, parent_task_id, board_order, origin_insight_id, origin_template_id |
| `task_dependencies`, `task_comments`, `task_attachments` | |

**Pacotes de tarefas** são o mecanismo de replicação: um modelo guarda **deslocamentos em dias** a partir de uma âncora (`start_date` ou `planned_launch_date`), e aplicá-lo a um produto materializa as tarefas com datas calculadas. Um modelo ancorado no lançamento aplicado a um produto sem data de lançamento **cai para a data de início com aviso** — produzir tarefa nenhuma apagaria trabalho do plano em silêncio.

Anexos são **URL + rótulo**. Não há upload de arquivo.

### Insights

`insights` — title, description, origin_id, owner_id, insight_date, status, **effort 1–10**, **impact 1–10**. O score é `impact / effort`, calculado, nunca armazenado.

### Financeiro

| Tabela | Campos que importam |
|---|---|
| `finance_entries` | entry_type_id, category, description, amount, currency, competence_date, **is_variable**, recurring, recurrence_period, recurrence_end, parent_entry_id, cost_center, supplier, receipt_url, **deleted_at** |
| `monthly_sales` | **competence** (único por produto), new_mrr, recurring_revenue, one_time_revenue, churn_amount, churn_rate, new/active/churned_customers, avg_ticket, source |

Lançamento recorrente gera parcelas com `parent_entry_id` apontando para o original.

### Business Plan

| Tabela | Campos que importam |
|---|---|
| `business_plans` | version, approved_at, author_id, assumptions, horizon_months, status (`draft`/`active`/`superseded`) |
| `business_plan_months` | competence, planned_revenue, planned_cost, planned_customers, planned_margin |
| `milestones` | name, target_date, acceptance_criteria, status, done_date |
| `action_plans` | name, description, root_cause, owner_id, due_date, status, expected_result, actual_result, **trigger_competence**, **trigger_deviation** |

Versão nova **preserva a anterior** (`superseded`), para a comparação entre versões existir.

### Snapshot

`health_snapshots` — (product_id, competence) único: score, components jsonb, roi, projected_roi, accumulated_revenue, accumulated_cost, recommendation.

É o que permite mostrar "variação vs. mês anterior" sem recalcular o passado. Precisa de um comando que recalcula o mês corrente e, opcionalmente, reconstrói os meses passados.

---

## 6. Motor de cálculo

Funções **puras**, sem acesso a banco. Esta seção é a mais importante para reproduzir os mesmos números.

### 6.1 Série mensal

A partir das vendas e dos lançamentos, monte um ponto por competência com: `revenue`, `cost` (total), `variableCost`, `opex`, `capex`, `contributionMargin`, `result`, **`recurringResult`**, `accumulatedRevenue`, `accumulatedCost`.

```
recurringResult = revenue − (cost.total − cost.capex)
```

> **`recurringResult` é o campo que mais erra se você não o separar.** É o resultado excluindo gasto pontual — a taxa corrente olhando para frente. Veja 6.4.

### 6.2 ROI

```
roiOf(revenue, cost) = cost <= 0 ? null : ((revenue − cost) / cost) × 100
```

**ROI consolidado do portfólio é calculado sobre os totais**, nunca como média dos ROIs individuais — a média de percentuais deixa um produto minúsculo de razão enorme dominar o número.

### 6.3 Projeção de ROI 12 meses

Regressão linear simples sobre a receita dos últimos `windowMonths` (padrão 6) + média móvel do custo corrente.

- Menos de 3 pontos na janela → `null`. Dois pontos fazem uma reta, mas não dizem nada sobre tendência.
- **Janela inteiramente sem receita → `null`.** Uma série de zeros encaixa perfeitamente numa reta horizontal e produziria `−100%` com "alta confiança" para um produto que ainda não lançou.
- Receita projetada tem piso em zero: uma reta descendente cruza para receita negativa, o que é aritmética e não previsão.
- O resultado carrega **a janela usada, a inclinação, o r² e a confiança** (alta / média / baixa), e a tela declara que é projeção.

### 6.4 Payback

1. Se a receita acumulada já alcançou o custo acumulado em algum mês → `reached`, com essa competência.
2. Senão, projete a lacuna pela **média de `recurringResult`** na janela.
3. Média ≤ 0 → `unreachable`.
4. Senão → `estimated`, com a competência calculada.

> **Use `recurringResult`, não `result`.** Projetar com o resultado cheio espalha um CAPEX já gasto no passado pela taxa corrente futura, e declara "inalcançável" produtos perfeitamente saudáveis.

### 6.5 Health Score

Cinco componentes, pesos configuráveis somando 100. Padrão: **meta 30, financeiro 25, execução 20, Business Plan 15, risco 10**. Semáforo: verde ≥ 75, amarelo ≥ 50, vermelho abaixo.

| Componente | Fórmula | Devolve `null` quando |
|---|---|---|
| **Meta** | `min(realizado / alvo, 1,2) × 100` (permite superação até 120) | sem meta principal, alvo ≤ 0, ou realizado não medível |
| **Financeiro** | média de: `clamp((roi + 100) / 2)` e `clamp(margem%_da_receita + 50)` | sem custo nem receita lançados |
| **Execução** | `clamp(realizado / esperado × 100) − min(30, atrasadas × 5)` | nenhuma tarefa, **ou cronograma que ainda não começou** |
| **Business Plan** | `clamp(100 − \|desvio acumulado %\|)` | sem plano ativo |
| **Risco** | `100 − min(60, planos vencidos × 20) − min(40, insights críticos sem tratamento × 10)` | nunca (sem risco = 100) |

Mapeamento do financeiro: ROI de −100% vira 0 e +100% vira 100, então o ponto de equilíbrio fica em 50. A margem mapeia sua participação na receita na mesma escala (−50% → 0, +50% → 100).

Componente nulo sai da conta com os pesos renormalizados. **Cobertura abaixo de 50 → score não é reportado** (§3.2).

> O componente de execução precisa do segundo caso de nulo: um cronograma com progresso esperado zero e realizado zero teria razão `0/0`. Dar 100 ali premia o produto por não ter feito nada.

### 6.6 Recomendação de continuidade

Cinco regras, avaliadas **da mais severa para a mais branda**, com a primeira que casar vencendo. A ordem importa: um produto que está em queda *e* no prejuízo precisa ler "descontinuar", não "observar" — a resposta mais branda enterraria o achado.

| # | Resultado | Condições (padrão, configurável) |
|---|---|---|
| 0 | **sem veredito** | a saúde não pôde ser medida (§3.2) → texto dizendo que falta cadastrar, nenhum número afirmado |
| 1 | **Descontinuar** | ROI < 0 **e** ROI projetado < 0 **e** ≥ 3 meses seguidos de queda |
| 2 | **Pivotar** | meta não atingida **e** crescimento MoM > 0 **e** ≥ 3 meses de margem de contribuição negativa |
| 3 | **Escalar** | Health ≥ 75 **e** ROI > 0 **e** crescimento MoM > 0 |
| 4 | **Observar** | saúde na faixa intermediária sem retorno projetado, **ou** payback depois do prazo da meta principal |
| 5 | **Manter** | faixa intermediária com ROI projetado positivo |
| 6 | **Manter** | **saúde boa, mas ROI acumulado ainda negativo e projetado positivo** |
| 7 | **Observar** | tudo o mais |

> A regra 6 não é óbvia e foi a última a aparecer. Um produto em crescimento forte, com projeção positiva e ROI acumulado negativo porque o CAPEX ainda não voltou, não cabe na faixa intermediária (a saúde é boa demais) nem na regra de escalar (o ROI é negativo). Sem ela, ele cai em "observar" — a resposta errada para algo que só precisa manter o curso.

Toda recomendação devolve `rationale: string[]` e `evidence: {label, value}[]`.

### 6.7 Cronograma

- **Aplicação de pacote:** data = âncora + deslocamento. Fim antes do início vira fim = início, com aviso.
- **Progresso geral:** média ponderada pelas horas estimadas.
- **Progresso esperado:** fração do tempo decorrido entre início e prazo de cada tarefa, na mesma ponderação.
- **Curva S:** planejado × realizado ao longo do tempo.
- **Caminho crítico:** CPM com passada para frente e para trás sobre as dependências.
- **Tarefa atrasada:** prazo passou e não está em coluna de conclusão.

### 6.8 Business Plan vs. realizado

Mês a mês e acumulado, com desvio absoluto e percentual e farol por linha.

**Meses futuros são marcados como sem realizado e excluídos do desvio acumulado.** Incluí-los faria todo plano parecer catastroficamente atrasado no dia em que foi aprovado.

Gatilho: desvio acumulado abaixo do limite (padrão −15%) sugere a criação de um plano de ação, com a competência e o desvio que o dispararam guardados para rastreabilidade.

### 6.9 Motor de sugestões

Lê os comentários dos produtos e devolve temas recorrentes com tendência no tempo, produtos afetados e correlação com a variação do Health Score.

**Fica atrás de uma interface** (`CommentAnalyzer`), com uma implementação baseada em regras. Trocar por LLM depois é escrever outra implementação e mudar uma linha — nada mais na aplicação sabe como as sugestões são produzidas.

A implementação por regras, para português:

1. Normalizar (minúsculas, sem acento, sem pontuação).
2. Remover stopwords — lista ampla, incluindo **substantivos organizacionais genéricos** ("time", "equipe", "área", "projeto", "caso", "forma", "ponto") e **intensificadores** ("demais", "bastante", "muito", "sempre", "melhor", "maior").
3. Singularizar de forma conservadora: tirar o "s" final de palavras com 6+ letras que não terminem em "ss". **Testar stopword antes e depois** — tirar o "s" de "demais" produz "demai", que não está em lista nenhuma.
4. Extrair unigramas e bigramas.
5. Agrupar por **coeficiente de sobreposição** sobre unigramas, com bônus quando há bigrama em comum. Limiar 0,25.
6. Rotular o grupo com tf-idf.
7. Devolver com grafia original (acentos), tendência, produtos afetados e **os ids dos comentários de origem**.

> Três armadilhas, todas já pagas:
> - **Não use tf-idf para escolher os termos de comparação.** O idf premia o que é único do documento, e o vocabulário compartilhado é justamente o que faz dois comentários serem o mesmo tema. Com tf-idf, nada agrupa. Use idf só para rotular.
> - **Não use Jaccard com bigramas.** Bigramas incham os dois conjuntos e quase nunca coincidem; a similaridade dilui para ~0,07.
> - **Mostre os comentários de origem no card.** Sugestão que não dá para conferir é sugestão que se aceita por fé.

---

## 7. Telas

```
/entrar                      login
/                            painel executivo
/produtos                    lista + filtros
/produtos/novo               cadastro
/produtos/[id]/visao-geral   blocos A, B, C, D
/produtos/[id]/insights      matriz esforço × impacto
/produtos/[id]/financeiro    lançamentos · vendas · evolução · auditoria
/produtos/[id]/tarefas       alternância Gantt ⇄ Kanban
/produtos/[id]/business-plan projeções, plano × realizado, marcos, planos de ação
/produtos/[id]/comentarios
/configuracoes               geral · domínios · pacotes de tarefas
/usuarios                    gestão de usuários
```

### Página do produto

- **Bloco A — indicadores da fase.** O que importa acompanhar *nesta* fase, com destaque no que está fora do esperado. Em declínio: queda MoM, meses consecutivos em queda, ROI marginal, custo de manutenção vs. receita. Em concepção: insights validados, esforço estimado acumulado, investimento comprometido, tempo na fase.
- **Bloco B — evolução.** Curva S planejada × realizada, timeline de fases, gráfico de receita × meta × plano.
- **Bloco C — saúde.** Health Score com a **decomposição**: cada componente com valor bruto, peso, contribuição e **uma frase explicando**. O número sozinho é inútil para agir; o que serve é saber qual componente caiu.
- **Bloco D — continuidade.** Receita acumulada, custo total, ROI, ROI projetado, payback, margem do mês, burn mensal, manutenção vs. receita — e o card de recomendação (§3.4) com o histórico de decisões abaixo.

### Tarefas

Gantt e Kanban **sobre os mesmos dados**, com alternância. O Gantt tem linha de hoje, preenchimento por percentual, setas de dependência, marco de lançamento, caminho crítico, zoom e arrastar/redimensionar. O Kanban tem atualização otimista com rollback, colunas administráveis e a alternativa de teclado da §3.10.

### Insights

Matriz esforço × impacto com quatro quadrantes. Clicar abre, arrastar altera esforço e impacto, e um insight pode ser **convertido em tarefa**, mantendo a origem.

### Painel executivo

- Indicadores consolidados: produtos, receita, custo, **ROI consolidado sobre os totais**, produtos em vermelho, meta agregada.
- **Matriz de portfólio:** ROI no eixo X, Health no Y, tamanho da bolha pela receita acumulada, cor pela fase. Eixo de ROI limitado a uma janela legível, com quem ficar fora **fixado na borda e marcado** — um produto a 600% espremeria todos os outros numa linha vertical.
- Funil de ciclo de vida: quantos produtos e quanta receita em cada fase, com tempo médio.
- Ranking por Health Score, com os sem medição no fim (§3.2).
- Alertas consolidados, do mais grave ao menos.
- Painel de sugestões (§6.9).
- **Filtros globais na URL** (fase, responsável, categoria, período), para o recorte ser compartilhável.
- Exportação CSV e PDF. O PDF precisa de **cabeçalho só de impressão** com título, data e os filtros aplicados — senão sai uma pilha anônima de gráficos.

Agregações do painel excluem o que não pode ser medido: produto sem meta medível não entra no denominador da meta agregada, produto sem medição não conta como vermelho.

---

## 8. Dados de exemplo

O seed não é enfeite: **é o que revela os erros da §3.** Cinco produtos, 12 a 24 meses de histórico:

| Produto | Deve produzir |
|---|---|
| Maduro e saudável | ROI claramente positivo, meta em dia → recomendação **escalar** |
| Em crescimento | cresce rápido, CAPEX ainda não recuperado → recomendação **manter** (exercita a regra 6) |
| **Em declínio** | ROI negativo, projeção negativa, ≥ 3 meses de queda → recomendação **descontinuar** |
| Pré-lançamento | custo lançado, **nenhuma venda** → projeção nula, meta não medida |
| Recém-criado | **nada** → Health "sem medição" de ponta a ponta |

Os dois últimos existem precisamente para provar a §3.1 e a §3.2. Se o produto recém-criado aparecer com Health 100 e semáforo verde, a implementação está errada.

Além disso: um Business Plan com desvio que dispare o gatilho, um plano de ação vencido, insights espalhados pelos quatro quadrantes, e comentários suficientes para o motor de sugestões achar ao menos dois temas.

**Ancore o seed no mês corrente**, não em datas fixas, para ele continuar atual. E escreva as curvas de receita à mão em vez de sortear: o motor precisa cair numa recomendação específica para cada produto, e um passeio aleatório muda a resposta entre execuções.

---

## 9. Critérios de aceite

A suíte tem de passar. Estes são os testes que pegam os erros desta especificação.

### Unitários — motor de cálculo

- [ ] ROI com custo zero devolve nulo, não divisão por zero
- [ ] Produto sem nenhum mês de venda: meta devolve **nulo**, não zero
- [ ] Mês que existe e veio zerado: meta devolve **zero**, não nulo
- [ ] Meta trimestral soma os três últimos meses, não o último
- [ ] Meta de tipo não coletado (NPS) devolve nulo com o texto certo — distinto de "sem meta cadastrada" e de "sem histórico"
- [ ] Projeção sobre receita toda zerada devolve nulo
- [ ] Projeção com menos de 3 pontos devolve nulo
- [ ] Payback projeta por `recurringResult`: um CAPEX passado não torna o produto inalcançável
- [ ] Componente de saúde com cronograma não iniciado devolve nulo, não 100
- [ ] Cobertura abaixo de 50 → `measured: false`, mesmo com score aritmético 100
- [ ] Meta com alvo zero devolve nulo
- [ ] Superação de meta é limitada a 120
- [ ] Recomendação: declínio + prejuízo → descontinuar, não observar
- [ ] Recomendação: saúde boa + ROI negativo + projeção positiva → manter
- [ ] Recomendação: saúde não medida → sem veredito, sem afirmar Health Score
- [ ] Desvio acumulado do BP ignora meses futuros
- [ ] Moeda compacta não depende do ICU do runtime
- [ ] Agrupamento de comentários: dois textos do mesmo tema agrupam
- [ ] Agrupamento: dois temas distintos que compartilham uma palavra genérica **não** agrupam
- [ ] Singularização não deixa stopword escapar ("demais" não vira "demai")

### Integração — autenticação e autorização

- [ ] Login com senha certa cria sessão; com senha errada, não
- [ ] Bloqueio após 5 tentativas, por 15 minutos
- [ ] Sessão expirada é recusada
- [ ] Colaborador recebe negativa **do servidor** em mutação que a interface esconderia
- [ ] Executivo recebe negativa **do servidor** em qualquer mutação
- [ ] Gerente de produto não edita produto de outro dono
- [ ] Tentativa de `UPDATE` ou `DELETE` em log de auditoria falha **no banco**

### Navegador

Com o servidor no ar, percorrer: login → painel → produto em declínio (recomendação com racional) → Kanban (arrastar **e** mover por teclado) → Gantt (caminho crítico) → importar CSV de vendas → gerar plano de ação a partir do desvio. **Console e rede sem erro.**

---

## 10. Armadilhas conhecidas

Cada uma destas custou tempo. Estão aqui para não custarem de novo.

| Armadilha | Sintoma | Correção |
|---|---|---|
| **`<title>` dentro de `<svg>`** | erro de hidratação no gráfico | React 19 trata `<title>` como metadado de documento e o hoista: o servidor manda a tag vazia. Use `aria-label` + uma linha de texto ao lado do gráfico |
| **`Intl` com `notation: "compact"`** | erro de hidratação em número | o ICU do servidor e o do navegador divergem ("R$ 0" vs "R$ 0,0"). Escreva a formatação compacta à mão |
| **Subconsulta correlacionada** | contagem sempre zero, **sem erro nenhum** | `where t.package_id = ${tabela.id}` liga o `id` à tabela interna. Escreva o nome da tabela externa literal |
| **Drag-and-drop sem `id` estável** | erro de hidratação por `aria-describedby` | dê `id` fixo ao contexto |
| **Arquivo de ações do servidor com export não-async** | build quebra, teste não pega | mova helpers puros para fora |
| **Checkbox desmarcada** | desmarcar não tem efeito | checkbox desmarcada não envia nada; o padrão do schema tem de ser `false`, não `true` |
| **Reset do banco preservando o diário de migrations** | banco vazio atrás de um reset "bem-sucedido" | derrube também o schema onde o ORM guarda o diário |
| **Build concorrente com o servidor de desenvolvimento** | 500 com "módulo não encontrado" | os dois escrevem no mesmo diretório. Pare um, limpe, rode o outro |
| **Captura de pointer no arrastar** | arrastar morre em silêncio | `setPointerCapture` pode lançar; mude o estado **antes** e envolva a captura em try/catch |
| **Cookie de sessão com `secure` em produção** | login falha em silêncio sobre HTTP | o navegador descarta o cookie e a tela volta ao login sem erro |

**Sobre verificação no navegador:** mensagens de console se acumulam por aba, e leitura de DOM por script pega instantâneo velho. Verifique em **aba nova**, com clique de verdade e captura de tela.

---

## 11. Ordem de construção

Ao fim de cada fase: rodar verificação de tipos, testes e lint, e revisar o que ficou pronto antes de seguir.

1. **Fundação.** Projeto, banco, schema completo, primeira migration, seed mínimo (admin + domínios + configurações), layout, navegação, formatação pt-BR, estados de carregamento/erro/vazio.
2. **Autenticação e usuários.** Login, sessão, bloqueio, logs, guard de autorização, CRUD de usuários. **Testes de integração desta fase.**
3. **Produtos e configurações.** CRUD com metas múltiplas e meta principal, histórico de fase, domínios administráveis, CRUD de pacotes com pré-visualização e aplicação a produto existente.
4. **Tarefas.** CRUD, subtarefas, dependências; Kanban com arrastar + alternativa de teclado; Gantt com setas, caminho crítico, zoom e arrastar.
5. **Financeiro.** Lançamentos com recorrência, auditoria append-only em aba própria, vendas mensais, importação CSV com pré-visualização e relatório de erros.
6. **Motor de cálculo.** ROI, projeção, payback, Health Score, recomendação — **com os testes da §9 e os casos de borda**. Snapshots mensais.
7. **Página do produto.** Blocos A/B/C/D, card de recomendação com registro da decisão, matriz de insights interativa.
8. **Business Plan.** Projeções, marcos, plano × realizado com farol, gatilho de desvio, planos de ação, versionamento.
9. **Painel executivo.** Indicadores, matriz de portfólio, funil, alertas, motor de sugestões atrás da interface.
10. **Acabamento.** Seed completo da §8, exportação, revisão de acessibilidade e contraste, documentação, build e suíte completa.

A fase 6 é onde as regras da §3 aparecem ou não. Se o seed da §8 estiver pronto antes dela, os erros ficam visíveis cedo — recomendo antecipar os produtos "pré-lançamento" e "recém-criado" para a fase 3.

---

## 12. O que fica de fora

Declare isto explicitamente, para não virar expectativa:

- **Sem upload de arquivo.** Anexos são URL + rótulo.
- **Sem editor rico.** Descrições, premissas e comentários são texto simples.
- **Sem LLM no motor de sugestões.** Roda por regras; a interface existe para a troca.
- **Sem multi-tenant, sem notificação por e-mail, sem tempo real.**
- **Metas de NPS, market share e adoção podem ser cadastradas, mas não medidas.**

---

## Apêndice — prompt inicial

Para colar numa ferramenta junto com este documento:

> Construa a aplicação descrita no PRD em anexo. Antes de escrever código, proponha a arquitetura e o modelo de dados e espere aprovação.
>
> Implemente na ordem da §11, rodando os testes e revisando comigo ao fim de cada fase.
>
> As dez regras da §3 são requisitos, não sugestões de estilo. As três que mais quebram implementações e que eu vou verificar primeiro:
>
> 1. O que não pode ser medido devolve nulo, nunca zero (§3.1).
> 2. Health Score com menos de metade do peso medido não é exibido (§3.2).
> 3. Todo cálculo mora num motor de funções puras, importado por quem precisar — nenhuma regra escrita inline numa tela (§3.3).
>
> Use bibliotecas maduras e populares. Não invente dependências: confirme que cada pacote existe antes de usar.
>
> Ao final, rode o build e a suíte, corrija o que falhar e me entregue um resumo do que foi construído, das decisões técnicas e do que ficou de fora.
