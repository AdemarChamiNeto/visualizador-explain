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

/** Código SQLSTATE do erro (ex.: 42501 = sem permissão). */
async function sqlstate(sql: string): Promise<string> {
  try {
    await visitante.query(sql);
  } catch (err) {
    await visitante.query("ROLLBACK").catch(() => {});
    return (err as { code: string }).code;
  }
  throw new Error(`deveria ter falhado: ${sql}`);
}

test("o visitante lê a loja sem precisar escrever o schema (search_path = loja)", async () => {
  const { rows } = await visitante.query<{ n: number }>("SELECT count(*)::int AS n FROM categorias WHERE nome = 'Livros'");
  assert.equal(rows[0].n, 1);
});

test("escrita barrada duas vezes: a transação é só leitura e, mesmo forçando, o papel não tem permissão", async () => {
  assert.equal(await sqlstate("INSERT INTO categorias (nome) VALUES ('x')"), "25006"); // read_only_sql_transaction
  await visitante.query("BEGIN READ WRITE");
  assert.equal(await sqlstate("INSERT INTO categorias (nome) VALUES ('x')"), "42501"); // insufficient_privilege
  await visitante.query("BEGIN READ WRITE");
  assert.equal(await sqlstate("CREATE TABLE loja.minha (id int)"), "42501");
  await visitante.query("BEGIN READ WRITE");
  assert.equal(await sqlstate("CREATE TABLE public.minha (id int)"), "42501");
});

test("não enxerga o que não é da loja (controle de migrações no schema public)", async () => {
  assert.equal(await sqlstate("SELECT * FROM public.schema_migrations"), "42501");
});

test("não consegue virar dono pelo set_config dentro de um SELECT", async () => {
  assert.equal(await sqlstate("SELECT set_config('role', 'dono', false)"), "42501");
});

test("consulta lenta é cortada pelo statement_timeout do papel (3 s)", async () => {
  const start = Date.now();
  assert.equal(await sqlstate("SELECT pg_sleep(10)"), "57014"); // query_canceled
  const took = Date.now() - start;
  assert.ok(took >= 2500 && took < 6000, `cortou em ${took} ms`);
});

test("migrar de novo mantém o login do visitante (a senha é redefinida a cada subida)", async () => {
  await migrate(DATABASE_URL, PASSWORD, () => {});
  const c = new pg.Client({ connectionString: visitorUrl(DATABASE_URL, PASSWORD) });
  await c.connect();
  await c.end();
});
