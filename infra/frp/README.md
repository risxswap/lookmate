# frp 开发调试

小程序 → 现有宿主机 Nginx（HTTPS）→ 宿主机回环映射端口 → frps 容器 → 本机 frpc → 本地后端。仅调试时启动本机隧道，不发布 Web、MySQL 或 Redis。

## 版本与准备

两端使用官方 [frp v0.71.1](https://github.com/fatedier/frp/releases/tag/v0.71.1)，服务端镜像固定为 `ghcr.io/fatedier/frps:v0.71.1`。下载本机系统对应的压缩包和同一发布中的 `frp_sha256_checksums.txt`，先用 `shasum -a 256`（Linux 可用 `sha256sum`）核对该压缩包的完整摘要，再解压。不要执行未校验的下载文件。把 `frpc` 放在 PATH 或用 `FRPC_BIN` 指定绝对路径。Apple Silicon Mac 对应 `frp_0.71.1_darwin_arm64.tar.gz`，本次官方发布摘要为 `d15d0324b99e14619c9aa46e37f6db588c06a09be4bc6f7948890b6b61077842`。

公网机需要 Docker Compose 插件，Nginx 已在宿主机运行。本机需要 Bash 与 frpc，无需 Docker。两端各复制一份配置并按职责填写：

```sh
cp infra/frp/.env.example infra/frp/.env
chmod 600 infra/frp/.env
openssl rand -hex 32
```

最后一条生成 token，安全地填入两端的 `FRP_TOKEN`，不要提交或粘贴到日志。`.env` 是由 Bash `source` 的可信本机配置；含空格、美元符号等字符的值用单引号包裹，不加载不可信文件。可用 `LOOKMATE_FRP_CONFIG=/绝对路径/配置文件` 指定另一份配置。各命令不会修改原配置。

| 配置 | 用途 |
| --- | --- |
| `FRP_SERVER_ADDR` | 本机 frpc 连接的公网 IP 或域名，不含协议和端口 |
| `FRP_SERVER_PORT` | 隧道连接端口，默认 7000，两端一致 |
| `FRP_REMOTE_PORT` | 业务映射端口，默认 18080，两端和 Nginx 一致 |
| `FRP_TOKEN` | 两端相同的认证凭据，至少 32 字符 |
| `FRP_LOCAL_IP` / `FRP_LOCAL_PORT` | 后端地址，默认 127.0.0.1:8080 |
| `FRP_PROXY_NAME` | 隧道名称，多个开发机须使用不同名称和映射端口 |
| `FRPC_BIN` | 本机二进制路径，可含空格 |
| `FRPS_IMAGE` / `FRP_BIND_IP` | 固定服务端镜像和隧道端口监听 IP |
| `FRP_DOMAIN` | 小程序访问的 HTTPS 域名 |
| `FRP_NGINX_CERT_FILE` / `FRP_NGINX_KEY_FILE` | 宿主机证书和私钥绝对路径 |
| `FRP_NGINX_READ_TIMEOUT` | Nginx 响应等待时间，默认 60s |

业务映射仅发布到宿主机 `127.0.0.1`，该边界不提供公网绑定配置。frps 只允许配置中的一个映射端口；增加另一开发机需另行设计端口分配。

## 公网端

复制 `infra/frp/` 到公网机，在该机器填写 `.env` 的 token、端口、域名和证书路径。以下从项目根目录运行；若单独复制目录，也可通过脚本绝对路径调用。

```sh
bash infra/frp/frp.sh server config --quiet
bash infra/frp/frp.sh server run --rm --no-deps frps verify -c /etc/frp/frps.toml
bash infra/frp/frp.sh server up -d
bash infra/frp/frp.sh server logs --tail 50 frps
mkdir -p infra/frp/runtime
bash infra/frp/frp.sh nginx > infra/frp/runtime/nginx.conf
```

把生成的 Nginx 内容合并到已有站点配置；同域名已有 server 时只合并对应 location，避免重复声明。随后在公网机执行 `nginx -t`，通过后再 reload。脚本只生成示例，不自动安装或重载 Nginx。若现有域名还承载其他应用，请使用专用调试子域名或自行调整路由。

公网防火墙允许 HTTPS 和 `FRP_SERVER_PORT`；不要开放 `FRP_REMOTE_PORT`。容器内监听 `0.0.0.0` 是为了接受 Docker 转发，宿主机业务端口仍仅绑定回环地址。停止 frps：`bash infra/frp/frp.sh server down`。不要直接输出 `docker compose config`（不带 `--quiet`）并分享，展开后的配置含 token。

## 本机调试

填写本机 `.env` 的公网地址、端口和 token，然后：

```sh
bash infra/frp/frp.sh verify
bash infra/frp/frp.sh client
```

也可在 VS Code 中先选“启动后端”，再选“启动 frp 隧道”。launch.json 使用独立入口，不启动前端、不安装常驻服务；配置文件位置由该入口的 `LOOKMATE_FRP_CONFIG` 指定。脚本通过 `exec` 前台运行 frpc，终端中按 Ctrl+C 结束。IDE 的停止按钮是否关闭该终端需实际验证；如终端仍在运行，应 Ctrl+C 或关闭该终端，并确认日志出现退出且公网请求失败。

隧道不运行、机器休眠、断网或后端停止时，小程序请求会失败；重新启动后恢复访问，不自动重提生成任务。这个中间件只建立网络通道，小程序登录与会话方案仍待实现；不改变后端权限、CSRF、Cookie 或可信代理配置。后端目前不信任转发头，真实域名与登录行为需要联调，不能把连通视为小程序完整登录可用。

## 隧道 TLS

frps 强制 TLS，frpc 启用 TLS；默认使用 frp 内建证书，客户端不校验服务端身份，token 用于客户端认证。若需服务端身份校验，将服务端证书和私钥放到公网 `infra/frp/certs/`，设置 `FRP_TLS_CERT_FILE=/etc/frp/certs/server.crt`、`FRP_TLS_KEY_FILE=/etc/frp/certs/server.key`。本机设置 `FRP_TLS_CA_FILE` 为信任的 CA PEM 绝对路径，并设置匹配证书的 `FRP_TLS_SERVER_NAME`。这些配置不替代 Nginx 的 HTTPS 证书设置。私钥、CA 和 token 均不入库。

配置模板使用 frp 官方环境变量渲染，字符串按引号转义；参考 [配置与 verify](https://gofrp.org/en/docs/features/common/configure/) 和 [TLS](https://gofrp.org/en/docs/features/common/network/network-tls/)。实际公网地址、端口占用、Nginx 配置及微信开发者工具/真机域名设置须在部署环境验证。
