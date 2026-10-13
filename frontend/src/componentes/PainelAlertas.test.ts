import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import App from "../App.vue";
import ListaAlertas from "./ListaAlertas.vue";
import PainelNo from "./PainelNo.vue";
import { gerarAlertas } from "../plano/alertas";
import { lerPlano } from "../plano/ler";
import nestedLoop from "../plano/exemplos/nested-loop.json";
import seqScan from "../plano/exemplos/seq-scan.json";

describe("painel do nó", () => {
  it("explica os números e os campos importantes em português; o JSON inteiro fica recolhido", () => {
    const w = mount(PainelNo, { props: { no: lerPlano(seqScan).raiz } });
    const texto = w.text();
    expect(w.find("h3").text()).toBe("Seq Scan em pedidos");
    expect(texto).toContain("Linhas reais65 por execução");
    expect(texto).toContain("Filtro(cliente_id = 42)");
    expect(texto).toContain("Linhas descartadas pelo filtro (por execução)199.935");
    expect(w.find("details").attributes("open")).toBeUndefined();
    expect(w.find("details").text()).toContain("Parallel Aware");
  });
});

describe("lista de alertas", () => {
  it("mostra nível, título, detalhe e dica; 'Ver no plano' avisa qual nó", async () => {
    const alertas = gerarAlertas(lerPlano(nestedLoop));
    const w = mount(ListaAlertas, { props: { alertas, comAnalyze: true } });
    const itens = w.findAll("li");
    expect(itens.map((i) => i.classes()[0])).toEqual(["alto", "medio"]);
    expect(itens[1].text()).toContain("Index Scan executado 1.204 vezes");
    await itens[1].find("button.ver").trigger("click");
    expect(w.emitted("selecionar")?.[0]).toEqual(["0.1"]);
  });

  it("explica por que não há alerta (sem ANALYZE ou plano saudável)", () => {
    expect(mount(ListaAlertas, { props: { alertas: [], comAnalyze: false } }).text()).toContain("Sem ANALYZE");
    expect(mount(ListaAlertas, { props: { alertas: [], comAnalyze: true } }).text()).toContain("Nenhum alerta");
  });
});

describe("página com o plano", () => {
  it("abre no nó do alerta mais grave, e o alerta leva o painel para o nó dele", async () => {
    const w = mount(App);
    await w.findAll(".chip")[2].trigger("click"); // Nested Loop
    expect(w.find(".painel h3").text()).toBe("Seq Scan em pedidos"); // alerta alto
    expect(w.find('[data-no="0.0"]').classes()).toContain("selecionado");
    await w.findAll(".alertas button.ver")[1].trigger("click");
    expect(w.find(".painel h3").text()).toBe("Index Scan em itens_pedido");
  });
});
