<script setup lang="ts">
import { computed, ref } from "vue";
import type { No } from "../plano/tipos";
import { erroEstimativa, fator, linhas, tempo } from "../plano/formato";

/** Um nó da árvore e, recolhíveis, os filhos (o componente se usa recursivamente). */
const props = withDefaults(defineProps<{
  no: No;
  selecionado: string | null;
  comAlerta: ReadonlySet<string>;
  /** Há um LIMIT acima: o nó para cedo, então vir menos linha que o estimado não é erro (igual aos alertas). */
  abaixoDeLimit?: boolean;
  /** O pai junta dois lados (Hash Join, Nested Loop...): aí "dentro" e "fora" ajudam a ler. */
  ladoDeJuncao?: boolean;
}>(), { abaixoDeLimit: false, ladoDeJuncao: false });
const emit = defineEmits<{ selecionar: [id: string] }>();
const aberto = ref(true);

const r = computed(() => props.no.real);
const erro = computed(() => {
  const e = r.value ? erroEstimativa(props.no.linhasEstimadas, r.value.linhas) : null;
  return e && !(e.sentido === "menos" && props.abaixoDeLimit) ? e : null;
});
// cor da barra: quanto mais do tempo total o nó gasta sozinho, mais "quente"
const calor = computed(() => {
  const p = r.value?.percentual ?? 0;
  return p >= 50 ? "alto" : p >= 15 ? "medio" : "baixo";
});
</script>

<template>
  <li class="no" :class="{ selecionado: selecionado === no.id }">
    <div class="linha">
      <button v-if="no.filhos.length" type="button" class="recolher" :aria-expanded="aberto"
        :aria-label="aberto ? 'Recolher' : 'Expandir'" @click="aberto = !aberto">{{ aberto ? "▾" : "▸" }}</button>
      <span v-else class="recolher" aria-hidden="true"></span>

      <button type="button" class="cartao" :aria-pressed="selecionado === no.id" @click="emit('selecionar', no.id)">
        <span class="titulo">
          <strong>{{ no.tipo }}</strong>
          <span v-if="no.relacao" class="rel"> em {{ no.relacao }}</span>
          <span v-if="no.indice" class="rel"> usando {{ no.indice }}</span>
          <span v-if="ladoDeJuncao && (no.papel === 'Inner' || no.papel === 'Outer')" class="papel">{{ no.papel === "Inner" ? "dentro" : "fora" }}</span>
          <span v-if="comAlerta.has(no.id)" class="alerta" title="Este nó tem alerta">!</span>
        </span>

        <span class="numeros">
          <template v-if="r">
            <span class="barra" :class="calor" :title="`${r.percentual.toFixed(1)}% do tempo da consulta`">
              <span :style="{ width: `${Math.max(r.percentual, 1)}%` }"></span>
            </span>
            <span class="tempo">{{ tempo(r.tempoProprioMs) }}</span>
            <span class="qtd">
              {{ linhas(r.linhas) }} linhas
              <span v-if="erro" class="estimativa" :class="{ grave: erro.fator >= 5 }">est. {{ linhas(no.linhasEstimadas) }} ({{ fator(erro.fator) }} {{ erro.sentido }})</span>
              <span v-if="r.execucoes > 1"> × {{ linhas(r.execucoes) }} execuções</span>
            </span>
          </template>
          <span v-else class="qtd">{{ linhas(no.linhasEstimadas) }} linhas estimadas · custo {{ linhas(no.custoTotal) }}</span>
        </span>
      </button>
    </div>

    <ul v-if="no.filhos.length && aberto" class="filhos">
      <NoPlano v-for="f in no.filhos" :key="f.id" :no="f" :selecionado="selecionado" :com-alerta="comAlerta"
        :abaixo-de-limit="abaixoDeLimit || no.tipo === 'Limit'" :lado-de-juncao="no.filhos.length > 1" @selecionar="emit('selecionar', $event)" />
    </ul>
  </li>
</template>
