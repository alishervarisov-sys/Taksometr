#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

npm ci
npm run check
npm run dist:mac

echo "Готовый установщик: $SCRIPT_DIR/release/ZaKi-Admin-macOS-universal.dmg"
