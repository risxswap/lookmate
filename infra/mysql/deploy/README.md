# MySQL 生产部署

此目录使用独立 Compose 运行 `mysql:8.0.45`，通过外部网络 `lookmate` 的别名 `lookmate-mysql:3306` 供 server 和 ops 连接，不发布宿主机端口。部署机可以在线拉取镜像，不需要本地构建镜像。

以下命令在交付包安装后的稳定目录 `/srv/lookmate/infra/mysql` 执行。初次安装时复制模板一次，后续更新保留已有 `.env` 与数据目录：

```sh
cp .env.example .env
chmod 600 .env
# 编辑 .env，填写不同的 MYSQL_ROOT_PASSWORD 和 MYSQL_PASSWORD。
# MYSQL_DATA_DIR 填版本目录之外的绝对路径，以下示例与模板一致。
mkdir -p /srv/lookmate/infra/mysql/data
chmod 644 config/my.cnf
docker network inspect lookmate >/dev/null 2>&1 || docker network create lookmate
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
```

`MYSQL_DATA_DIR` 必须预先创建；配置缺失或挂载源不存在时停止启动，避免误用新空目录。`MYSQL_IMAGE` 可以改成同版本的已验证镜像地址或 digest，不使用 `latest`。`LOOKMATE_NETWORK` 如需调整，所有组件保持一致。不要同时启动开发与生产配置并指向同一个数据目录。

只有空数据目录会依据环境变量初始化数据库和账号。已有数据目录修改 `.env` 不会修改账号、密码或库名，不能通过删除目录来应用新密码。应用不使用 root；`MYSQL_USER` 和 `MYSQL_PASSWORD` 要与 server 配置相符。镜像初始化账号具有目标库权限，首次迁移可使用该账号；如已准备独立迁移账号，将其填入 ops，权限由运维按实际环境分配。

健康检查使用配置的业务账号查询目标库。等待 `docker compose ps` 显示 healthy，再运行 ops 的 `info`、`migrate`、`validate`，最后启动 server。容器不自动执行交付包中的 SQL。当前应用所需迁移包括 V11，迁移文件以同一交付包为准。

`.env` 使用 Compose dotenv 格式，含 `$` 等字符的密码用单引号包裹；复制到 server 的 Java properties 时去掉外围引号，并按 properties 规则转义。不要分享展开后的 `docker compose config`，其中含凭据。

`docker compose stop` 停止，`docker compose up -d` 恢复。数据绑定到独立宿主机目录，容器重建或 `docker compose down` 不删除该目录。日志由 Docker 轮转，持久化不代替备份。跨版本升级前核对镜像与数据兼容性，本交付脚本不升级或回滚数据库。

在源码仓库直接使用时，模板名为 `.env.prod.example`，Compose 名为 `docker-compose.prod.yml`；复制模板到 `.env.prod`，将上述每条 `docker compose` 命令替换为 `docker compose --env-file .env.prod -f docker-compose.prod.yml`。交付打包会归集为本文使用的标准文件名。

参考：[MySQL 官方镜像](https://hub.docker.com/_/mysql)、[Compose 外部网络](https://docs.docker.com/compose/how-tos/networking/)。容器运行、数据重启保留和实际数据库连接需在有 Docker 引擎的目标环境验证。
