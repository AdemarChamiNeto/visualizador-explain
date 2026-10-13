<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api, ErroApi, type Comparacao, type Tabela } from "../api";
import { gerarAlertas } from "../plano/alertas";
import { percorrer } from "../plano/ler";
import type { Plano } from "../plano/tipos";
import { linhas } from "../plano/formato";

/** "E se existisse este índice?": o plano da mesma consulta com um índice hipotético (HypoPG). */
const props = defineProps<{ sql: string; plano: Plano }>();
const emit = defineEmits<{ verPlano: [json: unknown] }>();

const tabelas = ref<Tabela[]>([]);
const tabela = ref("");
const colunas = ref<string[]>([]);
const rodando = ref(false);
const erro = ref("");
const resultado = ref<Comparacao | null>(null);

/** Sugestão a partir do alerta de Seq Scan: a tabela dele e as colunas que aparecem no filtro. */
function sugerir() {
  const alerta = gerarAlertas(props.plano).find((a) => a.tipo === "seq-scan-filtro");
  const no = alerta && [...percorrer(props.plano.raiz)].find((n) => n.id === alerta.noId);
  const t = tabelas.value.find((x) => x.tabela === no?.relacao) ?? tabelas.value[0];
  if (!t) return;
  const filtro = String(no?.campos["Filter"] ?? "");
  tabela.value = t.tabela;
  colunas.value = t.colunas.filter((c) => new RegExp(`\\b${c}\\b`).test(filtro)).slice(0, 3);
}

onMounted(async () => {
  try {
    tabelas.value = await api.tabelas();
    sugerir();
  } catch (e) {
    erro.value = e instanceof ErroApi ? e.message : "Não foi possível carregar as tabelas.";
  }
});
// só uma consulta nova muda a sugestão: ver o plano com o índice (mesma consulta) mantém a escolha
watch(() => props.sql, () => { resultado.value = null; sugerir(); });

const opcoes = computed(() => tabelas.value.find((t) => t.tabela === tabela.value)?.colunas ?? []);
const custo = (json: unknown) => (json as { Plan: { "Total Cost": number; "Node Type": string } }[])[0].Plan;

async function comparar() {
  rodando.value = true;
  erro.value = "";
  try {
    resultado.value = await api.compararIndice(props.sql, tabela.value, colunas.value);
  } catch (e) {
    if (!(e instanceof ErroApi)) throw e;
    erro.value = e.message;
  } finally {
    rodando.value = false;
  }
}
</script>

<template>
  <section class="indice" aria-labelledby="t-indice">
    <h3 id="t-indice">E se existisse um índice?</h3>
    <p class="nota">O índice é hipotético (HypoPG): só o planejador o enxerga, nada é criado no banco.</p>
    <form v-if="tabelas.length" class="campos" @submit.prevent="comparar">
      <label>Tabela
        <select v-model="tabela" @change="colunas = []">
          <option v-for="t in tabelas" :key="t.tabela" :value="t.tabela">{{ t.tabela }}</option>
        </select>
      </label>
      <fieldset>
        <legend>Colunas (até 3, na ordem do índice)</legend>
        <label v-for="c in opcoes" :key="c" class="check">
          <input v-model="colunas" type="checkbox" :value="c" :disabled="!colunas.includes(c) && colunas.length >= 3" /> {{ c }}
        </label>
      </fieldset>
      <button type="submit" class="principal" :disabled="rodando || !colunas.length">{{ rodando ? "Comparando…" : "Comparar planos" }}</button>
    </form>
    <p v-if="erro" class="erro" role="alert">{{ erro }}</p>

    <div v-if="resultado" class="resultado-indice" role="status">
      <p>
        <code>CREATE INDEX ON {{ tabela }} ({{ colunas.join(", ") }})</code>
        <strong>{{ resultado.usado ? " seria usado." : " não seria usado: o planejador prefere o plano atual." }}</strong>
      </p>
      <p>
        Custo estimado: {{ linhas(custo(resultado.antes)["Total Cost"]) }} → <strong>{{ linhas(custo(resultado.depois)["Total Cost"]) }}</strong>
        ({{ custo(resultado.antes)["Node Type"] }} → {{ custo(resultado.depois)["Node Type"] }})
      </p>
      <button type="button" class="ver" @click="emit('verPlano', resultado.depois)">Ver o plano com o índice</button>
    </div>
  </section>
</template>

<style scoped>
.indice { display: grid; gap: 8px; background: var(--superficie); border: 1px solid var(--borda); border-radius: var(--raio); padding: 14px 16px; }
h3 { margin: 0; font-size: 1rem; }
.campos { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: flex-end; }
.campos > label { display: grid; gap: 4px; }
select { border: 1px solid var(--borda); border-radius: var(--raio); padding: 6px 8px; background: var(--fundo); }
fieldset { border: 1px solid var(--borda); border-radius: var(--raio); margin: 0; padding: 4px 10px 8px; display: flex; flex-wrap: wrap; gap: 4px 12px; }
legend { font-size: .85em; color: var(--suave); }
.check { display: flex; gap: 4px; align-items: center; color: var(--texto); }
.resultado-indice p { margin: 0 0 4px; }
.ver { background: none; border: 0; padding: 0; color: var(--destaque); cursor: pointer; text-decoration: underline; }
</style>
