# MySQL

独立运行官方 `mysql:8.0.45`，默认仅发布到宿主机 `127.0.0.1:3306`，供本地 IDE 后端连接。配置使用 utf8mb4、utf8mb4_bin 和 UTC；数据保存在本目录的 `data/`，与容器生命周期分离。

## 启动

在本目录运行：

```sh
cp .env.example .env
chmod 600 .env
# 编辑 .env，填写不同的 MYSQL_ROOT_PASSWORD 和 MYSQL_PASSWORD
chmod 644 config/my.cnf
docker compose config --quiet
docker compose up -d
docker compose ps
docker compose logs --tail 50 mysql
```

配置文件必须可读且不能全局可写，MySQL 会忽略全局可写的配置文件。`.env` 是 Compose dotenv 格式，不是后端的 Java properties；密码含 `$` 等字符时用单引号包裹。不要分享展开后的 `docker compose config`，其中包含凭据。

`MYSQL_PORT` 修改宿主机端口；`MYSQL_DATA_DIR` 可指定已有绝对路径或相对于本目录的路径；`MYSQL_DATABASE`、`MYSQL_USER`、两种密码用于首次初始化。镜像默认固定补丁版本，也可将 `MYSQL_IMAGE` 配为同版本的已验证 digest。其余 MySQL 参数在 `config/my.cnf` 中维护。

只有空数据目录会按这些环境变量创建数据库和账号。已有目录修改环境变量不会改密码、账号或库名，应通过数据库管理操作处理，不能删除数据目录来套用新配置。开发账号拥有指定库的权限，可供本地显式迁移；生产迁移账号与运行账号的权限拆分不在本配置范围内。不要使用 root 作为应用账号。

## 后端与迁移

在项目根 `.env.dev`（Java properties）中对应配置，例如：

```properties
spring.datasource.url=jdbc:mysql://127.0.0.1:3306/lookmate?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true
spring.datasource.username=lookmate
spring.datasource.password=填写MYSQL_PASSWORD的实际值
```

按实际端口、数据库和账号修改；Java properties 中的反斜杠等字符需按其规则转义，不能直接复制 Compose 的外围单引号。数据源由当前 MySQL JDBC 驱动处理，认证与 TLS 参数按实际开发环境配置，不在此关闭认证或自动开放公网。

基础设施不会自动运行 `ops/db/migrations/`。新空库创建后，先从项目根执行 `bash ops/migrate.sh info` 确认目标，再按 [迁移说明](../../ops/README.md) 显式迁移，最后启动后端。本次仅创建配置，未执行这些迁移命令。

## 停止与运行边界

`docker compose stop` 停止，`docker compose up -d` 恢复，`docker compose down` 删除容器与网络但保留绑定的数据目录。不要删除数据目录。健康检查使用配置账号执行 `SELECT 1`；密码错误或目标库不可用不会判为健康。容器日志设置轮转。

默认独立 Compose 网络用于该组件，本机应用经宿主机回环端口连接。后续容器化应用需按架构接入共同的外部网络；不要把其 `127.0.0.1` 当成宿主机，也不要为容器连通直接公开数据库端口。备份方案暂缓，本配置的持久化不等于备份。

本机无 Docker 引擎，本轮已使用临时 Compose 二进制完成配置解析检查，镜像拉取、容器启动、健康检查与数据重启保留需在 Docker 环境验证。官方说明：[MySQL 镜像](https://hub.docker.com/_/mysql)。
