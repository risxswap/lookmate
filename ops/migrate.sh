#!/usr/bin/env bash
set -euo pipefail
# 配置文件为权限受限的 Flyway properties，含 flyway.url/user/password。
# 本脚本不创建数据库、不执行 clean，不从应用启动调用。
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config="${1:?用法: ops/migrate.sh /绝对路径/flyway.conf [info|validate|migrate]}"
action="${2:-info}"
case "$action" in info|validate|migrate) ;; *) echo "仅允许 info、validate 或 migrate" >&2; exit 2;; esac
[[ "$config" = /* && -f "$config" ]] || { echo "请提供存在的配置文件绝对路径" >&2; exit 2; }
exec "$root/apps/server/mvnw" -B -f "$root/ops/pom.xml" "-Dflyway.configFiles=$config" "flyway:$action"
