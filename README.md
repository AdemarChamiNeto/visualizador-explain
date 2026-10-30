# Visualizador de EXPLAIN

Visualizador de planos de execução do PostgreSQL: roda `EXPLAIN ANALYZE` num banco de exemplo (ou lê o plano colado) e mostra a árvore com o tempo de cada nó, onde a estimativa errou e o que um **índice hipotético** mudaria.

**Demo:** [visualizador-explain.onrender.com](https://visualizador-explain.onrender.com/). Para abrir direto num exemplo: [/#exemplo=juncao](https://visualizador-explain.onrender.com/#exemplo=juncao). O plano grátis do Render dorme sem visitas, e a primeira visita leva uns 30 s para acordar.

<p>
  <img src="docs/arvore.png" width="100%" alt="Árvore de um plano com junção: alertas de Seq Scan e de estimativa errada no topo, a árvore com barras de tempo e o painel do nó selecionado">
</p>
<p>
  <img src="docs/indice.png" width="62%" alt="Comparação com índice hipotético: CREATE INDEX ON pedidos (cliente_id) seria usado, custo 4.167 → 208">
  <img src="docs/celular.png" width="30%" alt="O mesmo resultado no celular, em uma coluna">
</p>

**Stack:**
- **Back:** Node 22 · Express 5 · TypeScript · PostgreSQL 16 + **HypoPG** (SQL puro com `pg`) · Zod
- **Front:** Vue 3 · TypeScript · Vite
- **Testes e entrega:** `node:test` + Vitest + Vue Test Utils · Docker · GitHub Actions · Render + Neon

## Funcionalidades

- **Rodar no banco de exemplo:** uma loja com 50 mil clientes, 200 mil pedidos e 1 milhão de itens. Há 5 consultas prontas, uma para cada cenário: sem índice, estimativa errada, ordenação em disco...
- **Colar um plano** de qualquer banco (`EXPLAIN (ANALYZE, FORMAT JSON)`). Ele é lido **só no navegador**: nada vai para o servidor.
- **Árvore do plano:**
  - **tempo próprio** de cada nó (o total menos os filhos), com uma barra que esquenta conforme o % da consulta;
  - linhas reais × estimadas, por execução, e quantas vezes o nó rodou.
- **Alertas**, do mais grave para o menos:
  - Seq Scan que descarta 90%+ do que lê, com a dica do índice no filtro;
  - estimativa errada em 5× ou mais, apontada **onde o erro nasce** e não em cada nó que o herda;
  - ordenação em disco, hash em lotes e o lado de dentro de um Nested Loop rodando milhares de vezes.
- **Painel do nó:** os campos que explicam o que ele fez (filtro, condição do índice, blocos da memória × do disco), com o JSON inteiro recolhido.
- **"E se existisse um índice?":** o plano antes e depois de um índice **hipotético** (HypoPG), sem criar nada de verdade.
  - A tela já sugere o índice a partir do alerta de Seq Scan.
  - Exemplo: `pedidos (cliente_id)` faz o custo cair de 4.167 para 208.
- **Erro de sintaxe** marca na consulta o caractere onde o Postgres parou de entender.
- **Links para exemplos:** `/#exemplo=juncao`, `/#exemplo=nested-loop`...
- **Pronto para publicar:**
  - ícones, Open Graph com a árvore real, JSON-LD, `robots`/`sitemap`/`llms.txt`, privacidade e 404 de verdade;
  - GA4 e Clarity só depois do consentimento;
  - Lighthouse em produção: **100 / 100 / 100 / 100** na página inicial e **99 / 100 / 100 / 100** com um plano aberto.

## Arquitetura

```
backend/
  migrations/
    001_extensoes.sql    HypoPG
    002_loja.sql         schema da loja e o papel "visitante" (só leitura)
    003_dados.sql        1 milhão de itens, sempre os mesmos (setseed + fórmulas)
    004_hipotetico.sql   funções SECURITY DEFINER para o índice hipotético
  src/
    explain/executar.ts  roda o EXPLAIN com as camadas de segurança e classifica os erros
    http/                rotas, OpenAPI, site estático
frontend/src/
  plano/                 TypeScript puro: lê o JSON do EXPLAIN, tempo próprio, alertas
  componentes/           árvore, painel do nó, alertas, banco de exemplo, índice hipotético
docs/banco.md            roteiro do banco preenchido, decisões e camadas de segurança
```

### Decisões

- **O visitante roda SQL no meu banco: a segurança é em camadas**, e cada uma tem um teste que tenta furá-la.

  | Camada | O que barra |
  |---|---|
  | Papel `visitante` com **login próprio** (não `SET ROLE` a partir do dono) | `SELECT set_config('role', 'dono', false)` voltaria a ser dono |
  | Só `SELECT` na `loja`; banco e schema `public` negados por padrão | escrita, `CREATE TABLE`, ler o controle de migrações |
  | `BEGIN READ ONLY` + `SET LOCAL statement_timeout = 3s`, `work_mem` 4 MB, 5 conexões | escrita, `pg_sleep`, produto cartesiano, ordenação gigante |
  | **Protocolo estendido** do `pg` | `SELECT 1; DROP TABLE pedidos`: o Postgres recusa mais de um comando |
  | `ROLLBACK` + `DISCARD ALL` ao devolver a conexão | um `set_config(..., false)` ou `pg_advisory_lock` passaria para o próximo visitante (testado com um pool de **1 conexão**) |
  | **Custo estimado acima de 5 milhões: sem `ANALYZE`** (volta só a estimativa, com aviso) | o timeout corta a consulta em 3 s, mas não o disco: um auto-join de `itens_pedido` escreveu 1,8 GB de arquivo temporário antes de ser cancelado |
  | Função nova do dono **sem `EXECUTE` para `PUBLIC`** (`ALTER DEFAULT PRIVILEGES`) | uma função criada depois ficaria executável pelo visitante sem ninguém perceber |
  | Rate limit: 20 consultas/min por IP | um visitante ocupando o banco |

  **O que a produção mostrou:** o Cloudflare, que fica na frente do Render, barra antes do nosso servidor os corpos que parecem SQL injection clássico, como `SELECT 1; DROP TABLE pedidos`. Ele devolve 403 em HTML, e a tela agora explica isso. O resto chega à API e foi conferido no Neon:
  - `DELETE` → só leitura;
  - `public.schema_migrations` e `public.hypopg_create_index` → sem permissão;
  - `set_config('role', 'neondb_owner', false)` → negado;
  - `pg_sleep(10)` → cortado em 3 s;
  - 1.000 índices hipotéticos num SELECT → para no terceiro.

  **Sugestões de um comentário no LinkedIn (30/10/2026), e o que deu para fazer:**
  - `temp_file_limit` seria o limite certo para o disco, mas **só superusuário define** (o Neon não dá). No lugar, o limite de custo: a consulta pronta mais pesada (ordenar 1 milhão de itens) custa 139 mil, um join de três tabelas com 1 milhão de linhas, 44 mil; as que encheriam o disco ficam entre 96 e 773 milhões;
  - **teste de carga:** 12 `pg_sleep(10)` ao mesmo tempo, pelo pool de produção. As que pegam conexão são cortadas em 3 s (422), as que esperam demais recebem 503 com `Retry-After`; o visitante não passa de 5 conexões, o `/api/health` continua respondendo e, depois, uma consulta normal volta na hora;
  - **privilégios herdados:** o visitante não é membro de papel nenhum; `pg_read_file`, `pg_ls_dir`, `lo_import` e `SET temp_file_limit` são negados. As funções nativas do Postgres continuam executáveis (revogar exige superusuário) e ficam contidas por timeout, `work_mem` e o limite de custo.

  O banco de produção é um **projeto Neon só dele**: nada de outro sistema mora onde o visitante roda SQL.
- **Índice hipotético sem dar a HypoPG ao visitante:**
  - **o risco:** com acesso direto, `SELECT hypopg_create_index(...) FROM generate_series(1, 1000000)` encheria a memória da sessão;
  - **a solução:** ele só tem duas funções `SECURITY DEFINER`, que validam tabela e colunas com `%I` e aceitam no máximo 3 índices por sessão;
  - **um detalhe que pegou:** o índice hipotético **não some no `ROLLBACK`**, então cada conexão devolvida chama `hipotetico.limpar()`.
- **Dados com problemas de propósito:**
  - faltam índices em `pedidos.cliente_id` e `itens_pedido.produto_id`;
  - 70% dos pedidos estão entregues;
  - **cidade e UF andam juntas,** mas o planejador supõe colunas independentes: Curitiba/PR é estimado em 493 linhas e tem 3.880. É o cenário do alerta de estimativa errada.
- **Dados determinísticos:** `setseed` + fórmulas. Os planos dos testes e da documentação são iguais em qualquer máquina. O total do pedido é calculado antes de inserir, porque um `UPDATE` depois deixaria 200 mil linhas mortas e mudaria os planos.
- **Tempo próprio, não total:** o `Actual Total Time` é a média por execução e inclui os filhos. O gargalo aparece em média × execuções − filhos. Com workers paralelos os filhos podem somar mais que o pai, então o valor nunca fica negativo.
- **Abaixo de um `LIMIT`, vir menos linha que o estimado não é erro:** o nó parou cedo. Sem essa regra, todo Sort com LIMIT viraria "estimativa errada".
- **Erros pela pergunta "de quem é a falha?":**
  - sintaxe, escrita, permissão e tempo → **422** com o tipo e a posição na consulta enviada, descontado o `EXPLAIN (...)` que a API põe na frente;
  - banco fora → **503** com `Retry-After`, mensagem genérica e um `id` no log.
- **PRs de até 300 linhas**, cada um com um foco e testável sozinho. O histórico do repositório mostra a ordem: banco → API → leitor → tela → lançamento.

## Rodando

Precisa de Node 22 e Docker.

```bash
docker compose up -d db          # Postgres 16 + HypoPG na porta 5434, dono sem superusuário (igual ao Neon)
cd backend && cp .env.example .env
npm install && npm run dev       # API em http://localhost:3003 (a 1ª subida gera o milhão de itens, ~15 s)
cd ../frontend && npm install && npm run dev   # http://localhost:5175
```

Ou a imagem única (API + site):

```bash
docker build -t visualizador-explain .
docker run -p 3020:3003 -e DATABASE_URL=postgres://dono:dono-dev@host.docker.internal:5434/explain \
  -e VISITANTE_PASSWORD=uma-senha-longa-local visualizador-explain
```

## Testes

```bash
cd backend && npm test    # 44 testes contra PostgreSQL real (docker compose up -d db)
cd frontend && npm test   # 48 testes (Vitest + Vue Test Utils)
```

- **Banco:**
  - o visitante não escreve (nem forçando `READ WRITE`), não lê o `public` e não vira dono;
  - sem privilégio herdado: função nova do dono não fica executável, funções de servidor negadas;
  - a consulta lenta é cortada;
  - os dados têm o volume exato, e os totais batem com os itens;
  - os cenários do visualizador existem nos dados, inclusive a estimativa errada.
- **Execução:**
  - um comando por vez;
  - `set_config` e advisory lock não vazam para o próximo visitante;
  - a posição do erro de sintaxe sai certa;
  - consulta de custo absurdo volta só a estimativa (em menos de 1 s), e a consulta pronta mais pesada ainda roda com `ANALYZE`;
  - índice hipotético: usado × ignorado, nome com SQL embutido recusado, limite de 3, nada sobra para a próxima consulta.
- **API:**
  - 400/413/422/503 com a mensagem certa, rate limit com `Retry-After`;
  - **carga:** 12 consultas lentas ao mesmo tempo dão só 422/503, nunca 500, e o banco não passa de 5 conexões;
  - **toda rota está na OpenAPI**;
  - site: 404 de verdade, cache, compressão, robots/sitemap.
- **Leitor e alertas,** com **planos reais gravados** do banco de exemplo: tempo próprio no Nested Loop (média × 1.204 execuções), a estimativa só onde nasce e a regra do LIMIT.
- **Tela:**
  - árvore, painel e alertas;
  - a API com `fetch` simulado: sem rede, servidor acordando, 429;
  - o fluxo completo rodar → comparar índice → ver o plano com o índice → voltar;
  - consentimento LGPD.

O CI roda typecheck e testes, com o Postgres + HypoPG montado no próprio Actions. Também faz o build da imagem Docker e roda o gitleaks em todo o histórico.

## Deploy (Render + Neon)

1. No Neon, crie um **projeto só para este site** e copie a connection string **direta**, sem `-pooler`: as migrações usam advisory lock.
2. No Render: **New + → Blueprint** → este repositório (`render.yaml`). Cole a `DATABASE_URL`; a `VISITANTE_PASSWORD` é gerada pelo Render.
3. A primeira subida cria a HypoPG, o schema, o papel `visitante` e os dados de exemplo.
4. Opcional: `VITE_GA_ID` e `VITE_CLARITY_ID` (GA4 e Clarity, só depois do consentimento).

## Autor

Ademar C. Neto · [portfólio](https://ademarchamineto.github.io) · [GitHub](https://github.com/AdemarChamiNeto)
