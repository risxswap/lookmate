# Redis

独立运行官方 `redis:7.4.11`，仅保存登录会话，默认仅发布到宿主机 `127.0.0.1:6379`。启用密码认证、AOF 每秒同步和 noeviction；达到内存上限时拒绝新增写入，不主动逐出已有会话。数据保存在本目录 `data/`，不随容器删除。

## 启动

在本目录运行：

```sh
cp .env.example .env
chmod 600 .env
# 编辑 .env，填写 REDIS_PASSWORD
docker compose config --quiet
docker compose up -d
docker compose ps
docker compose logs --tail 50 redis
```

`.env` 是 Compose dotenv 格式。密码含 `$` 等字符时用单引号包裹；不要分享展开后的 `docker compose config`，其中包含凭据。空密码会在 Compose 解析阶段报错。

`REDIS_PORT` 修改宿主机端口；`REDIS_DATA_DIR` 可指定绝对路径或相对于本目录的路径；`REDIS_MAXMEMORY` 默认 `256mb`，仅限制 Redis 数据内存，不是容器总内存限制；按实际会话容量调整。`REDIS_IMAGE` 固定补丁版本，也可使用同版本的已验证 digest。其余参数在 `config/redis.conf` 中维护。修改密码后重新创建容器并同步后端配置。

Redis 配置内监听 `0.0.0.0` 是为了接受容器端口转发，宿主机仍只绑定回环地址。密码由 Compose 作为参数传给 Redis，拥有 Docker 管理权限的人可查看它；不在仓库保存真实凭据。健康检查通过 `REDISCLI_AUTH` 认证，并严格检查响应为 `PONG`，不会把 `NOAUTH` 当成功。

## 后端连接

在项目根 `.env.dev`（Java properties）中对应配置，例如：

```properties
spring.data.redis.host=127.0.0.1
spring.data.redis.port=6379
spring.data.redis.password=填写REDIS_PASSWORD的实际值
spring.data.redis.database=0
```

按实际端口和密码填写。Java properties 的特殊字符按其规则转义，不要复制 Compose 的外围单引号。沿用后端 `lookmate:server:sessions` 命名空间，不存业务缓存或任务队列。

## 停止与运行边界

`docker compose stop` 停止，`docker compose up -d` 恢复；`docker compose down` 删除容器与网络，保留绑定数据。AOF everysec 在异常宕机时仍可能丢失最近约一秒写入，不保证会话绝对不丢失。备份暂缓，不把持久化视为备份。

容器日志设置轮转。默认独立网络，本机应用从回环端口连接；后续容器化应用按架构接入共同外部网络，不将容器内的 `127.0.0.1` 当作宿主机，不直接公开 Redis 端口。

本机无 Docker，容器运行待验证；本机二进制的隔离检查结果见 [本轮记录](../../docs/02-需求文档/2026-10-30-数据库中间件配置/01-需求说明.md)。官方说明：[Redis 镜像](https://hub.docker.com/_/redis)、[Redis 配置](https://redis.io/docs/latest/operate/oss_and_stack/management/config/)。
