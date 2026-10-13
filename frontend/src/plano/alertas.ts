import { percorrer } from "./ler";
import type { No, Plano } from "./tipos";

/**
 * Alertas do plano: o que um DBA olharia primeiro. Só com ANALYZE (sem linhas reais não dá para
 * saber se a estimativa errou nem quanto o Seq Scan descartou).
 */

export type TipoAlerta = "seq-scan-filtro" | "estimativa" | "ordenacao-disco" | "hash-em-lotes" | "loop-pesado";

export type Alerta = {
  noId: string;
  tipo: TipoAlerta;
  nivel: "alto" | "medio";
  titulo: string;
  detalhe: string;
  dica: string;
};

/** Estimativa errada a partir de 5× (com pelo menos 100 linhas de diferença, senão é ruído). */
export const FATOR_ESTIMATIVA = 5;
const n = (v: number) => Math.round(v).toLocaleString("pt-BR");
/** Porcentagem com vírgula; abaixo de 1% com duas casas (0,03% e não 0,0%). */
const pct = (v: number) => `${v.toFixed(v < 1 ? 2 : 1).replace(".", ",")}%`;

export function gerarAlertas(plano: Plano): Alerta[] {
  if (!plano.comAnalyze) return [];
  const alertas: Alerta[] = [];
  const pais = new Map<string, No>();
  for (const no of percorrer(plano.raiz)) for (const f of no.filhos) pais.set(f.id, no);
  const temAncestral = (no: No, tipo: string) => {
    for (let p = pais.get(no.id); p; p = pais.get(p.id)) if (p.tipo === tipo) return true;
    return false;
  };
  const errouEstimativa = new Set<string>();

  // de baixo para cima: a estimativa errada só é apontada onde nasce, não em cada nó acima que herda o erro
  for (const no of [...percorrer(plano.raiz)].reverse()) {
    const r = no.real;
    if (!r || r.execucoes === 0) continue;
    const c = no.campos;

    const descartadas = (typeof c["Rows Removed by Filter"] === "number" ? c["Rows Removed by Filter"] : 0) * r.execucoes;
    const devolvidas = r.linhas * r.execucoes;
    if (no.tipo === "Seq Scan" && descartadas >= 1000 && descartadas >= 0.9 * (descartadas + devolvidas)) {
      alertas.push({
        noId: no.id, tipo: "seq-scan-filtro", nivel: r.percentual >= 30 ? "alto" : "medio",
        titulo: `Seq Scan em ${no.relacao} descartou ${n(descartadas)} linhas`,
        detalhe: `Leu ${n(descartadas + devolvidas)} linhas para devolver ${n(devolvidas)} (${pct((devolvidas / (descartadas + devolvidas)) * 100)}).`,
        dica: `Um índice nas colunas do filtro ${String(c["Filter"] ?? "")} evita ler a tabela inteira.`,
      });
    }

    const est = no.linhasEstimadas;
    const fator = Math.max(est, r.linhas) / Math.max(1, Math.min(est, r.linhas));
    // abaixo de um LIMIT o nó para cedo: vir menos linha que o estimado é esperado, não erro
    const parouCedo = r.linhas < est && temAncestral(no, "Limit");
    const filhoErrou = no.filhos.some((f) => errouEstimativa.has(f.id));
    if (fator >= FATOR_ESTIMATIVA && Math.abs(est - r.linhas) >= 100 && !parouCedo) {
      errouEstimativa.add(no.id);
      if (!filhoErrou) {
        alertas.push({
          noId: no.id, tipo: "estimativa", nivel: "medio",
          titulo: `Estimativa errada em ${no.tipo}${no.relacao ? ` (${no.relacao})` : ""}`,
          detalhe: `O planejador esperava ${n(est)} linhas e vieram ${n(r.linhas)} (${fator.toFixed(1).replace(".", ",")}× ${r.linhas > est ? "mais" : "menos"}).`,
          dica: "Estatísticas velhas (rode ANALYZE) ou colunas que andam juntas (CREATE STATISTICS) levam o planejador a escolher mal as junções acima daqui.",
        });
      }
    }

    if (c["Sort Space Type"] === "Disk") {
      alertas.push({
        noId: no.id, tipo: "ordenacao-disco", nivel: "alto",
        titulo: "Ordenação em disco",
        detalhe: `Não coube no work_mem e usou ${n(Number(c["Sort Space Used"] ?? 0))} kB em disco (${String(c["Sort Method"] ?? "")}).`,
        dica: `Um índice na ordem pedida (${[c["Sort Key"]].flat().join(", ")}) evita ordenar; ou aumente o work_mem só desta consulta.`,
      });
    }

    if (typeof c["Hash Batches"] === "number" && c["Hash Batches"] > 1) {
      alertas.push({
        noId: no.id, tipo: "hash-em-lotes", nivel: "medio",
        titulo: `Hash em ${c["Hash Batches"]} lotes`,
        detalhe: "A tabela hash não coube no work_mem e foi dividida em lotes gravados em disco.",
        dica: "Filtre antes da junção para o lado do hash ficar menor, ou aumente o work_mem.",
      });
    }

    if (no.papel === "Inner" && pais.get(no.id)?.tipo === "Nested Loop" && r.execucoes >= 1000 && r.tempoTotalMs >= 0.1 * (plano.execucaoMs ?? 0)) {
      alertas.push({
        noId: no.id, tipo: "loop-pesado", nivel: "medio",
        titulo: `${no.tipo} executado ${n(r.execucoes)} vezes`,
        detalhe: `É o lado de dentro de um Nested Loop: roda uma vez por linha do outro lado, somando ${r.tempoTotalMs.toFixed(1).replace(".", ",")} ms.`,
        dica: "Se o lado de fora crescer, um Hash Join costuma ganhar. Confira se a estimativa do lado de fora está certa.",
      });
    }
  }

  // os mais graves primeiro; empate: o nó que gasta mais tempo
  const tempo = new Map([...percorrer(plano.raiz)].map((no) => [no.id, no.real?.percentual ?? 0]));
  return alertas.sort((a, b) => (a.nivel === b.nivel ? tempo.get(b.noId)! - tempo.get(a.noId)! : a.nivel === "alto" ? -1 : 1));
}
