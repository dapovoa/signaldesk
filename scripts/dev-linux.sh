#!/usr/bin/env bash

set -o pipefail

ELECTRON_DISABLE_SANDBOX=1 electron-vite dev 2>&1 | awk '
  /\[DEP0040\] DeprecationWarning: The `punycode` module is deprecated\./ { next }
  /Use `electron --trace-deprecation \.\.\.` to show where the warning was created/ { next }
  /screencast_portal\.cc:369\] Failed to start the screen cast session\./ { next }
  /base_capturer_pipewire\.cc:93\] ScreenCastPortal failed: 2$/ { next }
  { print }
'
