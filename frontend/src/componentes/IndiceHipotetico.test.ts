import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import IndiceHipotetico from "./IndiceHipotetico.vue";
import { lerPlano } from "../plano/ler";
import seqScan from "../plano/exemplos/seq-scan.json";
import juncao from "../plano/exemplos/juncao.json";
import comparacao from "../plano/exemplos/comparacao.json"; // resposta real da API para pedidos(cliente_id)

const TABELAS = [
  { tabela: "clientes", colunas: ["id", "nome", "email", "cidade", "uf", "criado_em"] },
  { tabela: "pedidos", colunas: ["id", "cliente_id", "status", "criado_em", "total_centavos"] },
];
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

function api(...respostas: Response[]) {
  const fetch = vi.fn(async () => respostas.shift()!);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());

const montar = async (planoJson: unknown, sql = "SELECT * FROM pedidos WHERE cliente_id = 42") => {
  const w = mount(IndiceHipotetico, { props: { sql, plano: lerPlano(planoJson) } });
  await flushPromises();
  return w;
};
const marcadas = (w: Awaited<ReturnType<typeof montar>>) =>
  w.findAll("input[type=checkbox]").filter((c) => (c.element as HTMLInputElement).checked).map((c) => (c.element as HTMLInputElement).value);

describe("índice hipotético na tela", () => {
  it("sugere o índice a partir do alerta de Seq Scan: a tabela e as colunas do filtro", async () => {
    api(json(TABELAS));
    const w = await montar(seqScan);
    expect((w.find("select").element as HTMLSelectElement).value).toBe("pedidos");
    expect(marcadas(w)).toEqual(["cliente_id"]);

    const outro = await (api(json(TABELAS)), montar(juncao)); // filtro em cidade e uf
    expect((outro.find("select").element as HTMLSelectElement).value).toBe("clientes");
    expect(marcadas(outro)).toEqual(["cidade", "uf"]);
  });

  it("compara, diz se o índice seria usado e entrega o plano com o índice", async () => {
    const fetch = api(json(TABELAS), json(comparacao));
    const w = await montar(seqScan);
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(JSON.parse((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body as string))
      .toEqual({ sql: "SELECT * FROM pedidos WHERE cliente_id = 42", tabela: "pedidos", colunas: ["cliente_id"] });
    const texto = w.find("[role=status]").text();
    expect(texto).toContain("CREATE INDEX ON pedidos (cliente_id) seria usado.");
    expect(texto).toContain("Custo estimado: 4.167 → 208 (Seq Scan → Bitmap Heap Scan)");
    await w.find("button.ver").trigger("click");
    expect(w.emitted("verPlano")?.[0]).toEqual([comparacao.depois]);
    // a página troca o plano pelo hipotético (mesma consulta): a escolha e o resultado continuam
    await w.setProps({ plano: lerPlano(comparacao.depois) });
    expect((w.find("select").element as HTMLSelectElement).value).toBe("pedidos");
    expect(w.find("[role=status]").exists()).toBe(true);
  });

  it("no máximo 3 colunas: as outras ficam desabilitadas", async () => {
    api(json(TABELAS));
    const w = await montar(seqScan);
    const caixas = w.findAll("input[type=checkbox]");
    for (const i of [0, 2]) await caixas[i].setValue(true); // + id e status (cliente_id já veio marcado)
    expect(marcadas(w)).toHaveLength(3);
    expect((caixas[3].element as HTMLInputElement).disabled).toBe(true);
  });

  it("erro da API aparece como aviso", async () => {
    api(json(TABELAS), json({ error: 'A coluna "x" não existe em pedidos.', tipo: "entrada" }, 400));
    const w = await montar(seqScan);
    await w.find("form").trigger("submit");
    await flushPromises();
    expect(w.find("[role=alert]").text()).toBe('A coluna "x" não existe em pedidos.');
  });
});
