#!/usr/bin/env sh
# Start CloudSnip on Linux/macOS:  ./cloudsnip.sh   (or: sh cloudsnip.sh)
cd "$(dirname "$0")" || exit 1
exec python3 run.py "$@"
