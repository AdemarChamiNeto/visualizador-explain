<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import EntradaBanco from "./componentes/EntradaBanco.vue";
import ListaAlertas from "./componentes/ListaAlertas.vue";
import NoPlano from "./componentes/NoPlano.vue";
import PainelNo from "./componentes/PainelNo.vue";
import { gerarAlertas } from "./plano/alertas";
import { lerPlano, lerTexto, percorrer, PlanoInvalido } from "./plano/ler";
import type { Plano } from "./plano/tipos";
import { tempo } from "./plano/formato";
import juncao from "./plano/exemplos/juncao.json";
import nestedLoop from "./plano/exemplos/nested-loop.json";
import ordenacaoDisco from "./plano/exemplos/ordenacao-disco.json";
import seqScan from "./plano/exemplos/seq-scan.json";

// planos reais gravados do banco de exemplo: a tela funciona mesmo sem a API
const EXEMPLOS = [
  { nome: "Seq Scan sem índice", json: seqScan },
  { nome: "Junção com estimativa errada", json: juncao },
  { nome: "Nested Loop", json: nestedLoop },
  { nome: "Ordenação em disco", json: ordenacaoDisco },
];

const aba = ref<"banco" | "colar">("banco");
const texto = ref("");
const erro = ref("");
const plano = ref<Plano | null>(null);
const selecionado = ref<string | null>(null);
const alertas = computed(() => (plano.value ? gerarAlertas(plano.value) : []));
const comAlerta = computed(() => new Set(alertas.value.map((a) => a.noId)));
const noSelecionado = computed(() => (plano.value ? [...percorrer(plano.value.raiz)].find((n) => n.id === selecionado.value) ?? null : null));

/** Seleciona e traz o nó para a vista (vindo de um alerta, ele pode estar fora da tela). */
async function selecionar(id: string) {
  selecionado.value = id;
  await nextTick();
  document.querySelector(`[data-no="${id}"]`)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
}

function abrir(p: Plano) {
  plano.value = p;
  // abre já no nó do alerta mais grave (ou na raiz): o painel nunca começa vazio
  selecionado.value = alertas.value[0]?.noId ?? p.raiz.id;
}

function ler() {
  try {
    abrir(lerTexto(texto.value));
    erro.value = "";
  } catch (e) {
    if (!(e instanceof PlanoInvalido)) throw e;
    erro.value = e.message;
  }
}

function exemplo(json: unknown) {
  texto.value = JSON.stringify(json, null, 2);
  ler();
}
</script>

<template>
  <header class="topo">
    <h1>Visualizador de EXPLAIN</h1>
    <p>O plano de execução do PostgreSQL em árvore: quanto tempo cada passo gastou e onde a estimativa errou.</p>
  </header>

  <main class="pagina">
    <section class="entrada" aria-label="Consulta">
      <div class="abas" role="tablist">
        <button type="button" role="tab" :aria-selected="aba === 'banco'" @click="aba = 'banco'">Banco de exemplo</button>
        <button type="button" role="tab" :aria-selected="aba === 'colar'" @click="aba = 'colar'">Colar um plano</button>
      </div>
      <EntradaBanco v-if="aba === 'banco'" @plano="(json) => abrir(lerPlano(json))" />
      <template v-else>
      <label for="plano-json">Saída de <code>EXPLAIN (ANALYZE, FORMAT JSON)</code></label>
      <textarea id="plano-json" v-model="texto" class="sql" rows="10" spellcheck="false" placeholder='[ { "Plan": { "Node Type": ... } } ]'></textarea>
      <button type="button" class="principal" @click="ler">Ler plano</button>
      <p v-if="erro" class="erro" role="alert">{{ erro }}</p>
      <p class="exemplos">
        Ou veja um exemplo:
        <button v-for="e in EXEMPLOS" :key="e.nome" type="button" class="chip" @click="exemplo(e.json)">{{ e.nome }}</button>
      </p>
      <p class="nota">O plano colado é lido no seu navegador: nada vai para o servidor.</p>
      </template>
    </section>

    <section v-if="plano" class="resultado" aria-labelledby="t-plano">
      <h2 id="t-plano">Plano</h2>
      <p class="resumo">
        <template v-if="plano.execucaoMs !== null">Execução: <strong>{{ tempo(plano.execucaoMs) }}</strong> · </template>
        <template v-if="plano.planejamentoMs !== null">planejamento: {{ tempo(plano.planejamentoMs) }} · </template>
        {{ plano.totalNos }} {{ plano.totalNos === 1 ? "nó" : "nós" }}
        <template v-if="!plano.comAnalyze"> · sem ANALYZE: só estimativas</template>
      </p>
      <ListaAlertas :alertas="alertas" :com-analyze="plano.comAnalyze" @selecionar="selecionar" />
      <div class="plano-e-painel">
        <ul class="arvore" aria-label="Árvore do plano">
          <NoPlano :no="plano.raiz" :selecionado="selecionado" :com-alerta="comAlerta" @selecionar="selecionar" />
        </ul>
        <PainelNo v-if="noSelecionado" :key="noSelecionado.id" :no="noSelecionado" />
      </div>
    </section>
  </main>
</template>

<style scoped>
.topo { padding: 20px 24px 8px; }
.topo h1 { margin: 0; font-size: 1.5rem; }
.topo p { margin: 4px 0 0; color: var(--suave); }
.pagina { display: grid; grid-template-columns: minmax(280px, 380px) minmax(0, 1fr); gap: 20px; padding: 16px 24px 40px; align-items: start; }
@media (max-width: 860px) { .pagina { grid-template-columns: minmax(0, 1fr); padding: 12px 16px 32px; } }
h2 { font-size: 1.05rem; margin: 0 0 10px; }
.entrada { display: grid; gap: 8px; background: var(--superficie); border: 1px solid var(--borda); border-radius: var(--raio); padding: 16px; }
.resumo { margin: 0 0 12px; color: var(--suave); }
.abas { display: flex; gap: 4px; border-bottom: 1px solid var(--borda); margin-bottom: 4px; }
.abas button { background: none; border: 0; border-bottom: 2px solid transparent; padding: 6px 10px; cursor: pointer; color: var(--suave); }
.abas button[aria-selected="true"] { color: var(--texto); border-bottom-color: var(--destaque); font-weight: 600; }
.resultado { display: grid; gap: 16px; align-content: start; }
.resultado > h2, .resumo { margin-bottom: 0; }
.plano-e-painel { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 340px); gap: 16px; align-items: start; }
.plano-e-painel > aside { position: sticky; top: 12px; }
@media (max-width: 1100px) { .plano-e-painel { grid-template-columns: minmax(0, 1fr); } .plano-e-painel > aside { position: static; } }
</style>
