<script setup lang="ts">
import { computed } from "vue";
import type { No } from "../plano/tipos";
import { linhas, tempo } from "../plano/formato";

const props = defineProps<{ no: No }>();

/** Campos que explicam o que o nó fez, com um nome em português; o resto vai para "todos os campos". */
const ROTULOS: Record<string, string> = {
  "Filter": "Filtro",
  "Rows Removed by Filter": "Linhas descartadas pelo filtro (por execução)",
  "Index Cond": "Condição do índice",
  "Recheck Cond": "Condição conferida de novo",
  "Hash Cond": "Condição da junção (hash)",
  "Merge Cond": "Condição da junção (merge)",
  "Join Filter": "Filtro da junção",
  "Join Type": "Tipo de junção",
  "Sort Key": "Ordenar por",
  "Sort Method": "Método de ordenação",
  "Sort Space Used": "Espaço da ordenação (kB)",
  "Sort Space Type": "Onde ordenou",
  "Group Key": "Agrupar por",
  "Hash Batches": "Lotes do hash",
  "Shared Hit Blocks": "Blocos lidos da memória (cache)",
  "Shared Read Blocks": "Blocos lidos do disco",
  "Temp Written Blocks": "Blocos temporários gravados",
  "Workers Launched": "Workers paralelos",
};
const texto = (v: unknown) => (Array.isArray(v) ? v.join(", ") : typeof v === "number" ? linhas(v) : String(v));

const explicados = computed(() => Object.entries(ROTULOS)
  .filter(([k]) => props.no.campos[k] !== undefined && props.no.campos[k] !== 0)
  .map(([k, rotulo]) => ({ rotulo, valor: texto(props.no.campos[k]) })));
const todos = computed(() => Object.entries(props.no.campos).map(([k, v]) => ({ k, valor: texto(v) })));
</script>

<template>
  <aside class="painel" aria-labelledby="t-no">
    <h3 id="t-no">{{ no.tipo }}<span v-if="no.relacao" class="rel"> em {{ no.relacao }}</span></h3>
    <p v-if="no.indice" class="rel">Índice: <code>{{ no.indice }}</code></p>
    <dl>
      <template v-if="no.real">
        <dt>Tempo só deste nó</dt><dd>{{ tempo(no.real.tempoProprioMs) }} ({{ no.real.percentual.toFixed(1).replace(".", ",") }}% da consulta)</dd>
        <dt>Tempo com os filhos</dt><dd>{{ tempo(no.real.tempoTotalMs) }}</dd>
        <dt>Linhas reais</dt><dd>{{ linhas(no.real.linhas) }} por execução</dd>
        <dt>Execuções</dt><dd>{{ linhas(no.real.execucoes) }}</dd>
      </template>
      <dt>Linhas estimadas</dt><dd>{{ linhas(no.linhasEstimadas) }}</dd>
      <dt>Custo estimado</dt><dd>{{ no.custoTotal.toLocaleString("pt-BR") }}</dd>
      <template v-for="c in explicados" :key="c.rotulo"><dt>{{ c.rotulo }}</dt><dd><code>{{ c.valor }}</code></dd></template>
    </dl>
    <details>
      <summary>Todos os campos do JSON</summary>
      <dl class="todos"><template v-for="c in todos" :key="c.k"><dt>{{ c.k }}</dt><dd><code>{{ c.valor }}</code></dd></template></dl>
    </details>
  </aside>
</template>

<style scoped>
.painel { background: var(--superficie); border: 1px solid var(--borda); border-radius: var(--raio); padding: 14px 16px; }
h3 { margin: 0 0 4px; font-size: 1rem; overflow-wrap: anywhere; }
.rel { color: var(--suave); margin: 0; font-weight: 400; }
dl { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 6px 12px; margin: 10px 0 0; font-size: .9em; }
dt { color: var(--suave); }
dd { margin: 0; overflow-wrap: anywhere; }
details { margin-top: 12px; font-size: .9em; }
summary { cursor: pointer; color: var(--destaque); }
.todos { font-size: .85em; }
</style>
