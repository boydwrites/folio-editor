#!/bin/bash
set -eu
folio_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
folio_python="${FOLIO_PYTHON:-python3}"
exec "$folio_python" "$folio_dir/folio/desktop/build.py"
