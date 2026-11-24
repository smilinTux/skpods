#!/usr/bin/env bash
# Start everything the Guardian demo needs on this machine: sk-consent (8782), the clinic bridge (8790) and the dev server (5177).
#   set -a; . /path/to/test-credentials.env; set +a
#   export SKCONSENT_CREDS_FILE=/path/to/guardian-agent.env      # 0600 file with SKCONSENT_CLIENT_ID / SKCONSENT_CLIENT_SECRET
#   npm run stack
# Ctrl+C stops all three. Logs go to $TMPDIR/guardian-stack/.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SKPODS_BASE:?set SKPODS_BASE}"
: "${SKCONSENT_CREDS_FILE:?set SKCONSENT_CREDS_FILE}"
LOGS="${TMPDIR:-/tmp}/guardian-stack"; mkdir -p "$LOGS"
BIN="${SK_CONSENT_BIN:-}"
if [ -z "$BIN" ]; then
  (cd ../../services/sk-consent && cargo build --release)
  BIN="$(cd ../../services/sk-consent && cargo metadata --format-version 1 --no-deps 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')/release/sk-consent"
fi
export SKCONSENT_BIND=127.0.0.1:8782 SKCONSENT_PUBLIC_URL=http://127.0.0.1:8782 SKCONSENT_DB="${SKCONSENT_DB:-$LOGS/sk-consent.db}"
pids=()
trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT INT TERM
"$BIN" serve >"$LOGS/sk-consent.log" 2>&1 & pids+=($!)
npx tsx scripts/clinic-bridge.ts >"$LOGS/bridge.log" 2>&1 & pids+=($!)
echo "sk-consent http://127.0.0.1:8782   clinic bridge http://127.0.0.1:8790   logs in $LOGS"
echo "App: http://localhost:5177/"
npx vite
