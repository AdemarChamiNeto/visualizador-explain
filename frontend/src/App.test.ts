import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import App from "./App.vue";

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
