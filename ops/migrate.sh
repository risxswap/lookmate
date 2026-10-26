#!/usr/bin/env bash
set -euo pipefail
# 与后端共享 apps/server/.env.dev 的 Java properties 配置；不创建数据库或自动迁移。
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
action="${1:-info}"
case "$action" in info|validate|migrate) ;; *) echo "用法: ops/migrate.sh [info|validate|migrate]" >&2; exit 2;; esac
[[ "$#" -le 1 ]] || { echo "配置路径请通过 LOOKMATE_DEV_CONFIG 指定" >&2; exit 2; }
java_command="${JAVA_HOME:+$JAVA_HOME/bin/}java"
# Java 8 会把源码路径当作类名；同时保证 Maven 使用同一套 Java 21。
java_properties="$("$java_command" -XshowSettings:properties -version 2>&1 || true)"
if ! grep -Eq 'java.specification.version = 21$' <<< "$java_properties"; then
    if [[ -x /usr/libexec/java_home ]]; then
        detected_java_home="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"
        if [[ -n "$detected_java_home" ]]; then
            java_command="$detected_java_home/bin/java"
            java_properties="$("$java_command" -XshowSettings:properties -version 2>&1 || true)"
        fi
    fi
fi
if ! grep -Eq 'java.specification.version = 21$' <<< "$java_properties"; then
    echo "数据迁移需要 Java 21，请安装并将 JAVA_HOME 指向 Java 21。" >&2
    exit 2
fi
JAVA_HOME="$(sed -n 's/^[[:space:]]*java.home = //p' <<< "$java_properties")"
export JAVA_HOME
exec "$java_command" "$root/ops/RunMigration.java" "$root" "$action"
