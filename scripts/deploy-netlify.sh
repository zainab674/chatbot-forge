#!/usr/bin/env bash
#
# One-command Netlify deploy.
#
#   ./scripts/deploy-netlify.sh
#
# Checks the environment first, because the two ways this goes wrong are a
# missing MONGODB_URI (the site deploys and then every action fails) and a
# missing ENCRYPTION_SECRET (creating a chatbot with an API key 500s).
#
# Authentication: either log in through the browser when prompted, or set
# NETLIFY_AUTH_TOKEN in your shell before running this. Do not put the token in
# a file in this repository.

set -euo pipefail

cd "$(dirname "$0")/.."

say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
warn() { printf '  \033[33m! %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓ %s\033[0m\n' "$1"; }

say "Checking prerequisites"

if ! command -v node >/dev/null 2>&1; then
  echo "Node is not installed. Get it from https://nodejs.org (18 or newer)." >&2
  exit 1
fi
ok "node $(node -v)"

if [ ! -d node_modules ]; then
  say "Installing dependencies"
  npm install
fi

say "Running the test suite"
npm run typecheck
npm test
npm run test:knowledge
ok "tests passed"

say "Environment variables"
missing=0
for var in MONGODB_URI ENCRYPTION_SECRET; do
  if [ -z "${!var:-}" ]; then
    warn "$var is not set in this shell"
    missing=1
  else
    ok "$var is set"
  fi
done

if [ "$missing" = "1" ]; then
  cat <<'EOF'

  These are only needed on Netlify, not here, so this is not fatal.
  Set them under Site configuration > Environment variables after the deploy,
  then trigger one more deploy. See DEPLOY.md for the full list.

EOF
fi

say "Deploying to Netlify"
if [ -n "${NETLIFY_AUTH_TOKEN:-}" ]; then
  ok "using NETLIFY_AUTH_TOKEN from the environment"
fi

npx netlify-cli deploy --build --prod

say "Done"
cat <<'EOF'
  Next:
    1. Set MONGODB_URI, MONGODB_DB, ENCRYPTION_SECRET and NEXT_PUBLIC_APP_URL
       in the Netlify UI, then redeploy so the build picks up the app URL.
    2. In MongoDB Atlas, allow 0.0.0.0/0 under Network Access. Netlify
       functions have no fixed IP, and this is the usual reason a fresh deploy
       cannot reach the database.
    3. Open the site, create a chatbot, and send it a message.
EOF
