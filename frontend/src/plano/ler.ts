import type { No, Plano } from "./tipos";

/**
 * Lê a saída de EXPLAIN (FORMAT JSON), com ou sem ANALYZE. Roda no navegador: o plano colado
 * nunca vai para o servidor. Entrada ruim vira PlanoInvalido com uma mensagem que diz o que fazer.
 */

export class PlanoInvalido extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanoInvalido";
  }
}

export const MAX_TEXTO = 2_000_000;
const MAX_NOS = 5000;
const MAX_PROFUNDIDADE = 200;
/** Campos que viram propriedades do nó; o resto fica em `campos`. */
const LIDOS = new Set([
  "Node Type", "Relation Name", "CTE Name", "Function Name", "Index Name", "Parent Relationship",
  "Total Cost", "Plan Rows", "Actual Rows", "Actual Loops", "Actual Total Time", "Plans",
]);

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function lerTexto(texto: string): Plano {
  if (texto.length > MAX_TEXTO) throw new PlanoInvalido("Plano grande demais (máximo de 2 MB).");
  const t = texto.trim();
  if (!t) throw new PlanoInvalido("Cole a saída de EXPLAIN (FORMAT JSON).");
  // formato texto (o padrão do psql): dá para reconhecer e dizer como gerar o JSON
  if (/^[^[{]*(Seq Scan|Index Scan|Hash Join|Nested Loop|QUERY PLAN|->)/.test(t)) {
    throw new PlanoInvalido("Esse plano está em formato texto. Rode de novo com EXPLAIN (ANALYZE, FORMAT JSON) e cole o resultado.");
  }
  let json: unknown;
  try {
    json = JSON.parse(t);
  } catch {
    throw new PlanoInvalido("Não é um JSON válido. Copie a saída inteira de EXPLAIN (FORMAT JSON), de [ até ].");
  }
  return lerPlano(json);
}

export function lerPlano(entrada: unknown): Plano {
  // o EXPLAIN devolve [ { "Plan": ... } ]; aceitamos também o objeto sem o colchete
  const topo = Array.isArray(entrada) ? entrada[0] : entrada;
  if (!isObj(topo) || !isObj(topo.Plan)) throw new PlanoInvalido('O JSON não parece um plano do EXPLAIN: falta o campo "Plan".');

  let totalNos = 0;
  const comAnalyze = num(topo.Plan["Actual Total Time"]) !== null;

  const ler = (j: Json, id: string, profundidade: number): No => {
    if (++totalNos > MAX_NOS) throw new PlanoInvalido(`Plano com mais de ${MAX_NOS} nós.`);
    if (profundidade > MAX_PROFUNDIDADE) throw new PlanoInvalido("Plano aninhado demais.");
    const tipo = j["Node Type"];
    const custo = num(j["Total Cost"]);
    const estimadas = num(j["Plan Rows"]);
    if (typeof tipo !== "string" || custo === null || estimadas === null) {
      throw new PlanoInvalido(`Nó ${id} sem "Node Type", "Total Cost" ou "Plan Rows": o JSON não parece um plano do EXPLAIN.`);
    }
    const filhos = (Array.isArray(j.Plans) ? j.Plans : []).map((f, i) => {
      if (!isObj(f)) throw new PlanoInvalido(`Nó ${id}.${i} inválido.`);
      return ler(f, `${id}.${i}`, profundidade + 1);
    });

    const tempoPorExecucao = num(j["Actual Total Time"]);
    const execucoes = num(j["Actual Loops"]) ?? 1;
    const real =
      comAnalyze && tempoPorExecucao !== null
        ? {
            linhas: num(j["Actual Rows"]) ?? 0,
            execucoes,
            // o "Actual Total Time" é a média por execução: o tempo gasto de verdade é média × execuções
            tempoTotalMs: tempoPorExecucao * execucoes,
            tempoProprioMs: 0,
            percentual: 0,
          }
        : null;

    const campos: Json = {};
    for (const [k, v] of Object.entries(j)) if (!LIDOS.has(k)) campos[k] = v;
    const relacao = [j["Relation Name"], j["CTE Name"], j["Function Name"]].find((v) => typeof v === "string") as string | undefined;

    return {
      id, tipo, relacao: relacao ?? null,
      indice: typeof j["Index Name"] === "string" ? j["Index Name"] : null,
      papel: typeof j["Parent Relationship"] === "string" ? j["Parent Relationship"] : null,
      custoTotal: custo, linhasEstimadas: estimadas, real, campos, filhos,
    };
  };

  const raiz = ler(topo.Plan, "0", 0);
  const execucaoMs = num(topo["Execution Time"]);
  if (comAnalyze) calcularTempoProprio(raiz, execucaoMs ?? raiz.real?.tempoTotalMs ?? 0);
  return { raiz, comAnalyze, planejamentoMs: num(topo["Planning Time"]), execucaoMs, totalNos };
}

/**
 * Tempo próprio = total do nó menos o total dos filhos. Com workers paralelos, os tempos dos
 * filhos somam o de cada worker e podem passar o do pai: aí o próprio fica 0, nunca negativo.
 */
function calcularTempoProprio(no: No, execucaoMs: number) {
  for (const f of no.filhos) calcularTempoProprio(f, execucaoMs);
  if (!no.real) return;
  const dosFilhos = no.filhos.reduce((s, f) => s + (f.real?.tempoTotalMs ?? 0), 0);
  no.real.tempoProprioMs = Math.max(0, no.real.tempoTotalMs - dosFilhos);
  no.real.percentual = execucaoMs > 0 ? Math.min(100, (no.real.tempoProprioMs / execucaoMs) * 100) : 0;
}

/** Todos os nós em ordem (raiz primeiro). */
export function* percorrer(no: No): Generator<No> {
  yield no;
  for (const f of no.filhos) yield* percorrer(f);
}
