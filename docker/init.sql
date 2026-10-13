-- Simula o Neon: o dono do banco NÃO é superusuário (só pode criar papéis).
-- Senha só de desenvolvimento local; em produção o DATABASE_URL vem da hospedagem.
CREATE ROLE dono LOGIN CREATEROLE PASSWORD 'dono-dev';
CREATE DATABASE explain OWNER dono;
CREATE DATABASE explain_test OWNER dono;

-- A HypoPG não é "trusted": localmente só o superusuário cria. No Neon, o dono do projeto cria.
\connect explain
CREATE EXTENSION IF NOT EXISTS hypopg;
\connect explain_test
CREATE EXTENSION IF NOT EXISTS hypopg;
