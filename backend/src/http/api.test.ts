import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import pg from "pg";
import { migrate, visitorUrl } from "../db/migrate.js";
import { criarApp } from "./app.js";
import { openapi } from "./openapi.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://dono:dono-dev@localhost:5434/explain_test";
const PASSWORD = process.env.VISITANTE_PASSWORD ?? "visitante-dev";

let pool: pg.Pool;
let server: Server;
let origem = "";

before(async () => {
  await migrate(DATABASE_URL, PASSWORD, () => {});
  pool = new pg.Pool({ connectionString: visitorUrl(DATABASE_URL, PASSWORD), max: 2 });
  process.env.EXPLAIN_RATE_LIMIT = "1000"; // o limite tem teste próprio no fim
  server = criarApp(pool).listen(0);
  origem = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server.close();
  await pool.end();
});

const post = async (corpo: unknown, url = origem, bruto?: string) => {
  const res = await fetch(`${url}/api/explain`, { method: "POST", headers: { "content-type": "application/json" }, body: bruto ?? JSON.stringify(corpo) });
  return { status: res.status, json: (await res.json()) as any, headers: res.headers };
};

test("POST /api/explain devolve o plano", async () => {
  const r = await post({ sql: "SELECT * FROM pedidos WHERE cliente_id = 42" });
  assert.equal(r.status, 200);
  assert.equal(r.json.analyze, true);
  assert.equal(r.json.plano[0].Plan["Node Type"], "Seq Scan");
  const sem = await post({ sql: "SELECT 1", analyze: false });
  assert.equal(sem.json.analyze, false);
});

test("falha da consulta é de quem enviou: 422 com o tipo e a posição; corpo errado é 400", async () => {
  const sintaxe = await post({ sql: "SELECT * FROM pedidos WHERE" });
  assert.equal(sintaxe.status, 422);
  assert.equal(sintaxe.json.tipo, "sintaxe");
  assert.equal(sintaxe.json.posicao, 28);
  assert.deepEqual((await post({ sql: "SELECT 1; DROP TABLE pedidos" })).json, { error: "Envie um comando por vez.", tipo: "sintaxe" });
  assert.equal((await post({ sql: "DELETE FROM pedidos" })).json.tipo, "escrita");

  assert.equal((await post({ sql: "   " })).status, 400);
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ sql: "SELECT 1", analyze: "sim" })).status, 400);
  assert.equal((await post({ sql: "SELECT 1", extra: 1 })).status, 400);
  assert.deepEqual((await post(null, origem, "{ quebrado")).json, { error: "JSON inválido." });
  assert.equal((await post({ sql: "x".repeat(30_000) })).status, 413);
});

test("índice hipotético por HTTP: 200 com os dois planos; coluna que não existe é 400; e a lista de tabelas", async () => {
  const chamar = (corpo: unknown) =>
    fetch(`${origem}/api/indice-hipotetico`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
  const ok = await chamar({ sql: "SELECT * FROM pedidos WHERE cliente_id = 42", tabela: "pedidos", colunas: ["cliente_id"] });
  assert.equal(ok.status, 200);
  const r = (await ok.json()) as { usado: boolean; antes: unknown[]; depois: unknown[] };
  assert.equal(r.usado, true);
  const ruim = await chamar({ sql: "SELECT 1", tabela: "pedidos", colunas: ["nao_existe"] });
  assert.equal(ruim.status, 400);
  assert.equal(((await ruim.json()) as { tipo: string }).tipo, "entrada");
  assert.equal((await chamar({ sql: "SELECT 1", tabela: "pedidos", colunas: ["a", "b", "c", "d"] })).status, 400);

  const tabelas = (await (await fetch(`${origem}/api/tabelas`)).json()) as { tabela: string }[];
  assert.equal(tabelas.length, 5);
});

test("banco fora é falha nossa: 503 com Retry-After e mensagem genérica com id", async () => {
  const fora = new pg.Pool({ connectionString: "postgres://visitante:x@127.0.0.1:1/nada", connectionTimeoutMillis: 500 });
  const s = criarApp(fora).listen(0);
  try {
    const r = await post({ sql: "SELECT 1" }, `http://127.0.0.1:${(s.address() as AddressInfo).port}`);
    assert.equal(r.status, 503);
    assert.equal(r.headers.get("retry-after"), "5");
    assert.match(r.json.id, /^[0-9a-f-]{36}$/);
    assert.ok(!JSON.stringify(r.json).includes("127.0.0.1"), "não vaza detalhe da conexão");
  } finally {
    s.close();
    await fora.end();
  }
});

test("cabeçalhos de segurança, sem x-powered-by e 404 em JSON", async () => {
  const res = await fetch(`${origem}/api/nada`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "Rota não encontrada" });
  assert.equal(res.headers.get("x-powered-by"), null);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.ok(res.headers.get("content-security-policy"));
});

test("OpenAPI: toda rota do app está documentada e nenhuma documentada some", () => {
  const src = fs.readFileSync(new URL("./app.ts", import.meta.url), "utf8");
  const declaradas = new Set([...src.matchAll(/app\.(get|post|put|patch|delete)\("([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`));
  const documentadas = new Set(Object.entries(openapi.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m} ${p}`)));
  assert.deepEqual([...declaradas].sort(), [...documentadas].sort());
});

test("rate limit: passou do limite, 429 com Retry-After", async () => {
  process.env.EXPLAIN_RATE_LIMIT = "2";
  const s = criarApp(pool).listen(0);
  try {
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    assert.equal((await post({ sql: "SELECT 1", analyze: false }, url)).status, 200);
    assert.equal((await post({ sql: "SELECT 1", analyze: false }, url)).status, 200);
    const r = await post({ sql: "SELECT 1", analyze: false }, url);
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get("retry-after")) > 0);
  } finally {
    s.close();
  }
});
