# Postgres 16 com a HypoPG (índices hipotéticos), a mesma extensão que o Neon oferece.
# A imagem oficial (Debian) já vem com o repositório apt do PostgreSQL configurado.
FROM postgres:16
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-hypopg \
 && rm -rf /var/lib/apt/lists/*
