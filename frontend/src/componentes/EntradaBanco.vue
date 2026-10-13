<script setup lang="ts">
import { ref } from "vue";
import { api, CONSULTAS, ErroApi } from "../api";

/** Escrever a consulta e rodar o EXPLAIN no banco de exemplo (pela API). */
const emit = defineEmits<{ plano: [json: unknown, sql: string] }>();

const sql = ref(CONSULTAS[0].sql);
const analyze = ref(true);
const rodando = ref(false);
const erro = ref("");
const campo = ref<HTMLTextAreaElement | null>(null);

async function rodar() {
  rodando.value = true;
  erro.value = "";
  try {
    const r = await api.explicar(sql.value, analyze.value);
    emit("plano", r.plano, sql.value);
  } catch (e) {
    if (!(e instanceof ErroApi)) throw e;
    erro.value = e.posicao ? `${e.message} (posição ${e.posicao}, marcada na consulta)` : e.message;
    // erro de sintaxe: seleciona o caractere onde o Postgres parou de entender
    if (e.posicao && campo.value) {
      campo.value.focus();
      campo.value.setSelectionRange(e.posicao - 1, e.posicao);
    }
  } finally {
    rodando.value = false;
  }
}

function usar(consulta: string) {
  sql.value = consulta;
  void rodar();
}
</script>

<template>
  <form class="banco" @submit.prevent="rodar">
    <label for="consulta">Consulta no banco de exemplo (uma loja: clientes, produtos, pedidos, itens_pedido)</label>
    <textarea id="consulta" ref="campo" v-model="sql" class="sql" rows="7" spellcheck="false" maxlength="5000"
      @keydown.ctrl.enter.prevent="rodar"></textarea>
    <div class="acoes">
      <button type="submit" class="principal" :disabled="rodando">{{ rodando ? "Rodando…" : "Explicar" }}</button>
      <label class="check"><input v-model="analyze" type="checkbox" /> ANALYZE (roda de verdade, até 3 s)</label>
    </div>
    <p v-if="erro" class="erro" role="alert">{{ erro }}</p>
    <p class="exemplos">
      Consultas prontas:
      <button v-for="c in CONSULTAS" :key="c.nome" type="button" class="chip" :disabled="rodando" @click="usar(c.sql)">{{ c.nome }}</button>
    </p>
    <p class="nota">Só leitura, um comando por vez. Ctrl+Enter também roda.</p>
  </form>
</template>

<style scoped>
.banco { display: grid; gap: 8px; }
.acoes { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
.check { display: flex; gap: 6px; align-items: center; font-size: .9em; color: var(--suave); }
</style>
