#!/usr/bin/env bash
set -eu
# pipefail 不是所有 shell 都支持(如 Windows 上的 busybox ash / dash), 支持时启用
if (set -o pipefail) 2>/dev/null; then set -o pipefail; fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

vinext="${SITES_PROJECT_ROOT}/node_modules/.bin/vinext"
if [[ ! -x "${vinext}" ]]; then
  echo "vinext is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

if command -v timeout >/dev/null 2>&1; then
  echo "Running bounded vinext build..."
  timeout \
    --signal=TERM \
    --kill-after="${SITES_BUILD_KILL_AFTER:-10s}" \
    "${SITES_BUILD_TIMEOUT:-3m}" \
    "${vinext}" build
else
  echo "GNU timeout unavailable; running vinext build directly (no automatic kill)." >&2
  "${vinext}" build
fi
