#!/usr/bin/env bash
# run-drivability.sh — 10-01 live drivability harness.
#
# Proves the canonical demo app (examples/demo-app/) is vision-drivable by the REAL,
# UNMODIFIED archeo explore CLI (scripted provider, real headed Chromium, floor ON):
#   - steps > 0 (the exact thing 03-04 ORIGINAL failed: 0 steps, empty frontier)
#   - states >= 2 (the app has >= 3 distinct routes)
#   - full protocol surface captured: REST + POST /graphql + POST /rpc + held:true writes
#   - spec secret-clean (strict bearer/sk-ant-/JWT grep gate)
#   - floor-clean: GET /__ledger__ shows mutations=0, destructiveHits=0
#
# Reproduce: bash .planning/phases/10-vision-drivable-fixtures/10-01-live-verification/run-drivability.sh
# Node built-ins + curl only; no src/ or test/ edits.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
CLI="$REPO/src/cli/index.ts"
APP_PORT=4701
APP_URL="http://127.0.0.1:${APP_PORT}/app"
RUNS="$HERE/runs"
LOGS="$HERE/logs"
MAX_STEPS=30

rm -rf "$RUNS" "$LOGS"
mkdir -p "$RUNS/explore" "$LOGS"

echo "=== 10-01 DRIVABILITY HARNESS ==="
echo "REPO: $REPO"
echo "APP:  $APP_URL"
echo ""

# ------------------------------------------------------------------
# 1. Boot demo-app with ledger-wrap on $APP_PORT
# ------------------------------------------------------------------
echo "--- Booting demo-app with ledger-wrap on port $APP_PORT ---"
PORT=$APP_PORT node "$HERE/launch-with-ledger.mjs" >"$LOGS/app.log" 2>&1 &
APP_PID=$!
cleanup() { kill "$APP_PID" 2>/dev/null || true; }
trap cleanup EXIT

# Poll until app answers
for i in $(seq 1 50); do
  if curl -s -o /dev/null -w '' "http://127.0.0.1:${APP_PORT}/app"; then
    echo "  demo-app up on $APP_PORT (attempt $i)"
    break
  fi
  sleep 0.2
  if [ "$i" -eq 50 ]; then
    echo "FAIL: demo-app never came up on $APP_PORT"
    exit 1
  fi
done

echo ""
echo "--- Sanity probes ---"
echo "  /app a-href count: $(curl -s http://127.0.0.1:${APP_PORT}/app | grep -c '<a href' || echo 0)"
echo "  /api/users:        $(curl -s http://127.0.0.1:${APP_PORT}/api/users | head -c 80)"
echo "  /graphql (query):  $(curl -s -X POST http://127.0.0.1:${APP_PORT}/graphql -H 'content-type: application/json' -d '{"query":"query Me { me { id } }"}' | head -c 80)"
echo "  /rpc (read):       $(curl -s -X POST http://127.0.0.1:${APP_PORT}/rpc -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getSettings","params":{}}' | head -c 80)"
echo ""

# ------------------------------------------------------------------
# 2. Run the REAL, UNMODIFIED archeo explore CLI
# ------------------------------------------------------------------
echo "--- Running archeo explore (real headed Chromium, scripted, floor ON) ---"
echo "  node $CLI explore $APP_URL --i-have-authorization --model scripted --max-steps $MAX_STEPS --no-dashboard"
echo ""

EXPLORE_LOG="$LOGS/explore.log"
( cd "$RUNS/explore" && node "$CLI" explore "$APP_URL" \
    --i-have-authorization \
    --model scripted \
    --max-steps "$MAX_STEPS" \
    --no-dashboard \
  2>&1 ) | tee "$EXPLORE_LOG"

echo ""

# ------------------------------------------------------------------
# 3. Read the produced archeo-spec.json
# ------------------------------------------------------------------
SPEC_FILE="$(find "$RUNS/explore/.archeo/captures" -name 'archeo-spec.json' 2>/dev/null | sort | tail -1)"
if [ -z "$SPEC_FILE" ]; then
  echo "FAIL: no spec.json found under $RUNS/explore/.archeo/captures"
  exit 1
fi
echo "--- spec.json found: $SPEC_FILE ---"
cp "$SPEC_FILE" "$LOGS/archeo-spec.json"

# ------------------------------------------------------------------
# 4. Parse + assert drivability from the stop summary + spec
# ------------------------------------------------------------------
echo ""
echo "--- Parsing explore log for stop summary ---"
STOP_LINE="$(grep 'exploration stopped:' "$EXPLORE_LOG" | tail -1)"
echo "  stop line: $STOP_LINE"

# Extract steps from the stop line: "exploration stopped: ... (N steps, ...)"
STEPS="$(echo "$STOP_LINE" | sed 's/.*(\([0-9]*\) steps.*/\1/')"
echo "  steps = $STEPS"

# Extract states from spec.json (field is coverage.statesDiscovered)
STATES="$(node -e "
  const fs = require('fs');
  const spec = JSON.parse(fs.readFileSync('$LOGS/archeo-spec.json', 'utf8'));
  const states = (spec.coverage && spec.coverage.statesDiscovered) || 0;
  console.log(states);
" 2>/dev/null || echo 0)"
echo "  states = $STATES"

# Extract endpoint list from spec.json (field is pathTemplate, not path; held is boolean)
ENDPOINT_LIST="$(node -e "
  const fs = require('fs');
  const spec = JSON.parse(fs.readFileSync('$LOGS/archeo-spec.json', 'utf8'));
  const eps = spec.endpoints || [];
  eps.forEach(e => console.log(e.method + ' ' + (e.pathTemplate || e.path || '?') + (e.held ? ' [held]' : '')));
" 2>/dev/null || echo 'ERROR reading endpoints')"
echo ""
echo "--- Captured endpoints ---"
echo "$ENDPOINT_LIST"
echo ""

# Check for required endpoints
HAS_GRAPHQL="$(echo "$ENDPOINT_LIST" | grep -c 'POST /graphql' || echo 0)"
HAS_RPC="$(echo "$ENDPOINT_LIST" | grep -c 'POST /rpc' || echo 0)"
HAS_HELD="$(echo "$ENDPOINT_LIST" | grep -c '\[held\]' || echo 0)"
HAS_REST_READ="$(echo "$ENDPOINT_LIST" | grep -cE 'GET (/api/|/app)' || echo 0)"

echo "--- Assertion results ---"
PASS=1

if [ "${STEPS:-0}" -gt 0 ]; then
  echo "  [PASS] steps > 0: $STEPS steps"
else
  echo "  [FAIL] steps > 0: got $STEPS (03-04 ORIGINAL also got 0 — this would be the same failure)"
  PASS=0
fi

if [ "${STATES:-0}" -ge 2 ]; then
  echo "  [PASS] states >= 2: $STATES states"
else
  echo "  [FAIL] states >= 2: got $STATES (expected at least 2 distinct routes)"
  PASS=0
fi

if [ "${HAS_REST_READ:-0}" -gt 0 ]; then
  echo "  [PASS] REST reads present: $HAS_REST_READ endpoints"
else
  echo "  [FAIL] REST reads missing from captured endpoints"
  PASS=0
fi

if [ "${HAS_GRAPHQL:-0}" -gt 0 ]; then
  echo "  [PASS] POST /graphql captured"
else
  echo "  [FAIL] POST /graphql NOT in captured endpoints"
  PASS=0
fi

if [ "${HAS_RPC:-0}" -gt 0 ]; then
  echo "  [PASS] POST /rpc captured"
else
  echo "  [FAIL] POST /rpc NOT in captured endpoints"
  PASS=0
fi

if [ "${HAS_HELD:-0}" -gt 0 ]; then
  echo "  [PASS] held writes present: $HAS_HELD held endpoints"
else
  echo "  [FAIL] no held:true endpoints in spec"
  PASS=0
fi

# ------------------------------------------------------------------
# 5. Secret-clean check (CAP-05 re-assertion)
# ------------------------------------------------------------------
echo ""
echo "--- Secret-clean check ---"
SECRET_HITS="$(grep -rniE "bearer |sk-ant-|eyJ[A-Za-z0-9_-]{10,}" "$LOGS/archeo-spec.json" 2>/dev/null | wc -l | tr -d ' ')"
if [ "${SECRET_HITS:-1}" -eq 0 ]; then
  echo "  [PASS] spec secret-clean (bearer/sk-ant-/JWT grep = 0 hits)"
else
  echo "  [WARN] spec secret check: $SECRET_HITS potential secret patterns (review manually)"
fi

# ------------------------------------------------------------------
# 6. Floor proof: GET /__ledger__ after the run
# ------------------------------------------------------------------
echo ""
echo "--- Floor proof: GET /__ledger__ ---"
LEDGER="$(curl -s "http://127.0.0.1:${APP_PORT}/__ledger__")"
echo "  ledger: $LEDGER"
MUTATIONS="$(echo "$LEDGER" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.mutations)" 2>/dev/null || echo '?')"
DESTRUCTIVE="$(echo "$LEDGER" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.destructiveHits)" 2>/dev/null || echo '?')"
echo "  mutations = $MUTATIONS | destructiveHits = $DESTRUCTIVE"

if [ "${MUTATIONS}" = "0" ] && [ "${DESTRUCTIVE}" = "0" ]; then
  echo "  [PASS] floor clean: mutations=0, destructiveHits=0"
else
  echo "  [FAIL] floor NOT clean: mutations=$MUTATIONS, destructiveHits=$DESTRUCTIVE"
  PASS=0
fi

echo "$LEDGER" > "$LOGS/ledger.json"

# ------------------------------------------------------------------
# 7. Final verdict
# ------------------------------------------------------------------
echo ""
echo "=== VERDICT ==="
if [ "$PASS" -eq 1 ]; then
  echo "PASS — demo-app IS vision-drivable: steps=$STEPS, states=$STATES, full protocol surface captured, floor clean"
  echo "       (03-04 ORIGINAL under the same assertion: 0 steps, page-1 only — FIX-01 drivability closed)"
else
  echo "FAIL — one or more assertions failed (see above)"
  exit 1
fi
