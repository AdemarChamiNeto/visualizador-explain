import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate, visitorUrl } from "./migrate.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://dono:dono-dev@localhost:5434/explain_test";
const PASSWORD = process.env.VISITANTE_PASSWORD ?? "visitante-dev";

let visitante: pg.Client;
before(async () => {
  await migrate(DATABASE_URL, PASSWORD, () => {});
  visitante = new pg.Client({ connectionString: visitorUrl(DATABASE_URL, PASSWORD) });
  await visitante.connect();
});
after(() => visitante?.end());

const one = async <T>(sql: string) => (await visitante.query(sql)).rows[0] as T;
const plano = async (sql: string) =>
  (await visitante.query<{ "QUERY PLAN": string }>(`EXPLAIN ${sql}`)).rows.map((r) => r["QUERY PLAN"]).join("\n");

test("volume e números sempre iguais (dados determinísticos)", async () => {
  const n = await one<Record<string, number>>(`SELECT
    (SELECT count(*) FROM categorias)::int AS categorias, (SELECT count(*) FROM produtos)::int AS produtos,
    (SELECT count(*) FROM clientes)::int AS clientes, (SELECT count(*) FROM pedidos)::int AS pedidos,
    (SELECT count(*) FROM itens_pedido)::int AS itens`);
  let itens = 0;
  for (let g = 1; g <= 200_000; g++) itens += 1 + ((g * 7919) % 9); // a mesma fórmula da migração
  assert.deepEqual(n, { categorias: 12, produtos: 2000, clientes: 50_000, pedidos: 200_000, itens });
});

test("o total de cada pedido bate com os itens", async () => {
  const { erradas } = await one<{ erradas: number }>(`SELECT count(*)::int AS erradas FROM pedidos p
    JOIN (SELECT pedido_id, sum(quantidade * preco_unitario_centavos) AS total FROM itens_pedido GROUP BY pedido_id) i
      ON i.pedido_id = p.id
    WHERE i.total <> p.total_centavos`);
  assert.equal(erradas, 0);
});

test("os cenários do visualizador existem: sem índice vira Seq Scan, com índice não", async () => {
  assert.match(await plano("SELECT * FROM pedidos WHERE cliente_id = 42"), /Seq Scan on pedidos/);
  assert.match(await plano("SELECT * FROM itens_pedido WHERE produto_id = 7"), /Seq Scan on itens_pedido/);
  assert.match(await plano("SELECT * FROM pedidos WHERE criado_em >= '2025-03-01' AND criado_em < '2025-03-02'"), /Index Scan|Bitmap Index Scan/);
  assert.match(await plano("SELECT * FROM clientes WHERE email = 'cliente42@exemplo.com'"), /Index Scan using clientes_email_key/);
});

test("cidade e UF correlacionadas: o planejador erra a estimativa (cenário de 'estimativa errada')", async () => {
  const real = (await one<{ n: number }>("SELECT count(*)::int AS n FROM clientes WHERE cidade = 'Curitiba' AND uf = 'PR'")).n;
  const estimada = Number(/rows=(\d+)/.exec(await plano("SELECT * FROM clientes WHERE cidade = 'Curitiba' AND uf = 'PR'"))![1]);
  assert.ok(real > estimada * 2, `real ${real}, estimada ${estimada}`);
});
