import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import pg from "pg";
import { criarApp } from "./app.js";

// o site não toca no banco: um pool que nunca conecta basta
const pool = new pg.Pool({ connectionString: "postgres://x:x@127.0.0.1:1/x" });
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "site-"));
let server: Server;
let origem = "";

before(() => {
  fs.mkdirSync(path.join(pasta, "assets"));
  fs.writeFileSync(path.join(pasta, "index.html"), '<link rel="canonical" href="__PUBLIC_URL__/" />');
  fs.writeFileSync(path.join(pasta, "404.html"), "<h1>Não encontrada</h1>");
  fs.writeFileSync(path.join(pasta, "assets", "app-abc123.js"), "console.log(1)");
  fs.writeFileSync(path.join(pasta, "favicon.svg"), "<svg/>");
  server = criarApp(pool, { pastaSite: pasta, urlPublica: "https://explain.exemplo.com/" }).listen(0);
  origem = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server.close();
  await pool.end();
  fs.rmSync(pasta, { recursive: true, force: true });
});

test("a página troca __PUBLIC_URL__ pelo endereço real e não fica em cache", async () => {
  const res = await fetch(`${origem}/`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '<link rel="canonical" href="https://explain.exemplo.com/" />');
  assert.equal(res.headers.get("cache-control"), "no-cache");
});

test("arquivos do build com cache de 1 ano; outros arquivos com cache curto", async () => {
  const js = await fetch(`${origem}/assets/app-abc123.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get("cache-control") ?? "", /max-age=31536000, immutable/);
  assert.match((await fetch(`${origem}/favicon.svg`)).headers.get("cache-control") ?? "", /max-age=3600/);
});

test("caminho que não existe é 404 de verdade (HTML para página, JSON para a API)", async () => {
  const pagina = await fetch(`${origem}/qualquer-coisa`);
  assert.equal(pagina.status, 404);
  assert.equal(await pagina.text(), "<h1>Não encontrada</h1>");
  assert.equal((await fetch(`${origem}/assets/nao-existe.js`)).status, 404);
  const api = await fetch(`${origem}/api/nada`);
  assert.equal(api.status, 404);
  assert.deepEqual(await api.json(), { error: "Rota não encontrada" });
});
