#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "用法: $0 [info|validate|migrate]" >&2
}

if [[ $# -gt 1 ]]; then
  usage
  exit 2
fi
action="${1:-info}"
case "$action" in
  info|validate|migrate) ;;
  *) usage; exit 2 ;;
esac

ops_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config_path="${LOOKMATE_OPS_ENV:-$ops_directory/.env}"
if [[ "$config_path" != /* || ! -f "$config_path" ]]; then
  echo "请准备 ops/.env，或用 LOOKMATE_OPS_ENV 指定现有配置文件的绝对路径。" >&2
  exit 2
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "生产迁移需要 Docker CLI 与 Compose 插件。" >&2
  exit 2
fi

exec docker compose --project-directory "$ops_directory" \
  --env-file "$config_path" -f "$ops_directory/docker-compose.yml" \
  run --rm --no-deps flyway "$action"
