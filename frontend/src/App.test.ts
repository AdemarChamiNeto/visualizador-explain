import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import App from "./App.vue";
import seqScan from "./plano/exemplos/seq-scan.json";
import comparacao from "./plano/exemplos/comparacao.json";

describe("tela de colar plano", () => {
  it("o exemplo carrega a árvore; JSON ruim mostra o que fazer", async () => {
    const w = mount(App);
    await w.findAll("[role=tab]")[1].trigger("click"); // aba "Colar um plano"
    await w.findAll(".chip")[1].trigger("click");
    expect(w.findAll(".cartao")).toHaveLength(7);
    expect(w.find(".resumo").text()).toMatch(/Execução: .*7 nós/);

    await w.find("textarea").setValue("Seq Scan on pedidos  (cost=0.00..4173.00 rows=67 width=32)");
    await w.find("button.principal").trigger("click");
    expect(w.find("[role=alert]").text()).toContain("formato texto");
  });
});

describe("link direto para um exemplo", () => {
  it("#exemplo=nested-loop abre o exemplo na aba de colar", () => {
    window.location.hash = "#exemplo=nested-loop";
    try {
      const w = mount(App);
      expect(w.find('[role=tab][aria-selected="true"]').text()).toBe("Colar um plano");
      expect(w.findAll(".cartao")).toHaveLength(3);
    } finally {
      window.location.hash = "";
    }
  });
});

describe("fluxo do banco de exemplo com índice hipotético", () => {
  it("roda, compara, abre o plano com o índice (sem alertas) e volta ao plano real", async () => {
    const respostas = [
      { plano: seqScan, analyze: true },
      [{ tabela: "pedidos", colunas: ["id", "cliente_id", "status", "criado_em", "total_centavos"] }],
      comparacao,
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(respostas.shift()), { headers: { "content-type": "application/json" } })));
    try {
      const w = mount(App);
      await w.find("form.banco").trigger("submit");
      await flushPromises();
      expect(w.find(".alertas").text()).toContain("Seq Scan em pedidos");

      await w.find(".indice form").trigger("submit");
      await flushPromises();
      await w.find(".resultado-indice button.ver").trigger("click");
      expect(w.find(".resumo").text()).toContain("com o índice hipotético");
      expect(w.find(".alertas").exists()).toBe(false); // plano hipotético é só estimativa

      await w.find(".resumo button.link").trigger("click");
      expect(w.find(".resumo").text()).toContain("Execução");
      expect(w.find(".alertas").exists()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
