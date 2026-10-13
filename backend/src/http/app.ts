import crypto from "node:crypto";
import compression from "compression";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type pg from "pg";
import { z } from "zod";
import { compararIndice, ErroBanco, ErroConsulta, explicar, listarTabelas, MAX_SQL, type Tabela } from "../explain/executar.js";
import { openapi } from "./openapi.js";
import { servirSite } from "./site.js";

const MIN = 60_000;
const limite = (por: number, nome: string) =>
  rateLimit({
    windowMs: MIN,
    limit: Number(process.env[nome] ?? por),
    standardHeaders: "draft-7", // RateLimit + Retry-After
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
    message: { error: "Muitas consultas. Espere um pouco e tente de novo." },
  });

const corpoExplain = z.object({
  sql: z.string().max(MAX_SQL + 100), // a margem cobre o ";" e espaços que o executor tira
  analyze: z.boolean().default(true),
}).strict();

const nome = z.string().min(1).max(63);
const corpoIndice = z.object({
  sql: corpoExplain.shape.sql,
  tabela: nome,
  colunas: z.array(nome).min(1).max(3),
}).strict();

const invalido = (issues: z.ZodIssue[]) => ({
  details: issues.map((i) => ({ field: i.path.join("."), message: i.message })),
});

export type OpcoesApp = {
  /** Pasta do front compilado (produção: a mesma imagem serve API e site). */
  pastaSite?: string;
  urlPublica?: string;
};

/** Monta o app sem abrir porta (os testes sobem em memória). O pool é o do papel visitante. */
export function criarApp(pool: pg.Pool, opcoes: OpcoesApp = {}) {
  const app = express();
  app.set("trust proxy", 1); // atrás do proxy do Render: o IP real vem do X-Forwarded-For
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(compression()); // JS, CSS e o JSON dos planos (que é grande) vão comprimidos

  // sem CORS: front e API no mesmo domínio. Corpo pequeno: a consulta tem no máximo 5 mil caracteres
  app.use("/api", express.json({ limit: "20kb" }), limite(120, "READ_RATE_LIMIT"));
  app.get("/api/health", (_req, res) => void res.json({ ok: true }));
  app.get("/api/docs.json", (_req, res) => void res.json(openapi));

  // cada EXPLAIN ANALYZE pode ocupar uma conexão por até 3 s: limite bem menor que o de leitura
  const explainLimit = limite(20, "EXPLAIN_RATE_LIMIT"); // vale para as duas rotas que rodam consulta
  app.post("/api/explain", explainLimit, async (req, res) => {
    const corpo = corpoExplain.safeParse(req.body);
    if (!corpo.success) {
      return void res.status(400).json({
        error: "Envie { sql: texto, analyze?: true | false }.", ...invalido(corpo.error.issues),
      });
    }
    res.json(await explicar(pool, corpo.data.sql, corpo.data.analyze));
  });

  app.post("/api/indice-hipotetico", explainLimit, async (req, res) => {
    const corpo = corpoIndice.safeParse(req.body);
    if (!corpo.success) {
      return void res.status(400).json({ error: "Envie { sql, tabela, colunas: [1 a 3 colunas] }.", ...invalido(corpo.error.issues) });
    }
    res.json(await compararIndice(pool, corpo.data.sql, corpo.data.tabela, corpo.data.colunas));
  });

  // o schema não muda enquanto o servidor roda: consulta uma vez (e de novo se der erro)
  let tabelas: Promise<Tabela[]> | null = null;
  app.get("/api/tabelas", async (_req, res) => {
    tabelas ??= listarTabelas(pool).catch((err) => { tabelas = null; throw err; });
    res.json(await tabelas);
  });

  app.use("/api", (_req, res) => void res.status(404).json({ error: "Rota não encontrada" }));
  if (opcoes.pastaSite) servirSite(app, opcoes.pastaSite, opcoes.urlPublica ?? "");
  app.use(tratarErro);
  return app;
}

/** 4xx = falha de quem chamou (mensagem do que corrigir); 5xx = nossa (genérica + id no log, sem stack). */
function tratarErro(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ErroConsulta) {
    return void res.status(err.tipo === "entrada" ? 400 : 422).json({ error: err.message, tipo: err.tipo, ...(err.posicao ? { posicao: err.posicao } : {}) });
  }
  const tipo = (err as { type?: string }).type; // vindos do express.json
  if (tipo === "entity.too.large") return void res.status(413).json({ error: "Consulta grande demais." });
  if (tipo === "entity.parse.failed") return void res.status(400).json({ error: "JSON inválido." });
  // 4xx vindo de biblioteca (ex.: arquivo de /assets que não existe): é de quem pediu, não erro nosso
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return void res.status(status).json({ error: status === 404 ? "Não encontrado." : "Requisição inválida." });
  }

  const id = crypto.randomUUID();
  console.error(`[erro ${id}] ${req.method} ${req.path}:`, err instanceof ErroBanco ? err.causa ?? err : err);
  if (err instanceof ErroBanco) return void res.status(503).set("Retry-After", "5").json({ error: err.message, id });
  res.status(500).json({ error: "Erro interno.", id });
}
