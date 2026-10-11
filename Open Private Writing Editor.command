#!/bin/bash
set -eu
folio_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
folio_python="${FOLIO_PYTHON:-python3}"
if ! command -v "$folio_python" >/dev/null 2>&1; then
  echo 'Private Writing Editor needs its local Python runtime. Set FOLIO_PYTHON to a Python with python-docx, lxml, and pypdf installed.'
  exit 1
fi
exec "$folio_python" "$folio_dir/folio/launch.py" "$@"
