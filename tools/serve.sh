#!/usr/bin/env bash
# Serve both origins for local development.
#
# Two ports, not two paths. `localhost:4001` and `localhost:4002` are different
# origins, and both are secure contexts, so the whole cross-origin grant flow can
# be exercised locally before anything is deployed.
set -euo pipefail
cd "$(dirname "$0")/.."
./tools/sync-config.sh
trap 'kill 0' EXIT
python3 -m http.server 4001 --directory vault >/dev/null 2>&1 &
python3 -m http.server 4002 --directory host  >/dev/null 2>&1 &
echo "vault  http://localhost:4001"
echo "host   http://localhost:4002   <- open this one"
wait
