#!/bin/bash
set -euo pipefail

RUNTIME_DATA_DIR="/home/vkuser/.local/share/vibe-dashboard-runtime/data"

pick_port() {
  od -An -N2 -tu2 /dev/urandom |
  tr -d ' ' |
  awk '{print 50000 + ($1 % 10000)}'
}

touch .env

if ! grep -q "^export PORT=" .env; then
  PORT="$(pick_port)"
  printf 'export PORT=%s\n' "$PORT" >> .env
fi

if ! grep -q "^export SERVER_PORT=" .env; then
  . ./.env
  SERVER_PORT="$(pick_port)"

  while [ "$SERVER_PORT" = "${PORT:-}" ]; do
    SERVER_PORT="$(pick_port)"
  done

  printf 'export SERVER_PORT=%s\n' "$SERVER_PORT" >> .env
fi

. ./.env

if [ ! -d ./data ] && [ -d "$RUNTIME_DATA_DIR" ]; then
  echo "Bootstrapping ./data from $RUNTIME_DATA_DIR"
  mkdir -p ./data
  cp -a "$RUNTIME_DATA_DIR"/. ./data/
fi

echo "https://port-$PORT.jamtools.dev"

pnpm i
npm rebuild better-sqlite3

# if [ ! -d node_modules ]; then
#   pnpm i
# fi

npm run dev

# npm run storybook:dev
# npm run storybook
