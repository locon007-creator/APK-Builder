#!/usr/bin/env bash
set -euo pipefail
test -f website/index.html
rm -rf app/src/main/assets/www
mkdir -p app/src/main/assets/www
cp -R website/. app/src/main/assets/www/
test -s app/src/main/assets/www/index.html
