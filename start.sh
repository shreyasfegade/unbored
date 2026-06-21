#!/usr/bin/env bash
# Unbored launcher for macOS / Linux — `./start.sh`.
set -e
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then
  exec python3 run.py "$@"
else
  exec python run.py "$@"
fi
