-- Função nova do dono não nasce executável por todo mundo.
-- O padrão do Postgres dá EXECUTE a PUBLIC em toda função criada, e o visitante faz parte de PUBLIC.
-- As funções de hoje já revogam PUBLIC uma a uma (004_hipotetico.sql); isto vale para as que vierem,
-- para o "somente leitura" não depender de alguém lembrar do REVOKE.
-- Vale para os objetos criados pelo papel que roda as migrações (o dono). As funções embutidas do
-- Postgres (pg_sleep, generate_series...) são do superusuário e não dá para revogar sem ele: quem
-- segura essas é o statement_timeout, o work_mem e o limite de custo do ANALYZE (executar.ts).
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
