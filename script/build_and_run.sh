#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="OPC"
APP_PATH="/Applications/${APP_NAME}.app"

assert_app_not_running() {
  if /usr/bin/pgrep -f "${APP_PATH}/Contents/MacOS/${APP_NAME}" >/dev/null 2>&1; then
    echo "${APP_NAME} is running from ${APP_PATH}. Quit it before rebuild/install." >&2
    exit 1
  fi
}

assert_app_not_running
cd "${ROOT_DIR}/desktop"
/usr/bin/env -u ELECTRON_RUN_AS_NODE -u ELECTRON_NO_ATTACH_CONSOLE npm test
/usr/bin/env -u ELECTRON_RUN_AS_NODE -u ELECTRON_NO_ATTACH_CONSOLE npm run package:mac

assert_app_not_running
/usr/bin/env -u ELECTRON_RUN_AS_NODE -u ELECTRON_NO_ATTACH_CONSOLE npm run install:applications

/usr/bin/env -u ELECTRON_RUN_AS_NODE -u ELECTRON_NO_ATTACH_CONSOLE npm run open:applications

if [[ "${1:-}" == "--verify" ]]; then
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if /usr/bin/pgrep -x "${APP_NAME}" >/dev/null 2>&1; then
      echo "${APP_NAME} launched from ${APP_PATH}"
      exit 0
    fi
    /bin/sleep 0.5
  done
  echo "${APP_NAME} did not stay running" >&2
  exit 1
fi
