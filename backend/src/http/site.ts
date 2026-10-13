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
  // arquivos do build têm hash no nome: cache de 1 ano (versão nova = nome novo)
  app.use("/assets", express.static(path.join(pasta, "assets"), { maxAge: "365d", immutable: true, fallthrough: false }));
  app.use(express.static(pasta, { maxAge: "1h", index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    res.status(404).type("html").send(naoEncontrada);
  });
}
