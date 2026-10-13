import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import EntradaBanco from "./EntradaBanco.vue";
import { CONSULTAS } from "../api";
import seqScan from "../plano/exemplos/seq-scan.json";

/** Simula a API: cada chamada recebe a próxima resposta (ou falha de rede). */
function api(...respostas: (Response | Error)[]) {
  const fetch = vi.fn(async () => {
    const r = respostas.shift()!;
    if (r instanceof Error) throw r;
    return r;
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const json = (corpo: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json", ...headers } });

afterEach(() => vi.unstubAllGlobals());

async function rodar(w: ReturnType<typeof mount>, sql?: string) {
  if (sql !== undefined) await w.find("textarea").setValue(sql);
  await w.find("form").trigger("submit");
  await flushPromises();
}

describe("rodar no banco de exemplo", () => {
  it("manda a consulta e o ANALYZE para a API e entrega o plano", async () => {
    const fetch = api(json({ plano: seqScan, analyze: false }));
    const w = mount(EntradaBanco);
    await w.find("input[type=checkbox]").setValue(false);
    await rodar(w, "SELECT * FROM pedidos WHERE cliente_id = 42");
    expect(fetch).toHaveBeenCalledWith("/api/explain", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ sql: "SELECT * FROM pedidos WHERE cliente_id = 42", analyze: false });
    expect(w.emitted("plano")?.[0]).toEqual([seqScan, "SELECT * FROM pedidos WHERE cliente_id = 42"]);
  });

  it("erro de sintaxe: mostra a mensagem e seleciona na consulta o ponto onde o Postgres parou", async () => {
    api(json({ error: 'syntax error at or near "FORM"', tipo: "sintaxe", posicao: 10 }, 422));
    const w = mount(EntradaBanco, { attachTo: document.body });
    await rodar(w, "SELECT * FORM pedidos");
    expect(w.find("[role=alert]").text()).toBe('syntax error at or near "FORM" (posição 10, marcada na consulta)');
    const campo = w.find("textarea").element as HTMLTextAreaElement;
    expect([campo.selectionStart, campo.selectionEnd]).toEqual([9, 10]); // o "F" de FORM
    w.unmount();
  });

  it.each([
    ["sem rede", new TypeError("Failed to fetch"), /Sem conexão com o servidor/],
    ["servidor acordando (HTML no lugar de JSON)", new Response("<html>502</html>", { status: 503 }), /acordando/],
    ["rate limit", json({ error: "Muitas consultas." }, 429, { "retry-after": "30" }), /^Muitas consultas\. \(aguarde 30 s\)$/],
  ])("%s vira mensagem que diz o que fazer", async (_nome, resposta, mensagem) => {
    api(resposta);
    const w = mount(EntradaBanco);
    await rodar(w);
    expect(w.find("[role=alert]").text()).toMatch(mensagem);
  });

  it("consulta pronta preenche e já roda", async () => {
    const fetch = api(json({ plano: seqScan, analyze: true }));
    const w = mount(EntradaBanco);
    await w.findAll(".chip")[1].trigger("click");
    await flushPromises();
    expect((w.find("textarea").element as HTMLTextAreaElement).value).toBe(CONSULTAS[1].sql);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
