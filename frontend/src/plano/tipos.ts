/** Plano de execução já lido e normalizado: o que a tela desenha e o que os alertas analisam. */
export type Plano = {
  raiz: No;
  /** Veio de EXPLAIN ANALYZE (tem linhas e tempos reais) ou só de EXPLAIN (só estimativas). */
  comAnalyze: boolean;
  planejamentoMs: number | null;
  execucaoMs: number | null;
  totalNos: number;
};

export type No = {
  /** Caminho na árvore ("0", "0.1", "0.1.0"): estável e único. */
  id: string;
  /** "Seq Scan", "Hash Join", "Sort"... */
  tipo: string;
  /** Tabela lida pelo nó (ou CTE / função), se houver. */
  relacao: string | null;
  indice: string | null;
  /** Papel no nó de cima: "Outer", "Inner", "InitPlan", "SubPlan"... */
  papel: string | null;
  custoTotal: number;
  /** Linhas estimadas POR EXECUÇÃO do nó, como o Postgres mostra. */
  linhasEstimadas: number;
  /** Só com ANALYZE. */
  real: Real | null;
  /** O resto do JSON do nó (Filter, Index Cond, Sort Method...), para o painel de detalhes. */
  campos: Record<string, unknown>;
  filhos: No[];
};

export type Real = {
  /** Linhas reais POR EXECUÇÃO (comparável com linhasEstimadas). */
  linhas: number;
  /** Quantas vezes o nó rodou (o lado de dentro de um Nested Loop roda uma vez por linha de fora). */
  execucoes: number;
  /** Tempo de todas as execuções, incluindo os filhos. */
  tempoTotalMs: number;
  /** Tempo só deste nó: o total menos o dos filhos. É o que aponta o gargalo. */
  tempoProprioMs: number;
  /** tempoProprioMs sobre o tempo de execução da consulta (0 a 100). */
  percentual: number;
};
