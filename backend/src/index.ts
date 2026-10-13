import { z } from "zod";
import { migrate, visitorUrl } from "./db/migrate.js";
import { criarPoolVisitante } from "./explain/executar.js";
import { criarApp } from "./http/app.js";

// sobe só com as variáveis obrigatórias (o erro diz qual falta)
const env = z.object({
  DATABASE_URL: z.string().url(),
  VISITANTE_PASSWORD: z.string().min(16, "use uma senha longa (openssl rand -hex 24)"),
  PORT: z.coerce.number().int().default(3003),
  STATIC_DIR: z.string().optional(),
  // no Render o endereço público vem sozinho; PUBLIC_URL só para outra hospedagem
  PUBLIC_URL: z.string().url().optional(),
  RENDER_EXTERNAL_URL: z.string().url().optional(),
}).parse(process.env);
const urlPublica = env.PUBLIC_URL ?? env.RENDER_EXTERNAL_URL ?? `http://localhost:${env.PORT}`;

await migrate(env.DATABASE_URL, env.VISITANTE_PASSWORD);
const pool = criarPoolVisitante(visitorUrl(env.DATABASE_URL, env.VISITANTE_PASSWORD));
// erro numa conexão ociosa (banco reiniciou) não derruba o processo: o pool abre outra
pool.on("error", (err) => console.error("[pool] conexão perdida:", err.message));

const server = criarApp(pool, { pastaSite: env.STATIC_DIR, urlPublica }).listen(env.PORT, () => console.log(`Visualizador de EXPLAIN em ${urlPublica}`));
process.on("SIGTERM", () => server.close(() => void pool.end()));
