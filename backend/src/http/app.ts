import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type pg from "pg";
import { z } from "zod";
import { ErroBanco, ErroConsulta, explicar, MAX_SQL } from "../explain/executar.js";
import { openapi } from "./openapi.js";

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

/** Monta o app sem abrir porta (os testes sobem em memória). O pool é o do papel visitante. */
export function criarApp(pool: pg.Pool) {
  const app = express();
  app.set("trust proxy", 1); // atrás do proxy do Render: o IP real vem do X-Forwarded-For
  app.disable("x-powered-by");
  app.use(helmet());

  // sem CORS: front e API no mesmo domínio. Corpo pequeno: a consulta tem no máximo 5 mil caracteres
  app.use("/api", express.json({ limit: "20kb" }), limite(120, "READ_RATE_LIMIT"));
  app.get("/api/health", (_req, res) => void res.json({ ok: true }));
  app.get("/api/docs.json", (_req, res) => void res.json(openapi));

  // cada EXPLAIN ANALYZE pode ocupar uma conexão por até 3 s: limite bem menor que o de leitura
  app.post("/api/explain", limite(20, "EXPLAIN_RATE_LIMIT"), async (req, res) => {
    const corpo = corpoExplain.safeParse(req.body);
    if (!corpo.success) {
      return void res.status(400).json({
        error: "Envie { sql: texto, analyze?: true | false }.",
        details: corpo.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    res.json(await explicar(pool, corpo.data.sql, corpo.data.analyze));
  });

  app.use("/api", (_req, res) => void res.status(404).json({ error: "Rota não encontrada" }));
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

  const id = crypto.randomUUID();
  console.error(`[erro ${id}] ${req.method} ${req.path}:`, err instanceof ErroBanco ? err.causa ?? err : err);
  if (err instanceof ErroBanco) return void res.status(503).set("Retry-After", "5").json({ error: err.message, id });
  res.status(500).json({ error: "Erro interno.", id });
}
