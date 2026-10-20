#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="${1:-all}"
case "$target" in
  server|web|all) ;;
  *) echo "用法: $0 [server|web|all]" >&2; exit 2 ;;
esac

if [[ "$target" == server || "$target" == all ]]; then
  (cd "$project_root/apps/server" && ./mvnw -B verify)
fi
if [[ "$target" == web || "$target" == all ]]; then
  (cd "$project_root/apps/web" && npm ci && npm run build)
fi
