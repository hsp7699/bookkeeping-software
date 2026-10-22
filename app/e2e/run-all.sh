#!/usr/bin/env bash
# Runs every browser check against a running app (BASE_URL, default http://localhost:3100).
# Seeds the demo company first if it doesn't exist (for the report checks).
set -uo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-/tmp/books-e2e}
mkdir -p "$OUT"
npm run -s seed:demo >/dev/null 2>&1 || true
fail=0
for t in slice-invoice m2-accounts m3-sales m4-expenses m5-money m6-banking m7-reconcile m8-reports m9-credits p2-reports-tax p2-tracking; do
  if node "e2e/$t.mjs" "$OUT" > "$OUT/$t.log" 2>&1 && tail -1 "$OUT/$t.log" | grep -q "^OK"; then
    echo "pass  $t"
  else
    echo "FAIL  $t  (see $OUT/$t.log)"; fail=1
  fi
done
exit $fail
