import pg from "pg";

/**
 * Roda o EXPLAIN da consulta de quem visita o site. O papel "visitante" já é só leitura e tem
 * timeout (migrations/002_loja.sql); aqui ficam as camadas que dependem de COMO a consulta roda:
 *  - protocolo estendido: o Postgres recusa mais de um comando ("SELECT 1; DROP ...");
 *  - transação READ ONLY com SET LOCAL a cada consulta (não confia no que a conexão traz);
 *  - ROLLBACK sempre + DISCARD ALL ao devolver a conexão: um set_config(..., false) ou um
 *    pg_advisory_lock() do visitante não passa para a consulta do próximo.
 */

export const MAX_SQL = 5000;
export const TIMEOUT_MS = 3000;

/** Falha de quem enviou a consulta (4xx): a mensagem do Postgres ajuda a corrigir. */
export class ErroConsulta extends Error {
  constructor(
    message: string,
    readonly tipo: "entrada" | "sintaxe" | "escrita" | "permissao" | "tempo" | "limite",
    /** Posição do erro (1 = primeiro caractere) na consulta enviada, quando o Postgres informa. */
    readonly posicao?: number,
  ) {
    super(message);
    this.name = "ErroConsulta";
  }
}

/** Falha nossa ou do banco (5xx): banco fora, conexões esgotadas. Mensagem genérica para quem chamou. */
export class ErroBanco extends Error {
  constructor(message: string, readonly causa?: unknown) {
    super(message);
    this.name = "ErroBanco";
  }
}

export type Explain = { plano: unknown; analyze: boolean };

/** Pool do visitante: poucas conexões (o papel aceita 5) e espera curta por uma livre. */
export function criarPoolVisitante(url: string) {
  return new pg.Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000 });
}

export function limparSql(sql: unknown): string {
  if (typeof sql !== "string") throw new ErroConsulta("Envie a consulta como texto.", "entrada");
  // ";" no fim é comum e inofensivo; no meio continua barrado pelo protocolo
  const limpo = sql.trim().replace(/;\s*$/, "").trim();
  if (!limpo) throw new ErroConsulta("Escreva uma consulta.", "entrada");
  if (limpo.length > MAX_SQL) throw new ErroConsulta(`Consulta grande demais (máximo de ${MAX_SQL} caracteres).`, "entrada");
  return limpo;
}

export async function explicar(pool: pg.Pool, sql: string, analyze = true): Promise<Explain> {
  const consulta = limparSql(sql);
  const prefixo = `EXPLAIN (${analyze ? "ANALYZE, BUFFERS, " : ""}FORMAT JSON) `;

  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (err) {
    throw new ErroBanco("Banco indisponível ou ocupado. Tente de novo em alguns segundos.", err);
  }
  let quebrada: Error | undefined;
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${TIMEOUT_MS}; SET LOCAL lock_timeout = 1000; SET LOCAL work_mem = '4MB'; SET LOCAL search_path = loja`);
    // queryMode existe no pg 8.23, mas ainda não nos tipos do @types/pg
    const config: pg.QueryConfig & { queryMode: "extended" } = { text: prefixo + consulta, queryMode: "extended" };
    const r = await client.query(config);
    return { plano: r.rows[0]["QUERY PLAN"], analyze };
  } catch (err) {
    throw traduzir(err, prefixo.length);
  } finally {
    try {
      await client.query("ROLLBACK");
      await client.query("DISCARD ALL");
    } catch (err) {
      quebrada = err as Error; // conexão em estado ruim: descarta em vez de devolver ao pool
    }
    client.release(quebrada);
  }
}

/** Erro do Postgres → de quem é a falha. Códigos em https://www.postgresql.org/docs/current/errcodes-appendix.html */
function traduzir(err: unknown, tamanhoPrefixo: number): Error {
  const e = err as { code?: string; message?: string; position?: string };
  const codigo = e.code ?? "";
  const msg = e.message ?? "erro desconhecido";
  const pos = e.position ? Number(e.position) - tamanhoPrefixo : undefined;
  const posicao = pos !== undefined && pos > 0 ? pos : undefined;

  if (codigo === "57014") return new ErroConsulta(`A consulta passou de ${TIMEOUT_MS / 1000} s e foi cancelada. Tente sem ANALYZE para ver só a estimativa.`, "tempo");
  if (codigo === "25006") return new ErroConsulta("Só consultas de leitura: o banco de exemplo não aceita alterações.", "escrita");
  if (codigo === "42501") return new ErroConsulta(`Sem permissão: ${msg}. Só as tabelas da loja estão liberadas.`, "permissao");
  if (codigo === "42601" && /multiple commands/.test(msg)) return new ErroConsulta("Envie um comando por vez.", "sintaxe");
  if (codigo.startsWith("53") || codigo.startsWith("54")) return new ErroConsulta(`A consulta passou de um limite do banco: ${msg}`, "limite");
  // classe 42 (sintaxe, tabela/coluna inexistente), 22 (dado inválido) e 0A (não suportado): erro na consulta
  if (/^(42|22|0A|21)/.test(codigo)) return new ErroConsulta(msg, "sintaxe", posicao);
  return new ErroBanco("O banco não conseguiu rodar a consulta agora. Tente de novo.", err);
}
