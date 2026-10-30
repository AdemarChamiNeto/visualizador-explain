import pg from "pg";

/**
 * Roda o EXPLAIN da consulta de quem visita o site. O papel "visitante" já é só leitura e tem
 * timeout (migrations/002_loja.sql); aqui ficam as camadas que dependem de COMO a consulta roda:
 *  - protocolo estendido: o Postgres recusa mais de um comando ("SELECT 1; DROP ...");
 *  - transação READ ONLY com SET LOCAL a cada consulta (não confia no que a conexão traz);
 *  - ROLLBACK sempre + hipotetico.limpar() + DISCARD ALL ao devolver a conexão: um
 *    set_config(..., false), um pg_advisory_lock() ou um índice hipotético (que não some no
 *    ROLLBACK) do visitante não passa para a consulta do próximo.
 */

export const MAX_SQL = 5000;
export const TIMEOUT_MS = 3000;
/**
 * Acima deste custo estimado o ANALYZE não roda: a pessoa recebe só o plano estimado. O timeout corta
 * a consulta em 3 s, mas não o disco: um auto-join de itens_pedido escreveu 1,8 GB de arquivo
 * temporário antes de ser cancelado, e o temp_file_limit exige superusuário (que o Neon não dá).
 * Medido em 30/10/2026: a consulta pronta mais pesada custa 139 mil; o auto-join, 96 milhões.
 */
export const CUSTO_MAX_ANALYZE = 5_000_000;

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

export type Explain = { plano: unknown; analyze: boolean; aviso?: string };

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
  const estimativa = "EXPLAIN (FORMAT JSON) ";
  if (!analyze) return naConexao(pool, estimativa.length, async (c) => ({ plano: await rodar(c, estimativa + consulta), analyze }));

  const prefixo = "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ";
  // erro de sintaxe aparece já na estimativa (a primeira a rodar): a posição desconta o prefixo dela
  return naConexao(pool, estimativa.length, async (c) => {
    // antes de executar de verdade, a estimativa (não roda nada): consulta absurda não vai ao disco
    let plano: unknown;
    await c.query("SAVEPOINT estimativa");
    try {
      plano = await rodar(c, estimativa + consulta);
    } catch (err) {
      // sem permissão já na estimativa (ex.: DELETE): o ANALYZE falha no mesmo ponto, antes de executar,
      // e com o erro mais claro ("só leitura", da transação READ ONLY)
      if ((err as { code?: string }).code !== "42501") throw err;
      await c.query("ROLLBACK TO SAVEPOINT estimativa");
      return { plano: await rodar(c, prefixo + consulta), analyze };
    }
    const custo = custoTotal(plano);
    if (custo > CUSTO_MAX_ANALYZE) {
      const aviso = `Consulta pesada demais para rodar de verdade aqui (custo estimado ${Math.round(custo).toLocaleString("pt-BR")}). Este é só o plano estimado, sem ANALYZE.`;
      return { plano, analyze: false, aviso };
    }
    return { plano: await rodar(c, prefixo + consulta), analyze };
  });
}

/** "Total Cost" do nó raiz do EXPLAIN (FORMAT JSON); 0 se o formato vier diferente. */
function custoTotal(plano: unknown): number {
  const raiz = (plano as { Plan?: { "Total Cost"?: number } }[] | undefined)?.[0]?.Plan;
  return typeof raiz?.["Total Cost"] === "number" ? raiz["Total Cost"] : 0;
}

export type Comparacao = { antes: unknown; depois: unknown; indice: string; usado: boolean };

/**
 * Plano antes e depois de um índice hipotético. Sem ANALYZE nos dois: o ANALYZE executa de
 * verdade e um índice que não existe não pode ser usado na execução, só no planejamento.
 */
export async function compararIndice(pool: pg.Pool, sql: string, tabela: string, colunas: string[]): Promise<Comparacao> {
  const consulta = limparSql(sql);
  const prefixo = "EXPLAIN (FORMAT JSON) ";
  return naConexao(pool, prefixo.length, async (c) => {
    const antes = await rodar(c, prefixo + consulta);
    const { rows } = await c.query<{ nome: string }>("SELECT hipotetico.criar_indice($1, $2) AS nome", [tabela, colunas]);
    const depois = await rodar(c, prefixo + consulta);
    const indice = rows[0].nome;
    return { antes, depois, indice, usado: JSON.stringify(depois).includes(`"Index Name":${JSON.stringify(indice)}`) };
  });
}

export type Tabela = { tabela: string; colunas: string[] };

/** Tabelas e colunas da loja, na ordem do schema (para a tela oferecer no índice hipotético). */
export async function listarTabelas(pool: pg.Pool): Promise<Tabela[]> {
  return naConexao(pool, 0, async (c) => (await c.query<Tabela>(
    `SELECT table_name AS tabela, array_agg(column_name::text ORDER BY ordinal_position) AS colunas
       FROM information_schema.columns WHERE table_schema = 'loja' GROUP BY table_name ORDER BY table_name`,
  )).rows);
}

/** Uma conexão do pool, numa transação só leitura, sempre limpa ao devolver. */
async function naConexao<T>(pool: pg.Pool, tamanhoPrefixo: number, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
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
    return await fn(client);
  } catch (err) {
    throw traduzir(err, tamanhoPrefixo);
  } finally {
    try {
      await client.query("ROLLBACK");
      await client.query("SELECT hipotetico.limpar()");
      await client.query("DISCARD ALL");
    } catch (err) {
      quebrada = err as Error; // conexão em estado ruim: descarta em vez de devolver ao pool
    }
    client.release(quebrada);
  }
}

async function rodar(c: pg.PoolClient, texto: string): Promise<unknown> {
  // protocolo estendido: um comando só. queryMode existe no pg 8.23, mas ainda não nos tipos do @types/pg
  const config: pg.QueryConfig & { queryMode: "extended" } = { text: texto, queryMode: "extended" };
  return (await c.query(config)).rows[0]["QUERY PLAN"];
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
  if (codigo === "22023") return new ErroConsulta(msg, "entrada"); // validação do índice hipotético
  if (codigo.startsWith("53") || codigo.startsWith("54")) return new ErroConsulta(`A consulta passou de um limite do banco: ${msg}`, "limite");
  // classe 42 (sintaxe, tabela/coluna inexistente), 22 (dado inválido) e 0A (não suportado): erro na consulta
  if (/^(42|22|0A|21)/.test(codigo)) return new ErroConsulta(msg, "sintaxe", posicao);
  return new ErroBanco("O banco não conseguiu rodar a consulta agora. Tente de novo.", err);
}
