#!/bin/bash
# PostgreSQL init script — runs once on first container start.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sql_readonly') THEN
        CREATE ROLE sql_readonly LOGIN PASSWORD 'readonly_pass';
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sql_app') THEN
        CREATE ROLE sql_app LOGIN PASSWORD 'app_pass';
      END IF;
    END
    \$\$;
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    SELECT 'CREATE DATABASE northwind'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'northwind')\gexec
    SELECT 'CREATE DATABASE sql_practice'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sql_practice')\gexec
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname=northwind -f /docker-init-assets/schema.sql
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname=northwind -f /docker-init-assets/seed.sql

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname=northwind <<-EOSQL
    GRANT CONNECT ON DATABASE northwind TO sql_readonly;
    GRANT USAGE ON SCHEMA public TO sql_readonly;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO sql_readonly;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO sql_readonly;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM sql_readonly;
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname=sql_practice <<-EOSQL
    GRANT ALL PRIVILEGES ON DATABASE sql_practice TO sql_app;
    GRANT ALL ON SCHEMA public TO sql_app;
    GRANT CREATE ON SCHEMA public TO sql_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO sql_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO sql_app;
EOSQL

echo "Northwind + sql_practice initialized."
