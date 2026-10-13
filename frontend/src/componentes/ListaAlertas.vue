<script setup lang="ts">
import type { Alerta } from "../plano/alertas";

defineProps<{ alertas: Alerta[]; comAnalyze: boolean }>();
const emit = defineEmits<{ selecionar: [id: string] }>();
</script>

<template>
  <section class="alertas" aria-labelledby="t-alertas">
    <h3 id="t-alertas">Alertas</h3>
    <p v-if="!comAnalyze" class="vazio">Sem ANALYZE não há linhas reais para comparar: rode com <code>EXPLAIN (ANALYZE, FORMAT JSON)</code> para ver os alertas.</p>
    <p v-else-if="!alertas.length" class="vazio">Nenhum alerta: nada de leitura desperdiçada, estimativa errada ou disco.</p>
    <ul v-else>
      <li v-for="(a, i) in alertas" :key="i" :class="a.nivel">
        <span class="nivel">{{ a.nivel === "alto" ? "Alto" : "Médio" }}</span>
        <div>
          <strong>{{ a.titulo }}</strong>
          <p>{{ a.detalhe }}</p>
          <p class="dica">{{ a.dica }}</p>
          <button type="button" class="ver" @click="emit('selecionar', a.noId)">Ver no plano</button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
h3 { margin: 0 0 8px; font-size: 1rem; }
ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
li { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: var(--raio); border: 1px solid var(--borda); background: var(--superficie); }
li.alto { border-left: 4px solid var(--quente); }
li.medio { border-left: 4px solid var(--morno); }
.nivel { flex: none; font-size: .75em; font-weight: 700; text-transform: uppercase; color: var(--suave); padding-top: 2px; }
p { margin: 2px 0 0; }
.dica { color: var(--suave); font-size: .9em; }
.ver { margin-top: 6px; background: none; border: 0; padding: 0; color: var(--destaque); cursor: pointer; text-decoration: underline; }
.vazio { margin: 0; color: var(--suave); }
</style>
