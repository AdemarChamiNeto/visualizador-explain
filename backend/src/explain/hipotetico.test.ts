import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate, visitorUrl } from "../db/migrate.js";
import { compararIndice, ErroConsulta, explicar, listarTabelas } from "./executar.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://dono:dono-dev@localhost:5434/explain_test";
const PASSWORD = process.env.VISITANTE_PASSWORD ?? "visitante-dev";

let pool: pg.Pool;
before(async () => {
  await migrate(DATABASE_URL, PASSWORD, () => {});
  pool = new pg.Pool({ connectionString: visitorUrl(DATABASE_URL, PASSWORD), max: 1 }); // a mesma conexão sempre
});
after(() => pool?.end());

const tipoDoErro = (p: Promise<unknown>) =>
  p.then(() => assert.fail("deveria ter falhado"), (e) => (assert.ok(e instanceof ErroConsulta, String(e)), e as ErroConsulta));
const raiz = (plano: unknown) => (plano as { Plan: { "Node Type": string } }[])[0].Plan["Node Type"];

test("índice em pedidos(cliente_id): o Seq Scan vira busca pelo índice que não existe de verdade", async () => {
  const r = await compararIndice(pool, "SELECT * FROM pedidos WHERE cliente_id = 42", "pedidos", ["cliente_id"]);
  assert.equal(raiz(r.antes), "Seq Scan");
  assert.match(raiz(r.depois), /Index Scan|Bitmap Heap Scan/);
  assert.match(r.indice, /^<\d+>btree_loja_pedidos_cliente_id$/);
  assert.equal(r.usado, true);
});

test("índice que não ajuda a consulta: o planejador ignora (usado = false)", async () => {
  const r = await compararIndice(pool, "SELECT * FROM pedidos WHERE cliente_id = 42", "pedidos", ["status"]);
  assert.equal(raiz(r.depois), "Seq Scan");
  assert.equal(r.usado, false);
});

test("tabela e colunas validadas no banco: nem nome com SQL embutido passa", async () => {
  const inexistente = await tipoDoErro(compararIndice(pool, "SELECT 1", "pedidos (id); DROP TABLE pedidos; --", ["id"]));
  assert.equal(inexistente.tipo, "entrada");
  assert.match(inexistente.message, /não existe na loja/);
  assert.match((await tipoDoErro(compararIndice(pool, "SELECT 1", "pedidos", ["nao_existe"]))).message, /coluna "nao_existe" não existe/);
  assert.match((await tipoDoErro(compararIndice(pool, "SELECT 1", "pedidos", ["id", "id"]))).message, /colunas diferentes/);
  assert.match((await tipoDoErro(compararIndice(pool, "SELECT 1", "schema_migrations", ["name"]))).message, /não existe na loja/);
});

test("o visitante não chama a HypoPG direto (o schema public é fechado)", async () => {
  const e = await tipoDoErro(explicar(pool, "SELECT * FROM public.hypopg_create_index('CREATE INDEX ON pedidos (id)')"));
  assert.equal(e.tipo, "permissao");
});

test("no máximo 3 índices por sessão, e nada fica para a próxima consulta (o ROLLBACK não desfaz índice hipotético)", async () => {
  const e = await tipoDoErro(explicar(pool, "SELECT hipotetico.criar_indice('pedidos', ARRAY['status']) FROM generate_series(1, 1000)"));
  assert.equal(e.tipo, "limite");
  await explicar(pool, "SELECT hipotetico.criar_indice('pedidos', ARRAY['status']) FROM generate_series(1, 3)"); // deixa 3 criados...
  const r = await compararIndice(pool, "SELECT * FROM pedidos WHERE cliente_id = 42", "pedidos", ["cliente_id"]); // ...e mesmo assim cabe mais um
  assert.equal(r.usado, true);
});

test("lista as tabelas e colunas da loja (e só da loja)", async () => {
  const tabelas = await listarTabelas(pool);
  assert.deepEqual(tabelas.map((t) => t.tabela), ["categorias", "clientes", "itens_pedido", "pedidos", "produtos"]);
  assert.deepEqual(tabelas.find((t) => t.tabela === "pedidos")!.colunas, ["id", "cliente_id", "status", "criado_em", "total_centavos"]);
});
