# Banco de dados

Roteiro de `_padroes/prompt-banco-de-dados.md` preenchido para este projeto, com as decisões e o porquê.

## Contexto
- **O que é:** visualizador de planos de execução do PostgreSQL. Quem visita escreve uma consulta, o servidor roda `EXPLAIN ANALYZE` num banco de exemplo e a tela mostra a árvore do plano com alertas.
- **Multi-tenant:** não. **Login:** não existe, então não há tabela de usuário, senha nem 2FA.
- **Banco:** PostgreSQL 16 + HypoPG, SQL puro com `pg`. Produção: um projeto **só para ele** no Neon. O visitante roda SQL ali, então nada de outro sistema pode morar no mesmo banco.
- **Acesso:** o navegador nunca fala com o banco; a API conecta como o papel `visitante`.

## Modelo (schema `loja`)
```
categorias 1──N produtos 1──N itens_pedido N──1 pedidos N──1 clientes
```
| Tabela | Linhas | Tamanho | Observação |
|---|---|---|---|
| categorias | 12 | 48 kB | |
| produtos | 2.000 | 272 kB | 5% inativos |
| clientes | 50.000 | 10 MB | 30% em São Paulo; cidade e UF correlacionadas |
| pedidos | 200.000 | 22 MB | 2024–2025; 70% entregues; poucos clientes compram muito |
| itens_pedido | 1.000.007 | 80 MB | 1 a 9 por pedido |

Os dados são **determinísticos** (`setseed` + fórmulas): os planos e os números deste documento são iguais em qualquer máquina, e um teste confere isso.

## Decisões
- **Fugi de três regras fixas do roteiro, de propósito.** O banco é só de leitura e de exemplo, e cada regra servia a um sistema que recebe escrita:
  - **chave `bigint`**, não UUID: o plano fica legível (`id = 42`), e ninguém vai expor ids a um cliente;
  - **sem soft delete e sem `updated_at`:** nada é apagado nem alterado;
  - **faltam índices de propósito:** `pedidos.cliente_id` e `itens_pedido.produto_id` não têm índice. São os exemplos clássicos de `Seq Scan` e os candidatos naturais para o índice hipotético.
- **Distribuições desiguais**, para os planos serem interessantes:
  - **status concentrado:** 70% dos pedidos estão entregues; `status = 'cancelado'` é seletivo, `status = 'entregue'` não;
  - **clientes concentrados:** poucos clientes têm muitos pedidos (`power(random(), 2)`);
  - **cidade e UF andam juntas,** mas o planejador supõe colunas independentes. `cidade = 'Curitiba' AND uf = 'PR'` é estimado em **493 linhas** e tem **3.880**. Esse é o cenário do alerta de "estimativa errada" (a correção seria `CREATE STATISTICS`).
- **Total do pedido calculado antes de inserir:** os itens são gerados primeiro numa tabela temporária. Um `UPDATE` depois deixaria 200 mil linhas mortas e inflaria a tabela, o que mudaria os planos.

## Segurança: o visitante roda SQL
O papel `visitante` é a parte mais sensível do projeto. Cada camada cobre o que a anterior pode deixar passar:

| Camada | O que barra |
|---|---|
| **Login próprio** (não `SET ROLE` a partir do dono) | `SELECT set_config('role', 'dono', false)` voltaria a ser dono; logado como visitante, não há para onde subir |
| **Só `SELECT` na `loja`**; banco e schema `public` negados por padrão | escrita, `CREATE TABLE`, ler `schema_migrations` |
| **`default_transaction_read_only`** | escrita, mesmo se alguma permissão escapar |
| **`statement_timeout` 3 s**, `lock_timeout` 1 s, `idle_in_transaction_session_timeout` 5 s | produto cartesiano, `pg_sleep`, conexão presa |
| **`work_mem` 4 MB** e **5 conexões** no máximo | ordenação gigante em memória, esgotar o banco |

Testado em `src/db/visitante.test.ts`. As camadas da API (um comando por vez, `SET LOCAL` a cada consulta, `DISCARD ALL` e `hypopg_reset()` ao devolver a conexão, rate limit) vêm no PR da API.

## Pontos de atenção
- **Ainda dá para ver e cancelar consultas do próprio papel:** o visitante enxerga, em `pg_stat_activity`, o texto das consultas de outros visitantes (o mesmo papel) e pode cancelá-las com `pg_cancel_backend`. Revogar isso exige superusuário, que o Neon não dá. O impacto é baixo (consultas de exemplo, sem dado pessoal) e o rate limit diminui o abuso.
- **O catálogo é visível:** `pg_catalog` mostra a estrutura da `loja`, o que é desejado num visualizador.
- **Tamanho:** ~120 MB, dentro dos 0,5 GB do plano grátis do Neon.
