import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "./migrate.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://dono:dono-dev@localhost:5434/explain_test";
const PASSWORD = process.env.VISITANTE_PASSWORD ?? "visitante-dev";

let dono: pg.Client;
before(async () => {
  await migrate(DATABASE_URL, PASSWORD, () => {});
  dono = new pg.Client({ connectionString: DATABASE_URL });
  await dono.connect();
});
after(() => dono?.end());

test("o dono do banco não é superusuário (igual ao Neon)", async () => {
  const { rows } = await dono.query<{ rolsuper: boolean }>("SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
  assert.equal(rows[0].rolsuper, false);
});

test("migrar de novo não aplica nada", async () => {
  assert.deepEqual(await migrate(DATABASE_URL, PASSWORD, () => {}), []);
});

test("a HypoPG funciona: o plano usa um índice que não existe de verdade", async () => {
  await dono.query("CREATE TEMP TABLE numeros AS SELECT g AS n FROM generate_series(1, 50000) g");
  await dono.query("ANALYZE numeros");
  const plano = async () =>
    (await dono.query<{ "QUERY PLAN": string }>("EXPLAIN SELECT * FROM numeros WHERE n = 42")).rows.map((r) => r["QUERY PLAN"]).join("\n");

  assert.match(await plano(), /Seq Scan on numeros/);
  await dono.query("SELECT * FROM hypopg_create_index('CREATE INDEX ON numeros (n)')");
  assert.match(await plano(), /Index Only Scan using "<\d+>btree_numeros_n" on numeros/);
  // o índice é só da sessão e some no reset: nada foi gravado no catálogo
  assert.equal((await dono.query("SELECT * FROM pg_indexes WHERE tablename = 'numeros'")).rowCount, 0);
  await dono.query("SELECT hypopg_reset()");
  assert.match(await plano(), /Seq Scan on numeros/);
});
