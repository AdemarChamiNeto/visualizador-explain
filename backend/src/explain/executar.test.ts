import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate, visitorUrl } from "../db/migrate.js";
import { criarPoolVisitante, ErroConsulta, explicar } from "./executar.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://dono:dono-dev@localhost:5434/explain_test";
const PASSWORD = process.env.VISITANTE_PASSWORD ?? "visitante-dev";

let pool: pg.Pool;
before(async () => {
  await migrate(DATABASE_URL, PASSWORD, () => {});
  // UMA conexão: toda consulta reusa a mesma e mostra se algo vaza de uma para a outra
  pool = new pg.Pool({ connectionString: visitorUrl(DATABASE_URL, PASSWORD), max: 1 });
});
after(() => pool?.end());

type Topo = { Plan: Record<string, unknown>; "Execution Time"?: number };
const plano = async (sql: string, analyze = true) => ((await explicar(pool, sql, analyze)).plano as Topo[])[0];

async function falha(sql: string): Promise<ErroConsulta> {
  try {
    await explicar(pool, sql);
  } catch (err) {
    assert.ok(err instanceof ErroConsulta, `esperava ErroConsulta, veio ${err}`);
    return err;
  }
  throw new Error(`deveria ter falhado: ${sql}`);
}

test("devolve o plano em JSON, com ANALYZE (tempo real) ou só a estimativa", async () => {
  const comAnalyze = await plano("SELECT * FROM pedidos WHERE cliente_id = 42;");
  assert.equal(comAnalyze.Plan["Node Type"], "Seq Scan");
  assert.equal(typeof comAnalyze["Execution Time"], "number");
  const semAnalyze = await plano("SELECT * FROM pedidos WHERE cliente_id = 42", false);
  assert.equal(semAnalyze["Execution Time"], undefined);
  assert.equal(semAnalyze.Plan["Actual Rows"], undefined);
});

test("um comando por vez: o segundo comando nunca roda", async () => {
  const e = await falha("SELECT 1; DROP TABLE pedidos");
  assert.equal(e.tipo, "sintaxe");
  assert.equal(e.message, "Envie um comando por vez.");
  assert.equal((await plano("SELECT count(*) FROM pedidos")).Plan["Node Type"], "Aggregate"); // a tabela continua lá
});

test("escrita barrada, mesmo dentro do EXPLAIN ANALYZE (que executa de verdade)", async () => {
  assert.equal((await falha("DELETE FROM pedidos")).tipo, "escrita");
  assert.equal((await falha("SELECT * FROM pedidos FOR UPDATE")).tipo, "escrita");
});

test("erro de sintaxe aponta a posição na consulta enviada, não no texto com o EXPLAIN na frente", async () => {
  const e = await falha("SELECT * FROM pedidos WHERE");
  assert.equal(e.tipo, "sintaxe");
  assert.equal(e.posicao, "SELECT * FROM pedidos WHERE".length + 1);
  assert.match((await falha("SELECT * FROM nao_existe")).message, /nao_existe/);
});

test("consulta lenta é cancelada em 3 s", async () => {
  const inicio = Date.now();
  assert.equal((await falha("SELECT pg_sleep(10)")).tipo, "tempo");
  assert.ok(Date.now() - inicio < 5000);
});

test("o visitante não desliga o timeout para a próxima consulta (set_config de sessão é desfeito)", async () => {
  await plano("SELECT set_config('statement_timeout', '0', false)");
  assert.equal((await falha("SELECT pg_sleep(10)")).tipo, "tempo");
});

test("advisory lock do visitante não fica preso na conexão do pool", async () => {
  await plano("SELECT pg_advisory_lock(424242)");
  const dono = new pg.Client({ connectionString: DATABASE_URL });
  await dono.connect();
  try {
    const { rows } = await dono.query<{ ok: boolean }>("SELECT pg_try_advisory_lock(424242) AS ok");
    assert.equal(rows[0].ok, true);
  } finally {
    await dono.end();
  }
});

test("entrada inválida nem chega ao banco", async () => {
  for (const sql of ["", "   ;  ", "x".repeat(5001)]) assert.equal((await falha(sql)).tipo, "entrada");
});

test("o pool de produção respeita o limite de conexões do papel", () => {
  const p = criarPoolVisitante(visitorUrl(DATABASE_URL, PASSWORD));
  assert.equal(p.options.max, 3);
  return p.end();
});
