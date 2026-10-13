import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");
/** Número fixo para o advisory lock: duas instâncias subindo juntas não migram ao mesmo tempo. */
const LOCK_ID = 7_340_002;

/**
 * Aplica, em ordem, os arquivos de migrations/ que ainda não rodaram (cada um numa transação)
 * e define a senha do papel visitante. Roda como o dono do banco.
 */
export async function migrate(databaseUrl: string, visitorPassword: string, log: (msg: string) => void = console.log): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Set((await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    const files = fs.readdirSync(DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      await client.query("BEGIN");
      try {
        await client.query(fs.readFileSync(path.join(DIR, file), "utf8"));
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migração ${file} falhou: ${(err as Error).message}`);
      }
      applied.push(file);
      log(`migração aplicada: ${file}`);
    }
    // a senha vem do ambiente e é trocada a cada subida (ALTER ROLE não aceita parâmetro $1)
    await client.query(`ALTER ROLE visitante WITH LOGIN PASSWORD ${client.escapeLiteral(visitorPassword)}`);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    await client.end();
  }
  return applied;
}

/** URL de conexão do visitante: o mesmo servidor e banco do dono, com o usuário e a senha do visitante. */
export function visitorUrl(databaseUrl: string, visitorPassword: string): string {
  const u = new URL(databaseUrl);
  u.username = "visitante";
  u.password = visitorPassword;
  return u.toString();
}
