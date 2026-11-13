#!/usr/bin/env bash
set -euo pipefail
umask 022

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
target=""
version=""
output_directory="$project_root/output"
output_set=false
version_set=false

usage() {
  cat <<'USAGE'
用法: ./package.sh [server|web|infra|all] [--version 版本] [--output 输出目录]

  server   构建后端，交付 JAR、运行配置和配套 ops 迁移文件及驱动
  web      构建 Web，交付静态文件、运行配置和宿主机 Nginx 接入示例
  infra    归集 MySQL/Redis 生产部署配置及 frp 调试配置
  all      交付以上全部组件（默认）

版本仅允许 1～64 位字母、数字、点、下划线和连字符，首位为字母或数字。
未指定版本时使用 UTC 时间，默认在 output/ 下平铺各组件目录。构建前自动清理旧交付产物。
构建需要 Java 21、Node.js >=24.22.0 <25 和 npm；infra 无需这些构建工具。
脚本不迁移数据库、不启动容器、不部署。使用 -h 或 --help 显示说明。
USAGE
}

fail() { echo "打包失败: $*" >&2; exit 2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --version)
      [[ $# -ge 2 && "$version_set" == false ]] || fail "--version 需要一个值，且只能指定一次"
      version="$2"; version_set=true; shift 2 ;;
    --version=*)
      [[ "$version_set" == false ]] || fail "--version 只能指定一次"
      version="${1#*=}"; version_set=true; shift ;;
    --output)
      [[ $# -ge 2 && "$output_set" == false ]] || fail "--output 需要一个值，且只能指定一次"
      output_directory="$2"; output_set=true; shift 2 ;;
    --output=*)
      [[ "$output_set" == false ]] || fail "--output 只能指定一次"
      output_directory="${1#*=}"; output_set=true; shift ;;
    server|web|infra|all)
      [[ -z "$target" ]] || fail "只能选择一个目标"
      target="$1"; shift ;;
    *) usage >&2; fail "未知参数: $1" ;;
  esac
done
target="${target:-all}"
if [[ "$version_set" == false ]]; then version="$(date -u +%Y%m%dT%H%M%SZ)"; fi
[[ "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ && ${#version} -le 64 ]] || fail "版本格式不正确"
[[ -n "$output_directory" && "$output_directory" != -* ]] || fail "输出目录不能为空或以连字符开头"
for tool in find sort sed cp date mktemp ln rm; do command -v "$tool" >/dev/null 2>&1 || fail "缺少工具 $tool"; done
if command -v sha256sum >/dev/null 2>&1; then
  hash_command=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
  hash_command=(shasum -a 256)
else
  fail "需要 sha256sum 或 shasum"
fi

mkdir -p "$output_directory"
output_directory="$(cd "$output_directory" && pwd -P)"
[[ "$output_directory" != / ]] || fail "输出目录不能为文件系统根目录"
case "$project_root/" in
  "$output_directory/"*) fail "输出目录不能为项目目录或其祖先目录" ;;
esac
for source_directory in apps infra ops tools docs .git .agents .codex; do
  case "$output_directory/" in
    "$project_root/$source_directory/"*) fail "输出目录不能位于项目源码目录: $source_directory" ;;
  esac
done
components=()
if [[ "$target" == server || "$target" == all ]]; then components+=(server ops); fi
if [[ "$target" == web || "$target" == all ]]; then components+=(web); fi
if [[ "$target" == infra || "$target" == all ]]; then components+=(mysql redis frp); fi
metadata_files=(README.md BUILD-INFO.properties SHA256SUMS)
lock_directory="$output_directory/.lookmate-package.lock"
mkdir "$lock_directory" 2>/dev/null || fail "此输出目录正在打包，或遗留锁目录尚未处理: $lock_directory"
temporary_directory=""
published_directories=()
cleanup() {
  local status=$?
  trap - EXIT
  if [[ $status -ne 0 ]]; then
    if [[ ${#published_directories[@]} -gt 0 ]]; then
      for destination in "${published_directories[@]}"; do rm -rf "$destination"; done
    fi
    for entry in "${metadata_files[@]}"; do
      if [[ -n "$temporary_directory" && "$output_directory/$entry" -ef "$temporary_directory/package/$entry" ]]; then rm -f "$output_directory/$entry"; fi
    done
  fi
  [[ -z "$temporary_directory" ]] || rm -rf "$temporary_directory"
  rmdir "$lock_directory" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
require_file() { [[ -f "$1" && ! -L "$1" && -s "$1" ]] || fail "文件缺失、为空或为符号链接: $1"; }
copy_file() {
  require_file "$project_root/$1"
  mkdir -p "$(dirname "$package_directory/$2")"
  cp "$project_root/$1" "$package_directory/$2"
}
copy_version_template() {
  require_file "$project_root/$1"
  grep -Fxq 'LOOKMATE_VERSION=CHANGE_ME' "$project_root/$1" || fail "版本模板缺少 LOOKMATE_VERSION=CHANGE_ME: $1"
  mkdir -p "$(dirname "$package_directory/$2")"
  sed "s/^LOOKMATE_VERSION=CHANGE_ME$/LOOKMATE_VERSION=$version/" "$project_root/$1" > "$package_directory/$2"
}

prepare_java() {
  local java_command java_properties detected_java_home
  java_command="${JAVA_HOME:+$JAVA_HOME/bin/}java"
  java_properties="$("$java_command" -XshowSettings:properties -version 2>&1 || true)"
  if ! grep -Eq 'java.specification.version = 21$' <<< "$java_properties" && [[ -x /usr/libexec/java_home ]]; then
    detected_java_home="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"
    if [[ -n "$detected_java_home" ]]; then
      java_command="$detected_java_home/bin/java"
      java_properties="$("$java_command" -XshowSettings:properties -version 2>&1 || true)"
    fi
  fi
  grep -Eq 'java.specification.version = 21$' <<< "$java_properties" || fail "后端构建需要 Java 21，请设置 JAVA_HOME"
  JAVA_HOME="$(sed -n 's/^[[:space:]]*java.home = //p' <<< "$java_properties")"
  [[ -x "$JAVA_HOME/bin/jar" ]] || fail "JAVA_HOME 必须指向包含 jar 工具的 JDK 21"
  export JAVA_HOME
}

prepare_node() {
  local node_version
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 || fail "Web 构建需要 Node.js 24 与 npm"
  node_version="$(node --version)"
  [[ "$node_version" =~ ^v24\.([0-9]+)\.[0-9]+$ && ${BASH_REMATCH[1]} -ge 22 ]] || fail "Web 构建需要 Node.js >=24.22.0 <25，当前 $node_version"
}

# all 在任何长构建之前检查两端工具链，避免后端构建完成后才发现 Node 不匹配。
if [[ "$target" == server || "$target" == all ]]; then prepare_java; fi
if [[ "$target" == web || "$target" == all ]]; then prepare_node; fi

echo "清理旧交付产物: $output_directory"
for entry in server web mysql redis frp ops "${metadata_files[@]}"; do
  rm -rf -- "$output_directory/$entry"
done
# 兼容之前的压缩包及版本交付目录，只匹配打包脚本生成的名称。
legacy_directories=("$output_directory")
if [[ -L "$output_directory/packages" ]]; then
  rm -f -- "$output_directory/packages"
elif [[ -d "$output_directory/packages" ]]; then
  legacy_directories+=("$output_directory/packages")
fi
for legacy_directory in "${legacy_directories[@]}"; do
  for legacy_path in "$legacy_directory"/lookmate-*; do
    legacy_name="${legacy_path##*/}"
    legacy_name="${legacy_name%.sha256}"
    legacy_name="${legacy_name%.tar.gz}"
    if [[ "$legacy_name" =~ ^lookmate-[A-Za-z0-9][A-Za-z0-9._-]*-(server|web|infra|all)$ ]]; then
      rm -rf -- "$legacy_path"
    fi
  done
done
rmdir "$output_directory/packages" 2>/dev/null || true
temporary_directory="$(mktemp -d "$output_directory/.lookmate-package.XXXXXX")"
package_directory="$temporary_directory/package"
mkdir -p "$package_directory"

if [[ "$target" == server || "$target" == all ]]; then
  echo "构建 server（Maven clean verify）"
  (cd "$project_root/apps/server" && ./mvnw -B clean verify)
  server_jar="$project_root/apps/server/target/lookmate-server.jar"
  require_file "$server_jar"
  driver_entry="BOOT-INF/lib/mysql-connector-j-9.7.0.jar"
  "$JAVA_HOME/bin/jar" --list --file "$server_jar" > "$temporary_directory/server-jar-entries.txt"
  grep -Fxq "$driver_entry" "$temporary_directory/server-jar-entries.txt" || fail "后端 JAR 缺少已锁定的 MySQL Connector/J 9.7.0"
  copy_file apps/server/target/lookmate-server.jar "server/releases/$version/lookmate-server.jar"
  copy_file apps/server/docker-compose.yml server/docker-compose.yml
  copy_version_template apps/server/deploy/.env.example server/deploy/.env.example
  copy_file apps/server/deploy/application.properties.example server/deploy/application.properties.example
  copy_file apps/server/deploy/README.md server/deploy/README.md
  copy_file ops/docker-compose.yml ops/docker-compose.yml
  copy_file ops/migrate-compose.sh ops/migrate-compose.sh
  copy_file ops/deploy/.env.example ops/deploy/.env.example
  copy_file ops/deploy/README.md ops/deploy/README.md
  migration_count=0
  for migration in "$project_root"/ops/db/migrations/V*__*.sql; do
    [[ -e "$migration" ]] || continue
    copy_file "${migration#"$project_root/"}" "ops/db/migrations/$(basename "$migration")"
    migration_count=$((migration_count + 1))
  done
  [[ $migration_count -gt 0 ]] || fail "没有可交付的 SQL 迁移文件"
  mkdir -p "$temporary_directory/driver" "$package_directory/ops/drivers"
  (cd "$temporary_directory/driver" && "$JAVA_HOME/bin/jar" xf "$server_jar" "$driver_entry")
  require_file "$temporary_directory/driver/$driver_entry"
  cp "$temporary_directory/driver/$driver_entry" "$package_directory/ops/drivers/mysql-connector-j-9.7.0.jar"
fi

if [[ "$target" == web || "$target" == all ]]; then
  echo "构建 web（npm ci、生产构建）"
  (cd "$project_root/apps/web" && npm ci && npm run build)
  web_dist="$project_root/apps/web/dist"
  require_file "$web_dist/index.html"
  [[ -d "$web_dist" && ! -L "$web_dist" ]] || fail "Web dist 必须为实际目录"
  find "$web_dist" -type l -print > "$temporary_directory/web-links.txt"
  [[ ! -s "$temporary_directory/web-links.txt" ]] || fail "Web 产物不能包含符号链接"
  find "$web_dist" \( -name '.env*' -o -name '*.pem' -o -name '*.key' -o -name 'node_modules' -o -name '.git' \) -print > "$temporary_directory/web-private-files.txt"
  [[ ! -s "$temporary_directory/web-private-files.txt" ]] || fail "Web 产物包含环境配置、私钥或开发目录"
  mkdir -p "$package_directory/web/releases/$version/dist"
  cp -R "$web_dist/." "$package_directory/web/releases/$version/dist/"
  copy_file apps/web/docker-compose.yml web/docker-compose.yml
  copy_version_template apps/web/deploy/.env.example web/deploy/.env.example
  copy_file apps/web/deploy/default.conf.template web/deploy/default.conf.template
  copy_file apps/web/deploy/host-nginx.conf.example web/deploy/host-nginx.conf.example
  copy_file apps/web/deploy/README.md web/deploy/README.md
fi

if [[ "$target" == infra || "$target" == all ]]; then
  for component in mysql redis; do
    copy_file "infra/$component/docker-compose.prod.yml" "$component/docker-compose.yml"
    copy_file "infra/$component/.env.prod.example" "$component/.env.example"
    copy_file "infra/$component/deploy/README.md" "$component/README.md"
  done
  copy_file infra/mysql/config/my.cnf mysql/config/my.cnf
  copy_file infra/redis/config/redis.conf redis/config/redis.conf
  for entry in docker-compose.yml frp.sh README.md .env.example config/frpc.toml config/frps.toml; do
    copy_file "infra/frp/$entry" "frp/$entry"
  done
fi

copy_file tools/package/README.md README.md
git_commit=unknown
git_worktree=unknown
if command -v git >/dev/null 2>&1 && git -C "$project_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git_commit="$(git -C "$project_root" rev-parse HEAD)"
  if [[ -z "$(git -C "$project_root" status --porcelain --untracked-files=normal)" ]]; then git_worktree=clean; else git_worktree=dirty; fi
fi
cat > "$package_directory/BUILD-INFO.properties" <<INFO
version=$version
target=$target
builtAtUtc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
gitCommit=$git_commit
gitWorktree=$git_worktree
INFO
find "$package_directory" -type d -exec chmod 755 {} +
find "$package_directory" -type f -exec chmod 644 {} +
if [[ -f "$package_directory/ops/migrate-compose.sh" ]]; then chmod 755 "$package_directory/ops/migrate-compose.sh"; fi
if [[ -f "$package_directory/frp/frp.sh" ]]; then chmod 755 "$package_directory/frp/frp.sh"; fi
(
  cd "$package_directory"
  find . -type f ! -name SHA256SUMS -print | LC_ALL=C sort > "$temporary_directory/file-list.txt"
  while IFS= read -r entry; do "${hash_command[@]}" "$entry"; done < "$temporary_directory/file-list.txt" > SHA256SUMS
)
# 构建和归集成功后再发布，独占创建目标目录，失败时只清理本次创建的目录。
for component in "${components[@]}"; do
  destination="$output_directory/$component"
  mkdir "$destination"
  published_directories+=("$destination")
  cp -R "$package_directory/$component/." "$destination/"
done
for entry in "${metadata_files[@]}"; do ln "$package_directory/$entry" "$output_directory/$entry"; done
echo "交付目录: $output_directory"
echo "校验文件: $output_directory/SHA256SUMS"
