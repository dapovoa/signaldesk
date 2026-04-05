#!/usr/bin/env bash

set -o pipefail

is_verbose_logging_enabled() {
  local value
  for value in \
    "${SIGNALDESK_VERBOSE:-}" \
    "${SIGNALDESK_PIPELINE_VERBOSE:-}" \
    "${SIGNALDESK_AVATAR_VERBOSE:-}"; do
    case "${value,,}" in
      1|true|yes|on)
        return 0
        ;;
    esac
  done

  return 1
}

if is_verbose_logging_enabled; then
  ELECTRON_DISABLE_SANDBOX=1 electron-vite dev
else
  ELECTRON_DISABLE_SANDBOX=1 electron-vite dev 2>&1 | awk '
    /\[DEP0040\] DeprecationWarning: The `punycode` module is deprecated\./ { next }
    /Use `electron --trace-deprecation \.\.\.` to show where the warning was created/ { next }
    /screencast_portal\.cc:369\] Failed to start the screen cast session\./ { next }
    /base_capturer_pipewire\.cc:93\] ScreenCastPortal failed: 2$/ { next }
    /\[vite\] \(client\) hmr update / { next }
    /^Opening in existing browser session\.$/ { next }
    { print }
  '
fi
