import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import NoPlano from "./NoPlano.vue";
import { lerPlano } from "../plano/ler";
import { erroEstimativa, tempo } from "../plano/formato";
import juncao from "../plano/exemplos/juncao.json";
import semAnalyze from "../plano/exemplos/sem-analyze.json";

const montar = (json: unknown, comAlerta = new Set<string>()) =>
  mount(NoPlano, { props: { no: lerPlano(json).raiz, selecionado: null, comAlerta } });

describe("árvore do plano", () => {
  it("mostra cada nó com tempo próprio, linhas e o erro de estimativa onde ele existe", () => {
    const w = montar(juncao, new Set(["0.0.0.0.1.0"]));
    const cartoes = w.findAll(".cartao");
    expect(cartoes).toHaveLength(7);
    const clientes = cartoes[6];
    expect(clientes.text()).toContain("Seq Scan em clientes");
    expect(clientes.text()).toContain("3.880 linhas");
    expect(clientes.find(".estimativa").text()).toBe("est. 497 (7,8× mais)");
    expect(clientes.find(".alerta").exists()).toBe(true);
    expect(cartoes[0].find(".alerta").exists()).toBe(false);
  });

  it("abaixo de um LIMIT, vir menos linha que o estimado não é destacado; dentro/fora só em junção", () => {
    const cartoes = montar(juncao).findAll(".cartao");
    expect(cartoes[1].text()).toContain("Sort");
    expect(cartoes[1].find(".estimativa").exists()).toBe(false); // 10 de 497: o LIMIT parou cedo
    expect(cartoes[1].find(".papel").exists()).toBe(false); // filho único do Limit
    expect(cartoes[4].find(".papel").text()).toBe("fora"); // lado do Hash Join
  });

  it("recolhe e expande os filhos, avisando o leitor de tela", async () => {
    const w = montar(juncao);
    const botao = w.find(".recolher");
    expect(botao.attributes("aria-expanded")).toBe("true");
    await botao.trigger("click");
    expect(w.findAll(".cartao")).toHaveLength(1);
    expect(botao.attributes("aria-expanded")).toBe("false");
  });

  it("clicar num nó (inclusive um filho) avisa qual foi selecionado", async () => {
    const w = montar(juncao);
    await w.findAll(".cartao")[3].trigger("click");
    expect(w.emitted("selecionar")?.[0]).toEqual(["0.0.0.0"]);
  });

  it("sem ANALYZE mostra só a estimativa e o custo", () => {
    expect(montar(semAnalyze).find(".cartao").text()).toContain("10 linhas estimadas");
  });
});

describe("formato", () => {
  it("tempo e estimativa em português", () => {
    expect(tempo(0.0123)).toBe("0,01 ms");
    expect(tempo(0.002)).toBe("< 0,01 ms");
    expect(tempo(31.13)).toBe("31 ms");
    expect(tempo(1534)).toBe("1,53 s");
    expect(erroEstimativa(100, 150)).toBeNull(); // menos de 2×: não vale destacar
    expect(erroEstimativa(497, 10)).toEqual({ fator: 49.7, sentido: "menos" });
  });
});
