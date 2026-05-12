touch .env

if ! grep -q "^export PORT=" .env; then
  PORT=$(
    od -An -N2 -tu2 /dev/urandom |
    tr -d ' ' |
    awk '{print 50000 + ($1 % 10000)}'
  )

  PORT=55743 # hardcode for now

  printf 'export PORT=%s\n' "$PORT" >> .env

  SERVER_PORT=$(
    od -An -N2 -tu2 /dev/urandom |
    tr -d ' ' |
    awk '{print 50000 + ($1 % 10000)}'
  )
  printf 'export SERVER_PORT=%s\n' "$SERVER_PORT" >> .env
fi

. ./.env

echo "https://port-$PORT.jamtools.dev"

pnpm i
npm rebuild better-sqlite3

# if [ ! -d node_modules ]; then
#   pnpm i
# fi

npm run dev

# npm run storybook:dev
# npm run storybook