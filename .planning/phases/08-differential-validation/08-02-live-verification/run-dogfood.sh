#!/usr/bin/env bash
# run-dogfood.sh — the 08-02 live differential-validation dogfood.
#
# Stands up the 03-04 ORIGINAL (via orig-launch.mjs) + REBUILD (via rebuild-launch.mjs)
# + a SECOND ORIGINAL instance (self-compare control) on separate localhost ports, then
# runs the REAL, UNMODIFIED archeo compare CLI (scripted provider, headed Chromium, floor
# ON both) for BOTH the original-vs-rebuild compare and the original-vs-itself self-compare.
# Collects both compare-report.json files and all three backend floor-proof ledgers.
#
# Zero deps: node built-ins + curl only. No src/ or test/ change.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="/Users/Montster/PrometheusUltra/Ideas/Archeo"
CLI="$REPO/src/cli/index.ts"
APPS="$HERE/apps"
RUNS="$HERE/runs"
LOGS="$HERE/logs"
rm -rf "$RUNS" "$LOGS"
mkdir -p "$RUNS/main" "$RUNS/self" "$LOGS"

ORIG_PORT=4100
REBUILD_PORT=4200
CLONE_PORT=4300

echo "=== Booting targets ==="
PORT=$ORIG_PORT    node "$APPS/orig-launch.mjs"    > "$LOGS/orig.log"    2>&1 &  ORIG_PID=$!
PORT=$REBUILD_PORT node "$APPS/rebuild-launch.mjs" > "$LOGS/rebuild.log" 2>&1 &  REBUILD_PID=$!
PORT=$CLONE_PORT   node "$APPS/orig-launch.mjs"    > "$LOGS/clone.log"   2>&1 &  CLONE_PID=$!

cleanup() { kill $ORIG_PID $REBUILD_PID $CLONE_PID 2>/dev/null; }
trap cleanup EXIT

wait_up() {
  local port=$1 name=$2
  for i in $(seq 1 50); do
    if curl -s -o /dev/null "http://127.0.0.1:$port/app"; then
      echo "  $name up on $port"; return 0
    fi
    sleep 0.2
  done
  echo "  FAILED: $name never came up on $port"; return 1
}
wait_up $ORIG_PORT    "original"       || exit 1
wait_up $REBUILD_PORT "rebuild"        || exit 1
wait_up $CLONE_PORT   "original-clone" || exit 1

echo ""
echo "=== Live divergence probe (marquee) ==="
echo "  orig    GET /api/settings -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$ORIG_PORT/api/settings)  (expect 404)"
echo "  rebuild GET /api/settings -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$REBUILD_PORT/api/settings)  (expect 200)"

echo ""
echo "=== RUN 1: archeo compare  original(4100) vs rebuild(4200) ==="
( cd "$RUNS/main" && node "$CLI" compare "http://127.0.0.1:$ORIG_PORT" "http://127.0.0.1:$REBUILD_PORT" \
    --i-have-authorization --model scripted ) 2>&1 | tee "$LOGS/compare-main.log"

echo ""
echo "=== RUN 2 (SELF-COMPARE CONTROL): archeo compare  original(4100) vs original-clone(4300) ==="
( cd "$RUNS/self" && node "$CLI" compare "http://127.0.0.1:$ORIG_PORT" "http://127.0.0.1:$CLONE_PORT" \
    --i-have-authorization --model scripted ) 2>&1 | tee "$LOGS/compare-self.log"

echo ""
echo "=== FLOOR PROOF: backend-side ledgers after ALL compare runs ==="
echo "  original(4100):       $(curl -s http://127.0.0.1:$ORIG_PORT/__ledger__)"
echo "  rebuild(4200):        $(curl -s http://127.0.0.1:$REBUILD_PORT/__ledger__)"
echo "  original-clone(4300): $(curl -s http://127.0.0.1:$CLONE_PORT/__ledger__)"

# Persist ledgers to files for the verification doc.
curl -s http://127.0.0.1:$ORIG_PORT/__ledger__    > "$LOGS/ledger-orig.json"
curl -s http://127.0.0.1:$REBUILD_PORT/__ledger__ > "$LOGS/ledger-rebuild.json"
curl -s http://127.0.0.1:$CLONE_PORT/__ledger__   > "$LOGS/ledger-clone.json"

echo ""
echo "=== Locating compare-report.json files ==="
MAIN_REPORT="$(find "$RUNS/main/.archeo/compares" -name compare-report.json 2>/dev/null | head -1)"
SELF_REPORT="$(find "$RUNS/self/.archeo/compares" -name compare-report.json 2>/dev/null | head -1)"
echo "  main: $MAIN_REPORT"
echo "  self: $SELF_REPORT"
cp "$MAIN_REPORT" "$LOGS/compare-report-main.json" 2>/dev/null
cp "$SELF_REPORT" "$LOGS/compare-report-self.json" 2>/dev/null

echo ""
echo "=== DONE ==="
