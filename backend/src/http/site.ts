import fs from "node:fs";
import path from "node:path";
import express, { type Express } from "express";

/**
 * Entrega o front compilado. A página é uma só ("/"): qualquer outro caminho é 404 de verdade
 * (buscador não indexa "página não encontrada" que responde 200). O __PUBLIC_URL__ do HTML vira o
 * endereço real do deploy (canonical, Open Graph), que no Render vem de RENDER_EXTERNAL_URL.
 */
export function servirSite(app: Express, pasta: string, urlPublica: string) {
  const arquivo = (nome: string) => path.resolve(pasta, nome);
  if (!fs.existsSync(arquivo("index.html"))) return;
  const base = urlPublica.replace(/\/$/, "");
  const ler = (nome: string) => fs.readFileSync(arquivo(nome), "utf8").replaceAll("__PUBLIC_URL__", base);
  const index = ler("index.html");
  const naoEncontrada = fs.existsSync(arquivo("404.html")) ? ler("404.html") : "<h1>Página não encontrada</h1>";

  app.get("/", (_req, res) => void res.type("html").set("Cache-Control", "no-cache").send(index));
  if (fs.existsSync(arquivo("privacidade.html"))) {
    const privacidade = ler("privacidade.html");
    app.get("/privacidade.html", (_req, res) => void res.type("html").send(privacidade));
  }

  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send(["User-agent: *", "Allow: /", "Disallow: /api/", "", `Sitemap: ${base}/sitemap.xml`, ""].join("\n"));
  });
  app.get("/sitemap.xml", (_req, res) => {
    const urls = ["/", "/privacidade.html"].map((p) => `  <url><loc>${base}${p}</loc></url>`).join("\n");
    res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  });
  app.get("/llms.txt", (_req, res) => {
    res.type("text/plain").send(`# Visualizador de EXPLAIN do PostgreSQL

> Roda EXPLAIN ANALYZE num banco de exemplo (uma loja com 1 milhão de itens) ou lê o plano colado, e mostra a árvore com o tempo próprio de cada nó, alertas (Seq Scan, estimativa errada, ordenação em disco, Nested Loop pesado) e a comparação com um índice hipotético (HypoPG). Projeto de portfólio de Ademar C. Neto.

- [Visualizador](${base}/): exemplos prontos em ${base}/#exemplo=juncao
- [API (OpenAPI)](${base}/api/docs.json): POST /api/explain e POST /api/indice-hipotetico
- [Privacidade](${base}/privacidade.html)
- [Código-fonte](https://github.com/AdemarChamiNeto/visualizador-explain)
`);
  });
  // arquivos do build têm hash no nome: cache de 1 ano (versão nova = nome novo)
  app.use("/assets", express.static(path.join(pasta, "assets"), { maxAge: "365d", immutable: true, fallthrough: false }));
  app.use(express.static(pasta, { maxAge: "1h", index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    res.status(404).type("html").send(naoEncontrada);
  });
}
