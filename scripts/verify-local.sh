#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_SMOKE=0

for arg in "$@"; do
  case "$arg" in
    --smoke-ios)
      RUN_SMOKE=1
      ;;
    --no-smoke)
      RUN_SMOKE=0
      ;;
    --help|-h)
      cat <<'USAGE'
Usage: bash scripts/verify-local.sh [--smoke-ios|--no-smoke]

Runs the fast local verification path used by CI:
  1. install dependencies when node_modules is missing
  2. npm run typecheck
  3. npm test
  4. npm run test:viewer when viewer tests are present
  5. npm run verify:artifacts

iOS Simulator smoke is host-gated and off by default for CI. Enable it with
--smoke-ios or ATLAS_LOOP_RUN_IOS_SMOKE=1 on a macOS/Xcode host with a booted
Simulator. The smoke captures a deterministic local demo-route screenshot with
ATLAS_LOOP_SMOKE_DEMO_ROUTE=confirmation by default; set it to none to disable
or to catalog, product-detail, cart, shipping, payment-review, or confirmation.
USAGE
      exit 0
      ;;
    *)
      echo "[verify-local] unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

if [[ "${ATLAS_LOOP_RUN_IOS_SMOKE:-0}" == "1" ]]; then
  RUN_SMOKE=1
fi

cd "$ROOT_DIR"

if [[ ! -d node_modules ]]; then
  if [[ -f package-lock.json ]]; then
    echo "[verify-local] installing dependencies with npm ci"
    npm ci
  else
    echo "[verify-local] installing dependencies with npm install --package-lock=false"
    npm install --package-lock=false
  fi
else
  echo "[verify-local] node_modules present; skipping install"
fi

echo "[verify-local] npm run typecheck"
npm run typecheck

echo "[verify-local] npm test"
npm test

if [[ -n "$(find tests/viewer -type f \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' -o -name '*.spec.tsx' \) -print -quit 2>/dev/null)" ]]; then
  echo "[verify-local] npm run test:viewer"
  npm run test:viewer
else
  echo "[verify-local] no viewer tests found; skipping npm run test:viewer"
fi

echo "[verify-local] npm run verify:artifacts"
npm run verify:artifacts

if [[ "$RUN_SMOKE" == "1" ]]; then
  echo "[verify-local] npm run smoke:ios"
  npm run smoke:ios
else
  echo "[verify-local] iOS Simulator smoke skipped; pass --smoke-ios or set ATLAS_LOOP_RUN_IOS_SMOKE=1 on a macOS/Xcode host with a booted Simulator"
fi
