#!/bin/bash
#
# fps-earth — double-click to play locally.
#
# Starts the multiplayer server AND the game, then opens your browser.
# Keep the Terminal window open while you play; close it (or press Ctrl-C)
# to stop everything. This file is portable — it works from wherever the
# fps-earth folder lives.

# Make sure Homebrew-installed node/npm are found when launched by double-click.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# This script lives in the project root, so the project IS its own folder.
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR" || exit 1

echo "──────────────────────────────────────────────"
echo "   fps-earth — starting locally"
echo "   folder: $PROJECT_DIR"
echo "──────────────────────────────────────────────"
echo ""

if ! command -v npm >/dev/null 2>&1; then
  echo "Couldn't find Node.js/npm. Install it from https://nodejs.org then try again."
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi

# First run on a fresh machine: install dependencies once.
if [ ! -d "node_modules" ]; then
  echo "First run: installing game dependencies (one time, ~1 minute)…"
  npm install || { echo "Install failed."; read -n 1 -s -r -p "Press any key to close."; exit 1; }
fi
if [ ! -d "server/node_modules" ]; then
  echo "First run: installing server dependencies (one time)…"
  npm --prefix server install || { echo "Install failed."; read -n 1 -s -r -p "Press any key to close."; exit 1; }
fi

# Start the multiplayer server — but reuse one if it's already running.
SERVER_PID=""
if lsof -ti:2567 >/dev/null 2>&1; then
  echo "Multiplayer server already running — reusing it."
else
  echo "Starting multiplayer server…"
  npm run dev:server &
  SERVER_PID=$!
fi

# Stop the server we started when this window closes or you press Ctrl-C.
cleanup() {
  trap - INT TERM HUP EXIT
  echo ""
  echo "Shutting down…"
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null
    lsof -ti:2567 2>/dev/null | xargs kill 2>/dev/null
  fi
  exit 0
}
trap cleanup INT TERM HUP EXIT

sleep 2
echo ""
echo "✓ Starting the game — your browser will open in a moment."
echo "  Keep this window open while you play. Close it to stop."
echo ""

# Run the game in the foreground (this keeps the window alive). --open
# launches your browser at whatever address Vite binds to.
npm run dev -- --open
