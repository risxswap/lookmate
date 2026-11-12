# 交付数据库迁移

交付包通过独立的一次性 Compose 服务运行 `redgate/flyway:12.4.0`，SQL 从 `db/migrations/` 只读挂载。`server` 和 `all` 交付包还包含 `drivers/mysql-connector-j-9.7.0.jar`，以单文件只读挂载补齐官方 CLI 未附带的 MySQL Connector/J，沿用现有迁移驱动版本，不覆盖镜像原有 drivers 目录。部署机只需要 Docker 与 Compose，不需要本地 Java、Maven 或业务源码，不读取开发用 `.env.dev`。本版本迁移文件包含 V1–V11，应用启动只检查结构兼容性，不自动迁移。

## 首次配置

将交付包中的 ops 安装在稳定目录 `/srv/lookmate/ops`，进入该目录：

```sh
cp deploy/.env.example .env
chmod 600 .env
# 编辑 .env，填写已存在的迁移账号、密码与目标数据库。
docker compose --env-file .env config --quiet
docker compose --env-file .env pull flyway
bash migrate-compose.sh info
# 核对上一步显示的目标及待执行脚本，再执行：
bash migrate-compose.sh migrate
bash migrate-compose.sh validate
```

先创建外部网络并启动 MySQL、Redis，等待健康检查通过，再执行上述迁移。默认网络为 `lookmate`，数据库地址为 `lookmate-mysql:3306/lookmate`；所有组件网络一致。如果数据库在其他主机，将 FLYWAY_URL 改为可访问的内网地址。

`FLYWAY_USER` 必须为已存在、对目标库有迁移权限的账号，不能使用 root。初次初始化可与 MySQL 镜像的 MYSQL_USER/MYSQL_PASSWORD 对应；如已配置独立迁移账号，填写该账号并另行维护权限。迁移不建数据库、不创建账号；禁用 clean、自动 baseline 和自动建 schema。连接重试只处理建立连接，不是迁移失败后的自动重跑。

脚本只接受 `info`、`validate`、`migrate`，默认 info；其他操作与额外参数会在调用 Docker 之前被拒绝。凭据通过 Compose 环境进入容器，不出现在命令参数。`.env` 是 Compose dotenv，特殊字符用单引号包裹；不要分享展开后的 `docker compose config`。如需使用其他配置，可设置 `LOOKMATE_OPS_ENV=/绝对路径/迁移.env`，脚本从任意当前目录运行均定位自身 ops 目录。

官方 `redgate/flyway:12.4.0` 镜像当前提供 linux/amd64，模板显式选择该平台。ARM64 主机需具备相应仿真，或使用已核对的同版本 ARM64 镜像，同时修改 FLYWAY_IMAGE、FLYWAY_PLATFORM；未验证时不要假定目标机支持仿真。MySQL/Redis 镜像支持 Linux amd64 与 arm64，仍需按目标机器实际平台拉取验证。

## 升级与失败处理

保留稳定 ops 配置，将新交付包中的 SQL、Compose、模板及脚本同步到该目录后，先 info，再显式 migrate 和 validate。已执行的 SQL 不修改，新增版本随新应用一起交付。更新应用前应停止接收新任务并等待已有任务结束；完整维护协议和 deploy.sh 自动部署不属于本次交付。

MySQL DDL 不能按整个迁移事务回滚。迁移中断或 validate 失败时停止启动不兼容的新 server，核对实际结构和 Flyway 历史，不自动 clean、baseline、repair 或反复重试。回退程序版本前核对数据库兼容性，程序回退不等于撤销数据库变更。

在源码仓库使用此生产入口之前，先生成 `server` 或 `all` 交付包，使用其中配套的 ops（包含驱动）；不能只复制 Compose 和 SQL 就直接启动迁移。`ops/migrate.sh` 继续保留为本地开发入口，两者配置分开。生产与共享开发库迁移未由本次实现执行；Compose 解析不代表数据库迁移已验证。

参考：[Flyway 官方镜像](https://hub.docker.com/r/redgate/flyway)、[Flyway Docker 用法](https://github.com/flyway/flyway-docker/tree/main/flyway-docker)、[Flyway MySQL 驱动说明](https://documentation.red-gate.com/flyway/reference/database-driver-reference/mysql)、[Flyway 环境配置](https://documentation.red-gate.com/flyway/reference/configuration)。
