import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import pg from "pg";
import { migrate, visitorUrl } from "../db/migrate.js";
import { criarPoolVisitante } from "../explain/executar.js";
import { criarApp } from "./app.js";

// Esgotamento de recursos: muita consulta lenta ao mesmo tempo. Usa o pool de produção (3 conexões,
// espera de 5 s por uma livre) para medir o comportamento que o site tem no ar.
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://dono:dono-dev@localhost:5434/explain_test";
const PASSWORD = process.env.VISITANTE_PASSWORD ?? "visitante-dev";

let pool: pg.Pool;
let dono: pg.Client;
let server: Server;
let origem = "";

before(async () => {
  await migrate(DATABASE_URL, PASSWORD, () => {});
  pool = criarPoolVisitante(visitorUrl(DATABASE_URL, PASSWORD));
  dono = new pg.Client({ connectionString: DATABASE_URL });
  await dono.connect();
  process.env.EXPLAIN_RATE_LIMIT = "1000"; // aqui o assunto é o banco, não o rate limit
  server = criarApp(pool).listen(0);
  origem = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server.close();
  await pool.end();
  await dono.end();
});

const explain = (sql: string) =>
  fetch(`${origem}/api/explain`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql }) });

test("12 consultas lentas ao mesmo tempo: o banco não passa do limite e a API responde 422 ou 503, nunca 500", async () => {
  const conexoes: number[] = [];
  const medir = setInterval(() => {
    dono.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = 'visitante'")
      .then((r) => conexoes.push(r.rows[0].n), () => {});
  }, 200);

  const pedidos = Array.from({ length: 12 }, () => explain("SELECT pg_sleep(10)"));
  // no meio da carga, a API continua respondendo o que não depende do banco
  await new Promise((r) => setTimeout(r, 1000));
  const inicioSaude = Date.now();
  assert.equal((await fetch(`${origem}/api/health`)).status, 200);
  assert.ok(Date.now() - inicioSaude < 500, "health demorou com o banco ocupado");

  const respostas = await Promise.all(pedidos);
  clearInterval(medir);
  const status = respostas.map((r) => r.status);
  assert.deepEqual([...new Set(status)].filter((s) => s !== 422 && s !== 503), [], `status inesperado: ${status}`);
  assert.ok(status.filter((s) => s === 422).length >= 3, "as que pegaram conexão são cortadas no tempo (422)");
  assert.ok(status.filter((s) => s === 503).length >= 1, "as que esperaram demais por conexão recebem 503");
  for (const r of respostas.filter((r) => r.status === 503)) assert.equal(r.headers.get("retry-after"), "5");
  assert.ok(Math.max(...conexoes) <= 5, `visitante abriu ${Math.max(...conexoes)} conexões (o papel aceita 5)`);

  // passada a carga, nenhuma conexão ficou presa: uma consulta normal volta na hora
  const depois = await explain("SELECT count(*) FROM pedidos");
  assert.equal(depois.status, 200);
});
