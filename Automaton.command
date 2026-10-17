#!/usr/bin/env bash
# Double-click in Finder: starts Automaton in Docker and opens the web console.
cd "$(dirname "$0")" || exit 1
./scripts/automaton-docker.sh up
echo
read -r -p "Press Enter to close this window (Automaton keeps running)..." _
