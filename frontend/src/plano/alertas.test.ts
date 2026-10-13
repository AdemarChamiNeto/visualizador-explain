import { describe, expect, it } from "vitest";
import { gerarAlertas } from "./alertas";
import { lerPlano } from "./ler";
// planos reais gravados do banco de exemplo
import seqScan from "./exemplos/seq-scan.json";
import juncao from "./exemplos/juncao.json";
import nestedLoop from "./exemplos/nested-loop.json";
import ordenacaoDisco from "./exemplos/ordenacao-disco.json";
import semAnalyze from "./exemplos/sem-analyze.json";

const alertas = (json: unknown) => gerarAlertas(lerPlano(json));
const resumo = (json: unknown) => alertas(json).map((a) => `${a.noId} ${a.tipo} ${a.nivel}`);

describe("gerarAlertas", () => {
  it("Seq Scan que lê a tabela inteira para devolver 65 linhas: alto, com a dica do índice", () => {
    const [a] = alertas(seqScan);
    expect(resumo(seqScan)).toEqual(["0 seq-scan-filtro alto"]);
    expect(a.titulo).toBe("Seq Scan em pedidos descartou 199.935 linhas");
    expect(a.detalhe).toBe("Leu 200.000 linhas para devolver 65 (0,03%).");
    expect(a.dica).toContain("(cliente_id = 42)");
  });

  it("estimativa errada só onde nasce (cidade + UF), não em cada nó acima que herda o erro", () => {
    const lista = alertas(juncao);
    const estimativas = lista.filter((a) => a.tipo === "estimativa");
    expect(estimativas.map((a) => a.noId)).toEqual(["0.0.0.0.1.0"]); // Seq Scan em clientes
    expect(estimativas[0].detalhe).toBe("O planejador esperava 497 linhas e vieram 3.880 (7,8× mais).");
    // o Sort abaixo do LIMIT devolveu 10 de 497 estimadas: parou cedo, não é erro
    expect(lista.some((a) => a.noId === "0.0" && a.tipo === "estimativa")).toBe(false);
  });

  it("ordenação que não coube no work_mem", () => {
    const [a] = alertas(ordenacaoDisco);
    expect(a).toMatchObject({ noId: "0", tipo: "ordenacao-disco", nivel: "alto" });
    expect(a.detalhe).toBe("Não coube no work_mem e usou 33.320 kB em disco (external merge).");
    expect(a.dica).toContain("quantidade, preco_unitario_centavos");
  });

  it("Nested Loop: o lado de dentro executado 1.204 vezes, e os mais graves vêm primeiro", () => {
    expect(resumo(nestedLoop)).toEqual(["0.0 seq-scan-filtro alto", "0.1 loop-pesado medio"]);
    expect(alertas(nestedLoop)[1].titulo).toBe("Index Scan executado 1.204 vezes");
  });

  it("sem ANALYZE não há alerta (não dá para comparar com o real)", () => {
    expect(alertas(semAnalyze)).toEqual([]);
  });

  it("hash dividido em lotes", () => {
    const plano = { "Execution Time": 50, Plan: {
      "Node Type": "Hash", "Total Cost": 1, "Plan Rows": 1000, "Actual Total Time": 40, "Actual Rows": 1000, "Actual Loops": 1, "Hash Batches": 8,
    } };
    expect(resumo(plano)).toEqual(["0 hash-em-lotes medio"]);
  });
});
