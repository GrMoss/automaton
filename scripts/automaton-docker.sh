#!/usr/bin/env bash
# One-command operation for running Automaton in an isolated Docker container.
#
#   scripts/automaton-docker.sh up        start everything and open the web console
#   scripts/automaton-docker.sh down      stop the container (data is kept)
#   scripts/automaton-docker.sh status    show container state and the console URL
#   scripts/automaton-docker.sh logs      follow the console/agent container logs
#   scripts/automaton-docker.sh rebuild   rebuild the image after code changes, then up
#   scripts/automaton-docker.sh url       print the console URL (contains a per-run token)
#
# The agent's wallet and state live in the Docker volume "automaton-data", not on the host.
set -euo pipefail

TOOLS="${DOCKER_TOOLS:-/Volumes/MOSS/docker-tools}"
if [ -f "$TOOLS/env.sh" ]; then
  # shellcheck disable=SC1091
  source "$TOOLS/env.sh"
fi
command -v docker >/dev/null || { echo "docker not found. Install it or set DOCKER_TOOLS." >&2; exit 1; }

IMAGE="${AUTOMATON_IMAGE:-automaton}"
NAME="${AUTOMATON_CONTAINER:-automaton}"
VOLUME="${AUTOMATON_VOLUME:-automaton-data}"
PORT="${AUTOMATON_PORT:-7777}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ensure_vm() {
  if docker info >/dev/null 2>&1; then return; fi
  if command -v colima >/dev/null; then
    echo "Starting the Docker VM (Colima)..."
    colima start
  fi
  docker info >/dev/null 2>&1 || { echo "Docker is not reachable." >&2; exit 1; }
}

image_exists() { docker image inspect "$IMAGE" >/dev/null 2>&1; }
container_exists() { docker container inspect "$NAME" >/dev/null 2>&1; }
container_running() { [ "$(docker container inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" = "true" ]; }

build() {
  echo "Building image '$IMAGE' (first time takes a few minutes)..."
  docker build -t "$IMAGE" "$REPO"
}

run_new() {
  # Hardened defaults: no extra capabilities, no privilege escalation, capped
  # resources, and the console published on the host's loopback only.
  docker run -d --name "$NAME" \
    -p "127.0.0.1:${PORT}:${PORT}" \
    -v "${VOLUME}:/home/node/.automaton" \
    --memory 1g --cpus 1 --pids-limit 256 \
    --cap-drop ALL --security-opt no-new-privileges \
    --restart unless-stopped \
    "$IMAGE" node dist/web/server.js --port "$PORT" >/dev/null
}

console_url() {
  # The console prints a fresh random token on every start; take the latest.
  docker logs "$NAME" 2>&1 | grep -o 'http://localhost:[0-9]*/#[0-9a-f]*' | tail -1
}

wait_for_url() {
  local url=""
  for _ in $(seq 1 60); do
    url="$(console_url || true)"
    [ -n "$url" ] && { echo "$url"; return 0; }
    sleep 1
  done
  echo "Console did not start. Recent logs:" >&2
  docker logs --tail 20 "$NAME" >&2 || true
  return 1
}

cmd_up() {
  ensure_vm
  image_exists || build
  if container_exists; then
    container_running || docker start "$NAME" >/dev/null
  else
    run_new
  fi
  local url
  url="$(wait_for_url)"
  echo "Automaton console: $url"
  command -v open >/dev/null && open "$url" || true
}

case "${1:-up}" in
  up) cmd_up ;;
  down) ensure_vm; container_exists && docker stop "$NAME" >/dev/null && echo "Stopped." || echo "Not running." ;;
  status)
    ensure_vm
    if container_running; then echo "running"; echo "$(console_url)"; else echo "stopped"; fi ;;
  logs) ensure_vm; docker logs -f --tail 100 "$NAME" ;;
  url) ensure_vm; console_url ;;
  rebuild)
    ensure_vm
    build
    container_exists && { docker rm -f "$NAME" >/dev/null; }
    cmd_up ;;
  *) echo "Usage: $0 {up|down|status|logs|url|rebuild}" >&2; exit 2 ;;
esac
