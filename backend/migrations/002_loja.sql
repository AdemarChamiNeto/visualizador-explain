-- Banco de exemplo: uma loja. Quem visita o site roda consultas aqui, como o papel "visitante".
-- Dados fixos e só de leitura, por isso: chave bigint (o plano fica legível: id = 42), sem
-- soft delete e sem updated_at. Detalhes e decisões em docs/banco.md.

CREATE SCHEMA loja;

CREATE TABLE loja.categorias (
  id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome text NOT NULL UNIQUE
);

CREATE TABLE loja.produtos (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- RESTRICT: categoria com produto não some sem decisão explícita
  categoria_id   bigint NOT NULL REFERENCES loja.categorias (id) ON DELETE RESTRICT,
  nome           text NOT NULL,
  preco_centavos integer NOT NULL CHECK (preco_centavos > 0),
  ativo          boolean NOT NULL DEFAULT true
);
-- filtro "produtos da categoria X"
CREATE INDEX produtos_categoria_id_idx ON loja.produtos (categoria_id);

CREATE TABLE loja.clientes (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome      text NOT NULL,
  email     text NOT NULL UNIQUE, -- o UNIQUE já cria o índice da busca por e-mail
  cidade    text NOT NULL,
  uf        char(2) NOT NULL,
  criado_em timestamptz NOT NULL
);

CREATE TYPE loja.status_pedido AS ENUM ('aberto', 'pago', 'enviado', 'entregue', 'cancelado');

CREATE TABLE loja.pedidos (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- SEM índice de propósito: "pedidos do cliente X" vira Seq Scan, o exemplo clássico do
  -- visualizador (e o candidato natural para o índice hipotético)
  cliente_id     bigint NOT NULL REFERENCES loja.clientes (id) ON DELETE RESTRICT,
  status         loja.status_pedido NOT NULL,
  criado_em      timestamptz NOT NULL,
  total_centavos integer NOT NULL DEFAULT 0 CHECK (total_centavos >= 0)
);
-- relatórios por período: mostra Index Scan x Bitmap Scan x Seq Scan conforme o tamanho do intervalo
CREATE INDEX pedidos_criado_em_idx ON loja.pedidos (criado_em);

CREATE TABLE loja.itens_pedido (
  -- CASCADE: item não existe sem o pedido
  pedido_id               bigint NOT NULL REFERENCES loja.pedidos (id) ON DELETE CASCADE,
  -- RESTRICT e SEM índice em produto_id, de propósito ("quem comprou o produto X" = Seq Scan em 1 milhão de linhas)
  produto_id              bigint NOT NULL REFERENCES loja.produtos (id) ON DELETE RESTRICT,
  quantidade              integer NOT NULL CHECK (quantidade > 0),
  preco_unitario_centavos integer NOT NULL CHECK (preco_unitario_centavos > 0),
  PRIMARY KEY (pedido_id, produto_id) -- um produto aparece uma vez por pedido; a PK serve a busca por pedido
);

-- ---------- papel do visitante ----------
-- Tem LOGIN próprio (a senha é definida pelo migrate.ts a partir do ambiente). A API NÃO conecta
-- como dono e troca de papel com SET ROLE: o SELECT do visitante poderia chamar
-- set_config('role', 'dono', ...) e voltar a ser dono. Logado como visitante, não há para onde subir.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'visitante') THEN
    CREATE ROLE visitante NOLOGIN; -- papéis são do cluster: o banco de teste e o de dev dividem o mesmo
  END IF;
END $$;

-- nega por padrão: ninguém além do dono entra no banco nem usa o schema public
DO $$ BEGIN EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()); END $$;
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO visitante', current_database()); END $$;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- libera só a leitura da loja
GRANT USAGE ON SCHEMA loja TO visitante;
GRANT SELECT ON ALL TABLES IN SCHEMA loja TO visitante;

-- limites que valem desde o login (a API ainda repete os principais com SET LOCAL a cada consulta)
ALTER ROLE visitante SET default_transaction_read_only = on;
ALTER ROLE visitante SET statement_timeout = '3s';
ALTER ROLE visitante SET lock_timeout = '1s';
ALTER ROLE visitante SET idle_in_transaction_session_timeout = '5s';
ALTER ROLE visitante SET work_mem = '4MB';
ALTER ROLE visitante SET search_path = loja;
ALTER ROLE visitante CONNECTION LIMIT 5;
