/**
 * Cliente da API (mesmo domínio, sem CORS). Toda falha vira ErroApi com uma mensagem para mostrar:
 * a da API quando ela responde, ou uma nossa quando nem chega a responder.
 */

export class ErroApi extends Error {
  constructor(message: string, readonly status: number, readonly tipo?: string, readonly posicao?: number) {
    super(message);
    this.name = "ErroApi";
  }
}

/** Resposta que não veio da nossa API (HTML de quem está na frente dela). */
function semJson(status: number): string {
  if (status === 502 || status === 503) return "O servidor está acordando (plano gratuito). Tente de novo em alguns segundos.";
  // o Cloudflare (na frente do Render) barra corpos que parecem SQL injection, como "; DROP TABLE"
  if (status === 403) return "A proteção da hospedagem (Cloudflare) bloqueou essa consulta por parecer um ataque. Ela nem chegou ao banco: tire o trecho suspeito (como \"; DROP\") e tente de novo.";
  return `Erro ${status} no servidor.`;
}

async function chamar<T>(metodo: "GET" | "POST", caminho: string, corpo?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${caminho}`, {
      method: metodo,
      headers: corpo === undefined ? undefined : { "content-type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new ErroApi("Sem conexão com o servidor. Confira a internet e tente de novo.", 0);
  }
  let json: { error?: string; tipo?: string; posicao?: number } | null = null;
  try {
    json = await res.json();
  } catch {
    // resposta que não é JSON (proxy, página de erro do provedor): mensagem genérica abaixo
  }
  if (res.ok && json) return json as T;
  const espera = res.headers.get("retry-after");
  const msg = json?.error ?? semJson(res.status);
  throw new ErroApi(res.status === 429 && espera ? `${msg} (aguarde ${espera} s)` : msg, res.status, json?.tipo, json?.posicao);
}

export type Tabela = { tabela: string; colunas: string[] };
export type Comparacao = { antes: unknown; depois: unknown; indice: string; usado: boolean };

export const api = {
  explicar: (sql: string, analyze: boolean) => chamar<{ plano: unknown; analyze: boolean }>("POST", "/explain", { sql, analyze }),
  compararIndice: (sql: string, tabela: string, colunas: string[]) => chamar<Comparacao>("POST", "/indice-hipotetico", { sql, tabela, colunas }),
  tabelas: () => chamar<Tabela[]>("GET", "/tabelas"),
};

/** Consultas prontas: cada uma mostra um cenário do banco de exemplo (ver docs/banco.md). */
export const CONSULTAS = [
  { nome: "Pedidos de um cliente (sem índice)", sql: "SELECT * FROM pedidos WHERE cliente_id = 42" },
  {
    nome: "Clientes de Curitiba (estimativa errada)",
    sql: "SELECT c.nome, count(*) AS pedidos\nFROM clientes c JOIN pedidos p ON p.cliente_id = c.id\nWHERE c.cidade = 'Curitiba' AND c.uf = 'PR'\nGROUP BY c.nome ORDER BY pedidos DESC LIMIT 10",
  },
  { nome: "Quem comprou um produto", sql: "SELECT DISTINCT p.cliente_id\nFROM itens_pedido i JOIN pedidos p ON p.id = i.pedido_id\nWHERE i.produto_id = 7" },
  {
    nome: "Vendas de uma semana (usa índice)",
    sql: "SELECT date_trunc('day', criado_em) AS dia, sum(total_centavos) AS vendas\nFROM pedidos\nWHERE criado_em >= '2025-03-01' AND criado_em < '2025-03-08'\nGROUP BY 1 ORDER BY 1",
  },
  { nome: "Ordenar 1 milhão de itens (disco)", sql: "SELECT * FROM itens_pedido ORDER BY quantidade, preco_unitario_centavos" },
];
