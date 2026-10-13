-- HypoPG: índices hipotéticos ("e se existisse um índice aqui?") sem criar nada de verdade.
-- No Neon o dono do projeto cria a extensão; localmente quem cria é o superusuário (docker/init.sql),
-- e aqui o IF NOT EXISTS só confere que ela está lá.
CREATE EXTENSION IF NOT EXISTS hypopg;
