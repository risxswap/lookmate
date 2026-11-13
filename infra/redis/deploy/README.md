# Redis 生产部署

此目录使用独立 Compose 运行 `redis:7.4.11`，通过外部网络 `lookmate` 的别名 `lookmate-redis:6379` 供 server 连接，不发布宿主机端口。Redis 仅保存登录会话，启用认证、AOF everysec 和 noeviction。

以下命令在稳定安装目录 `/opt/lookmate/redis` 执行。初次安装时复制一次模板，更新时保留已有 `.env` 与数据目录：

```sh
cp .env.example .env
chmod 600 .env
# 编辑 .env，填写 REDIS_PASSWORD。
# REDIS_DATA_DIR 填版本目录之外的绝对路径，以下示例与模板一致。
mkdir -p /opt/lookmate/redis/data
docker network inspect lookmate >/dev/null 2>&1 || docker network create lookmate
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
```

`REDIS_DATA_DIR` 必须预先创建。`REDIS_PASSWORD` 与 server 配置保持一致；修改后需重新创建 Redis 容器并同步 server。含 `$` 等字符的密码用 Compose 单引号包裹，填入 server 的 Java properties 时按其规则处理，不能照搬外围单引号。

`REDIS_IMAGE` 可改为同版本的已验证镜像地址或 digest，不使用 `latest`。所有组件的 `LOOKMATE_NETWORK` 保持一致。不要同时启动开发和生产配置并使用同一数据目录。健康检查需要认证并严格返回 PONG，等待 healthy 后再启动 server。不要分享展开后的 `docker compose config`，其中包含密码。

`REDIS_MAXMEMORY` 默认 `256mb`，限制数据内存；达到上限时拒绝新增写入，不主动淘汰有效会话。这不是容器总内存限制，部署时需留出进程与持久化开销。密码由环境传给容器，拥有 Docker 管理权限的人仍可读取环境配置。

`docker compose stop` 停止，`docker compose up -d` 恢复。`docker compose down` 不删除宿主机数据目录。AOF everysec 异常宕机可能丢失最近约一秒写入；持久化不等于备份，也不承诺登录会话绝对不丢失。日志由 Docker 轮转。

在源码仓库直接使用时，模板名为 `.env.prod.example`，Compose 名为 `docker-compose.prod.yml`；复制模板到 `.env.prod`，将上述每条 `docker compose` 命令替换为 `docker compose --env-file .env.prod -f docker-compose.prod.yml`。交付打包会归集为本文使用的标准文件名。

参考：[Redis 官方镜像](https://hub.docker.com/_/redis)、[Compose 外部网络](https://docs.docker.com/compose/how-tos/networking/)。容器启动、认证、数据重启保留及后端连接仍需在目标 Docker 环境验证。
