#!/bin/bash
#
# fps-earth — double-click to play locally.
#
# Starts the matchmaker (signaling) server AND the game, then opens your browser.
# When the game opens you're the HOST — share your invite link and friends join
# you directly (peer-to-peer); there's no game server to pay for. Keep the
# Terminal window open while you play; close it (or press Ctrl-C) to stop.
# This file is portable — it works from wherever the fps-earth folder lives.

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

# Install dependencies on first run — and refresh them whenever package.json
# changes (e.g. an update added a new dependency), so the game always starts.
stale_deps() {
  # $1 = folder holding package.json. Reinstall if node_modules is missing or
  # package.json is newer than npm's last-install marker.
  [ ! -d "$1/node_modules" ] && return 0
  [ "$1/package.json" -nt "$1/node_modules/.package-lock.json" ] && return 0
  return 1
}
if stale_deps "."; then
  echo "Installing game dependencies (one time, ~1 minute)…"
  npm install || { echo "Install failed."; read -n 1 -s -r -p "Press any key to close."; exit 1; }
fi
if stale_deps "server"; then
  echo "Installing server dependencies…"
  npm --prefix server install || { echo "Install failed."; read -n 1 -s -r -p "Press any key to close."; exit 1; }
fi

# Start the matchmaker (signaling) server — but reuse one if it's already running.
SERVER_PID=""
if lsof -ti:9000 >/dev/null 2>&1; then
  echo "Matchmaker already running — reusing it."
else
  echo "Starting matchmaker (signaling) server…"
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
    lsof -ti:9000 2>/dev/null | xargs kill 2>/dev/null
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
