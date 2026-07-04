#!/usr/bin/env bash
# run-fallback.sh — the 08-02 live differential-validation dogfood, FALLBACK path.
#
# Stands up the comparable SPA pair — v1 (ORIGINAL) + v2 (diverged REBUILD, 3 known drifts) +
# a SECOND v1 instance (self-compare control) — on separate localhost ports, then runs the REAL,
# UNMODIFIED `archeo compare` CLI (scripted provider, headed Chromium, floor ON both) for BOTH the
# original-vs-rebuild compare and the original-vs-itself self-compare. Collects both
# compare-report.json files and all three backend floor-proof ledgers.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="/Users/Montster/PrometheusUltra/Ideas/Archeo"
CLI="$REPO/src/cli/index.ts"
FB="$HERE/fallback"
RUNS="$HERE/runs-fb"
LOGS="$HERE/logs-fb"
rm -rf "$RUNS" "$LOGS"
mkdir -p "$RUNS/main" "$RUNS/self" "$LOGS"

V1_PORT=4100
V2_PORT=4200
CLONE_PORT=4300

echo "=== Booting SPA pair ==="
VARIANT=v1 PORT=$V1_PORT    node "$FB/launch.mjs" > "$LOGS/v1.log"    2>&1 &  V1_PID=$!
VARIANT=v2 PORT=$V2_PORT    node "$FB/launch.mjs" > "$LOGS/v2.log"    2>&1 &  V2_PID=$!
VARIANT=v1 PORT=$CLONE_PORT node "$FB/launch.mjs" > "$LOGS/clone.log" 2>&1 &  CLONE_PID=$!
cleanup() { kill $V1_PID $V2_PID $CLONE_PID 2>/dev/null; }
trap cleanup EXIT

wait_up() {
  local port=$1 name=$2
  for i in $(seq 1 50); do
    if curl -s -o /dev/null "http://127.0.0.1:$port/app"; then echo "  $name up on $port"; return 0; fi
    sleep 0.2
  done
  echo "  FAILED: $name never came up on $port"; return 1
}
wait_up $V1_PORT    "v1 (original)" || exit 1
wait_up $V2_PORT    "v2 (rebuild)"  || exit 1
wait_up $CLONE_PORT "v1-clone"      || exit 1

echo ""
echo "=== Known-drift live probes ==="
echo "  v1 /api/teams=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$V1_PORT/api/teams) v2 /api/teams=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$V2_PORT/api/teams)  (200 vs 404: removed endpoint)"
echo "  v1 /api/reports=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$V1_PORT/api/reports) v2 /api/reports=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$V2_PORT/api/reports)  (404 vs 200: new endpoint)"
echo "  v1 account=$(curl -s http://127.0.0.1:$V1_PORT/api/account)  v2 account=$(curl -s http://127.0.0.1:$V2_PORT/api/account)  (accountId number vs string: changed shape)"

echo ""
echo "=== RUN 1: archeo compare  v1/original(4100/app) vs v2/rebuild(4200/app) ==="
( cd "$RUNS/main" && node "$CLI" compare "http://127.0.0.1:$V1_PORT/app" "http://127.0.0.1:$V2_PORT/app" \
    --i-have-authorization --model scripted --max-steps 60 ) 2>&1 | tee "$LOGS/compare-main.log"

echo ""
echo "=== RUN 2 (SELF-COMPARE CONTROL): archeo compare  v1(4100/app) vs v1-clone(4300/app) ==="
( cd "$RUNS/self" && node "$CLI" compare "http://127.0.0.1:$V1_PORT/app" "http://127.0.0.1:$CLONE_PORT/app" \
    --i-have-authorization --model scripted --max-steps 60 ) 2>&1 | tee "$LOGS/compare-self.log"

echo ""
echo "=== FLOOR PROOF: backend-side ledgers after ALL compare runs ==="
echo "  v1/original(4100):    $(curl -s http://127.0.0.1:$V1_PORT/__ledger__)"
echo "  v2/rebuild(4200):     $(curl -s http://127.0.0.1:$V2_PORT/__ledger__)"
echo "  v1-clone(4300):       $(curl -s http://127.0.0.1:$CLONE_PORT/__ledger__)"
curl -s http://127.0.0.1:$V1_PORT/__ledger__    > "$LOGS/ledger-v1.json"
curl -s http://127.0.0.1:$V2_PORT/__ledger__    > "$LOGS/ledger-v2.json"
curl -s http://127.0.0.1:$CLONE_PORT/__ledger__ > "$LOGS/ledger-clone.json"

echo ""
echo "=== compare-report.json files ==="
MAIN_REPORT="$(find "$RUNS/main/.archeo/compares" -name compare-report.json 2>/dev/null | head -1)"
SELF_REPORT="$(find "$RUNS/self/.archeo/compares" -name compare-report.json 2>/dev/null | head -1)"
cp "$MAIN_REPORT" "$LOGS/compare-report-main.json" 2>/dev/null
cp "$SELF_REPORT" "$LOGS/compare-report-self.json" 2>/dev/null
echo "  main: $MAIN_REPORT"
echo "  self: $SELF_REPORT"

echo ""
echo "=== DONE ==="
