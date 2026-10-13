import { describe, expect, it } from "vitest";
import { lerPlano, lerTexto, percorrer, PlanoInvalido } from "./ler";
// planos reais gravados do banco de exemplo (EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON))
import seqScan from "./exemplos/seq-scan.json";
import juncao from "./exemplos/juncao.json";
import nestedLoop from "./exemplos/nested-loop.json";
import semAnalyze from "./exemplos/sem-analyze.json";

describe("lerPlano", () => {
  it("um nó só: tempo próprio = tempo total e quase todo o tempo da consulta", () => {
    const p = lerPlano(seqScan);
    expect(p.comAnalyze).toBe(true);
    expect(p.totalNos).toBe(1);
    expect(p.raiz).toMatchObject({ id: "0", tipo: "Seq Scan", relacao: "pedidos", linhasEstimadas: 67 });
    expect(p.raiz.real).toMatchObject({ linhas: 65, execucoes: 1, tempoTotalMs: 7.271, tempoProprioMs: 7.271 });
    expect(p.raiz.real!.percentual).toBeCloseTo((7.271 / 7.305) * 100, 5);
    expect(p.raiz.campos["Filter"]).toBe("(cliente_id = 42)");
    expect(p.raiz.campos["Rows Removed by Filter"]).toBe(199935);
  });

  it("Nested Loop: o lado de dentro conta tempo × execuções, e o pai fica só com o que é dele", () => {
    const p = lerPlano(nestedLoop);
    const [fora, dentro] = p.raiz.filhos;
    expect(p.raiz.tipo).toBe("Nested Loop");
    expect(fora.papel).toBe("Outer");
    expect(dentro).toMatchObject({ papel: "Inner", tipo: "Index Scan", indice: "itens_pedido_pkey" });
    expect(dentro.real!.execucoes).toBe(1204);
    expect(dentro.real!.tempoTotalMs).toBeCloseTo(0.005 * 1204, 6);
    expect(p.raiz.real!.tempoProprioMs).toBeCloseTo(14.241 - 7.807 - 0.005 * 1204, 6);
  });

  it("árvore com ids pelo caminho e tempos próprios que somam o tempo da consulta", () => {
    const p = lerPlano(juncao);
    const nos = [...percorrer(p.raiz)];
    expect(nos.map((n) => `${n.id} ${n.tipo}`)).toEqual([
      "0 Limit", "0.0 Sort", "0.0.0 Aggregate", "0.0.0.0 Hash Join", "0.0.0.0.0 Seq Scan", "0.0.0.0.1 Hash", "0.0.0.0.1.0 Seq Scan",
    ]);
    expect(p.totalNos).toBe(7);
    const soma = nos.reduce((s, n) => s + n.real!.tempoProprioMs, 0);
    expect(soma).toBeCloseTo(p.raiz.real!.tempoTotalMs, 6);
    expect(p.planejamentoMs).toBeGreaterThan(0);
  });

  it("sem ANALYZE: só estimativas, sem tempos", () => {
    const p = lerPlano(semAnalyze);
    expect(p.comAnalyze).toBe(false);
    expect(p.execucaoMs).toBeNull();
    expect([...percorrer(p.raiz)].every((n) => n.real === null)).toBe(true);
    expect(p.raiz.filhos[0].linhasEstimadas).toBe(497);
  });

  it("tempo próprio nunca negativo (workers paralelos somam mais que o pai)", () => {
    const p = lerPlano([{ "Execution Time": 10, Plan: {
      "Node Type": "Gather", "Total Cost": 1, "Plan Rows": 1, "Actual Total Time": 10, "Actual Rows": 1, "Actual Loops": 1,
      Plans: [{ "Node Type": "Parallel Seq Scan", "Total Cost": 1, "Plan Rows": 1, "Actual Total Time": 8, "Actual Rows": 1, "Actual Loops": 3 }],
    } }]);
    expect(p.raiz.real!.tempoProprioMs).toBe(0);
  });
});

describe("lerTexto: entrada ruim vira mensagem que diz o que fazer", () => {
  it("aceita o objeto sem colchetes e com espaços em volta", () => {
    expect(lerTexto(`\n  ${JSON.stringify(seqScan[0])}  \n`).raiz.tipo).toBe("Seq Scan");
  });

  it.each([
    ["", /Cole a saída/],
    ["Seq Scan on pedidos  (cost=0.00..4173.00 rows=67 width=32)", /formato texto/],
    [" QUERY PLAN \n----\n ->  Hash Join", /formato texto/],
    ["[{ \"Plan\": ", /não é um JSON válido/i],
    ['{"linhas": 3}', /falta o campo "Plan"/],
    ['[{"Plan": {"Node Type": "Seq Scan"}}]', /sem "Node Type", "Total Cost" ou "Plan Rows"/],
  ])("%j", (texto, erro) => {
    expect(() => lerTexto(texto)).toThrow(PlanoInvalido);
    expect(() => lerTexto(texto)).toThrow(erro);
  });

  it("recusa texto gigante e árvore absurda", () => {
    expect(() => lerTexto(" ".repeat(2_000_001))).toThrow(/grande demais/);
    let plano: Record<string, unknown> = { "Node Type": "Result", "Total Cost": 0, "Plan Rows": 1 };
    for (let i = 0; i < 300; i++) plano = { "Node Type": "Result", "Total Cost": 0, "Plan Rows": 1, Plans: [plano] };
    expect(() => lerPlano({ Plan: plano })).toThrow(/aninhado demais/);
  });
});
