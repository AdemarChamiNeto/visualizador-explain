-- Índice hipotético para o visitante, sem dar a ele acesso direto à HypoPG.
-- As funções da HypoPG ficam no schema public, que o visitante não enxerga (002_loja.sql). Se ele
-- pudesse chamar hypopg_create_index, um "SELECT ... FROM generate_series(1, 1000000)" criaria um
-- milhão de índices na memória da sessão. Aqui ele só tem duas funções, que rodam como o dono
-- (SECURITY DEFINER): uma valida tabela e colunas e cria no máximo 3 índices por sessão; a outra limpa.
-- Os índices hipotéticos são da sessão e NÃO somem no ROLLBACK: a API chama limpar() ao devolver a conexão.

CREATE SCHEMA hipotetico;

CREATE FUNCTION hipotetico.criar_indice(tabela text, colunas text[])
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog -- nada de objeto com nome igual vindo de outro schema
AS $$
DECLARE
  rel regclass := to_regclass(format('loja.%I', tabela));
  col text;
  nome text;
BEGIN
  IF rel IS NULL THEN
    RAISE EXCEPTION 'A tabela "%" não existe na loja.', tabela USING ERRCODE = '22023';
  END IF;
  IF coalesce(cardinality(colunas), 0) NOT BETWEEN 1 AND 3 OR cardinality(colunas) <> (SELECT count(DISTINCT c) FROM unnest(colunas) c) THEN
    RAISE EXCEPTION 'Escolha de 1 a 3 colunas diferentes.' USING ERRCODE = '22023';
  END IF;
  FOREACH col IN ARRAY colunas LOOP
    IF NOT EXISTS (SELECT FROM pg_attribute WHERE attrelid = rel AND attname = col AND attnum > 0 AND NOT attisdropped) THEN
      RAISE EXCEPTION 'A coluna "%" não existe em %.', col, tabela USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.hypopg()) >= 3 THEN
    RAISE EXCEPTION 'No máximo 3 índices hipotéticos por vez.' USING ERRCODE = '54000';
  END IF;

  SELECT h.indexname INTO nome
  FROM public.hypopg_create_index(format('CREATE INDEX ON %s (%s)', rel, (SELECT string_agg(format('%I', c), ', ') FROM unnest(colunas) c))) h;
  RETURN nome;
END $$;

CREATE FUNCTION hipotetico.limpar()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$ SELECT public.hypopg_reset() $$;

-- funções nascem executáveis por todo mundo: tira de PUBLIC e libera só para o visitante
REVOKE ALL ON FUNCTION hipotetico.criar_indice(text, text[]), hipotetico.limpar() FROM PUBLIC;
GRANT USAGE ON SCHEMA hipotetico TO visitante;
GRANT EXECUTE ON FUNCTION hipotetico.criar_indice(text, text[]), hipotetico.limpar() TO visitante;
