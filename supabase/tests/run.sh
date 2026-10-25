#!/usr/bin/env bash
# Runs the Supabase stub + all migrations + RLS tests against DATABASE_URL.
# Everything runs inside ONE transaction that is rolled back at the end, so the
# target database is left unchanged (roles included). Use a throwaway local
# PostgreSQL >= 15 — never a real Supabase project.
#
# Usage: DATABASE_URL=postgresql://postgres@localhost:54329/postgres supabase/tests/run.sh
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set" >&2
  exit 2
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
migrations_dir="$here/../migrations"

script="$(mktemp)"
trap 'rm -f "$script"' EXIT

{
  echo '\set ON_ERROR_STOP on'
  echo 'begin;'
  echo "\\i '$here/supabase_stub.sql'"
  for f in $(ls "$migrations_dir"/*.sql | sort); do
    echo "\\echo 'Applying $(basename "$f")'"
    echo "\\i '$f'"
  done
  echo "\\i '$here/rls_test.sql'"
  echo 'rollback;'
} > "$script"

if psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -f "$script"; then
  echo "RESULT: PASS"
else
  status=$?
  echo "RESULT: FAIL (psql exit code $status)" >&2
  exit 1
fi
