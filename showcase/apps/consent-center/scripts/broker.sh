#!/usr/bin/env bash
# Runs your own sk-consent instance for this app on 127.0.0.1:8781.
# Needs SKPODS_BASE and SKCONSENT_CREDS_FILE (0600 file with SKCONSENT_CLIENT_ID and SKCONSENT_CLIENT_SECRET).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="${SK_CONSENT_BIN:-$here/../../../services/sk-consent/target/release/sk-consent}"
[ -x "$bin" ] || { echo "build it first: (cd services/sk-consent && cargo build --release)" >&2; exit 1; }
export SKCONSENT_BIND="${SKCONSENT_BIND:-127.0.0.1:8781}"
export SKCONSENT_PUBLIC_URL="${SKCONSENT_PUBLIC_URL:-http://localhost:8781}"
export SKCONSENT_DB="${SKCONSENT_DB:-$here/../.data/consent-center.db}"
mkdir -p "$(dirname "$SKCONSENT_DB")"
exec "$bin" serve
