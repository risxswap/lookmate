#!/usr/bin/env bash
set -euo pipefail
FRP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
fail() { printf 'frp: %s\n' "$*" >&2; exit 1; }
config_file="${LOOKMATE_FRP_CONFIG:-$FRP_DIR/.env}"
[[ -f "$config_file" ]] || fail "缺少配置，请复制 infra/frp/.env.example 为 .env 并填写；也可设置 LOOKMATE_FRP_CONFIG。"
set -a
# 此文件是用户维护的可信 Bash 配置，不读取外部输入。
source "$config_file"
: "${FRP_SERVER_PORT:=7000}" "${FRP_REMOTE_PORT:=18080}" "${FRP_LOCAL_PORT:=8080}"
: "${FRP_LOCAL_IP:=127.0.0.1}" "${FRP_PROXY_NAME:=lookmate-dev}" "${FRPC_BIN:=frpc}"
: "${FRP_TOKEN:=}"
: "${FRP_TLS_CA_FILE:=}" "${FRP_TLS_SERVER_NAME:=}" "${FRP_TLS_CERT_FILE:=}" "${FRP_TLS_KEY_FILE:=}"
: "${FRP_NGINX_READ_TIMEOUT:=60s}"
set +a
port() { [[ "$2" =~ ^[1-9][0-9]{0,4}$ ]] && (( 10#$2 <= 65535 )) || fail "$1 必须为 1–65535 的端口，不能有前导零"; }
port FRP_SERVER_PORT "$FRP_SERVER_PORT"
port FRP_REMOTE_PORT "$FRP_REMOTE_PORT"
port FRP_LOCAL_PORT "$FRP_LOCAL_PORT"
[[ "$FRP_SERVER_PORT" != "$FRP_REMOTE_PORT" ]] || fail '连接端口与业务映射端口不能相同'
case "${1:-}" in
  client|verify)
    [[ -n "${FRP_SERVER_ADDR:-}" ]] || fail '请填写 FRP_SERVER_ADDR'
    [[ ${#FRP_TOKEN} -ge 32 ]] || fail 'FRP_TOKEN 至少需要 32 个字符'
    [[ -z "$FRP_TLS_CA_FILE" || -f "$FRP_TLS_CA_FILE" ]] || fail 'FRP_TLS_CA_FILE 文件不存在'
    command -v "$FRPC_BIN" >/dev/null 2>&1 || fail '找不到 FRPC_BIN 指定的 frpc，请按 README 安装'
    if [[ "$1" == verify ]]; then exec "$FRPC_BIN" verify -c "$FRP_DIR/config/frpc.toml"; fi
    exec "$FRPC_BIN" -c "$FRP_DIR/config/frpc.toml"
    ;;
  server)
    [[ ${#FRP_TOKEN} -ge 32 ]] || fail 'FRP_TOKEN 至少需要 32 个字符'
    [[ -z "$FRP_TLS_CERT_FILE" && -z "$FRP_TLS_KEY_FILE" || -n "$FRP_TLS_CERT_FILE" && -n "$FRP_TLS_KEY_FILE" ]] || fail '服务端证书与私钥必须同时设置'
    mkdir -p "$FRP_DIR/certs"
    shift
    # 使用已导出的 Bash 配置，禁用 Compose 再次按 dotenv 解释配置。
    exec docker compose --env-file /dev/null --project-directory "$FRP_DIR" -f "$FRP_DIR/docker-compose.yml" "${@:-up}"
    ;;
  nginx)
    [[ "${FRP_DOMAIN:-}" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || fail '请填写单个 FRP_DOMAIN 域名'
    for value in "${FRP_NGINX_CERT_FILE:-}" "${FRP_NGINX_KEY_FILE:-}"; do
      [[ "$value" == /* && "$value" != *[\"\$\;\{\}\\]* && "$value" != *$'\n'* ]] || fail 'Nginx 证书路径需为绝对路径，不能包含引号、变量或配置控制字符'
    done
    [[ "$FRP_NGINX_READ_TIMEOUT" =~ ^[1-9][0-9]*[sm]$ ]] || fail 'FRP_NGINX_READ_TIMEOUT 示例：60s'
    cat <<EOF
# 合并到已有 Nginx 配置，勿重复声明同域名 server；先 nginx -t 再 reload。
server {
    listen 443 ssl;
    server_name $FRP_DOMAIN;
    ssl_certificate "$FRP_NGINX_CERT_FILE";
    ssl_certificate_key "$FRP_NGINX_KEY_FILE";
    location / {
        proxy_pass http://127.0.0.1:$FRP_REMOTE_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout $FRP_NGINX_READ_TIMEOUT;
    }
}
EOF
    ;;
  *) fail '用法：bash infra/frp/frp.sh client|verify|nginx|server [compose 参数]';;
esac
