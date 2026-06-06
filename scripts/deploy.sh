#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NO_PULL=false
for arg in "$@"; do
  [[ "$arg" == "--no-pull" ]] && NO_PULL=true
done

if [[ "$NO_PULL" == false ]] && git rev-parse --git-dir >/dev/null 2>&1; then
  git pull --ff-only || true
fi

echo "[deploy] building..."
npm run build

echo "[deploy] starting containers..."
docker compose up -d --build

echo "[deploy] health check..."
sleep 3
curl -sf "http://127.0.0.1:${PORT:-3000}/api/health" | head -c 200
echo ""

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  source .env
fi

if [[ -n "${BOT_TOKEN:-}" && -n "${PUBLIC_URL:-}" && "${USE_WEBHOOK:-true}" == "true" ]]; then
  WEBHOOK_PATH="/webhook/${WEBHOOK_SECRET:-dev-secret}"
  echo "[deploy] webhook should be: ${PUBLIC_URL}${WEBHOOK_PATH}"
  echo "[deploy] bot sets webhook on startup when USE_WEBHOOK=true"
fi

echo "[deploy] done"
