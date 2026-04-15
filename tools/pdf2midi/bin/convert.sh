#!/usr/bin/env bash
# Manual single-PDF smoke test wrapper.
#
# Usage:
#   ./bin/convert.sh path/to/score.pdf [--audio] [--force] [--output <dir>]
#
# Resolves to: tsx src/convert.ts <args...>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${TOOL_DIR}"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <input.pdf> [--audio] [--force] [--output <dir>]" >&2
  exit 2
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "npx not found in PATH" >&2
  exit 127
fi

exec npx --yes tsx src/convert.ts "$@"
