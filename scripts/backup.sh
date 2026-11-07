#!/usr/bin/env bash
set -euo pipefail
exec "$(dirname "$0")/offline.sh" backup "${1:-}"
