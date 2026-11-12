# web 运行配置

使用固定 `nginx:1.30.6-alpine` 镜像挂载已构建的静态文件，无需 Node.js，也不构建应用镜像。Compose 位于本目录的上一级；生产静态文件位于 `releases/<版本>/dist/`。

## 首次准备

将交付包中的 web 组件放到稳定目录，例如 `/srv/lookmate/apps/web`，在该目录执行：

```sh
cp deploy/.env.example .env
mkdir -p config/templates
cp deploy/default.conf.template config/templates/default.conf.template
chmod 600 .env
```

填写 `.env` 的版本、实际绝对配置目录和网络名。容器内配置模板由官方 Nginx 启动脚本读取，只替换 `LOOKMATE_SERVER_UPSTREAM`，保留 `$uri` 等 Nginx 变量。模板挂载只读，渲染结果由镜像写入容器 `/etc/nginx/conf.d/`。不要改成覆盖挂载只读的整个 conf.d，否则入口脚本无法生成配置。

先创建共同外部网络并启动 server，再执行：

```sh
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose exec web nginx -t
docker compose ps
curl --fail http://127.0.0.1:18081/healthz
```

默认 HTTP 仅映射 `127.0.0.1:18081:80`，该端口可由 `WEB_PORT` 修改。server 默认通过 `lookmate-server:8080` 访问，不映射到宿主机。Docker DNS 每10秒重新解析到期地址，server 容器重建后无需手动修改 IP；解析刷新前短时请求可能失败，写请求不自动重试。

## 接入宿主机 HTTPS Nginx

将 `host-nginx.conf.example` 的 location 合并到已有站点 HTTPS server 块，沿用域名、证书、TLS 和 HTTP 跳转配置。已有同路径 location 时先合并，不重复声明。若该域名还提供其他应用，改用专用子域名；本模板按根路径部署单页应用。

宿主机 Nginx 先覆盖客户端传入的转发头，再转发给 web。web 保留原始 Host、HTTPS、端口与客户端地址并转给 server；不能直接公开 web 回环端口，或在它前面增加不受控代理。示例按当前宿主机 Nginx 为公网入口处理，若以后增加 CDN/负载均衡，需重新配置入口真实 IP 信任范围。

在宿主机执行 `nginx -t`，成功后按原有方式 reload，并从 HTTPS 域名验证页面、登录、Cookie 与 `/api`。本次仅提供配置，不自动改宿主机站点或 reload。小程序使用的 HTTPS API 域名也可指向这条 `/api` 代理链路。

静态 History 路由回退到 index.html，`/api` 和 `/api/...` 原样代理且不回退页面；`/assets/` 缺失文件返回404。index.html 禁止复用旧缓存，带哈希的 assets 可长期缓存。静态图片和用户原图仍按既有文件接口及七牛流程处理；本入口请求体上限2m，不承担原图直传。

## 更新

保留实际 `.env` 与 config/templates，复制新静态版本到 releases，修改 `LOOKMATE_VERSION` 后执行 `docker compose up -d`。Nginx 模板修改后也需重建容器；不要以新模板直接覆盖已调整的实际配置。`/healthz` 仅检查本 web 进程响应，不证明后端或数据库可用。

官方参考：[Nginx 镜像标签](https://github.com/docker-library/official-images/blob/master/library/nginx)、[官方环境模板脚本](https://github.com/nginx/docker-nginx/blob/master/entrypoint/20-envsubst-on-templates.sh)、[Nginx proxy_pass](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass)。
