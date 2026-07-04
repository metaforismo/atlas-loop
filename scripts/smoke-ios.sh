#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REQUIRE_SMOKE="${ATLAS_LOOP_SMOKE_REQUIRE:-0}"
DAEMON_PID=""
DEMO_PROJECT="${ATLAS_LOOP_DEMO_PROJECT:-apps/ios-commerce-demo/CommerceDemo.xcodeproj}"
DEMO_SCHEME="${ATLAS_LOOP_DEMO_SCHEME:-CommerceDemo}"
PORT="${ATLAS_LOOP_DAEMON_PORT:-4317}"
LOG_DIR="${ATLAS_LOOP_SMOKE_LOG_DIR:-artifacts/smoke-ios}"
DERIVED_DATA="$LOG_DIR/DerivedData"
DEMO_APP_PATH=""

skip() {
  echo "[smoke-ios] SKIP: $1"
  if [[ "$REQUIRE_SMOKE" == "1" ]]; then
    exit 1
  fi
  exit 0
}

cleanup() {
  if [[ -n "$DAEMON_PID" ]]; then
    kill "$DAEMON_PID" >/dev/null 2>&1 || true
    wait "$DAEMON_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

activate_simulator_window() {
  if [[ "${ATLAS_LOOP_SMOKE_ACTIVATE_SIMULATOR:-1}" != "1" ]]; then
    return
  fi

  open -a Simulator --args -CurrentDeviceUDID "$BOOTED_UDID" >/dev/null 2>&1 || true
  osascript -e 'tell application "Simulator" to activate' >/dev/null 2>&1 || true
}

cd "$ROOT_DIR"
mkdir -p "$LOG_DIR"

if [[ "$(uname -s)" != "Darwin" ]]; then
  skip "macOS is required for Simulator smoke"
fi

command -v xcodebuild >/dev/null 2>&1 || skip "xcodebuild is not installed"
command -v xcrun >/dev/null 2>&1 || skip "xcrun is not installed"
xcrun simctl help >/dev/null 2>&1 || skip "simctl is not available"

BOOTED_UDID="$(xcrun simctl list devices booted 2>/dev/null | awk -F '[()]' '/Booted/ { print $2; exit }')"
if [[ -z "$BOOTED_UDID" ]]; then
  skip "no booted iOS Simulator found; boot one first or set ATLAS_LOOP_SMOKE_REQUIRE=1 to fail instead of skip"
fi
echo "[smoke-ios] using booted simulator $BOOTED_UDID"
activate_simulator_window

if [[ -f native/ios-hid-helper/Package.swift ]]; then
  echo "[smoke-ios] building native iOS HID helper"
  swift build --package-path native/ios-hid-helper
else
  echo "[smoke-ios] native/ios-hid-helper/Package.swift not found; helper build skipped"
fi

if [[ -n "$DEMO_SCHEME" && -d "$DEMO_PROJECT" ]]; then
  DEMO_DESTINATION="platform=iOS Simulator,id=$BOOTED_UDID"
  if [[ -n "${ATLAS_LOOP_DEMO_WORKSPACE:-}" ]]; then
    echo "[smoke-ios] building demo workspace $ATLAS_LOOP_DEMO_WORKSPACE scheme $ATLAS_LOOP_DEMO_SCHEME"
    xcodebuild -workspace "$ATLAS_LOOP_DEMO_WORKSPACE" -scheme "$ATLAS_LOOP_DEMO_SCHEME" -destination "$DEMO_DESTINATION" -derivedDataPath "$DERIVED_DATA" build CODE_SIGNING_ALLOWED=NO
    DEMO_APP_PATH="$DERIVED_DATA/Build/Products/Debug-iphonesimulator/$ATLAS_LOOP_DEMO_SCHEME.app"
  elif [[ -n "$DEMO_PROJECT" ]]; then
    echo "[smoke-ios] building demo project $DEMO_PROJECT scheme $DEMO_SCHEME"
    xcodebuild -project "$DEMO_PROJECT" -scheme "$DEMO_SCHEME" -destination "$DEMO_DESTINATION" -derivedDataPath "$DERIVED_DATA" build CODE_SIGNING_ALLOWED=NO
    DEMO_APP_PATH="$DERIVED_DATA/Build/Products/Debug-iphonesimulator/$DEMO_SCHEME.app"
  else
    echo "[smoke-ios] ATLAS_LOOP_DEMO_SCHEME set without ATLAS_LOOP_DEMO_WORKSPACE or ATLAS_LOOP_DEMO_PROJECT; demo build skipped"
  fi
else
  echo "[smoke-ios] demo project not present; demo build skipped"
fi

if [[ ! -f apps/daemon/src/index.ts || ! -f apps/cli/src/index.ts ]]; then
  skip "daemon/CLI sources are not present in this checkout"
fi

if [[ ! -d node_modules ]]; then
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install --package-lock=false
  fi
fi

echo "[smoke-ios] starting daemon on port $PORT"
ATLAS_LOOP_DAEMON_PORT="$PORT" npm run daemon >"$LOG_DIR/daemon.log" 2>&1 &
DAEMON_PID="$!"

for _ in $(seq 1 50); do
  if nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$DAEMON_PID" >/dev/null 2>&1; then
    echo "[smoke-ios] daemon exited early; log follows" >&2
    sed -n '1,160p' "$LOG_DIR/daemon.log" >&2 || true
    exit 1
  fi
  sleep 0.2
done

if ! nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; then
  echo "[smoke-ios] daemon did not open port $PORT; log follows" >&2
  sed -n '1,160p' "$LOG_DIR/daemon.log" >&2 || true
  exit 1
fi

echo "[smoke-ios] running CLI help smoke"
npm run cli -- --help >/dev/null

if [[ -d "$DEMO_APP_PATH" ]]; then
  echo "[smoke-ios] running Atlas Loop install/launch/screenshot smoke"
  SESSION_JSON="$(ATLAS_LOOP_DAEMON_URL="http://127.0.0.1:$PORT" npm run --silent cli -- session start --udid "$BOOTED_UDID" --viewer)"
  printf '%s\n' "$SESSION_JSON" >"$LOG_DIR/session.json"
  SESSION_ID="$(node -e 'const fs=require("fs"); const s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(s.id)' "$LOG_DIR/session.json")"
  ATLAS_LOOP_DAEMON_URL="http://127.0.0.1:$PORT" npm run --silent cli -- install --session "$SESSION_ID" --app "$DEMO_APP_PATH" >"$LOG_DIR/install.json"
  ATLAS_LOOP_DAEMON_URL="http://127.0.0.1:$PORT" npm run --silent cli -- launch --session "$SESSION_ID" --bundle-id app.atlasloop.CommerceDemo >"$LOG_DIR/launch.json"
  activate_simulator_window
  sleep 2
  ATLAS_LOOP_DAEMON_URL="http://127.0.0.1:$PORT" npm run --silent cli -- screenshot --session "$SESSION_ID" --reason smoke-ios >"$LOG_DIR/screenshot.json"
  ATLAS_LOOP_DAEMON_URL="http://127.0.0.1:$PORT" npm run --silent cli -- session stop --session "$SESSION_ID" >"$LOG_DIR/stop.json"
  npm run --silent verify:artifacts -- "artifacts/sessions/$SESSION_ID"
else
  echo "[smoke-ios] demo app path not found after build; Atlas Loop install/launch/screenshot smoke skipped"
fi

if [[ -n "${ATLAS_LOOP_SMOKE_CLI_COMMAND:-}" ]]; then
  echo "[smoke-ios] running custom CLI smoke: $ATLAS_LOOP_SMOKE_CLI_COMMAND"
  bash -lc "$ATLAS_LOOP_SMOKE_CLI_COMMAND"
else
  echo "[smoke-ios] ATLAS_LOOP_SMOKE_CLI_COMMAND not set; daemon startup and CLI help smoke completed"
fi
