/** Documentação da API (OpenAPI 3.1). Um teste garante que toda rota está aqui e vice-versa. */
const erro = (descricao: string) => ({
  description: descricao,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Erro" } } },
});

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Visualizador de EXPLAIN",
    version: "1.0.0",
    description: "Roda EXPLAIN (ANALYZE) num banco de exemplo de uma loja, como um papel só de leitura com timeout de 3 s.",
  },
  paths: {
    "/api/health": { get: { summary: "Saúde da API", responses: { 200: { description: "ok" } } } },
    "/api/docs.json": { get: { summary: "Esta documentação", responses: { 200: { description: "OpenAPI" } } } },
    "/api/explain": {
      post: {
        summary: "Plano de execução de uma consulta no banco de exemplo",
        description: "Um comando por vez, só leitura. Com analyze (padrão), a consulta roda de verdade e o plano traz tempos e linhas reais.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["sql"],
                additionalProperties: false,
                properties: {
                  sql: { type: "string", maxLength: 5000, examples: ["SELECT * FROM pedidos WHERE cliente_id = 42"] },
                  analyze: { type: "boolean", default: true },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Plano (saída de EXPLAIN FORMAT JSON)", content: { "application/json": { schema: { type: "object", properties: { plano: { type: "array" }, analyze: { type: "boolean" } } } } } },
          400: erro("Corpo inválido ou consulta vazia/grande demais"),
          413: erro("Corpo grande demais"),
          422: erro("A consulta falhou: sintaxe (com posição), escrita, permissão, tempo ou limite"),
          429: erro("Rate limit (20 consultas/min por IP); veja Retry-After"),
          503: erro("Banco indisponível ou ocupado; veja Retry-After"),
        },
      },
    },
  },
  components: {
    schemas: {
      Erro: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string" },
          tipo: { type: "string", enum: ["entrada", "sintaxe", "escrita", "permissao", "tempo", "limite"] },
          posicao: { type: "integer", description: "Posição do erro na consulta enviada (1 = primeiro caractere)" },
          id: { type: "string", description: "Identificador para achar o caso no log (erros 5xx)" },
        },
      },
    },
  },
} as const;
