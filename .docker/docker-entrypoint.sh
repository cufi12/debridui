#!/usr/bin/env sh
set -eu

# Test-only container-local PostgreSQL. Never use a Render DATABASE_URL:
# this service must remain isolated from production and the shared free DB.
PG_BIN="$(pg_config --bindir)"
export DATABASE_URL="postgresql://nextjs@127.0.0.1:5432/debridui"
PGDATA="/tmp/debridui-test-postgres"
export PGDATA

mkdir -p "$PGDATA"
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "[test-db] Initializing fresh ephemeral PostgreSQL cluster"
  "$PG_BIN/initdb" -D "$PGDATA" -U nextjs --auth-local=trust --auth-host=trust
fi

if ! "$PG_BIN/pg_ctl" -D "$PGDATA" -l /tmp/test-postgres.log \
  -o "-h 127.0.0.1 -p 5432 -c listen_addresses=127.0.0.1 -c max_connections=20 -c shared_buffers=64MB" \
  -w start; then
  echo "[test-db] PostgreSQL failed to start; server log follows:"
  cat /tmp/test-postgres.log || true
  exit 1
fi

if [ ! -f "$PGDATA/.debridui-test-schema-ready" ]; then
  if ! "$PG_BIN/psql" -h 127.0.0.1 -p 5432 -U nextjs -d postgres -Atqc \
    "SELECT 1 FROM pg_database WHERE datname = 'debridui'" | grep -q 1; then
    "$PG_BIN/createdb" -h 127.0.0.1 -p 5432 -U nextjs debridui
  fi
  for migration in /app/drizzle/*.sql; do
    [ -f "$migration" ] || continue
    echo "[test-db] Applying $(basename "$migration")"
    "$PG_BIN/psql" -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U nextjs -d debridui -f "$migration"
  done
  touch "$PGDATA/.debridui-test-schema-ready"
fi

START_TIME=$(date +%s%3N)
SED_FILE=$(mktemp)
printenv | sed -n 's/^\(NEXT_PUBLIC_[^=]*\)=\(.*\)$/s|__\1__|\2|g/p' >> "$SED_FILE"
echo 's|__NEXT_PUBLIC_[A-Z_]*__||g' >> "$SED_FILE"
find .next -type f \( -name "*.js" -o -name "*.html" \) -print0 | \
  xargs -0 -P "$(nproc)" sed -i -f "$SED_FILE"
rm -f "$SED_FILE"

echo "Env injected in $(($(date +%s%3N) - START_TIME))ms"
echo "[test-db] Isolated PostgreSQL is ready on 127.0.0.1:5432"
exec "$@"
