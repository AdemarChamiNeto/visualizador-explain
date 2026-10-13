/** Números do plano em português, curtos o bastante para caber numa linha da árvore. */

export const linhas = (n: number) => Math.round(n).toLocaleString("pt-BR");

export function tempo(ms: number): string {
  if (ms > 0 && ms < 0.01) return "< 0,01 ms";
  if (ms >= 1000) return `${(ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} s`;
  if (ms >= 10) return `${ms.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} ms`;
  return `${ms.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ms`;
}

/** Quantas vezes o real ficou acima (ou abaixo) do estimado; null quando a diferença é pequena. */
export function erroEstimativa(estimadas: number, reais: number): { fator: number; sentido: "mais" | "menos" } | null {
  const fator = Math.max(estimadas, reais) / Math.max(1, Math.min(estimadas, reais));
  if (fator < 2) return null;
  return { fator, sentido: reais > estimadas ? "mais" : "menos" };
}

export const fator = (f: number) => `${f.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}×`;
