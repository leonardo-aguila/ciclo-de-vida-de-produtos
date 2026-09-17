#!/usr/bin/env bash
# Makes sure the Postgres cluster is running before the dev server starts.
# The cluster is not a system service and does not come back up after a reboot,
# which otherwise surfaces as a generic "server-side exception" in the browser.
set -euo pipefail

PG_BIN="${PG_BIN:-$HOME/Applications/Postgres.app/Contents/Versions/latest/bin}"
PGDATA_DIR="${PGDATA_DIR:-$HOME/.local/pgdata-ponteiro}"
PGPORT="${PGPORT:-5433}"

if [ ! -d "$PG_BIN" ]; then
  echo "erro: binários do Postgres não encontrados em $PG_BIN" >&2
  echo "      defina PG_BIN apontando para o bin do seu Postgres." >&2
  exit 1
fi
export PATH="$PG_BIN:$PATH"

if pg_isready -h localhost -p "$PGPORT" >/dev/null 2>&1; then
  exit 0
fi

echo "banco parado na porta $PGPORT — subindo o cluster em $PGDATA_DIR..."
pg_ctl -D "$PGDATA_DIR" -l "$PGDATA_DIR/server.log" -o "-p $PGPORT" start >/dev/null

for _ in $(seq 1 20); do
  if pg_isready -h localhost -p "$PGPORT" >/dev/null 2>&1; then
    echo "banco no ar."
    exit 0
  fi
  sleep 0.5
done

echo "erro: o cluster não respondeu em 10s. Veja $PGDATA_DIR/server.log" >&2
exit 1
