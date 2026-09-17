#!/usr/bin/env bash
# One-off: creates the application role and the two databases.
# Idempotent — safe to run again.
set -euo pipefail

PG_BIN="${PG_BIN:-$HOME/Applications/Postgres.app/Contents/Versions/latest/bin}"
PGPORT="${PGPORT:-5433}"
SUPERUSER="${PGSUPERUSER:-$(whoami)}"
APP_ROLE="portfolio_app"
APP_PASSWORD="${APP_PASSWORD:-portfolio_app}"

export PATH="$PG_BIN:$PATH"
bash "$(dirname "$0")/ensure-db.sh"

psql_su() { psql -h localhost -p "$PGPORT" -U "$SUPERUSER" -v ON_ERROR_STOP=1 "$@"; }

echo "criando papel $APP_ROLE..."
psql_su -d postgres -q -c "DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$APP_ROLE') THEN
    CREATE ROLE $APP_ROLE LOGIN PASSWORD '$APP_PASSWORD';
  END IF;
END \$\$;"

for DB in portfolio portfolio_test; do
  if ! psql_su -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '$DB'" | grep -q 1; then
    echo "criando banco $DB..."
    psql_su -d postgres -q -c "CREATE DATABASE $DB"
  fi
  psql_su -d "$DB" -q -c "GRANT CONNECT ON DATABASE $DB TO $APP_ROLE;"
  psql_su -d "$DB" -q -c "GRANT USAGE, CREATE ON SCHEMA public TO $APP_ROLE;"
done

echo "pronto. Rode: npm run db:migrate && npm run db:seed"
