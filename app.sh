#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── colours ────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

# ── service definitions ────────────────────────────────────────────────────
#   name | port | log | command (run from ROOT)
declare -a SERVICES=(
  "api|8000|/tmp/rcm-api.log|cd apps/api && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
  "web-booking|3400|/tmp/rcm-booking.log|cd apps/web-booking && node ../../node_modules/.bin/next dev -p 3400"
  "web-admin|3002|/tmp/rcm-admin.log|cd apps/web-admin && node ../../node_modules/.bin/vite --port 3002"
  "web-counter|3001|/tmp/rcm-counter.log|cd apps/web-counter && node ../../node_modules/.bin/vite --port 3001"
)

# ── helpers ────────────────────────────────────────────────────────────────
pid_for_port() { lsof -ti:"$1" 2>/dev/null | head -1; }

is_up() { [[ -n "$(pid_for_port "$1")" ]]; }

svc_label() {
  # pad name to 12 chars for alignment
  printf "%-12s" "$1"
}

print_status() {
  local name="$1" port="$2"
  if is_up "$port"; then
    echo -e "  $(svc_label "$name") ${GREEN}●  running${RESET}  http://localhost:${port}"
  else
    echo -e "  $(svc_label "$name") ${RED}○  stopped${RESET}"
  fi
}

stop_svc() {
  local name="$1" port="$2"
  local pids
  pids=$(lsof -ti:"$port" 2>/dev/null || true)
  if [[ -z "$pids" ]]; then
    echo -e "  $(svc_label "$name") ${YELLOW}already stopped${RESET}"
    return
  fi
  echo "$pids" | xargs kill -9 2>/dev/null || true
  echo -e "  $(svc_label "$name") ${RED}stopped${RESET}"
}

start_svc() {
  local name="$1" port="$2" log="$3" cmd="$4"
  if is_up "$port"; then
    echo -e "  $(svc_label "$name") ${YELLOW}already running${RESET}  (port $port)"
    return
  fi
  nohup bash -c "cd '$ROOT' && $cmd" > "$log" 2>&1 &
  echo -e "  $(svc_label "$name") ${GREEN}started${RESET}  → $log"
}

wait_for_up() {
  local port="$1" retries=15 i=0
  while [[ $i -lt $retries ]]; do
    if is_up "$port"; then return 0; fi
    sleep 1; ((i++))
  done
  return 1
}

# ── commands ───────────────────────────────────────────────────────────────
cmd_status() {
  echo -e "\n${BOLD}RCM — service status${RESET}"
  echo -e "────────────────────────────────────────────────"
  for svc in "${SERVICES[@]}"; do
    IFS='|' read -r name port _ _ <<< "$svc"
    print_status "$name" "$port"
  done
  echo -e "\n${CYAN}  Credentials${RESET}"
  echo -e "  web-admin   admin@test.com / Anw_Van_201"
  echo -e "  api docs    http://localhost:8000/docs"
  echo -e "  agent UI    http://localhost:3400/agent-preview\n"
}

cmd_stop() {
  echo -e "\n${BOLD}Stopping services…${RESET}"
  for svc in "${SERVICES[@]}"; do
    IFS='|' read -r name port _ _ <<< "$svc"
    stop_svc "$name" "$port"
  done
  echo ""
}

cmd_start() {
  echo -e "\n${BOLD}Starting services…${RESET}"
  for svc in "${SERVICES[@]}"; do
    IFS='|' read -r name port log cmd <<< "$svc"
    start_svc "$name" "$port" "$log" "$cmd"
  done

  echo -e "\n${CYAN}Waiting for services to come up…${RESET}"
  local all_ok=true
  for svc in "${SERVICES[@]}"; do
    IFS='|' read -r name port _ _ <<< "$svc"
    if wait_for_up "$port"; then
      echo -e "  $(svc_label "$name") ${GREEN}✓  ready${RESET}  http://localhost:${port}"
    else
      echo -e "  $(svc_label "$name") ${RED}✗  timeout${RESET}"
      all_ok=false
    fi
  done

  if $all_ok; then
    echo -e "\n${GREEN}${BOLD}All services up.${RESET}"
  else
    echo -e "\n${RED}One or more services failed to start. Check logs in /tmp/rcm-*.log${RESET}"
    exit 1
  fi

  echo -e "\n${CYAN}  URLs${RESET}"
  echo -e "  http://localhost:8000        API"
  echo -e "  http://localhost:8000/docs   API docs"
  echo -e "  http://localhost:3400        web-booking"
  echo -e "  http://localhost:3400/agent-preview  Agent UI preview"
  echo -e "  http://localhost:3002        web-admin (CRM)"
  echo -e "  http://localhost:3001        web-counter\n"
}

cmd_restart() {
  cmd_stop
  cmd_start
}

cmd_logs() {
  local name="${2:-}"
  if [[ -z "$name" ]]; then
    echo "Usage: $0 logs <service>"
    echo "Services: api, web-booking, web-admin, web-counter"
    exit 1
  fi
  local log_map=(
    "api:/tmp/rcm-api.log"
    "web-booking:/tmp/rcm-booking.log"
    "web-admin:/tmp/rcm-admin.log"
    "web-counter:/tmp/rcm-counter.log"
  )
  for entry in "${log_map[@]}"; do
    IFS=':' read -r svc log <<< "$entry"
    if [[ "$svc" == "$name" ]]; then
      tail -f "$log"
      return
    fi
  done
  echo -e "${RED}Unknown service: $name${RESET}"
  exit 1
}

# ── entrypoint ─────────────────────────────────────────────────────────────
COMMAND="${1:-status}"

case "$COMMAND" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_restart ;;
  status)  cmd_status ;;
  logs)    cmd_logs "$@" ;;
  *)
    echo -e "Usage: $0 {start|stop|restart|status|logs <service>}"
    echo -e "  services: api, web-booking, web-admin, web-counter"
    exit 1
    ;;
esac
