-- Dados de exemplo. Sempre os mesmos: setseed fixa o random() e os itens saem de fórmulas,
-- então os planos e os números da documentação batem em qualquer máquina.
SELECT setseed(0.42);

INSERT INTO loja.categorias (nome) VALUES
  ('Eletrônicos'), ('Informática'), ('Livros'), ('Casa'), ('Cozinha'), ('Esporte'),
  ('Brinquedos'), ('Moda'), ('Beleza'), ('Pet'), ('Ferramentas'), ('Papelaria');

INSERT INTO loja.produtos (categoria_id, nome, preco_centavos, ativo)
SELECT 1 + g % 12, 'Produto ' || g, 500 + (random() * 99500)::int, random() > 0.05
FROM generate_series(1, 2000) g;

-- 50 mil clientes concentrados em poucas cidades. Cidade e UF andam juntas, mas o planejador
-- supõe colunas independentes: "cidade = 'Curitiba' AND uf = 'PR'" sai com estimativa errada.
INSERT INTO loja.clientes (nome, email, cidade, uf, criado_em)
SELECT 'Cliente ' || g, 'cliente' || g || '@exemplo.com', c.cidade, c.uf, timestamptz '2023-01-01' + t * interval '3 years'
FROM (SELECT g, random() AS r, random() AS t FROM generate_series(1, 50000) g) b
CROSS JOIN LATERAL (
  SELECT * FROM (VALUES
    (0.30, 'São Paulo', 'SP'), (0.40, 'Campinas', 'SP'), (0.55, 'Rio de Janeiro', 'RJ'),
    (0.65, 'Belo Horizonte', 'MG'), (0.73, 'Curitiba', 'PR'), (0.77, 'Ponta Grossa', 'PR'),
    (0.78, 'Irati', 'PR'), (0.85, 'Porto Alegre', 'RS'), (0.91, 'Salvador', 'BA'),
    (0.96, 'Recife', 'PE'), (1.01, 'Manaus', 'AM')
  ) AS v (ate, cidade, uf)
  WHERE b.r < v.ate ORDER BY v.ate LIMIT 1
) c
ORDER BY g;

-- itens primeiro (numa tabela temporária) para o total do pedido já nascer certo, sem UPDATE
-- depois (um UPDATE em 200 mil linhas deixaria metade da tabela como linha morta).
-- 1 a 9 itens por pedido (média 5, ~1 milhão no total); 977 é primo com 2000, então os
-- produtos de um mesmo pedido nunca se repetem.
CREATE TEMP TABLE itens_gerados ON COMMIT DROP AS
SELECT g AS pedido_id, 1 + (g * 131 + n * 977) % 2000 AS produto_id, 1 + (g + n) % 4 AS quantidade
FROM generate_series(1, 200000) g, generate_series(1, 1 + (g * 7919) % 9) n;

-- 200 mil pedidos em 2024 e 2025. Poucos clientes compram muito (power(r, 2) puxa para os
-- primeiros ids) e quase todos os pedidos estão entregues: distribuições desiguais, como na vida real.
INSERT INTO loja.pedidos (id, cliente_id, status, criado_em, total_centavos) OVERRIDING SYSTEM VALUE
SELECT b.g,
       1 + floor(power(b.r1, 2) * 50000)::int,
       (CASE WHEN b.r2 < 0.70 THEN 'entregue' WHEN b.r2 < 0.80 THEN 'enviado' WHEN b.r2 < 0.90 THEN 'pago'
             WHEN b.r2 < 0.95 THEN 'aberto' ELSE 'cancelado' END)::loja.status_pedido,
       timestamptz '2024-01-01' + b.r3 * interval '2 years',
       t.total
FROM (SELECT g, random() AS r1, random() AS r2, random() AS r3 FROM generate_series(1, 200000) g) b
JOIN (
  SELECT i.pedido_id, sum(i.quantidade * p.preco_centavos) AS total
  FROM itens_gerados i JOIN loja.produtos p ON p.id = i.produto_id
  GROUP BY i.pedido_id
) t ON t.pedido_id = b.g
ORDER BY b.g;
SELECT setval(pg_get_serial_sequence('loja.pedidos', 'id'), 200000);

INSERT INTO loja.itens_pedido (pedido_id, produto_id, quantidade, preco_unitario_centavos)
SELECT i.pedido_id, i.produto_id, i.quantidade, p.preco_centavos
FROM itens_gerados i JOIN loja.produtos p ON p.id = i.produto_id
ORDER BY i.pedido_id, i.produto_id;

-- estatísticas para o planejador (o VACUUM não roda dentro da transação da migração; o autovacuum faz depois)
ANALYZE loja.categorias, loja.produtos, loja.clientes, loja.pedidos, loja.itens_pedido;
