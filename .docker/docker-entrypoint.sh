#!/usr/bin/env sh

set -e

# This image is exclusively for the isolated Render test service.
# Always bind DebridUI to this container-local database; never use a
# Render-provided DATABASE_URL that could point at a shared/production DB.
PG_BIN="$(pg_config --bindir)"
export DATABASE_URL="postgresql://nextjs@127.0.0.1:5432/debridui"
PGDATA="/var/lib/postgresql/data"
export PGDATA

"$PG_BIN/pg_ctl" -D "$PGDATA" -l /tmp/test-postgres.log \
  -o "-h 127.0.0.1 -p 5432 -c listen_addresses=127.0.0.1 -c max_connections=20 -c shared_buffers=64MB" \
  -w start

# Apply the checked-in PostgreSQL migrations once for this container's
# ephemeral database. A marker also makes process restarts idempotent.
if [ ! -f "$PGDATA/.debridui-test-schema-ready" ]; then
  "$PG_BIN/createdb" -h 127.0.0.1 -p 5432 -U nextjs debridui
  for migration in /app/drizzle/*.sql; do
    echo "[test-db] Applying $(basename "$migration")"
    "$PG_BIN/psql" -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U nextjs -d debridui -f "$migration"
  done
  touch "$PGDATA/.debridui-test-schema-ready"
fi

START_TIME=$(date +%s%3N)

# Build sed script with all NEXT_PUBLIC_* replacements
SED_FILE=$(mktemp)
printenv | sed -n 's/^\(NEXT_PUBLIC_[^=]*\)=\(.*\)$/s|__\1__|\2|g/p' >> "$SED_FILE"
echo 's|__NEXT_PUBLIC_[A-Z_]*__||g' >> "$SED_FILE"

# Process all files in parallel
find .next -type f \( -name "*.js" -o -name "*.html" \) -print0 | \
  xargs -0 -P "$(nproc)" sed -i -f "$SED_FILE"

rm -f "$SED_FILE"

echo "Env injected in $(($(date +%s%3N) - START_TIME))ms"
echo "[test-db] Isolated PostgreSQL is ready on 127.0.0.1:5432"

exec "$@"
