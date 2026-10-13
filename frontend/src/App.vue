<script setup lang="ts">
import { computed, ref } from "vue";
import NoPlano from "./componentes/NoPlano.vue";
import { gerarAlertas } from "./plano/alertas";
import { lerTexto, PlanoInvalido } from "./plano/ler";
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

const texto = ref("");
const erro = ref("");
const plano = ref<Plano | null>(null);
const selecionado = ref<string | null>(null);
const comAlerta = computed(() => new Set(plano.value ? gerarAlertas(plano.value).map((a) => a.noId) : []));

function ler() {
  try {
    plano.value = lerTexto(texto.value);
    erro.value = "";
    selecionado.value = null;
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
    <section class="entrada" aria-labelledby="t-colar">
      <h2 id="t-colar">Colar um plano</h2>
      <label for="plano-json">Saída de <code>EXPLAIN (ANALYZE, FORMAT JSON)</code></label>
      <textarea id="plano-json" v-model="texto" class="sql" rows="10" spellcheck="false" placeholder='[ { "Plan": { "Node Type": ... } } ]'></textarea>
      <button type="button" class="principal" @click="ler">Ler plano</button>
      <p v-if="erro" class="erro" role="alert">{{ erro }}</p>
      <p class="exemplos">
        Ou veja um exemplo:
        <button v-for="e in EXEMPLOS" :key="e.nome" type="button" class="chip" @click="exemplo(e.json)">{{ e.nome }}</button>
      </p>
      <p class="nota">O plano colado é lido no seu navegador: nada vai para o servidor.</p>
    </section>

    <section v-if="plano" class="resultado" aria-labelledby="t-plano">
      <h2 id="t-plano">Plano</h2>
      <p class="resumo">
        <template v-if="plano.execucaoMs !== null">Execução: <strong>{{ tempo(plano.execucaoMs) }}</strong> · </template>
        <template v-if="plano.planejamentoMs !== null">planejamento: {{ tempo(plano.planejamentoMs) }} · </template>
        {{ plano.totalNos }} {{ plano.totalNos === 1 ? "nó" : "nós" }}
        <template v-if="!plano.comAnalyze"> · sem ANALYZE: só estimativas</template>
      </p>
      <ul class="arvore">
        <NoPlano :no="plano.raiz" :selecionado="selecionado" :com-alerta="comAlerta" @selecionar="selecionado = $event" />
      </ul>
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
label { font-size: .9em; color: var(--suave); }
textarea { width: 100%; resize: vertical; border: 1px solid var(--borda); border-radius: var(--raio); padding: 8px; background: var(--fundo); }
.principal { justify-self: start; background: var(--destaque); color: var(--sobre-destaque); border: 0; border-radius: var(--raio); padding: 8px 16px; cursor: pointer; font-weight: 600; }
.chip { margin: 4px 4px 0 0; background: none; border: 1px solid var(--borda); border-radius: 99px; padding: 2px 10px; cursor: pointer; font-size: .85em; }
.chip:hover { border-color: var(--destaque); }
.exemplos, .nota { margin: 0; font-size: .9em; color: var(--suave); }
.erro { margin: 0; padding: 8px 10px; border-radius: var(--raio); background: var(--aviso-fundo); color: var(--aviso); }
.resumo { margin: 0 0 12px; color: var(--suave); }
</style>
